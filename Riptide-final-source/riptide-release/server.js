'use strict';

// Shared local/serverless backend. See VERCEL.md and README before deployment.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  openDatabase
} = require('./storage.js');
const {
  calculate
} = require('./model.js');
const ROLES = ['admin', 'relief', 'hydrology', 'rescue', 'verification'];
const ACTIONS = {
  admin: ['pumps', 'gate', 'sandbags', 'clearDrain', 'manualReroute', 'siren', 'broadcast'],
  hydrology: ['pumps', 'gate', 'sandbags', 'clearDrain'],
  rescue: ['manualReroute', 'siren'],
  relief: ['broadcast'],
  verification: []
};
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
async function buildApp() {
  const DATA = process.env.RIPTIDE_DATA_DIR || path.join(ROOT, 'data');
  const PREVIEW_COOKIES = process.env.RIPTIDE_PREVIEW_COOKIES === 'true';
  const SECURE_COOKIES = !!process.env.VERCEL || process.env.RIPTIDE_SECURE_COOKIES === 'true';
  const MAX_BODY = 7_500_000;
  const SESSION_MS = 12 * 60 * 60 * 1000;
  const db = openDatabase(DATA);
  return db.withRequest(async () => {
    if (db.remote) await db.exec('BEGIN IMMEDIATE');
    await db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','relief','hydrology','rescue','verification')), salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scenario (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('report','sos','support')), payload TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, received_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','acknowledged','resolved')));
CREATE TABLE IF NOT EXISTS attachments (item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS items_received_idx ON items(received_at DESC); CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);`);
    // Existing databases are upgraded in place; accounts remain enabled by default.
    if (!(await db.prepare('PRAGMA table_info(users)').all()).some(column => column.name === 'active')) await db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))');
    // Rebuild the legacy role constraint without changing account IDs or related records.
    if ((await db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get()).sql.includes("'responder'")) {
      await db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
 CREATE TABLE users_new (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','relief','hydrology','rescue','verification')), salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
 INSERT INTO users_new SELECT id,username,CASE role WHEN 'responder' THEN 'rescue' WHEN 'support' THEN 'relief' ELSE role END,salt,password_hash,created_at,active FROM users;
 DROP TABLE users; ALTER TABLE users_new RENAME TO users; DELETE FROM sessions; COMMIT; PRAGMA foreign_keys=ON;`);
    }
    await db.exec(`CREATE TABLE IF NOT EXISTS staff_alerts (id INTEGER PRIMARY KEY, sender_id INTEGER NOT NULL REFERENCES users(id), sender_name TEXT NOT NULL, sender_role TEXT NOT NULL, recipient_id INTEGER NOT NULL REFERENCES users(id), message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL);`);
    try {
      fs.chmodSync(path.join(DATA, 'riptide.sqlite'), 0o600);
    } catch {}
    const now = () => new Date().toISOString();
    const digest = value => crypto.createHash('sha256').update(value).digest('hex');
    const passwordHash = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
    async function createUser(username, password, role) {
      const salt = crypto.randomBytes(16).toString('hex');
      await db.prepare('INSERT INTO users(username,role,salt,password_hash,created_at) VALUES(?,?,?,?,?)').run(username, role, salt, passwordHash(password, salt), now());
    }
    // Bootstrap only into an empty user database. Never ships with a default password.
    if (!(await db.prepare('SELECT 1 FROM users LIMIT 1').get()) && process.env.RIPTIDE_ADMIN_USER && process.env.RIPTIDE_ADMIN_PASSWORD) {
      const username = process.env.RIPTIDE_ADMIN_USER.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,64}$/.test(username) || process.env.RIPTIDE_ADMIN_PASSWORD.length < 12 || process.env.RIPTIDE_ADMIN_PASSWORD.length > 256) throw new Error('Invalid bootstrap admin credentials: username 3-64 characters, password at least 12 characters.');
      await createUser(username, process.env.RIPTIDE_ADMIN_PASSWORD, 'admin');
      console.log('Bootstrap admin created. Remove the bootstrap credentials from the environment.');
    }
    // Explicit opt-in only: these credentials are intentionally public demo access.
    const DEMO_MODE = process.env.RIPTIDE_DEMO_MODE === 'true';
    const DEMO_ACCOUNTS = [{
      username: 'demo.admin',
      role: 'admin',
      password: 'Demo-Admin-2026!'
    }, {
      username: 'demo.relief',
      role: 'relief',
      password: 'Demo-Relief-2026!'
    }, {
      username: 'demo.hydrology',
      role: 'hydrology',
      password: 'Demo-Hydrology-2026!'
    }, {
      username: 'demo.rescue',
      role: 'rescue',
      password: 'Demo-Rescue-2026!'
    }, {
      username: 'demo.verification',
      role: 'verification',
      password: 'Demo-Verify-2026!'
    }];
    if (DEMO_MODE) for (const account of DEMO_ACCOUNTS) {
      if (!(await db.prepare('SELECT id FROM users WHERE username=?').get(account.username))) await createUser(account.username, account.password, account.role);
    }
    if (DEMO_MODE && !(await db.prepare('SELECT 1 FROM scenario WHERE id=1').get())) {
      const baseline = {
        ...calculate({
          water: 2.6,
          velocity: 1.2,
          rainfall: 35,
          blockage: 40,
          gate: 50,
          pumps: 1,
          sandbags: false
        }),
        updatedAt: now(),
        revision: 1
      };
      await db.prepare('INSERT INTO scenario(id,data,updated_at) VALUES(1,?,?)').run(JSON.stringify(baseline), baseline.updatedAt);
    }
    await db.exec(`CREATE TABLE IF NOT EXISTS operator_work (id INTEGER PRIMARY KEY, role TEXT NOT NULL, actor TEXT NOT NULL, location TEXT NOT NULL, detail TEXT NOT NULL, quantity INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL);`);
    await db.exec(`CREATE TABLE IF NOT EXISTS alert_replies (id INTEGER PRIMARY KEY, alert_id INTEGER NOT NULL REFERENCES staff_alerts(id), sender_id INTEGER NOT NULL REFERENCES users(id), sender_name TEXT NOT NULL, sender_role TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS replies_alert_idx ON alert_replies(alert_id,id);`);
    await db.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS limits_expiry_idx ON rate_limits(expires_at);');
    const MEDIA_CHUNK=393216;
    await db.exec(`CREATE TABLE IF NOT EXISTS media_uploads (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS media_chunks (upload_id TEXT NOT NULL REFERENCES media_uploads(id) ON DELETE CASCADE, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(upload_id,part));`);
    async function uploadedMedia(body){
      if(!body.media?.uploadId)return body;
      if(body.type!=='report')throw err(400,'Only reports accept attachments');
      const upload=await db.prepare('SELECT * FROM media_uploads WHERE id=?').get(body.media.uploadId);
      if(!upload||upload.created_at<Date.now()-3600000||typeof body.media.uploadToken!=='string'||digest(body.media.uploadToken)!==upload.token_hash)throw err(400,'Upload is unavailable or expired');
      const parts=await db.prepare('SELECT part,bytes FROM media_chunks WHERE upload_id=? ORDER BY part').all(upload.id);
      if(parts.length!==Math.ceil(upload.size/MEDIA_CHUNK)||parts.some((part,i)=>part.part!==i))throw err(400,'Upload is incomplete');
      const bytes=Buffer.concat(parts.map(p=>Buffer.from(p.bytes)));if(bytes.length!==upload.size)throw err(400,'Upload size mismatch');
      return {...body,media:{name:upload.name,data:'data:'+upload.mime+';base64,'+bytes.toString('base64')}};
    }
    async function audit(actor, action, target) {
      await db.prepare('INSERT INTO audit(actor,action,target,at) VALUES(?,?,?,?)').run(actor, action, target, now());
    }
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    };
    function json(res, code, value, extra = {}) {
      res.writeHead(code, {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        ...extra
      });
      res.end(JSON.stringify(value));
    }
    function err(code, message) {
      return Object.assign(new Error(message), {
        status: code
      });
    }
    function text(value, field, max, required = true) {
      if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw err(400, `Invalid ${field}`);
      return value.trim();
    }
    function secret(value) {
      if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw err(400, 'Invalid password');
      return value;
    }
    function isSameOrigin(req) {
      if (req.headers['sec-fetch-site'] === 'cross-site') return false;
      if (!req.headers.origin) return true; // Non-browser clients; cookies are SameSite=Strict.
      try {
        return new URL(req.headers.origin).host === req.headers.host;
      } catch {
        return false;
      }
    }
    function requestToken(req) {
      const browserSessions = PREVIEW_COOKIES || DEMO_MODE;
      const previewHeader = browserSessions && req.headers['x-riptide-session'];
      if (typeof previewHeader === 'string' && /^[a-f0-9]{64}$/.test(previewHeader)) return previewHeader;
      const bearer = browserSessions && (req.headers.authorization || '').match(/^Bearer ([a-f0-9]{64})$/);
      if (bearer) return bearer[1];
      return (req.headers.cookie || '').match(/(?:^|;\s*)riptide_session=([a-f0-9]{64})(?:;|$)/)?.[1] || null;
    }
    async function session(req) {
      const token = requestToken(req);
      if (!token) return null;
      return (await db.prepare('SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').get(digest(token), Date.now())) || null;
    }
    async function requireRole(req, roles) {
      const user = await session(req);
      if (!user) throw err(401, 'Sign in required');
      if (!roles.includes(user.role)) throw err(403, 'Insufficient permissions');
      return user;
    }
    function cookie(value, maxAge) {
      return `riptide_session=${value}; Path=/; HttpOnly; ${PREVIEW_COOKIES ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Strict'}; Max-Age=${maxAge}${!PREVIEW_COOKIES && SECURE_COOKIES ? '; Secure' : ''}`;
    }
    const limits = new Map();
    async function rateLimit(req, kind, max, windowMs) {
      if(db.remote){
        const ip=process.env.VERCEL?(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim():req.socket?.remoteAddress||'unknown';
        const key=digest(ip)+':'+kind,t=Date.now();
        await db.prepare('INSERT INTO rate_limits(key,hits,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END').run(key,t+windowMs,t,t);
        const row=await db.prepare('SELECT hits FROM rate_limits WHERE key=?').get(key);
        if(row.hits>max)throw err(429,'Too many requests; try again later');return;
      }
      const key = (req.socket.remoteAddress || 'unknown') + ':' + kind,
        t = Date.now();
      const old = limits.get(key);
      const entry = !old || old.until <= t ? {
        count: 0,
        until: t + windowMs
      } : old;
      entry.count++;
      limits.set(key, entry);
      if (limits.size > 10000) for (const [k, v] of limits) if (v.until <= t) limits.delete(k);
      if (entry.count > max) throw err(429, 'Too many requests; try again later');
    }
    function readJson(req) {
      return new Promise((resolve, reject) => {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
          req.resume();
          return reject(err(415, 'Expected application/json'));
        }
        if(req.body!==undefined){
          try{let value=req.body;if(Buffer.isBuffer(value))value=value.toString('utf8');if(typeof value==='string')value=JSON.parse(value);
           if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
           if(Buffer.byteLength(JSON.stringify(value))>MAX_BODY)return reject(err(413,'Request too large'));return resolve(value);
          }catch(e){return reject(err(400,'Invalid JSON'))}
        }
        let size = 0,
          chunks = [],
          exceeded = false;
        req.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_BODY) {
            exceeded = true;
            chunks = [];
          } else if (!exceeded) chunks.push(chunk);
        });
        req.on('end', () => {
          if (exceeded) return reject(err(413, 'Request too large'));
          try {
            const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error();
            resolve(v);
          } catch {
            return reject(err(400, 'Invalid JSON'));
          }
        });
        req.on('error', reject);
      });
    }
    const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);
    function parseMedia(media) {
      if (media == null) return null;
      if (!media || typeof media !== 'object') throw err(400, 'Invalid attachment');
      const name = text(media.name, 'attachment name', 160);
      const match = typeof media.data === 'string' && media.data.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i);
      if (!match || !allowedMimes.has(match[1].toLowerCase())) throw err(400, 'Unsupported attachment; use JPEG, PNG, WebP, MP4 or WebM');
      const mime = match[1].toLowerCase(),
        bytes = Buffer.from(match[2], 'base64');
      if (!bytes.length || bytes.length > 5 * 1024 * 1024 || bytes.toString('base64') !== match[2]) throw err(400, 'Invalid attachment size or encoding');
      const signatures = {
        'image/jpeg': () => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
        'image/png': () => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
        'image/webp': () => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
        'video/mp4': () => bytes.toString('ascii', 4, 8) === 'ftyp',
        'video/webm': () => bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))
      };
      if (!signatures[mime]()) throw err(400, 'Attachment does not match its declared type');
      return {
        name,
        mime,
        bytes
      };
    }
    function validateItem(v) {
      const id = text(v.id, 'id', 100);
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw err(400, 'Invalid id');
      if (!['report', 'sos', 'support'].includes(v.type)) throw err(400, 'Invalid item type');
      const createdAt = text(v.createdAt, 'createdAt', 40);
      if (!Number.isFinite(Date.parse(createdAt))) throw err(400, 'Invalid createdAt');
      const payload = {
        id,
        type: v.type,
        createdAt,
        description: text(v.description, 'description', 2000)
      };
      if (v.type === 'sos') {
        if (v.gps != null) {
          const g = v.gps;
          if (typeof g !== 'object' || Array.isArray(g) || !Number.isFinite(g.latitude) || g.latitude < -90 || g.latitude > 90 || !Number.isFinite(g.longitude) || g.longitude < -180 || g.longitude > 180 || !Number.isFinite(g.accuracy) || g.accuracy < 0 || g.accuracy > 10000000 || typeof g.capturedAt !== 'string' || g.capturedAt.length > 40 || !Number.isFinite(Date.parse(g.capturedAt))) throw err(400, 'Invalid GPS coordinates');
          payload.gps = {
            latitude: g.latitude,
            longitude: g.longitude,
            accuracy: g.accuracy,
            capturedAt: g.capturedAt
          };
        }
        if (v.locationStatus !== undefined) {
          if (!['captured', 'denied', 'timeout', 'unavailable', 'unsupported', 'insecure', 'without_location'].includes(v.locationStatus)) throw err(400, 'Invalid location status');
          if (v.locationStatus === 'captured' !== !!payload.gps) throw err(400, 'GPS status does not match coordinates');
          payload.locationStatus = v.locationStatus;
        }
      }
      if (v.type === 'report') payload.location = text(v.location, 'location', 160);
      if (v.type === 'support') {
        if (!['Request support', 'Offer support'].includes(v.kind)) throw err(400, 'Invalid support type');
        payload.kind = v.kind;
        payload.organization = text(v.organization, 'organization', 160);
        payload.contact = text(v.contact, 'contact', 160);
      }
      const media = v.type === 'report' ? parseMedia(v.media) : null;
      if (v.type !== 'report' && v.media != null) throw err(400, 'Only reports can include attachments');
      return {
        payload,
        media
      };
    }
    function validateScenario(v) {
      for (const [key, min, max] of [['water', 0, 7.5], ['velocity', .1, 5], ['rainfall', 0, 150], ['blockage', 0, 100], ['gate', 0, 100], ['pumps', 0, 4], ['stage', 0, 20], ['area', 0, 18.5]]) if (typeof v[key] !== 'number' || !Number.isFinite(v[key]) || v[key] < min || v[key] > max) throw err(400, `Invalid ${key}`);
      if (!Number.isInteger(v.pumps) || typeof v.sandbags !== 'boolean' || ['manualReroute', 'siren', 'broadcast'].some(k => v[k] !== undefined && typeof v[k] !== 'boolean') || !Array.isArray(v.assets) || v.assets.length !== 7) throw err(400, 'Invalid scenario');
      const expected = ['underpass', 'road', 'rail', 'station', 'canal', 'power', 'hospital'];
      const seen = new Set();
      const assets = v.assets.map(a => {
        if (!a || !expected.includes(a.id) || seen.has(a.id) || !['SAFE', 'CAUTION', 'BLOCKED'].includes(a.status) || typeof a.depth !== 'number' || !Number.isFinite(a.depth) || a.depth < 0 || a.depth > 20) throw err(400, 'Invalid asset');
        seen.add(a.id);
        return {
          id: a.id,
          name: text(a.name, 'asset name', 80),
          status: a.status,
          depth: a.depth
        };
      });
      return {
        ...calculate(v),
        updatedAt: now()
      };
    }
    // Preserve prior demonstration data on upgrade. The original file is never deleted.
    async function importLegacy() {
      if (db.remote) return;
      const file = path.join(DATA, 'store.json');
      if (!fs.existsSync(file) || (await db.prepare("SELECT 1 FROM metadata WHERE key='legacy_import'").get())) return;
      let legacy;
      try {
        legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        console.error('Legacy store could not be read; it was left untouched.');
        return;
      }
      let failed = 0,
        imported = 0;
      if (legacy.scenario && !(await db.prepare('SELECT 1 FROM scenario WHERE id=1').get())) try {
        const value = {
          ...validateScenario(legacy.scenario),
          revision: 1
        };
        await db.prepare('INSERT INTO scenario(id,data,updated_at) VALUES(1,?,?)').run(JSON.stringify(value), value.updatedAt);
      } catch (e) {
        failed++;
      }
      if (Array.isArray(legacy.items)) for (const entry of legacy.items) {
        try {
          const {
            payload,
            media
          } = validateItem(entry);
          const hash = digest(JSON.stringify(payload) + (media ? media.mime + media.name + digest(media.bytes) : ''));
          if (!(await db.prepare('SELECT 1 FROM items WHERE id=?').get(payload.id))) {
            await db.exec('BEGIN IMMEDIATE');
            try {
              await db.prepare('INSERT INTO items(id,type,payload,payload_hash,created_at,received_at) VALUES(?,?,?,?,?,?)').run(payload.id, payload.type, JSON.stringify(payload), hash, payload.createdAt, now());
              if (media) await db.prepare('INSERT INTO attachments(item_id,name,mime,bytes) VALUES(?,?,?,?)').run(payload.id, media.name, media.mime, media.bytes);
              await db.exec('COMMIT');
              imported++;
            } catch (e) {
              await db.exec('ROLLBACK');
              throw e;
            }
          }
        } catch (e) {
          failed++;
        }
      }
      if (!failed) await db.prepare("INSERT INTO metadata(key,value) VALUES('legacy_import',?)").run(now());
      console.log(`Legacy import: ${imported} items imported, ${failed} entries need manual review. Original store.json was retained.`);
    }
    await importLegacy();
    if (db.remote) await db.exec('COMMIT');
    const staticFiles = new Set(['/index.html', '/monitor.html', '/simulator.html', '/riptide.css', '/portal.css', '/style.css', '/model.js', '/app.js', '/monitor.js', '/register.js', '/sw.js', '/manifest.json', '/icon.svg', '/voxel-city.svg', '/logo.jpg']);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.jpg': 'image/jpeg'
    };
    async function handle(req, res) {
      const url = new URL(req.url, 'http://localhost'),
        pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method) && !isSameOrigin(req)) throw err(403, 'Cross-origin requests are not allowed');
        if (req.method === 'GET' && pathname === '/api/demo-accounts') {
          if (!DEMO_MODE) throw err(404, 'Demo access is disabled');
          const available = [];
          for (const a of DEMO_ACCOUNTS) {
            const u = await db.prepare('SELECT active,role,salt,password_hash FROM users WHERE username=?').get(a.username);
            if (u?.active && u.role === a.role && passwordHash(a.password, u.salt) === u.password_hash) available.push(a);
          }
          return json(res, 200, available);
        }
        if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, {
          ok: true
        });
        if (req.method === 'GET' && pathname === '/api/session') {
          const user = await session(req);
          return json(res, 200, {
            user: user ? {
              username: user.username,
              role: user.role
            } : null,
            demoMode: DEMO_MODE,
            sessionTransport: user ? req.headers['x-riptide-session'] ? 'preview-header' : req.headers.authorization ? 'authorization' : 'cookie' : 'none',
            build: 'staff-session-v29',
            setupRequired: !(await db.prepare('SELECT 1 FROM users LIMIT 1').get())
          });
        }
        if (req.method === 'POST' && pathname === '/api/login') {
          await rateLimit(req, 'login', 10, 15 * 60 * 1000);
          const body = await readJson(req),
            username = text(body.username, 'username', 64).toLowerCase(),
            password = secret(body.password);
          const user = await db.prepare('SELECT * FROM users WHERE username=?').get(username);
          const salt = user?.salt || '00000000000000000000000000000000';
          const hash = passwordHash(password, salt);
          const expected = user?.password_hash || '0'.repeat(128);
          if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex')) || !user || !user.active) {
            await audit(username, 'login.failed', 'session');
            throw err(401, 'Invalid username or password');
          }
          const token = crypto.randomBytes(32).toString('hex');
          await db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
          await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token), user.id, Date.now() + SESSION_MS);
          await audit(user.username, 'login', 'session');
          return json(res, 200, {
            user: {
              username: user.username,
              role: user.role
            },
            ...(PREVIEW_COOKIES || DEMO_MODE ? {
              previewSessionToken: token
            } : {})
          }, {
            'Set-Cookie': cookie(token, SESSION_MS / 1000)
          });
        }
        if (req.method === 'POST' && pathname === '/api/logout') {
          const signedIn = await session(req);
          if (signedIn) await audit(signedIn.username, 'logout', 'session');
          const token = requestToken(req);
          if (token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
          return json(res, 200, {
            ok: true
          }, {
            'Set-Cookie': cookie('', 0)
          });
        }
        if (req.method === 'POST' && pathname === '/api/change-password') {
          await rateLimit(req, 'password', 10, 15 * 60 * 1000);
          const actor = await requireRole(req, ROLES);
          const b = await readJson(req);
          const current = secret(b.currentPassword),
            next = secret(b.newPassword);
          if (next.length < 12) throw err(400, 'Password must be at least 12 characters');
          const user = await db.prepare('SELECT salt,password_hash FROM users WHERE id=?').get(actor.id);
          const actual = passwordHash(current, user.salt);
          if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(user.password_hash, 'hex'))) throw err(401, 'Current password is incorrect');
          const salt = crypto.randomBytes(16).toString('hex');
          await db.exec('BEGIN IMMEDIATE');
          try {
            await db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(salt, passwordHash(next, salt), actor.id);
            await db.prepare('DELETE FROM sessions WHERE user_id=?').run(actor.id);
            await audit(actor.username, 'user.password_changed', actor.username);
            await db.exec('COMMIT');
          } catch (e) {
            await db.exec('ROLLBACK');
            throw e;
          }
          return json(res, 200, {
            ok: true
          }, {
            'Set-Cookie': cookie('', 0)
          });
        }
        if (pathname === '/api/work' && req.method === 'GET') {
          const actor = await requireRole(req, ROLES);
          return json(res, 200, await db.prepare("SELECT * FROM operator_work WHERE role=? OR ?='admin' ORDER BY id DESC LIMIT 200").all(actor.role, actor.role));
        }
        if (pathname === '/api/work' && req.method === 'POST') {
          const actor = await requireRole(req, ['relief', 'rescue', 'verification']);
          const b = await readJson(req);
          const location = text(b.location, 'location', 160),
            detail = text(b.detail, 'details', 2000);
          if (!Number.isInteger(b.quantity) || b.quantity < 1 || b.quantity > 100000) throw err(400, 'Quantity must be between 1 and 100000');
          await db.prepare('INSERT INTO operator_work(role,actor,location,detail,quantity,created_at) VALUES(?,?,?,?,?,?)').run(actor.role, actor.username, location, detail, b.quantity, now());
          await audit(actor.username, 'work.created', actor.role + ':' + location);
          return json(res, 201, {
            ok: true
          });
        }
        const workRoute = pathname.match(/^\/api\/work\/([1-9]\d*)$/);
        if (workRoute && req.method === 'PATCH') {
          const actor = await requireRole(req, ROLES),
            b = await readJson(req);
          if (!['planned', 'in_progress', 'completed'].includes(b.status)) throw err(400, 'Invalid work status');
          const item = await db.prepare('SELECT role FROM operator_work WHERE id=?').get(Number(workRoute[1]));
          if (!item) throw err(404, 'Work record not found');
          if (actor.role !== 'admin' && actor.role !== item.role) throw err(403, 'This record belongs to a different workspace');
          await db.prepare('UPDATE operator_work SET status=? WHERE id=?').run(b.status, Number(workRoute[1]));
          await audit(actor.username, 'work.' + b.status, workRoute[1]);
          return json(res, 200, {
            ok: true
          });
        }
        if (req.method === 'GET' && pathname === '/api/staff-directory') {
          await requireRole(req, ROLES);
          return json(res, 200, await db.prepare('SELECT id,username,role FROM users WHERE active=1 ORDER BY username').all());
        }
        if (pathname === '/api/alerts' && req.method === 'GET') {
          const actor = await requireRole(req, ROLES);
          return json(res, 200, await db.prepare('SELECT a.*,u.username AS recipient_name,u.role AS recipient_role FROM staff_alerts a JOIN users u ON u.id=a.recipient_id WHERE a.recipient_id=? OR a.sender_id=? OR ?=1 ORDER BY a.id DESC LIMIT 200').all(actor.id, actor.id, actor.role === 'admin' ? 1 : 0));
        }
        if (pathname === '/api/alerts' && req.method === 'POST') {
          const actor = await requireRole(req, ROLES);
          await rateLimit(req, 'alerts', 60, 60000);
          const b = await readJson(req);
          const message = text(b.message, 'message', 2000);
          if (!Number.isSafeInteger(b.recipientId)) throw err(400, 'Choose a recipient');
          const recipient = await db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(b.recipientId);
          if (!recipient) throw err(400, 'Recipient unavailable');
          const inserted = await db.prepare('INSERT INTO staff_alerts(sender_id,sender_name,sender_role,recipient_id,message,created_at) VALUES(?,?,?,?,?,?)').run(actor.id, actor.username, actor.role, recipient.id, message, now());
          await audit(actor.username, 'alert.sent', String(recipient.id));
          return json(res, 201, {
            ok: true,
            id: Number(inserted.lastInsertRowid)
          });
        }
        const threadRoute = pathname.match(/^\/api\/alerts\/([1-9]\d*)\/messages$/);
        if (threadRoute && ['GET', 'POST'].includes(req.method)) {
          const actor = await requireRole(req, ROLES),
            id = Number(threadRoute[1]);
          const alert = await db.prepare('SELECT a.*,u.username AS recipient_name,u.role AS recipient_role FROM staff_alerts a JOIN users u ON u.id=a.recipient_id WHERE a.id=?').get(id);
          if (!alert) throw err(404, 'Conversation not found');
          const participant = actor.id === alert.sender_id || actor.id === alert.recipient_id;
          if (!participant && actor.role !== 'admin') throw err(403, 'This conversation is not assigned to you');
          if (req.method === 'GET') return json(res, 200, {
            alert,
            messages: await db.prepare('SELECT id,sender_name,sender_role,message,created_at FROM alert_replies WHERE alert_id=? ORDER BY id ASC LIMIT 500').all(id),
            canReply: participant
          });
          if (!participant) throw err(403, 'Only the sender and recipient can reply');
          const other = actor.id === alert.sender_id ? alert.recipient_id : alert.sender_id;
          if (!(await db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(other))) throw err(409, 'The other participant is disabled');
          await rateLimit(req, 'replies', 120, 60000);
          const b = await readJson(req),
            message = text(b.message, 'message', 2000);
          const createdAt = now();
          const result = await db.prepare('INSERT INTO alert_replies(alert_id,sender_id,sender_name,sender_role,message,created_at) VALUES(?,?,?,?,?,?)').run(id, actor.id, actor.username, actor.role, message, createdAt);
          await audit(actor.username, 'alert.reply', String(id));
          return json(res, 201, {
            id: Number(result.lastInsertRowid),
            sender_name: actor.username,
            sender_role: actor.role,
            message,
            created_at: createdAt
          });
        }
        const alertRoute = pathname.match(/^\/api\/alerts\/([1-9]\d*)$/);
        if (alertRoute && req.method === 'PATCH') {
          const actor = await requireRole(req, ROLES),
            b = await readJson(req);
          if (!['acknowledged', 'completed'].includes(b.status)) throw err(400, 'Invalid alert status');
          const result = await db.prepare('UPDATE staff_alerts SET status=? WHERE id=? AND recipient_id=?').run(b.status, Number(alertRoute[1]), actor.id);
          if (!result.changes) throw err(403, 'Only the recipient can update this task');
          await audit(actor.username, 'alert.' + b.status, alertRoute[1]);
          return json(res, 200, {
            ok: true
          });
        }
        if (req.method === 'GET' && pathname === '/api/users') {
          await requireRole(req, ['admin']);
          const users = await db.prepare('SELECT id,username,role,active,created_at FROM users ORDER BY username').all();
          return json(res, 200, users.map(u => ({
            id: u.id,
            username: u.username,
            role: u.role,
            active: !!u.active,
            createdAt: u.created_at
          })));
        }
        if (req.method === 'GET' && pathname === '/api/audit') {
          await requireRole(req, ['admin']);
          return json(res, 200, await db.prepare('SELECT id,actor,action,target,at FROM audit ORDER BY id DESC LIMIT 200').all());
        }
        if (req.method === 'POST' && pathname === '/api/users') {
          const actor = await requireRole(req, ['admin']);
          const b = await readJson(req),
            username = text(b.username, 'username', 64).toLowerCase(),
            password = secret(b.password);
          if (!/^[a-z0-9._-]{3,64}$/.test(username) || password.length < 12 || !ROLES.includes(b.role)) throw err(400, 'Invalid username, role or password');
          if (await db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw err(409, 'Username already exists');
          await createUser(username, password, b.role);
          await audit(actor.username, 'user.create', username + ':' + b.role);
          return json(res, 201, {
            ok: true
          });
        }
        const userRoute = pathname.match(/^\/api\/users\/([1-9]\d{0,14})$/);
        if (req.method === 'PATCH' && userRoute) {
          const actor = await requireRole(req, ['admin']),
            body = await readJson(req),
            id = Number(userRoute[1]);
          const target = await db.prepare('SELECT id,username,role,active FROM users WHERE id=?').get(id);
          if (!target) throw err(404, 'User not found');
          const keys = Object.keys(body);
          if (keys.length !== 1 || !['role', 'active', 'password'].includes(keys[0])) throw err(400, 'Change one field at a time');
          const field = keys[0];
          if (field === 'role' && !ROLES.includes(body.role)) throw err(400, 'Invalid role');
          if (field === 'active' && typeof body.active !== 'boolean') throw err(400, 'Invalid account state');
          if (field === 'password' && secret(body.password).length < 12) throw err(400, 'Password must be at least 12 characters');
          if (actor.id === target.id && (field === 'role' || field === 'active')) throw err(400, 'You cannot change your own role or account state');
          if (target.active && target.role === 'admin' && (field === 'active' && !body.active || field === 'role' && body.role !== 'admin') && (await db.prepare("SELECT COUNT(*) AS count FROM users WHERE active=1 AND role='admin'").get()).count <= 1) throw err(400, 'At least one active administrator is required');
          await db.exec('BEGIN IMMEDIATE');
          try {
            if (field === 'role') await db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role, id);
            if (field === 'active') await db.prepare('UPDATE users SET active=? WHERE id=?').run(body.active ? 1 : 0, id);
            if (field === 'password') {
              const salt = crypto.randomBytes(16).toString('hex');
              await db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(salt, passwordHash(body.password, salt), id);
            }
            await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
            await audit(actor.username, 'user.' + (field === 'active' ? body.active ? 'enabled' : 'disabled' : field === 'password' ? 'password_reset' : 'role_changed'), target.username + (field === 'role' ? ':' + body.role : ''));
            await db.exec('COMMIT');
          } catch (e) {
            await db.exec('ROLLBACK');
            throw e;
          }
          return json(res, 200, {
            ok: true
          });
        }
        if (req.method === 'GET' && pathname === '/api/scenario') {
          const row = await db.prepare('SELECT data FROM scenario WHERE id=1').get();
          return json(res, 200, row ? JSON.parse(row.data) : null);
        }
        if (req.method === 'POST' && pathname === '/api/scenario') {
          await rateLimit(req, 'scenario', 300, 60000);
          const body = await readJson(req);
          const data = validateScenario(body);
          const existing = await db.prepare('SELECT data FROM scenario WHERE id=1').get();
          const current = existing ? JSON.parse(existing.data) : null;
          if (current && body.baseRevision !== (current.revision || 0) || !current && body.baseRevision != null) {return json(res,409,{error:'Scenario changed on another device',scenario:current});}
          data.revision = (current?.revision || 0) + 1;
          await db.prepare('INSERT INTO scenario(id,data,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(JSON.stringify(data), data.updatedAt);
          return json(res, 200, {
            ok: true,
            scenario: data
          });
        }
        if (req.method === 'POST' && pathname === '/api/scenario/actions') {
          const user = await requireRole(req, ROLES);
          const b = await readJson(req);
          if (!ACTIONS[user.role].includes(b.action)) throw err(403, 'This intervention is not assigned to your role');
          const row = await db.prepare('SELECT data FROM scenario WHERE id=1').get();
          if (!row) throw err(409, 'Start a scenario in the virtual environment first');
          const current = JSON.parse(row.data);
          const next = {
            ...current
          };
          if (b.action === 'pumps' && Number.isInteger(b.value) && b.value >= 0 && b.value <= 4) next.pumps = b.value;else if (b.action === 'sandbags' && typeof b.value === 'boolean') next.sandbags = b.value;else if (b.action === 'gate' && Number.isInteger(b.value) && b.value >= 0 && b.value <= 100 && b.value % 5 === 0) next.gate = b.value;else if (b.action === 'clearDrain') next.blockage = Math.max(0, next.blockage - 40);else if (['manualReroute', 'siren', 'broadcast'].includes(b.action) && typeof b.value === 'boolean') next[b.action] = b.value;else throw err(400, 'Invalid intervention');
          const data = {
            ...calculate(next),
            updatedAt: now(),
            revision: (current.revision || 0) + 1
          };
          await db.prepare('UPDATE scenario SET data=?,updated_at=? WHERE id=1').run(JSON.stringify(data), data.updatedAt);
          await audit(user.username, 'scenario.action', b.action + (b.value === undefined ? '' : ':' + String(b.value)));
          return json(res, 200, {
            ok: true,
            scenario: data
          });
        }
        if(req.method==='POST'&&pathname==='/api/uploads'){
          await rateLimit(req,'uploads',60,60000);const b=await readJson(req),name=text(b.name,'attachment name',160),mime=text(b.mime,'mime',80);
          if(!['image/jpeg','image/png','image/webp','video/mp4','video/webm'].includes(mime)||!Number.isInteger(b.size)||b.size<1||b.size>5*1024*1024)throw err(400,'Invalid attachment size or type');
          await db.prepare('DELETE FROM media_chunks WHERE upload_id IN (SELECT id FROM media_uploads WHERE created_at<?)').run(Date.now()-3600000);
          await db.prepare('DELETE FROM media_uploads WHERE created_at<?').run(Date.now()-3600000);
          const id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex');await db.prepare('INSERT INTO media_uploads(id,token_hash,name,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(id,digest(token),name,mime,b.size,Date.now());return json(res,201,{id,token,chunkSize:MEDIA_CHUNK});
        }
        const uploadPart=pathname.match(/^\/api\/uploads\/([a-f0-9-]{36})\/chunks\/(\d{1,3})$/);
        if(uploadPart&&req.method==='PUT'){
          await rateLimit(req,'upload-parts',1200,60000);const upload=await db.prepare('SELECT * FROM media_uploads WHERE id=?').get(uploadPart[1]),token=req.headers['x-riptide-upload-token'];
          if(!upload||upload.created_at<Date.now()-3600000||typeof token!=='string'||digest(token)!==upload.token_hash)throw err(403,'Invalid upload access');
          const part=Number(uploadPart[2]),b=await readJson(req);if(part>=Math.ceil(upload.size/MEDIA_CHUNK)||typeof b.data!=='string'||b.data.length>MEDIA_CHUNK*4/3+4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.data))throw err(400,'Invalid upload chunk');
          const bytes=Buffer.from(b.data,'base64');if(bytes.length!==Math.min(MEDIA_CHUNK,upload.size-part*MEDIA_CHUNK))throw err(400,'Chunk size mismatch');
          const old=await db.prepare('SELECT bytes FROM media_chunks WHERE upload_id=? AND part=?').get(upload.id,part);if(old&&digest(Buffer.from(old.bytes))!==digest(bytes))throw err(409,'Chunk already exists with different data');
          if(!old)await db.prepare('INSERT INTO media_chunks(upload_id,part,bytes) VALUES(?,?,?)').run(upload.id,part,bytes);return json(res,200,{ok:true});
        }
        const attachmentInfo=pathname.match(/^\/api\/items\/([a-zA-Z0-9_-]{8,100})\/attachment\/(info|parts\/(\d{1,3}))$/);
        if(attachmentInfo&&req.method==='GET'){
          await requireRole(req,['admin','verification','rescue']);const metadata=await db.prepare('SELECT name,mime,length(bytes) AS size FROM attachments WHERE item_id=?').get(attachmentInfo[1]);if(!metadata)throw err(404,'Attachment not found');
          if(attachmentInfo[2]==='info')return json(res,200,{...metadata,chunkSize:MEDIA_CHUNK});
          const part=Number(attachmentInfo[3]);if(part>=Math.ceil(metadata.size/MEDIA_CHUNK))throw err(404,'Attachment part not found');
          const chunk=await db.prepare('SELECT substr(bytes,?,?) AS bytes FROM attachments WHERE item_id=?').get(part*MEDIA_CHUNK+1,MEDIA_CHUNK,attachmentInfo[1]);return json(res,200,{data:Buffer.from(chunk.bytes).toString('base64')});
        }
        if (req.method === 'POST' && pathname === '/api/items') {
          await rateLimit(req, 'submissions', 60, 60000);
          const {
            payload,
            media
          } = validateItem(await uploadedMedia(await readJson(req)));
          if (payload.type === 'support') await requireRole(req, ['admin']);
          const hash = digest(JSON.stringify(payload) + (media ? media.mime + media.name + digest(media.bytes) : ''));
          const existing = await db.prepare('SELECT payload_hash FROM items WHERE id=?').get(payload.id);
          if (existing) {
            if (existing.payload_hash !== hash) throw err(409, 'Submission ID already exists with different content');
            return json(res, 200, {
              ok: true,
              duplicate: true
            });
          }
          await db.exec('BEGIN IMMEDIATE');
          try {
            await db.prepare('INSERT INTO items(id,type,payload,payload_hash,created_at,received_at) VALUES(?,?,?,?,?,?)').run(payload.id, payload.type, JSON.stringify(payload), hash, payload.createdAt, now());
            if (media) await db.prepare('INSERT INTO attachments(item_id,name,mime,bytes) VALUES(?,?,?,?)').run(payload.id, media.name, media.mime, media.bytes);
            await db.exec('COMMIT');
          } catch (e) {
            await db.exec('ROLLBACK');
            throw e;
          }
          return json(res, 201, {
            ok: true
          });
        }
        if (req.method === 'GET' && pathname === '/api/items') {
          const user = await requireRole(req, ['admin', 'verification', 'rescue']);
          const filter = user.role === 'admin' ? 'all' : 'incident';
          const rows = await db.prepare("SELECT i.payload,i.status,i.received_at, EXISTS(SELECT 1 FROM attachments a WHERE a.item_id=i.id) AS has_media FROM items i WHERE (?='all' OR (?='support' AND i.type='support') OR (?='incident' AND i.type IN ('report','sos'))) ORDER BY i.received_at DESC LIMIT 100").all(filter, filter, filter);
          return json(res, 200, rows.map(r => ({
            ...JSON.parse(r.payload),
            status: r.status,
            receivedAt: r.received_at,
            hasMedia: !!r.has_media
          })));
        }
        const attachment = pathname.match(/^\/api\/items\/([a-zA-Z0-9_-]{8,100})\/attachment$/);
        if (req.method === 'GET' && attachment) {
          await requireRole(req, ['admin', 'verification', 'rescue']);
          const file = await db.prepare('SELECT name,mime,bytes FROM attachments WHERE item_id=?').get(attachment[1]);
          if (!file) throw err(404, 'Attachment not found');
          if(process.env.VERCEL&&file.bytes.length>3_000_000)throw err(413,'Use the authenticated chunked attachment download in the staff workspace');
          res.writeHead(200, {
            ...headers,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="evidence"; filename*=UTF-8\x27\x27${encodeURIComponent(file.name)}`,
            'Content-Security-Policy': "default-src 'none'; sandbox"
          });
          return res.end(Buffer.from(file.bytes));
        }
        const status = pathname.match(/^\/api\/items\/([a-zA-Z0-9_-]{8,100})\/status$/);
        if (req.method === 'PATCH' && status) {
          const user = await requireRole(req, ['admin', 'verification']);
          const b = await readJson(req);
          if (!['new', 'acknowledged', 'resolved'].includes(b.status)) throw err(400, 'Invalid status');
          const item = await db.prepare('SELECT type FROM items WHERE id=?').get(status[1]);
          if (!item) throw err(404, 'Item not found');
          if (user.role !== 'admin' && item.type === 'support') throw err(403, 'Insufficient permissions');
          await db.prepare('UPDATE items SET status=? WHERE id=?').run(b.status, status[1]);
          await audit(user.username, 'item.status', status[1] + ':' + b.status);
          return json(res, 200, {
            ok: true
          });
        }
        throw err(404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw err(405, 'Method not allowed');
      const workspacePage = pathname.match(/^\/workspace\/(admin|relief|hydrology|rescue|verification)$/);
      if (workspacePage) {
        const actor = await session(req),
          role = workspacePage[1];
        if (!actor) {
          res.writeHead(302, {
            Location: '/monitor.html?workspace=' + role,
            'Cache-Control': 'no-store'
          });
          return res.end();
        }
        if (actor.role !== role) {
          res.writeHead(302, {
            Location: '/workspace/' + actor.role,
            'Cache-Control': 'no-store'
          });
          return res.end();
        }
        const page = await fs.promises.readFile(path.join(ROOT, 'monitor.html'), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        return res.end(req.method === 'HEAD' ? undefined : page.replace('<title>Riptide — Flood response platform</title>', '<title>Riptide — ' + role + ' workspace</title>'));
      }
      const file = pathname === '/' ? '/index.html' : pathname;
      if (!staticFiles.has(file)) throw err(404, 'Not found');
      const content = await fs.promises.readFile(path.join(ROOT, file));
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-cache'
      });
      return res.end(req.method === 'HEAD' ? undefined : content);
    }
    const handler = async (req,res)=>{
      // Commit serverless transactions before sending a success response.
      const write=db.remote&&req.url.startsWith('/api/')&&!['GET','HEAD'].includes(req.method);
      let head,body;const output=write?{headersSent:false,writeHead(...args){head=args;this.headersSent=true},end(value){body=value},destroy(){}}:res;
      try{await db.withRequest(async()=>{try{return await handle(req,output)}catch(error){if(write&&error.status){json(output,error.status,{error:error.message});return}throw error}},{write});if(write){if(head)res.writeHead(...head);res.end(body)}}catch(e){
        if(e.status)json(res,e.status,{error:e.message});else{console.error('Request failed:',e);if(!res.headersSent)json(res,500,{error:'Internal server error'});else res.destroy()}
      }
    };
    const server = http.createServer(handler);
    return {
      server,
      db,
      handler
    };
  });
}
const ready = buildApp();
if (require.main === module) ready.then(({
  server
}) => server.listen(PORT, '0.0.0.0', () => console.log(`Riptide listening on port ${PORT}`))).catch(e => {
  console.error('Startup failed:', e.message);
  process.exitCode = 1;
});
module.exports = {
  ready
};

# Riptide deployment package

**For Vercel, use [VERCEL.md](VERCEL.md).** The instructions below describe the alternative Node/Docker deployment.

This archive contains the deployable Node application, **not a static-only build**. It requires Node 22.13+ (including `node:sqlite`), one persistent writable data directory, and HTTPS. No frontend build step is required. Install dependencies with `npm ci --omit=dev`.

**Important:** This remains a simulated flood-response application, not a production-certified emergency service. SOS does not dispatch responders, location is captured once rather than continuously tracked, and the public simulator is anonymously editable. Read README.md's security and operational limitations before exposing it. Do not use it for life-safety decisions.

## Docker Compose (recommended for a single-server demonstration)

1. Extract this archive and enter its `riptide` folder.
2. Copy `.env.example` to `.env`. Fill in `RIPTIDE_ADMIN_USER` (3–64 letters/digits/dots/underscores/hyphens) and a unique `RIPTIDE_ADMIN_PASSWORD` (12–256 characters). Do not commit `.env` or reuse demo passwords.
3. Run `docker compose up -d --build`.
4. Configure a TLS reverse proxy on the **same host** to forward your HTTPS domain to `http://127.0.0.1:3000`. Forward the original Host header so same-origin checks work. The container port is intentionally not public.
5. Open `https://your-domain/monitor.html` and use Staff Sign In. Create the four operator accounts through Administration.
6. Remove the two bootstrap variables from `.env` after confirming the administrator can sign in, then run `docker compose up -d --force-recreate`. Accounts persist in the named volume; bootstrap variables do not reset existing passwords.

Demo autofill, public demo accounts and preview bearer-session access are disabled. The deployment does not ship with a database, accounts, sessions, citizen submissions or GPS records. Docker creates a new database on first startup.

## Example Caddy HTTPS proxy (on the host)

Replace `your-domain.example` with a domain pointing to your server. Install Caddy separately, allow inbound ports 80/443, and use:

```
your-domain.example {
    request_body {
        max_size 8MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

The example assumes Caddy and Compose run on the same host. Containerized proxies need their own network configuration. Keep the application on a single origin; do not host frontend and backend as unrelated static sites.

## Native Node alternative

Set environment variables using your host's secret/environment configuration (see `.env.example`), then:

```
node --version
npm ci --omit=dev
npm start
```

Node does not automatically load `.env`. With Node 22 you can instead use `node --env-file=.env server.js`. Run under a process supervisor, use an absolute persistent `RIPTIDE_DATA_DIR`, and put HTTPS in front of port 3000. Secure cookies require HTTPS; do not switch them off on a public deployment merely to make HTTP sign-in work.

## Sync and records

Everyone must use the same server URL and database. Alerts refresh about every four seconds, open chat replies about every three seconds, and scenario updates about every two seconds. This is polling, not instant push or guaranteed delivery. SOS GPS requires HTTPS and browser permission. There are no background push notifications or real emergency dispatch.

In local SQLite mode, use persistent storage and do not horizontally scale separate database copies. For serverless Vercel hosting, use the included function entry and hosted libSQL configuration described in VERCEL.md; never use temporary local SQLite storage for deployed data. Static-only hosting still cannot run staff and record APIs.

## Backups and operations

- Stop the app before backing up the entire data volume/directory, including any SQLite WAL files, and test restores.
- `docker compose down` preserves the named volume; **`docker compose down -v` deletes the database**.
- Keep secrets and citizen/GPS records private. Restrict deployment access for demonstrations.
- Add gateway rate limiting and monitoring appropriate to your host; the built-in per-process limits are not an operational security perimeter.
- Review README.md for missing controls including MFA, retention/deletion management, real sensor feeds, dispatch, malware scanning and independent security auditing.

## Verification

`SHA256SUMS` lists checksums of the packaged source/configuration files. On Linux run `sha256sum -c SHA256SUMS` from the extracted directory. Backend and DOM tests: `npm ci && npm test`. The browser regression additionally needs Playwright Chromium and required OS libraries (`npx playwright install --with-deps chromium`), then `npm run test:browser`.

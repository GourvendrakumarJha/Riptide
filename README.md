# Riptide
Rip through the tides
# Riptide — Flood Simulation & Multi-Role Disaster Response Platform

*Rip through the tides.*

**Riptide** is a full-stack interactive flood simulation, citizen incident/GPS SOS reporting, and role-based disaster response coordination platform. It connects an orthographic 3D virtual flood environment (**HydroSim**) with a public **Citizen Portal** (offline-capable reports and one-click GPS SOS) and **five role-specific staff workspaces** backed by either local SQLite (`node:sqlite`) or serverless **Turso / libSQL** on **Vercel**.

> **Important Disclaimer:** Riptide is a demonstration and scenario-testing platform, **not** a certified emergency service, hydrological forecast model, or real dispatch system. Flood stages, alerts, shelters, SOS signals, and response interventions are simulated and do not contact real emergency responders.

---

## Table of Contents

1. [Repository Layout](#repository-layout)
2. [Core Functional Capabilities](#core-functional-capabilities)
   - [1. HydroSim 3D Flood Simulation Engine](#1-hydrosim-3d-flood-simulation-engine)
   - [2. Citizen Portal, GPS SOS & Offline Outbox](#2-citizen-portal-gps-sos--offline-outbox)
   - [3. Role-Based Workspaces & Access Matrix](#3-role-based-workspaces--access-matrix)
   - [4. Staff Alerts & Two-Way Task Messenger](#4-staff-alerts--two-way-task-messenger)
   - [5. Chunked Evidence Transfers (Up to 5 MiB)](#5-chunked-evidence-transfers-up-to-5-mib)
   - [6. Dual-Mode Persistence & Session Security](#6-dual-mode-persistence--session-security)
3. [Complete Code Function Reference (Module-by-Module)](#complete-code-function-reference-module-by-module)
   - [`model.js` — Shared Hydrological & Asset Model](#modeljs--shared-hydrological--asset-model)
   - [`storage.js` — Unified SQLite & Turso/libSQL Adapter](#storagejs--unified-sqlite--tursolibsql-adapter)
   - [`server.js` — Backend Server, Auth, Validation & Router](#serverjs--backend-server-auth-validation--router)
   - [`api/index.js` — Vercel Serverless Function Entry](#apiindexjs--vercel-serverless-function-entry)
   - [`app.js` — HydroSim 3D Virtual Environment Client](#appjs--hydrosim-3d-virtual-environment-client)
   - [`monitor.js` — Monitoring Portal, Offline Outbox & Workspaces Client](#monitorjs--monitoring-portal-offline-outbox--workspaces-client)
   - [`register.js` & `sw.js` — PWA Service Worker](#registerjs--swjs--pwa-service-worker)
   - [`scripts/` — Migration, Packaging & Browser Verification](#scripts--migration-packaging--browser-verification)
4. [REST API & Route Reference](#rest-api--route-reference)
5. [Database Schema](#database-schema)
6. [Setup, Deployment & Verification](#setup-deployment--verification)
   - [Environment Variables](#environment-variables)
   - [Local Node.js & SQLite](#local-nodejs--sqlite)
   - [Docker Compose](#docker-compose)
   - [Vercel + Turso/libSQL Serverless Deployment](#vercel--tursolibsql-serverless-deployment)
   - [Automated Test Suites](#automated-test-suites)

---

## Repository Layout

```text
Riptide/
├── README.md                                   # Project overview & complete function documentation
└── Riptide-final-source/
    ├── README.md                               # Release overview
    ├── START-HERE.md                           # Quick-start & deployment checklist
    ├── RELEASE.json                            # Packaged release metadata
    ├── SHA256SUMS                              # Integrity checksums for packaged source files
    └── riptide-release/                        # Main deployable application root
        ├── index.html                          # Entry landing page (Virtual Environment vs. Monitoring)
        ├── simulator.html                      # HydroSim 3D interactive flood simulator UI
        ├── monitor.html                        # Citizen portal, admin portal & 5 staff workspaces UI
        ├── model.js                            # Shared hydrological stage & asset depth calculator (UMD)
        ├── app.js                              # 3D canvas renderer, simulator controls & scenario sync
        ├── monitor.js                          # Workspaces, auth, IndexedDB queue, GPS SOS, chat & uploads
        ├── server.js                           # HTTP server, REST API, RBAC, validation & schema init
        ├── storage.js                          # Dual node:sqlite / @libsql/client database adapter
        ├── api/
        │   └── index.js                        # Stateless Vercel Node.js Function entry point
        ├── register.js                         # Service worker registration script
        ├── sw.js                               # Offline-first PWA Service Worker (cache riptide-v30)
        ├── manifest.json                       # Web App Manifest
        ├── riptide.css / portal.css / style.css# Styling for entry, monitoring portals & HydroSim
        ├── icon.svg / voxel-city.svg / logo.jpg# Visual assets
        ├── scripts/
        │   ├── migrate-to-turso.cjs            # One-time local SQLite -> hosted Turso/libSQL importer
        │   ├── package-vercel.py               # Clean release ZIP builder with SHA-256 manifest checks
        │   ├── check-libsql.cjs                # Runs backend test suite against the libSQL driver
        │   └── check-browser-session.cjs       # Headless Playwright Chromium E2E test harness
        ├── test/
        │   ├── backend.test.js                 # Auth, RBAC, idempotency, scenario conflict & audit tests
        │   ├── workspaces.test.js              # JSDOM + fake-indexeddb tests across all 5 workspaces
        │   └── vercel.test.js                  # Multi-instance serverless, 5 MiB chunking & migration tests
        ├── Dockerfile / compose.yaml           # Self-hosted container configuration
        ├── vercel.json                         # Vercel Function routing & bundle rules
        └── DEPLOYMENT.md / VERCEL.md / README.md
```

---

## Core Functional Capabilities

### 1. HydroSim 3D Flood Simulation Engine
Accessible at `/simulator.html`, HydroSim provides a real-time interactive flood environment shared across connected clients:
- **Scenario Presets:** `normal` (baseline), `monsoon` (heavy rain), `urban` (blocked storm drains), and `breach` (extreme river flood).
- **Environmental Controls:** Continuous sliders for river base water level (`0–7.5 m`), flow velocity (`0.1–5.0 m/s`), rainfall intensity (`0–150 mm/h`), drainage clog/siltation (`0–100%`), and sluice gate opening (`0–100%`).
- **Operational Interventions:** Auxiliary pumps (`0–4` units), temporary sandbag levees, manual traffic diversion, citizen warning broadcast, drain clearing (`-40` blockage points), and evacuation siren.
- **3D Orthographic Canvas:** Rotatable 3D terrain slab with painter-sorted building geometry, animated velocity vectors, rain particles, expanding floodplain, inundation radius disks, terrain probe HUD, and collision-aware labels.
- **Optimistic Concurrency Sync:** Polls `/api/scenario` every **2 seconds** and debounces local edits (400 ms) using monotonic `revision` / `baseRevision` checks. Concurrent edits return `409 Conflict` and offer an explicit **Load shared scenario** recovery option rather than silently overwriting peer changes.

#### Monitored Urban Infrastructure Assets (`model.js` & `app.js`)

| Asset ID | Name | Type | Elevation | Caution Depth | Critical Depth (`BLOCKED`) | Special Relief Rules |
|---|---|---|---:|---:|---:|---|
| `underpass` | Central underpass | Road infrastructure | `0.8 m` | `> 0.1 m` | `> 0.4 m` | `+0.9 m` baseline relief; `+0.4 m` with levees (`sandbags`) |
| `road` | MG arterial road | Urban highway | `2.2 m` | `> 0.1 m` | `> 0.4 m` | — |
| `rail` | Rail track cutting | Railway corridor | `1.6 m` | `> 0.1 m` | `> 0.3 m` | `+0.4 m` with levees (`sandbags`) |
| `station` | Central station | Passenger hub | `2.5 m` | `> 0.4 m` | `> 0.9 m` | — |
| `canal` | Storm drain outfall | Drainage infrastructure | `1.1 m` | `> 0.4 m` | `> 0.8 m` | — |
| `power` | Power substation | Critical utility | `2.0 m` | `> 0.3 m` | `> 0.7 m` | — |
| `hospital` | District hospital | Emergency care | `4.5 m` | `> 0.5 m` | `> 1.2 m` | Rendered with 3D rooftop medical cross |

---

### 2. Citizen Portal, GPS SOS & Offline Outbox
Accessible publicly at `/monitor.html#citizen`:
- **One-Click GPS SOS:** Requests a single high-accuracy browser geolocation fix (`enableHighAccuracy: true`, `15s` timeout, `maximumAge: 0`) over HTTPS/localhost, capturing `latitude`, `longitude`, `accuracy`, and `capturedAt`. If permission is denied, unsupported, blocked by iframe Permissions Policy, or times out, citizens can explicitly choose **Send without location** (recording the exact `locationStatus` reason).
- **Atomic Device Persistence & History:** SOS submissions are written atomically in a single IndexedDB transaction to both `outbox` and `sosHistory`. Citizens can track delivery states (`queued`, `sent`, `needs_attention`, `discarded`), open coordinates on OpenStreetMap, and remove local copies once sent or discarded.
- **Citizen Incident Reports:** Captures location, situation description, and optional media evidence (`JPEG`, `PNG`, `WebP`, `MP4`, `WebM` up to **5 MiB**).
- **Idempotent Offline Outbox:** Submissions are queued in IndexedDB (`riptide-outbox`) with UUIDs and SHA-256 content hashes on the server. Retries are idempotent if the payload matches (`200 { duplicate: true }`) and rejected (`409`) if a duplicate ID carries altered content.
- **PWA Offline Shell:** `sw.js` caches core HTML/CSS/JS/SVG assets so the Citizen Portal and report/SOS forms open offline and flush automatically when connectivity returns.

---

### 3. Role-Based Workspaces & Access Matrix
Authenticated staff are routed to server-guarded workspace URLs (`/workspace/<role>`). Every role receives a tailored dashboard, live 7-pin infrastructure map, and staff messenger:

| Role Key | Display Title | Route | Allowed Simulation Interventions | Incident & Evidence Access | Work Register (`operator_work`) | Special Capabilities |
|---|---|---|---|---|---|---|
| `admin` | **Administrator** | `/workspace/admin` | `pumps`, `gate`, `sandbags`, `clearDrain`, `manualReroute`, `siren`, `broadcast` (All 7) | View all `report`, `sos`, & `support`; download attachments; update statuses | View & update statuses across **all** roles | Manage staff accounts (create, role, enable/disable, reset password), view latest 200 audit logs, access **Response** & **External Support** portals, review all staff alerts/threads |
| `relief` | **Relief and Resource Coordinator** | `/workspace/relief` | `broadcast` | — | Create & update `relief` supply allocations | Plan shelter supply kits, monitor inundated area & hospital status |
| `hydrology` | **Hydrology Expert** | `/workspace/hydrology` | `pumps`, `gate`, `sandbags`, `clearDrain` | — | — | Live water stage, rainfall, drain clog & pump discharge KPIs |
| `rescue` | **Rescue Initiator** | `/workspace/rescue` | `manualReroute`, `siren` | View `report` & `sos` queue (incl. GPS links) & download attachments | Create & update `rescue` team allocations | Plan simulated rescue teams, review blocked corridors & SOS coordinates |
| `verification` | **Reports and Data Verification Specialist** | `/workspace/verification` | None | View `report` & `sos`, download attachments, `ACKNOWLEDGE` & `RESOLVE` incidents | Create & update `verification` findings | Verify citizen media evidence and escalate findings to operational staff |

---

### 4. Staff Alerts & Two-Way Task Messenger
- **Active Staff Directory:** Populates a focus-safe native `<select>` dropdown of active peer accounts (`GET /api/staff-directory`), isolated from alert-loading failures with a 10-second timeout and manual retry button.
- **Targeted Tasks & Conversations:** Any active staff member can send a task/alert to another active account (`POST /api/alerts`), creating a persistent conversation thread (`alert_replies`).
- **Strict Participation Rules:** Only the sender and recipient can post replies (`POST /api/alerts/:id/messages`), and **only the recipient** can advance task status (`new` → `acknowledged` → `completed`). Administrators have read-only oversight across all threads.
- **Non-Destructive Polling:** Inbox/sent lists poll every **4 seconds** and open conversation threads poll every **3 seconds**, using JSON signature diffing so open `<details>` threads and in-progress reply drafts are never wiped during background refreshes.

---

### 5. Chunked Evidence Transfers (Up to 5 MiB)
To support full 5 MiB attachments on serverless platforms (such as Vercel, where individual request/response payloads are capped near 4.5 MB):
- **Upload:** When `apiFetch()` detects a base64 report attachment exceeding 2 MB of encoded text, `uploadEvidence()` initializes an upload capability (`POST /api/uploads`, 1-hour expiry, SHA-256 hashed capability token) and streams `393,216`-byte (`384 KiB`) binary chunks via `PUT /api/uploads/:id/chunks/:part` before submitting the item with `{ uploadId, uploadToken }`.
- **Server Reassembly & Magic-Byte Verification:** `uploadedMedia()` verifies completeness and byte counts, reassembles the file, and passes it to `parseMedia()` to check both MIME allowlists and binary file signatures (`JPEG`, `PNG`, `WebP`, `MP4`, `WebM`).
- **Download:** Clicking **Download Attachment** in any authorized workspace fetches `/attachment/info` and downloads `/attachment/parts/:part` chunks sequentially, verifying exact byte size before saving the reconstructed `Blob`.

---

### 6. Dual-Mode Persistence & Session Security
- **Unified Database Layer (`storage.js`):** Uses built-in synchronous `node:sqlite` (WAL mode + serialized promise queue) locally/in Docker, and `@libsql/client` with `AsyncLocalStorage` per-request write transactions on Vercel + Turso/libSQL.
- **Password & Session Hardening:** Passwords use `crypto.scryptSync` (64-byte key, 16-byte random salt) verified with `crypto.timingSafeEqual`. Session tokens (32 random bytes, 12-hour TTL) are stored only as SHA-256 hashes in `sessions`. Role changes, account disabling, password resets, and self-service password changes immediately revoke all sessions for that user.
- **Gateway-Compatible Preview Sessions:** Standard deployments enforce `HttpOnly; SameSite=Strict` cookies (`Secure` on HTTPS/Vercel). Opt-in demo/embedded preview modes (`RIPTIDE_PREVIEW_COOKIES=true` or `RIPTIDE_DEMO_MODE=true`) additionally support `SameSite=None; Secure; Partitioned` cookies and `X-Riptide-Session` / `Bearer` headers backed by the exact same server-side revocable session table.

---

## Complete Code Function Reference (Module-by-Module)

All application source modules reside in `Riptide-final-source/riptide-release/`. Below is every function in the codebase, organized by module.

---

### `model.js` — Shared Hydrological & Asset Model

Universal Module Definition (UMD) shared identically by the Node.js backend (`require('./model.js')`) and browser simulator (`window.RiptideModel`).

| Function | Signature | Description & Formulas |
|---|---|---|
| `calculate` | `calculate(input) => ScenarioResult` | Computes effective flood metrics from `{ water, velocity, rainfall, blockage, gate, pumps, sandbags, manualReroute, siren, broadcast }`.<br>• **Effective Stage (`m`):** `max(0.2, water + (rainfall / 100) * 1.5 * (1 + (blockage / 100) * 1.8) - pumps * 0.22 - (gate / 100) * 0.35 - (sandbags ? 0.45 : 0))`<br>• **Asset Depth (`m`):** For each of the 7 assets, `max(0, stage - elevation - relief)` where `relief` adds `0.9 m` for `underpass` and `0.4 m` for `underpass`/`rail` when `sandbags` is true.<br>• **Asset Status:** `'BLOCKED'` (`depth > critical`), `'CAUTION'` (`depth > caution`), or `'SAFE'`.<br>• **Inundated Area (`km²`):** `stage > 1.2 ? min(18.5, (stage - 1.2) * 2.8 + submerged * 0.8) : 0.2`.<br>Returns normalized inputs, boolean action flags, `stage`, `area`, and `assets`. |

---

### `storage.js` — Unified SQLite & Turso/libSQL Adapter

Provides an identical async query/transaction interface over local `node:sqlite` (`DatabaseSync`) and remote `@libsql/client`.

| Function | Signature | Description |
|---|---|---|
| `openDatabase` | `openDatabase(dataDir) => DatabaseAdapter` | Selects local `node:sqlite` (`riptide.sqlite` inside `0o700` `dataDir`) when `TURSO_DATABASE_URL` is unset, or `@libsql/client` when set. Rejects missing/local URLs when `process.env.VERCEL` is present so serverless deployments never silently write to ephemeral disk. |
| `connection` *(internal)* | `connection() => LibsqlClient` | Creates a `@libsql/client` instance configured with `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `intMode: 'number'`. |
| `writeTransaction` *(internal)* | `async writeTransaction() => Transaction` | Opens a `'write'` transaction in libSQL mode, retrying up to 7 times with exponential backoff (`min(25 * 2^attempt, 500)` ms) and refreshing local `file:` clients on `SQLITE_BUSY` / `SQLITE_LOCKED`. |
| `executor` *(internal)* | `executor() => Transaction \| LibsqlClient` | Returns the active `AsyncLocalStorage` request transaction, request-scoped client, or default client. |
| `row` *(internal)* | `row(value) => Object \| undefined` | Normalizes a libSQL result row into a plain JS object, converting `ArrayBuffer` BLOB values into Node.js `Buffer` instances. |
| `adapter.withRequest` | `async withRequest(fn, { write = false }) => Promise<any>` | **Local mode:** Chains `fn` onto an in-process Promise queue for sequential access.<br>**Remote mode:** Runs `fn` inside an isolated `AsyncLocalStorage` store; automatically opens, commits, or rolls back write transactions so concurrent serverless requests never share transaction state. |
| `adapter.prepare` | `prepare(sql) => { all, get, run }` | Prepares a SQL statement exposing async `.all(...args)` (array of rows), `.get(...args)` (single row or `undefined`), and `.run(...args)` (`{ changes, lastInsertRowid }`). |
| `adapter.exec` | `async exec(sql) => Promise<void>` | Executes raw SQL. In remote mode, maps `BEGIN [IMMEDIATE]`, `COMMIT`, and `ROLLBACK` to nested `AsyncLocalStorage` transaction depth management, strips local-only `PRAGMA` statements (`journal_mode`, `foreign_keys`, `busy_timeout`), and runs remaining SQL via `executeMultiple`. |
| `adapter.close` | `close() => void` | Closes the underlying SQLite database handle or libSQL client. |

---

### `server.js` — Backend Server, Auth, Validation & Router

Exports `{ ready }` (Promise resolving to `{ server, db, handler }`) and starts an HTTP server on `0.0.0.0:${PORT}` when executed directly.

| Function | Signature | Description |
|---|---|---|
| `buildApp` | `async buildApp() => { server, db, handler }` | Creates/migrates all 12 database tables, upgrades legacy `'responder'`/`'support'` roles to `'rescue'`/`'relief'`, bootstraps the initial admin (`RIPTIDE_ADMIN_USER` + `RIPTIDE_ADMIN_PASSWORD`) if `users` is empty, optionally seeds the 5 `DEMO_ACCOUNTS` and baseline scenario when `RIPTIDE_DEMO_MODE=true`, runs `importLegacy()`, and constructs the HTTP server and request handler. |
| `now` | `now() => string` | Returns the current UTC ISO-8601 timestamp. |
| `digest` | `digest(value) => string` | Computes a hex SHA-256 hash (`crypto.createHash('sha256')`) used for session tokens, upload capability tokens, rate-limit IP keys, and submission idempotency hashes. |
| `passwordHash` | `passwordHash(password, salt) => string` | Derives a 64-byte hex `scrypt` password digest (`crypto.scryptSync(password, salt, 64)`). |
| `createUser` | `async createUser(username, password, role)` | Generates a 16-byte random hex salt, hashes `password`, and inserts a new user row into `users`. |
| `uploadedMedia` | `async uploadedMedia(body) => Object` | Resolves chunked report attachments (`body.media.uploadId` + `uploadToken`): validates 1-hour expiry and token SHA-256 hash against `media_uploads`, verifies all sequential `393,216`-byte chunks exist in `media_chunks` with matching total size, concatenates them, and returns `body` with a reconstructed `data:<mime>;base64,...` payload. |
| `audit` | `async audit(actor, action, target)` | Records an operator or security event (e.g., `login`, `login.failed`, `user.create`, `scenario.action`, `alert.sent`, `item.status`) in the `audit` table. |
| `json` | `json(res, code, value, extra = {})` | Writes a JSON HTTP response with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and any extra headers (such as `Set-Cookie`). |
| `err` | `err(code, message) => Error` | Creates an `Error` annotated with HTTP status code `error.status = code`. |
| `text` | `text(value, field, max, required = true) => string` | Validates string input length (`<= max`) and non-empty trimmed value, returning trimmed text or throwing `400 Invalid <field>`. |
| `secret` | `secret(value) => string` | Validates password input type and length (`1..256` chars) without trimming characters. |
| `isSameOrigin` | `isSameOrigin(req) => boolean` | Protects mutating `/api/` endpoints against cross-site requests by checking `Sec-Fetch-Site !== 'cross-site'` and matching `Origin` host against `Host`. |
| `requestToken` | `requestToken(req) => string \| null` | Extracts a 64-hex-character session token from `X-Riptide-Session` or `Authorization: Bearer` (enabled only in demo/preview modes) or from the `riptide_session` cookie. |
| `session` | `async session(req) => { id, username, role } \| null` | Looks up an active, non-expired session by matching `digest(token)` against `sessions` joined with `users` (`active = 1` and `expires_at > Date.now()`). |
| `requireRole` | `async requireRole(req, roles) => User` | Calls `session(req)`: throws `401 Sign in required` if unauthenticated or `403 Insufficient permissions` if `user.role` is not in `roles`. |
| `cookie` | `cookie(value, maxAge) => string` | Builds the `riptide_session` cookie header (`HttpOnly`, `Path=/`, `Max-Age`, `SameSite=Strict` + `Secure` in standard mode, or `SameSite=None; Secure; Partitioned` when `RIPTIDE_PREVIEW_COOKIES=true`). |
| `rateLimit` | `async rateLimit(req, kind, max, windowMs)` | Enforces per-IP action rate limits (`login`, `password`, `alerts`, `replies`, `scenario`, `uploads`, `upload-parts`, `submissions`). Uses shared `rate_limits` rows in remote libSQL mode and an in-memory `Map` in local SQLite mode; throws `429` when exceeded. |
| `readJson` | `readJson(req) => Promise<Object>` | Parses and validates `application/json` request bodies (supporting both pre-parsed serverless `req.body` and Node streams) up to `7,500,000` bytes (`415` wrong content-type, `413` oversized, `400` invalid/non-object JSON). |
| `parseMedia` | `parseMedia(media) => { name, mime, bytes } \| null` | Validates report attachment data URLs: checks allowed MIME types (`image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/webm`), 5 MiB limit, canonical base64 encoding, and binary magic-number signatures (`FF D8 FF`, PNG header, `RIFF/WEBP`, `ftyp`, `1A 45 DF A3`). |
| `validateItem` | `validateItem(v) => { payload, media }` | Validates `report`, `sos`, and `support` submissions: enforces ID format (`8–100` URL-safe chars), valid `createdAt`, `description` (`<= 2000`), SOS `gps` bounds (`lat -90..90`, `lon -180..180`, `accuracy 0..10,000,000`) & `locationStatus` consistency, report `location` + `parseMedia()`, and support `kind` (`Request support` / `Offer support`), `organization`, and `contact`. |
| `validateScenario` | `validateScenario(v) => Scenario` | Validates numeric bounds on all scenario sliders/metrics, boolean intervention flags, and all 7 unique infrastructure assets, then recomputes authoritative outputs via `calculate(v)`. |
| `importLegacy` | `async importLegacy()` | Imports valid scenario and submission records once from a legacy `data/store.json` file (if present in local SQLite mode) without deleting the source file. |
| `handle` | `async handle(req, res)` | Core request router dispatching all `/api/*` endpoints, server-authenticated `/workspace/<role>` HTML routes (with `302` redirects for unauthenticated or wrong-role visitors), and allowlisted static files. |
| `handler` | `async handler(req, res)` | Outer HTTP/serverless request wrapper executing `handle` inside `db.withRequest(..., { write })`. Buffers write responses in remote mode until the database transaction commits, and converts thrown errors into structured JSON status responses. |

---

### `api/index.js` — Vercel Serverless Function Entry

| Function / Export | Signature | Description |
|---|---|---|
| `module.exports` | `async function(req, res)` | Awaits `require('../server.js').ready` and forwards `(req, res)` to `handler`. Returns `503 Service Unavailable` with JSON diagnostics if hosted database setup fails. |
| `config` | `{ api: { bodyParser: false } }` | Disables Vercel's default body parser so `server.js` `readJson()` enforces strict content-type and byte-length checks uniformly. |

---

### `app.js` — HydroSim 3D Virtual Environment Client

Powers `/simulator.html`, combining state controls, live scenario synchronization, and an interactive 3D HTML5 `<canvas>` renderer.

#### Simulation State & Sync Functions

| Function | Signature | Description |
|---|---|---|
| `$` | `$(id) => HTMLElement` | Shorthand for `document.getElementById(id)`. |
| `log` | `log(tag, message)` | Prepends a timestamped event (`TRIGGER`, `SCENARIO`, `PUMPS`, `LEVEE`, `ACTION`, `BROADCAST`, `DISPATCH`, `SIREN`, `INIT`) to `#log`, trimming entries beyond 40. |
| `inspect` | `inspect(asset)` | Displays the selected/hovered asset's name, type, elevation, water depth, status, and protocol tooltip in the terrain probe HUD. |
| `badge` | `badge(id, text, level)` | Updates road, rail, and drainage status badges (`safe`, `caution`, `danger`). |
| `eventTransition` | `eventTransition(key, active, message)` | Edge-detector that logs a `TRIGGER` message once when road closure, rail suspension, or drainage overflow transitions from `false` to `true`. |
| `update` | `update(publish = true)` | Recomputes flood stage and asset statuses via `RiptideModel.calculate(state)`, updates threat banner (`NORMAL`, `WARNING`, `RED ALERT`), net drain flow, inundated area, and corridor cards, and (if `publish` is true) saves to `localStorage` and schedules `syncScenario()` after 400 ms. |
| `applyShared` | `applyShared(s)` | Applies a remote/cached scenario snapshot into `state`, updates `sharedRevision`, refreshes UI with `update(false)`, and clears conflict flags. |
| `syncScenario` | `async syncScenario()` | Single-flight publisher sending `riptidePendingScenario` to `POST /api/scenario`. Exposes `#reloadShared` on `409 Conflict`, or advances `sharedRevision` and chains any newer local edit made while the request was in flight. |
| `pollShared` | `async pollShared()` | Polls `GET /api/scenario` every 2 seconds (when no local edit is pending) and calls `applyShared()` whenever `revision` changes. |
| `applyPreset` | `applyPreset(name)` | Loads one of `presets` (`normal`, `monsoon`, `urban`, `breach`), resets manual flags, updates the simulation, and logs the preset load. |
| `boot` | `async boot()` | Initializes the simulator on page load from pending local edits, `/api/scenario`, or cached `localStorage` state, then starts the `requestAnimationFrame(render)` loop. |

#### 3D Orthographic Projection & Canvas Rendering Functions

| Function | Signature | Description |
|---|---|---|
| `project` | `project(x, y, z = 0) => { x, y, depth }` | Rotates world coordinates `(x, y, z)` around `cameraAngle` into 2D canvas coordinates (`800×440` logical viewport) plus camera `depth` for painter sorting. |
| `polygon` | `polygon(points, fill, stroke, width)` | Projects 3D vertices and fills/strokes the closed 2D polygon on canvas. |
| `line3` | `line3(points, color, width, dash)` | Projects and strokes 3D polylines (terrain grid, road/rail centerlines, floodwater edge, sandbag levees, flow vectors). |
| `rect3` | `rect3(x1, y1, x2, y2, z, fill, stroke)` | Renders an axis-aligned horizontal 3D quad at elevation `z`. |
| `block` | `block(x, y, w, d, h, colors)` | Extrudes a 3D building footprint `(w × d × h)`, painter-sorting its four vertical faces by camera depth before drawing the roof face. |
| `world` | `world(a) => { x, y }` | Looks up world-space coordinates for an infrastructure asset from `assetPositions`. |
| `disk` | `disk(x, y, r, z, color)` | Draws a 20-sided projected circle at elevation `z` to represent floodwater pooling around inundated assets. |
| `render` | `render()` | Continuous `requestAnimationFrame` renderer drawing DPI-scaled terrain slab, grid, parks, river, dynamic floodplain, transport/canal corridors, sandbag levees, velocity vectors, inundation disks, depth-sorted 3D buildings, status pins, collision-free labels, and rain streaks. |
| `assetAt` | `assetAt(e) => Asset \| null` | Hit-tests pointer coordinates against `projectedAssets` within a 27-pixel radius for click and hover inspection. |

---

### `monitor.js` — Monitoring Portal, Offline Outbox & Workspaces Client

Powers `/monitor.html` and all `/workspace/<role>` views.

#### Authentication, Session & Transport Functions

| Function | Signature | Description |
|---|---|---|
| `$` | `$(id) => HTMLElement` | Shorthand for `document.getElementById(id)`. |
| `storePreviewToken` | `storePreviewToken(token)` | Persists or clears the preview/demo session token in `sessionStorage` (`riptide-preview-session`) and memory. |
| `apiFetch` | `async apiFetch(path, options = {}) => Response` | Central fetch wrapper: transparently chunks large report attachments (`> 2 MB` encoded) via `uploadEvidence()` and attaches `X-Riptide-Session` + `Authorization: Bearer` headers on same-origin calls when `previewSessionToken` is active. |
| `adminFetch` | `async adminFetch(path, options = {}) => Promise<any>` | Authenticated JSON helper tracking `authGeneration` and `authRequestSequence`: discards stale cross-login responses, triggers `sessionWarning` on `401`, throws server error messages on failure, and calls `confirmWorkspaceSession` on success. |
| `sessionWarning` | `sessionWarning(sequence)` | Reveals `#sessionNotice` (`SIGN IN AGAIN`) while keeping the current workspace open if `sequence >= lastAuthSuccess`. |
| `setWorkspaceConfirmation` | `setWorkspaceConfirmation(confirmed)` | Updates `#workspaceSession` status pill (`VERIFYING WORKSPACE`, `WORKSPACE CONFIRMED`, or `WORKSPACE RECONNECT REQUIRED`) with username and role title. |
| `confirmWorkspaceSession` | `confirmWorkspaceSession(sequence)` | Advances `lastAuthSuccess`, hides session warnings, and sets workspace confirmation to `true`. |
| `verifyWorkspaceSession` | `async verifyWorkspaceSession()` | Polls `GET /api/session` every 15 seconds to confirm active session validity without resetting forms or drafts. |
| `acceptUser` | `acceptUser(user)` | Increments `authGeneration`, updates `currentUser`, clears stored preview tokens on sign-out, and resets session banners. |
| `updateAccount` | `updateAccount()` | Updates topbar/sidebar controls for the signed-in role, hides restricted portals (`response`, `support`, `admin`) from unauthorized users, clears admin DOM on logout, and calls `configureWorkspace()`. |
| `refreshSession` | `async refreshSession()` | Queries `GET /api/session` on startup or sign-in dialog open; sets demo-picker availability, restores the signed-in role workspace, or triggers `openRequestedWorkspace()`. |
| `openRequestedWorkspace` | `async openRequestedWorkspace(role)` | Opens the sign-in dialog prompted for `?workspace=<role>` deep links and expands demo credential cards when demo mode is enabled. |

#### Routing, Role Dashboards & Work Register Functions

| Function | Signature | Description |
|---|---|---|
| `showView` | `showView(name)` | Switches active `.view` sections (`overview`, `citizen`, `response`, `support`, `admin`, and the 4 dedicated `<role>-workspace` views), enforces role guards, updates breadcrumbs, and syncs the URL (`/workspace/<role>` or `/monitor.html#<view>`). |
| `configureWorkspace` | `configureWorkspace()` | Moves shared operational cards (`roleDashboard`, `operatorControls`, `roleWorkPanel`, `operatorReports`, `roleWorkRecords`) into the active role's `.workspace-tool-dock`, filters `[data-action]` buttons to `roleActions[role]`, and refreshes work/staff/map panels. |
| `configureRoleDashboard` | `configureRoleDashboard(role)` | Applies role-specific titles, kickers, descriptions, and form field labels from `workspaceSpecs`. |
| `renderStaffMap` | `renderStaffMap(s)` | Renders 7 color-coded asset status pins (`safe`, `caution`, `blocked`) with water depths onto `#operatorMap`. |
| `renderRoleFacts` | `renderRoleFacts(s)` | Renders role-specific live KPIs into `#roleFacts` (e.g., water stage/pumps for Hydrology; blocked assets/siren for Rescue; inundated area/hospital for Relief). |
| `refreshWork` | `async refreshWork()` | Polls `GET /api/work` every 4 seconds and renders saved role plans/findings with `START WORK` (`in_progress`) and `MARK COMPLETED` (`completed`) transitions. |

#### Scenario & Incident Queue Functions

| Function | Signature | Description |
|---|---|---|
| `row` | `row(label, value) => HTMLDivElement` | Builds a two-column `.info-row` key/value element. |
| `setControl` | `setControl(id, value)` | Updates a mitigation `<select>` value only when it is not currently focused by the operator. |
| `renderScenario` | `renderScenario(s)` | Updates overall risk (`NORMAL`, `ADVISORY`, `WARNING`, `CRITICAL`), top scenario metrics, mitigation control values, citizen alert text, asset snapshots, and suggested response priorities. |
| `refreshScenario` | `async refreshScenario()` | Renders pending local scenario edits or polls `GET /api/scenario` every 2 seconds. |
| `renderItems` | `renderItems()` | Renders reports/SOS into `#incidentList` (and `#operatorIncidents` for Rescue/Verification) and support entries (merged with offline `pendingSupport`) into `#supportList`, wiring GPS links, attachment downloads, and `ACKNOWLEDGE`/`RESOLVE` buttons. |
| `refreshItems` | `async refreshItems()` | Polls `GET /api/items` every 2 seconds for authenticated staff and updates `#connection` status. |

#### Offline IndexedDB Outbox & GPS SOS Functions

| Function | Signature | Description |
|---|---|---|
| `openDB` | `openDB() => Promise<IDBDatabase>` | Opens IndexedDB `'riptide-outbox'` (v2) and initializes `'outbox'` and `'sosHistory'` stores keyed by `id`. |
| `outbox` | `async outbox(op, value, storeName = 'outbox')` | Performs `getAll`, `put`, or `delete` operations against `'outbox'` or `'sosHistory'`. |
| `id` | `id() => string` | Generates a UUID via `crypto.randomUUID()` (with timestamp + random base36 fallback). |
| `makeItem` | `makeItem(type, fields) => Object` | Creates a client submission envelope `{ id, type, createdAt, ...fields }`. |
| `enqueue` | `async enqueue(item)` | Stores an item in IndexedDB `'outbox'`, updates `queueCount()`, and triggers `flush()`. |
| `queueCount` | `async queueCount()` | Updates `#queueStatus`, syncs offline `pendingSupport`, and renders `#outboxList` with validation errors and `DISCARD` buttons. |
| `flush` | `async flush()` | Single-flight uploader sending queued items to `POST /api/items` while online. Removes accepted items (marking SOS `'sent'`), annotates `400`/`409`/`413`/`415` rejections with `queueError` (`'needs_attention'`), and retries transient failures later. |
| `gpsDetails` | `gpsDetails(item) => HTMLDivElement` | Formats SOS GPS coordinates (`lat`, `lon`, `±accuracy m`, capture time) with an OpenStreetMap link, or displays the fallback `locationStatus`. |
| `saveSOSHistory` | `async saveSOSHistory(item, delivery)` | Updates an SOS record's `delivery` state (`queued`, `sent`, `needs_attention`, `discarded`) in `'sosHistory'` and re-renders history. |
| `renderSOSHistory` | `async renderSOSHistory()` | Displays device SOS records sorted newest-first, with `REMOVE DEVICE COPY` actions for `sent` and `discarded` entries. |
| `recordSOS` | `async recordSOS(gps, locationStatus)` | Atomically saves a new SOS item into both `'outbox'` and `'sosHistory'` in one IndexedDB transaction, updates `#sosMessage`, and calls `flush()`. |

#### Administration, Staff Directory, Messenger & Evidence Functions

| Function | Signature | Description |
|---|---|---|
| `staffMessage` | `staffMessage(message, isError = false)` | Sets status/error feedback text in the account creation panel. |
| `createStaffRow` | `createStaffRow(user) => HTMLDivElement` | Renders an admin account management card with role `<select>` + `SAVE ROLE`, `DISABLE`/`ENABLE` toggle, and `RESET PASSWORD` form. |
| `changeStaff` | `async changeStaff(user, change, entry)` | Sends `PATCH /api/users/:id` to update `role`, `active`, or `password` and refreshes the admin directory/audit views. |
| `refreshAudit` | `async refreshAudit()` | Polls `GET /api/audit` every 10 seconds (while Admin view is visible) and renders the latest 200 audit trail entries. |
| `refreshAdmin` | `async refreshAdmin()` | Fetches `GET /api/users` to populate `#staffList` and triggers `refreshAudit()`. |
| `refreshRecipients` | `async refreshRecipients(force = false)` | Single-flight per-`authGeneration` loader (with 10s `AbortController` timeout) fetching `GET /api/staff-directory` and updating `#alertRecipient` only when unfocused, empty, or forced. |
| `updateRecipientSelection` | `updateRecipientSelection()` | Displays the selected recipient's full role label and username under `#alertRecipient`. |
| `refreshStaff` | `async refreshStaff()` | Polls every 4 seconds: independently triggers `refreshRecipients()` and `GET /api/alerts`, diffing alert signatures before updating `#staffInbox` and `#staffSent`. |
| `createConversation` | `createConversation(alert, group) => HTMLDetailsElement` | Creates an expandable `<details class="alert-conversation">` thread widget with lazy reply loading and a participant-only reply form. |
| `loadConversation` | `async loadConversation(details)` | Fetches `GET /api/alerts/:id/messages` (polled every 3 seconds while open) and updates `.thread-messages` when message signatures change. |
| `uploadEvidence` | `async uploadEvidence(media) => { uploadId, uploadToken }` | Splits large base64 attachments into `chunkSize` (`393,216` byte) parts via `POST /api/uploads` and sequential `PUT /api/uploads/:id/chunks/:part` calls. |

---

### `register.js` & `sw.js` — PWA Service Worker

| File / Handler | Description |
|---|---|
| `register.js` (`load` listener) | Registers `/sw.js` via `navigator.serviceWorker.register('/sw.js')` when supported by the browser. |
| `sw.js` (`install` listener) | Opens cache `riptide-v30`, pre-caches all 15 static shell files (`index.html`, `monitor.html`, `simulator.html`, CSS, JS, manifest, icons/art), and calls `self.skipWaiting()`. |
| `sw.js` (`activate` listener) | Deletes any cache keys not matching `riptide-v30` and claims active clients (`self.clients.claim()`). |
| `sw.js` (`fetch` listener) | Never caches `/api/*` or `/workspace/*` (offline `/workspace/*` navigations fall back to cached `/monitor.html`). Uses network-first with background cache update and offline cache fallback for public `GET` assets. |

---

### `scripts/` — Migration, Packaging & Browser Verification

| Script | Key Functions / Behavior |
|---|---|
| `scripts/migrate-to-turso.cjs` | CLI migration utility (`npm run migrate:turso -- /path/to/riptide.sqlite`). Opens local SQLite read-only, verifies schema upgrade (`active` column and migrated roles), confirms all 10 target tables on remote Turso/libSQL are empty, copies every row inside a write transaction, clears `sessions`, and commits. |
| `scripts/package-vercel.py` | Clean release archiver producing `releases/Riptide-vercel.zip` with a computed `SHA256SUMS` file while asserting via `archive.testzip()` that no `.sqlite`, `/data/`, `/node_modules/`, or `.env` files are bundled. |
| `scripts/check-libsql.cjs` | Spawns `node --test test/backend.test.js` with `RIPTIDE_TEST_DRIVER=libsql` (`npm run test:libsql`). |
| `scripts/check-browser-session.cjs` | Playwright Chromium E2E runner (`client()` creates an isolated cross-origin iframe context that strips `Cookie`, `Set-Cookie`, and `Authorization` headers; `signIn(client, username)` logs in via demo autofill). Verifies `X-Riptide-Session` auth, recipient picker, task send/reply/acknowledge, 32s polling stability, page reload recovery, and byte-exact 5 MiB chunked PNG upload/download. |

---

## REST API & Route Reference

All mutating `/api/*` endpoints require `Content-Type: application/json` (up to 7.5 MB body ceiling) and pass same-origin checks (`isSameOrigin`).

| Method & Path | Auth / Allowed Roles | Rate Limit | Function & Behavior |
|---|---|---|---|
| `GET /api/health` | Public | — | Health check returning `{ "ok": true }`. |
| `GET /api/session` | Public / Optional Session | — | Returns `{ user, demoMode, sessionTransport, build, setupRequired }`. |
| `GET /api/demo-accounts` | Public (`RIPTIDE_DEMO_MODE=true` only) | — | Returns active, unmodified demo credentials for the 5 roles (`404` when demo mode is off). |
| `POST /api/login` | Public | `10 / 15 min` | Authenticates `username` & `password` (timing-safe `scrypt`), creates 12h session cookie (plus `previewSessionToken` in demo/preview mode), logs `login` / `login.failed`. |
| `POST /api/logout` | Optional Session | — | Revokes the current session token in `sessions`, clears `riptide_session` cookie, and logs `logout`. |
| `POST /api/change-password` | Any active staff role | `10 / 15 min` | Verifies `currentPassword`, sets `newPassword` (`12–256` chars), revokes all sessions for the user, and logs `user.password_changed`. |
| `GET /api/users` | `admin` | — | Lists all staff accounts (`id, username, role, active, createdAt`) without password hashes or salts. |
| `POST /api/users` | `admin` | — | Creates a new staff account (`username`, `role`, `password >= 12 chars`) and logs `user.create`. |
| `PATCH /api/users/:id` | `admin` | — | Updates one field (`role`, `active`, or `password`), prevents self-demotion/self-disable or removing the last active admin, revokes user sessions, and audits the change. |
| `GET /api/audit` | `admin` | — | Returns the 200 most recent operator audit events (`id, actor, action, target, at`). |
| `GET /api/staff-directory` | Any active staff role | — | Lists active staff accounts (`id, username, role`) for the alert recipient dropdown. |
| `GET /api/alerts` | Any active staff role | — | Returns up to 200 alerts where the caller is sender or recipient (or all alerts for `admin`). |
| `POST /api/alerts` | Any active staff role | `60 / min` | Sends a targeted alert/task (`recipientId`, `message`) to an active staff user and returns `{ ok: true, id }`. |
| `PATCH /api/alerts/:id` | Recipient only | — | Advances task status to `acknowledged` or `completed` (`403` if caller is not the recipient). |
| `GET /api/alerts/:id/messages` | Sender, Recipient, or `admin` | — | Returns `{ alert, messages, canReply }` (up to 500 chronological replies). |
| `POST /api/alerts/:id/messages` | Sender or Recipient | `120 / min` | Appends a reply to an alert conversation (`409` if the other participant is disabled). |
| `GET /api/work` | Any active staff role | — | Returns up to 200 `operator_work` records matching `actor.role` (or all records for `admin`). |
| `POST /api/work` | `relief`, `rescue`, `verification` | — | Saves a role work plan/finding (`location`, `quantity` `1..100000`, `detail`). |
| `PATCH /api/work/:id` | Same role or `admin` | — | Updates work record status (`planned`, `in_progress`, `completed`). |
| `GET /api/scenario` | Public | — | Returns the current shared simulation scenario JSON (or `null` if not initialized). |
| `POST /api/scenario` | Public (Simulator) | `300 / min` | Validates and saves simulator state using optimistic `baseRevision` concurrency (`409` on revision mismatch) and increments `revision`. |
| `POST /api/scenario/actions` | Role-filtered (`ACTIONS[role]`) | — | Applies an authorized staff intervention (`pumps`, `gate`, `sandbags`, `clearDrain`, `manualReroute`, `siren`, `broadcast`), recalculates model outputs, increments `revision`, and audits `scenario.action`. |
| `POST /api/uploads` | Public | `60 / min` | Initializes a chunked report media upload (`<= 5 MiB`), purges uploads older than 1 hour, and returns `{ id, token, chunkSize: 393216 }`. |
| `PUT /api/uploads/:id/chunks/:part` | Upload token (`X-Riptide-Upload-Token`) | `1200 / min` | Stores an idempotent base64 chunk for `upload_id` and `part` index (`409` if re-uploaded with different bytes). |
| `POST /api/items` | Public (`report`, `sos`) / `admin` (`support`) | `60 / min` | Validates and stores an idempotent `report`, `sos`, or `support` item (reassembling chunked media if referenced). |
| `GET /api/items` | `admin`, `verification`, `rescue` | — | Returns up to 100 recent submissions (`admin` sees all types; `verification` & `rescue` see `report` and `sos` only). |
| `PATCH /api/items/:id/status` | `admin`, `verification` | — | Updates item status (`new`, `acknowledged`, `resolved`); only `admin` can update `support` items. |
| `GET /api/items/:id/attachment` | `admin`, `verification`, `rescue` | — | Downloads raw attachment bytes with `Content-Security-Policy: default-src 'none'; sandbox` (`413` on Vercel if `> 3 MB`; use chunked endpoints below). |
| `GET /api/items/:id/attachment/info` | `admin`, `verification`, `rescue` | — | Returns `{ name, mime, size, chunkSize: 393216 }` for chunked browser downloads. |
| `GET /api/items/:id/attachment/parts/:part` | `admin`, `verification`, `rescue` | — | Returns `{ data }` containing base64 bytes for the requested `393,216`-byte attachment slice. |
| `GET /workspace/:role` | Session-checked (`admin`, `relief`, `hydrology`, `rescue`, `verification`) | — | Serves `monitor.html` scoped to `:role`, redirecting unauthenticated users to `/monitor.html?workspace=:role` and mismatched roles to `/workspace/<actor.role>`. |

---

## Database Schema

`server.js` automatically initializes and migrates all tables on startup:

| Table | Primary Key | Purpose |
|---|---|---|
| `metadata` | `key TEXT` | Tracks one-time migration flags (e.g., `legacy_import`). |
| `users` | `id INTEGER` | Staff accounts (`username`, `role`, `salt`, `password_hash`, `created_at`, `active`). |
| `sessions` | `token_hash TEXT` | Active 12-hour staff sessions (`user_id` FK with `ON DELETE CASCADE`, `expires_at`). |
| `scenario` | `id INTEGER (CHECK id=1)` | Single-row JSON store (`data`, `updated_at`) for the shared flood scenario and `revision`. |
| `items` | `id TEXT` | Citizen reports, GPS SOS records, and partner support items (`type`, `payload`, `payload_hash`, `status`, timestamps). |
| `attachments` | `item_id TEXT` | Binary media evidence (`name`, `mime`, `bytes BLOB`) linked to `items(id)` (`ON DELETE CASCADE`). |
| `audit` | `id INTEGER` | Immutable operator/security activity log (`actor`, `action`, `target`, `at`). |
| `staff_alerts` | `id INTEGER` | Targeted inter-staff tasks/alerts (`sender_id`, `sender_name`, `sender_role`, `recipient_id`, `message`, `status`, `created_at`). |
| `alert_replies` | `id INTEGER` | Two-way conversation messages attached to `staff_alerts(id)`. |
| `operator_work` | `id INTEGER` | Role workspace plans and findings (`role`, `actor`, `location`, `detail`, `quantity`, `status`, `created_at`). |
| `rate_limits` | `key TEXT` | Shared rate-limit counters (`hits`, `expires_at`) used in remote Turso/libSQL mode. |
| `media_uploads` / `media_chunks` | `id TEXT` / `(upload_id, part)` | Temporary staging tables (1-hour TTL) for chunked 5 MiB attachment uploads. |

---

## Setup, Deployment & Verification

All commands below run from `Riptide-final-source/riptide-release/` and require **Node.js 22.13+** (within `22.x`).

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port for standalone Node.js / Docker HTTP server (binds to `0.0.0.0`). |
| `RIPTIDE_DATA_DIR` | `./data` | Directory for local `riptide.sqlite` when `TURSO_DATABASE_URL` is unset. |
| `TURSO_DATABASE_URL` | *(unset)* | Hosted `libsql://...` or `https://...` URL (required on Vercel). |
| `TURSO_AUTH_TOKEN` | *(unset)* | Database authentication token for hosted Turso/libSQL (required on Vercel). |
| `RIPTIDE_ADMIN_USER` | *(unset)* | Initial admin username (`3–64` chars `[a-z0-9._-]`), used **only** when `users` is empty. |
| `RIPTIDE_ADMIN_PASSWORD` | *(unset)* | Initial admin password (`12–256` chars), used **only** when `users` is empty. |
| `RIPTIDE_SECURE_COOKIES` | `false` (`true` on Vercel/Docker) | Adds `Secure` flag to session cookies (enable behind HTTPS). |
| `RIPTIDE_DEMO_MODE` | `false` | Seeds the 5 public `demo.*` accounts, baseline scenario, sign-in autofill picker, and session header support. **Use only on an isolated demo database.** |
| `RIPTIDE_PREVIEW_COOKIES` | `false` | Enables `SameSite=None; Secure; Partitioned` cookies and `X-Riptide-Session` header transport for embedded HTTPS iframe previews. |

### Local Node.js & SQLite

```bash
cd Riptide-final-source/riptide-release
npm ci

# Option A: Private local setup with your own initial administrator
export RIPTIDE_ADMIN_USER='admin.local'
read -rs -p 'Initial admin password (12+ chars): ' RIPTIDE_ADMIN_PASSWORD; echo
export RIPTIDE_ADMIN_PASSWORD
export RIPTIDE_SECURE_COOKIES='false'
npm start

# Option B: Isolated local demo with all 5 pre-configured demo roles
RIPTIDE_DEMO_MODE=true RIPTIDE_SECURE_COOKIES=false npm start
```

Open `http://localhost:3000` (Entry), `http://localhost:3000/simulator.html` (HydroSim), or `http://localhost:3000/monitor.html` (Monitoring & Workspaces).

### Docker Compose

```bash
cd Riptide-final-source/riptide-release
# Create .env with RIPTIDE_ADMIN_USER and RIPTIDE_ADMIN_PASSWORD (12+ chars)
docker compose up -d --build
```

Place a TLS reverse proxy (such as Caddy with `request_body { max_size 8MB }`) on the host forwarding HTTPS traffic to `127.0.0.1:3000`. See [`Riptide-final-source/riptide-release/DEPLOYMENT.md`](Riptide-final-source/riptide-release/DEPLOYMENT.md) for full proxy and backup guidance.

### Vercel + Turso/libSQL Serverless Deployment

1. Provision a **Turso / libSQL** database and auth token.
2. Import the repository into Vercel with **Root Directory** set to `Riptide-final-source/riptide-release` (or `riptide-release` from the release archive), **Framework Preset** `Other`, **Node.js** `22.x`, and **Install Command** `npm ci`.
3. Configure `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `RIPTIDE_ADMIN_USER`, `RIPTIDE_ADMIN_PASSWORD`, `RIPTIDE_SECURE_COOKIES=true`, `RIPTIDE_DEMO_MODE=false`, and `RIPTIDE_PREVIEW_COOKIES=false`.
4. To migrate an existing local SQLite database to an empty Turso database:
   ```bash
   TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." \
     npm run migrate:turso -- /absolute/path/to/riptide.sqlite
   ```
See [`Riptide-final-source/riptide-release/VERCEL.md`](Riptide-final-source/riptide-release/VERCEL.md) for complete serverless setup and post-deploy verification steps.

### Automated Test Suites

Run from `Riptide-final-source/riptide-release/`:

```bash
# Backend API, RBAC, 5 JSDOM workspaces, offline outbox, serverless concurrency & migration tests
npm test

# Backend regression suite through the async @libsql/client adapter
npm run test:libsql

# End-to-end Playwright Chromium tests (embedded cross-origin iframes, chat & 5 MiB chunked transfers)
npx playwright install chromium
npm run test:browser
npm run test:browser:libsql
```

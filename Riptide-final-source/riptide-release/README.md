# Riptide — flood response demonstration

**Vercel deployment is supported with a hosted Turso/libSQL database. Start with [VERCEL.md](VERCEL.md).** The Node/Docker mode still supports local SQLite. All staff, messaging, reports, attachments, GPS SOS and simulator features use the same application logic in both modes.

Riptide connects the virtual flood simulator with citizen, response, support and scenario portals. **This is not a real emergency service or production-ready flood-response system.** Floods, alerts, shelters, SOS, and response actions are simulated. SOS and reports are **not dispatched** to responders; support entries do **not** contact organizations. For real danger, call local emergency services.

## Run locally

Requires Node.js **22.13 or newer**, with the built-in `node:sqlite` module. Run `npm ci` to install dependencies. No frontend build step is needed. SQLite may emit an experimental warning on some Node versions.

```sh
# Choose your own values; do not commit them or expose them in logs.
export RIPTIDE_ADMIN_USER='your-admin-username'
read -rs -p 'Initial admin password (12+ characters): ' RIPTIDE_ADMIN_PASSWORD; echo
export RIPTIDE_ADMIN_PASSWORD
node server.js
```

Open `http://localhost:3000`. The first startup creates an admin only when the user database is empty and both variables are supplied. Remove those environment variables on later starts; they do not reset a password. If no account exists, staff sign-in stays unavailable until the server is restarted with bootstrap variables. Do not use a shared or sample password. `PORT` changes the port; `RIPTIDE_DATA_DIR` selects a persistent writable data directory. The server binds to `0.0.0.0`.

Use **Staff sign in** inside the monitoring portal. After an administrator signs in, the **Administration** tab appears. An administrator can create a separate login ID for each operator, assign or change their role, enable or disable accounts, reset passwords, and review the most recent 200 audit events. Staff can use **Change password** to replace their temporary password. Role changes, disabling and password resets revoke the affected account’s active sessions; password changes sign that person out on every device. An administrator cannot change their own role or disable their own account. Share temporary passwords securely outside the application.

Administrators alone can access the Response and External Support portals and manage staff. Four operator roles sign in through **Staff sign in** and use **Staff workspace**, with a live illustrative infrastructure map:

- **Relief Operator**: relief coordination and simulated broadcasts.
- **Hydrology Expert**: pumps, gates, levees and drainage controls.
- **Rescue Allocation Chief**: incident visibility, route diversion and simulated siren.
- **Reports and Data verification Specialist**: citizen reports, evidence downloads, acknowledgement and resolution.

Every staff member can send a targeted task/alert to another active account. Incoming and sent alerts show sender name and role, recipient name and role, timestamp and status. Only the recipient can acknowledge or complete a task; administrators can review all alerts. Alerts persist in SQLite and refresh while the app is online. No real dispatch or push notification is performed.

Existing responder accounts migrate to Rescue Allocation Chief and support accounts to Relief Operator; existing sessions are revoked once during migration. Administrators should review assignments after upgrading. The public simulator remains an anonymously writable demonstration, not a secured operational feed; role restrictions apply to staff intervention APIs, not anonymous simulator editing.

## Storage and offline behavior

- SQLite stores users, hashed session tokens, scenarios, reports, attachments, statuses and audit records in `data/riptide.sqlite` by default. Deployment packages exclude runtime databases and private data; bootstrap the first administrator as described above. Passwords use scrypt with per-user random salts. Sessions expire after 12 hours and use HttpOnly, SameSite=Strict cookies.
- An existing `data/store.json` is imported on first run where entries pass current validation. The original file is **never deleted**. Check server logs for entries requiring manual review; they remain in the original file. Back up the old file before upgrading.
- The public simulator and Riptide use one shared **demonstration** scenario. Simulator edits and authorized response interventions are recalculated by the same model and polled every two seconds. Concurrent simulator edits use revisions: if a newer change arrives first, the other editor sees a conflict and can load the shared scenario instead of silently overwriting it. Pending local edits are retried while the simulator is open; browser storage may be cleared or unavailable. The public simulator remains writable by anyone with access and is not a secured operational data feed.
- SOS, reports and support submissions queue in IndexedDB if the server is unavailable. They retry while the app is open, with idempotent submission IDs. Invalid items remain in the device outbox with an error and can be discarded. The queue is stored on the originating device, is not encrypted, and can be lost if storage is cleared, full or unavailable. Don't use a shared device for sensitive reports.
- On a successful initial visit, the service worker caches the app so SOS and report forms can open offline. Offline delivery is not guaranteed; the app needs to be open again after connectivity returns. Service workers require HTTPS except on localhost.
- Attachments are limited to 5 MB and JPEG, PNG, WebP, MP4 or WebM. They are stored in SQLite and only available to authorized staff as downloads. The server checks file signatures but does **not** scan attachments for malware.
- To back up, stop the server and copy the entire persistent data directory (including the SQLite database and any WAL files); verify restores. Never place it inside a public web root or commit it. `data/` is ignored by Git.

## API overview

`GET /api/health`, `GET /api/session`, `POST /api/login`, `POST /api/logout`, `GET/POST /api/users`, `PATCH /api/users/:id`, `GET /api/audit` (admin), `POST /api/change-password` (staff), `GET/POST /api/scenario`, `POST /api/scenario/actions` (responder/admin), `POST /api/items`, `GET /api/items` (staff, role-filtered), `GET /api/items/:id/attachment` (responder/admin), and `PATCH /api/items/:id/status` (role-filtered). Status values are `new`, `acknowledged`, and `resolved`. JSON requests are validated; duplicate submission IDs are idempotent only when their contents match.

Run automated backend tests with `node --test test/backend.test.js`.

## Before any real-world deployment

Run behind HTTPS and set `RIPTIDE_SECURE_COOKIES=true`; use a persistent volume, restrict access at the network edge, and configure rate limiting for your proxy topology. Local SQLite mode uses per-process rate limits; hosted libSQL mode uses shared database-backed limits. Neither replaces an appropriate gateway. This implementation has **not** been independently security-audited or load-tested and provides no MFA, encryption at rest, malware scanning, self-service account recovery, automated backups, retention/deletion policies, multi-region resilience, real sensor feeds, authoritative shelter data, real dispatch, real partner messaging, or verified emergency communications. It must not be used for public production or life-safety decisions until those controls and integrations are implemented, independently reviewed and tested with local authorities. Static hosting alone cannot run the backend.

## Connecting two computers

Both computers must open the **same application URL**, backed by the same persistent database (hosted libSQL on Vercel, or one persistent SQLite database on a Node server). Open the virtual environment on one and monitoring on the other. `localhost` on two different computers refers to two different machines, not a shared server. Deploy the Node server to a host reachable by both devices and use HTTPS; static hosting alone or separate server instances with separate databases cannot synchronize. Polling normally updates each view within about two seconds while connected. Response staff can set pumps, gate, levees, diversion, siren and simulated broadcast from the response portal. The simulator also displays response changes. A sync conflict requires using **Load shared scenario** in the simulator; that discards its pending local changes.

The Arena preview, if running, is temporary; share the same preview URL on both computers while it is live. The preview account is only for the isolated demo and is not created in your deployment. In your deployment, use the bootstrap instructions above to set your own staff credentials.

## Opt-in public demo accounts

For an isolated demonstration, start with `RIPTIDE_DEMO_MODE=true npm start`. This creates `demo.admin`, `demo.relief`, `demo.hydrology`, `demo.rescue`, and `demo.verification` when absent. Staff sign in displays **Fill demo credentials**, with a role card for each account. Selecting a card fills the form; the visitor still presses Sign in. Credentials are intentionally public through the demo API; never enable this on a private or operational deployment. Existing accounts are never reset. Disabled, reassigned, or password-changed demo accounts disappear from the picker. Turning demo mode off hides the picker/API but does not delete accounts: disable or delete public demo accounts before using a database privately. Use a separate data directory for the demo.

## Website navigation

Home offers Virtual Environment and Monitoring & Mitigation. Monitoring opens a portal selection page: Citizen Portal (public) or Staff Sign In. Successful sign-in routes administrators to the Admin Portal and other staff to their role-assigned workspace. Returning signed-in visitors resume the relevant staff destination. The Admin Portal links to Response, External Support, and Map & Staff Alerts. The diagram's display labels Relief and Resource Coordinator and Rescue Initiator correspond to the existing `relief` and `rescue` role keys; account credentials and permissions are unchanged. Reports and Data Verification Specialist remains a fifth destination because it was requested separately.

## Role-specific workspaces

Each account opens its assigned workspace from Staff Sign In. Relief has a supply allocation planner and distribution progress records. Rescue has team allocation plans, incident intelligence, route diversion and siren controls. Verification has evidence downloads, incident status review and a findings register. Hydrology has water/rainfall/drainage metrics and pumps, gate, levee and drain controls. Administration has account management, response/support, all operational controls, alert oversight and the combined operator work register. Plans and findings persist in SQLite; same-role staff share records, and administrators can review and update all records. Quantities and notes are self-reported demonstration plans, not verified stock or team availability. No real dispatch occurs.

UI regression tests use jsdom and fake-indexeddb: run `npm ci` then `npm test`. They exercise the role entry buttons, demo picker autofill, actual sign-in requests, unique workspace routes, form visibility and assigned controls for all five accounts. This is DOM-level coverage, not a visual browser test. The autofill button remains visible even outside demo mode and explains how to enable demo access instead of silently disappearing.

### Dedicated workspace pages

The five staff destinations are `/workspace/admin`, `/workspace/relief`, `/workspace/hydrology`, `/workspace/rescue`, and `/workspace/verification`. Each operator has a separate dashboard section with its own banner, capability summary and tool dock. Staff sign-in routes directly to the assigned page. Page routes check the session on the server; unauthenticated visitors are sent to sign-in and accounts requesting a different role are redirected to their own page. Browser reload restores the same destination. Workspace pages bypass service-worker caching. Demo mode initializes a baseline scenario only if none exists so the shared map is populated.

### Embedded preview session cookies

The Arena HTTPS iframe preview starts with `RIPTIDE_PREVIEW_COOKIES=true` to use Secure, HttpOnly, SameSite=None, Partitioned cookies. This is opt-in for embedded HTTPS previews only; ordinary deployments retain SameSite=Strict by default. Same-origin mutation checks remain enabled. If an embedded browser still blocks cookies, open the preview in a new tab. Background authorization failures no longer navigate away: an explicit session notice asks for reauthentication, and protected APIs continue to reject unauthenticated operations. Authentication generations prevent delayed requests from clearing a newer login. UI tests simulate cookie loss for multiple polling cycles in each role and verify that the workspace remains open and can reconnect.

### Simplified entry and support records

Monitoring now opens Overall Scenario directly. Portal Selection has been removed; use Citizen Portal in the sidebar or Staff Sign In and demo autofill in the top bar. Older `/monitor.html?workspace=...` links still open sign-in for the requested role. Recipient options are updated only when the active directory changes, and never rebuilt while the select has focus. External Support saves online submissions before confirming success, immediately displays the accepted record, and refreshes the server-backed list. Offline support records appear as queued until delivered. UI regression coverage verifies stable recipient option nodes across refreshes, removal of Portal Selection, and saved support records in both the list and API.

## GPS-enabled SOS records

SOS requests browser location permission over HTTPS (or localhost). It captures one location fix with latitude, longitude, reported accuracy and capture time, not continuous/background tracking. It then records the SOS atomically in the device outbox and SOS history, and retries delivery while the app is open. If permission is denied, location is unsupported or a fix times out, users can explicitly send without location. A sent status means the demo server accepted the record, not that responders received it. The Citizen Portal shows device SOS history and queued/sent/needs-attention/discarded delivery state. Accepted SOS records persist in SQLite and appear with GPS details and a map link in authorized admin/rescue/verification incident queues. Coordinates are self-reported, not verified. Opening a map link shares those coordinates with OpenStreetMap. Device history is unencrypted: avoid shared devices, and remove sent device copies when no longer needed. Removing a device copy does not delete the server record. No real dispatch occurs.

### Recipient picker

Tasks and alerts now use an in-page expandable recipient picker instead of the browser-native dropdown. Full role names and usernames wrap onto separate lines; search filters active staff locally. Native radio controls support keyboard selection, Escape closes the picker, and background polling preserves the open list, selection and focus. On narrower previews the alerts section stacks into a single column. DOM regression coverage checks filtering, selection, polling stability and actual alert delivery to the selected account; this does not constitute a visual browser-layout test.

### Recipient dropdown update

The recipient picker is now a standard native `<select>` dropdown with no search field, radio list or custom popup. The alert panels stack vertically to give the dropdown the full panel width. Option labels use username and a concise role label; the complete role and username are repeated below the selected value. Options are not rebuilt during ordinary polling or while the dropdown is focused. UI regression coverage checks the visible native control, selection retention and actual alert delivery.

Recipient loading is independent of alert loading: a failed `/api/alerts` response cannot leave the dropdown empty. The native select stays disabled while its first directory request is pending, becomes usable only after options arrive, and shows a retry action on failure or timeout. Background directory requests are single-flight per authentication generation; initial population cannot be blocked by focus. UI tests inject both directory and alerts failures, recover the directory with Retry while alerts still fail, and verify selection and delivery after recovery.

Embedded-preview authentication also supports a preview-only bearer session returned on login when `RIPTIDE_PREVIEW_COOKIES=true`. The monitoring client keeps it in per-tab sessionStorage (memory if storage is unavailable) and sends it in the Authorization header for same-origin API requests. It uses the same hashed, expiring, revocable server session as cookies. Logout revokes it. Default deployments do not return or accept these bearer sessions. This is intended for isolated demos where third-party cookies are blocked; unlike HttpOnly cookies, sessionStorage tokens are accessible to same-origin scripts. UI messenger regression tests now run without sending cookies and verify directory loading, selection and delivery for every role.

### Workspace confirmation and two-way conversations

A workspace session banner shows the authenticated username and role. Successful protected requests or session verification clear stale reconnect warnings; verification repeats every 15 seconds without rebuilding the workspace or resetting drafts. An explicit Refresh Messenger action retries session confirmation, recipients and conversations.

An alert is also a persistent conversation. Sender and recipient can open it and exchange replies; only the recipient acknowledges/completes the associated task. Administrators may review other conversations but cannot impersonate a participant or reply to threads they do not belong to. Replies persist in SQLite, identify their sender/role and timestamp, and open conversations refresh every three seconds. List polling avoids rebuilding unchanged cards so reply drafts and expanded conversations remain intact. This is polling, not push delivery or real emergency dispatch. DOM tests use two independent staff sessions to verify task receipt, reply delivery, acknowledgement and automatic recovery from a temporary authentication failure.

### Preview gateway compatibility (v29)

Demo/embedded-preview logins return a revocable session token when either `RIPTIDE_DEMO_MODE=true` or `RIPTIDE_PREVIEW_COOKIES=true`. Same-origin API requests carry it in `X-Riptide-Session` as well as the legacy Authorization header. Gateways that consume Authorization and browsers that block third-party cookies therefore do not break the messenger. Private deployments with both flags off still use HttpOnly cookies only. Session tokens never go in URLs, and staff roles continue to be enforced by the server. Successful authentication checks outrank older failed requests so delayed failures cannot put a healthy workspace into a reconnect loop. A new login displays Verifying Workspace while its check is pending, not Reconnect Required.

Run the real-browser regression using `npm run test:browser` after installing Playwright Chromium (`npx playwright install chromium`), or set `CHROMIUM_PATH` to an existing compatible browser binary. The test starts an isolated temporary demo backend, uses two cross-origin iframe clients with cookie headers removed and Authorization stripped, and checks messaging, 32 seconds of polling, and reload recovery through the custom session header. It writes no test data into the preview database.

## Vercel migration

The application now exports an async handler for Vercel, with remote libSQL persistence, per-invocation transactions, atomic bootstrap/schema initialization, shared rate limits, and chunked 5 MB evidence upload/download. No local runtime data is bundled. See VERCEL.md for setup, private versus demo environments, migration, tests and hosted deployment verification requirements.

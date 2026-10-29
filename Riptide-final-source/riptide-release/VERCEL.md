# Deploy the complete Riptide app on Vercel

This version runs the full backend in a Vercel Node.js Function and uses a **hosted Turso/libSQL database** for durable state. It does not write production records to Vercel's temporary filesystem. A hosted database is required; it is not bundled in the ZIP and must be created in your own account.

## 1. Create the persistent database

Create a database in Turso and generate an application database token. Keep its `libsql://…` URL and token in your hosting settings, **not in Git or chat**. A paid or free plan with sufficient storage/request capacity is your choice; this package does not provision or purchase a service.

Every function and user must use the same database. Use separate databases for private production and public demos, and preferably separate Preview and Production environments.

## 2. Import the GitHub repository into Vercel

Choose the branch containing these files (`arena/df827fda-riptide` until merged).

- **Root Directory:** `riptide-release`
- **Framework Preset:** Other
- **Node.js:** 22.x
- **Install Command:** `npm ci`
- **Build Command:** leave unset (there is no frontend compilation step)
- **Output Directory:** leave unset; do not set it to `public`, `dist`, or a static-only directory

The included `vercel.json` sends application, API, and workspace routes to `api/index.js`. That function serves only explicitly allowed public assets; the database, source configuration, tokens, tests and environment files are never public routes.

If you extracted the ZIP and deploy that extracted application directory directly, choose the directory containing `package.json`, `vercel.json` and `api/` as your project root.

## 3. Set environment variables in Vercel

Required for the complete application:

| Variable | Value |
|---|---|
| `TURSO_DATABASE_URL` | Your hosted `libsql://…` database URL |
| `TURSO_AUTH_TOKEN` | Your database token; mark it sensitive |
| `RIPTIDE_ADMIN_USER` | Your chosen initial administrator login |
| `RIPTIDE_ADMIN_PASSWORD` | Your unique initial password, 12–256 characters; mark it sensitive |
| `RIPTIDE_SECURE_COOKIES` | `true` |
| `RIPTIDE_DEMO_MODE` | `false` for private use |
| `RIPTIDE_PREVIEW_COOKIES` | `false` for normal top-level hosting |

Set the appropriate Vercel environments (Production and/or Preview), then deploy. On first successful request, the app creates its schema and first administrator atomically. Sign in and create the other four staff accounts in Administration. Remove the two bootstrap credential variables and redeploy after verifying sign-in; they do not reset an existing account's password.

For a deliberately public demonstration **using a separate database**, set `RIPTIDE_DEMO_MODE=true`. This enables the five public demo accounts and autofill. Set `RIPTIDE_PREVIEW_COOKIES=true` only if you deliberately embed the HTTPS deployment and need partitioned cookies. Demo/embedded modes can also authenticate via the same expiring server session sent in the dedicated application header. These are not client-side role overrides.

**Do not enable public demo credentials on a database containing private citizen or GPS records.** Disabling demo mode later does not remove accounts: disable those accounts too, or use a fresh private database.

## 4. Verify after deployment

1. Open `/api/health` and confirm `{"ok":true}`.
2. Sign in at `/monitor.html`; verify **Workspace Confirmed** with the right account and role.
3. Use two browsers/devices with different staff accounts and the same URL. Send a task, reply, acknowledge and complete it.
4. Test the simulator and monitoring page simultaneously. All instances use the same scenario revision and database.
5. Submit a citizen report, a GPS SOS (allow browser Location), and an administrator support request. Check saved records in the correct staff workspaces.
6. Upload and download evidence. The **5 MB** limit is retained: large evidence is split into smaller authenticated/capability-protected requests, avoiding Vercel's individual request/response limits.
7. Redeploy, then verify that accounts, tasks, chats, reports, SOS GPS and support records remain.

A 503 configuration error is intentional when the hosted database is missing or inaccessible. The app will not silently save production data into `/tmp`. Inspect Vercel Function logs for setup failures. Redeploy after changing environment variables. This code has local integration and browser tests; a successful live Vercel deployment still requires your actual hosted database and environment configuration.

## Existing SQLite records

To preserve a local/demo database, stop its server and back up its entire data directory first. Upgrade it with the current local server if it still has legacy roles. Create an **empty** hosted database, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in your local shell, and run:

```
npm ci
npm run migrate:turso -- /absolute/path/to/riptide.sqlite
```

The importer refuses a nonempty target. It preserves accounts, report/attachment records, SOS coordinates, support entries, scenario, tasks, audit history and conversations. Existing sessions are deliberately revoked: sign in again on the new origin. Do not place the source database in your repository or upload it as a static asset.

## Functionality and limits

No existing user feature was intentionally removed. All five role interfaces, administration, intervention controls, simulator sync, chat/replies, task statuses, partner records, GPS SOS, report evidence and browser offline outboxes remain.

- Sync is the existing polling mechanism (roughly 2–4 seconds), not WebSockets or guaranteed push delivery.
- GPS is the existing one-time browser location capture, not background tracking.
- Offline delivery requires the originating app to reopen online; mobile/browser storage and permissions can still prevent it.
- The same database supplies all Vercel instances; writes and revisions use transactions. Rate-limit state is shared in hosted storage.
- Hosted database/network operations and periodic polling consume provider usage; choose limits appropriate for your demonstration and monitor costs.
- Upload capabilities expire after an hour; incomplete chunks are cleaned up when another upload starts. Attachments still undergo type/signature and size checks, not malware scanning.
- This remains a simulated response system, not a certified emergency dispatch service. Hosting it on Vercel does not change that limitation.

## Local verification

```
npm ci
npm test
npm run test:libsql
npx playwright install --with-deps chromium
npm run test:browser:libsql
```

The libSQL integration tests use temporary file-backed libSQL for reproducible tests; they exercise the same async driver and serverless entry, including two independent instances and cold-start persistence. They are not a live hosted-provider connectivity test.

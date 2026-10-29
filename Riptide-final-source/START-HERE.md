# Riptide — complete final website source

This archive contains the entire current application, not an update patch.
Source: GourvendrakumarJha/Riptide, branch arena/df827fda-riptide.
Revision: 937711f (see RELEASE.json for the full commit).

## Start here

1. Extract this archive. Open riptide-release/VERCEL.md for Vercel deployment.
2. Use riptide-release as the project root, Other as the framework, Node 22.x,
   and npm ci as the install command. Leave build and output overrides unset.
3. Provision a hosted Turso/libSQL database. Set TURSO_DATABASE_URL and
   TURSO_AUTH_TOKEN in Vercel environment settings, never in source control.
4. Set RIPTIDE_ADMIN_USER and RIPTIDE_ADMIN_PASSWORD for the first administrator.
   Set RIPTIDE_SECURE_COOKIES=true, RIPTIDE_DEMO_MODE=false and
   RIPTIDE_PREVIEW_COOKIES=false for private top-level hosting.
5. Deploy, sign in, create the other staff accounts and verify the flows in
   VERCEL.md. Remove the bootstrap credential variables after successful setup.

For the five public demo accounts and sign-in autofill, use a separate database
and enable RIPTIDE_DEMO_MODE=true. Never enable public accounts on private data.

## What is included

- Complete frontend HTML, CSS and JavaScript, service worker, manifest and assets.
- Full backend, local SQLite and hosted libSQL storage adapter, and Vercel API.
- Five staff workspaces, account administration, two-way task conversations,
  operator controls, simulator synchronization, citizen reports, GPS SOS/history,
  offline queues, support records, statuses and evidence transfers up to 5 MiB.
- Dependency lockfile, Vercel configuration, Node/Docker self-hosting files,
  environment template, regression tests, browser checks and migration utility.
- Automatic database schema initialization in server.js: no separate SQL dump
  or private pre-populated database is required to start a new installation.

## Local use / existing records

See riptide-release/README.md and DEPLOYMENT.md. Requires Node 22.13 or newer
within Node 22.x. Run npm ci inside riptide-release. The .env template is not
automatically loaded by npm start: export your variables or use Node's
--env-file=.env option. For plain HTTP localhost testing, set
RIPTIDE_SECURE_COOKIES=false; use true for HTTPS deployment.

To transfer existing SQLite records, follow the migration section of VERCEL.md.
Back up your data first. Never upload a private database as a static website file.

## Verification and boundaries

SHA256SUMS lists every delivered file except itself for integrity checking.
Run npm test and npm run test:libsql inside riptide-release after npm ci.
The browser check additionally requires Chromium; see VERCEL.md.

No credentials, private citizen/GPS records, runtime databases, node_modules,
Git history or generated build caches are included. Install dependencies with
npm ci. A hosted database and environment configuration are still required on
Vercel. Local tests do not constitute a verified live hosted deployment.

This is a flood-response demonstration, not a certified emergency dispatch
service. Reports/SOS do not contact real responders or organizations.

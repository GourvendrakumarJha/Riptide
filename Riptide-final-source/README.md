# Riptide

Flood simulation, citizen reports/GPS SOS, and five role-specific staff workspaces.

## Vercel deployment

**[Download the Vercel-compatible package](https://github.com/GourvendrakumarJha/Riptide/raw/refs/heads/arena/df827fda-riptide/releases/Riptide-vercel.zip)**

**[Complete setup guide](riptide-release/VERCEL.md)** — deploy from `riptide-release`, with framework **Other**, Node **22.x**, and a hosted **Turso/libSQL** database. Configure the database URL/token and initial administrator credentials in Vercel's environment settings. No private database or credentials are bundled.

The backend is a stateless Vercel Function. Accounts, sessions, tasks and two-way chat, operator interventions, shared scenarios, reports, GPS SOS, statuses, support records and evidence persist in the database. Evidence up to 5 MiB uses chunked transfers to fit Vercel's request limits. Browser offline queues and the five staff interfaces remain in place.

For the five public demo accounts and sign-in autofill, enable `RIPTIDE_DEMO_MODE=true` **only on a separate demonstration database**. See the setup guide before enabling it.

Existing local data can be transferred using the included one-time migration tool. Local Node/SQLite and Docker deployment remain available; see [application documentation](riptide-release/README.md) and [self-hosting instructions](riptide-release/DEPLOYMENT.md).

### Verification

- `npm test`: application/API tests, five workspaces, two-instance serverless persistence and migration safeguards.
- `npm run test:libsql`: backend regression tests through libSQL.
- `npm run test:browser:libsql`: two embedded Chromium sessions, authentication, recipients, tasks, replies, acknowledgement, polling/reload and a byte-perfect 5 MiB evidence upload/download.

Run these commands inside `riptide-release`. Local file-backed libSQL tests and a local Vercel Node-builder check do **not** replace testing the deployed app against your hosted database.

Riptide remains a demonstration, **not a certified emergency service or real dispatch system**.

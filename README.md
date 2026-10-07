# Campus Connect 2.0 — local Advanced DBMS project

A working HTML/CSS/JavaScript website with Express, Mongoose, local MongoDB, and server-side sessions. No hosting or cloud database is required. MongoDB Compass inspects the same data the website stores; Compass itself is not the database server.

## Start on Windows

1. Install **Node.js 22 or newer**, MongoDB Community Server, and MongoDB Compass. During MongoDB setup, install MongoDB as a Windows service.
2. Extract this project to a normal folder, for example `C:\Projects\campus-connect`. Open that folder in VS Code.
3. Stop your previous Campus Connect server with Ctrl+C. Keep the existing database and `.env` settings if you have them.
4. Open Command Prompt in the project folder. On a first setup, run:

```bat
copy .env.example .env
npm install --omit=dev
npm run migrate
npm run seed
npm start
```

**Existing project:** preserve your old `.env`; do not overwrite it. Add the new settings shown below. Run installation and migration with the old server stopped. Seeding is optional and only adds missing demo records.

Open **http://localhost:3000**. For subsequent starts, run `npm start` or double-click `start-local.bat`. First-time users can double-click `setup-and-start.bat`, which installs packages, migrates, adds missing demo data, and starts the app.

`npm install --omit=dev` avoids downloading test-only dependencies. Internet is needed to install npm packages; the running website and QR library assets are served locally.

### Environment settings

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/campus_connect
HOST=127.0.0.1
PORT=3000
APP_BASE_URL=http://localhost:3000
NODE_ENV=development
PASSWORD_DELIVERY=console
```

Keep credentials in `.env`, which must not be committed. This ZIP excludes the uploaded `.env` and `node_modules`. Your database is stored by MongoDB separately from this source folder.

### Demo accounts

Password: `Campus@123`

| Role | Email |
|---|---|
| Admin | admin@campus.local |
| Organizer | organizer@campus.local |
| Student | student@campus.local |
| Second Student | student2@campus.local |

Existing accounts are not overwritten by the seed script, so their current passwords may differ. Public registration never grants Admin. Use **Admin → Users → Create user** for additional Admins.

## Connect MongoDB Compass

1. Open Compass and choose **Add new connection** (or New Connection).
2. Enter `mongodb://127.0.0.1:27017` and connect.
3. Open `campus_connect` after migration/seeding or the first saved record.
4. Browse `users`, `venues`, `events`, `feedbacks`, `notifications`, `sessions`, `suggestions`, `counters`, `audit_logs`, and `write_locks`.
5. In `events`, use Filter `{ "status": "Approved" }`. Expand `registrations` to see saved student IDs, ticket codes, status, and check-in times.
6. Refresh the collection after taking an action on the website.

Do not manually change venue reservations, roles, or registration arrays while the server is running; the application enforces rules around those writes.

## What's new

- Admin can deactivate or revoke an Organizer during a live event. Accounts and event records are preserved. Deactivation ends sessions; verification revocation blocks Organizer operations but keeps profile and notifications accessible.
- Event reassignment preserves `originalCreator`. Admin can continue check-in while an event needs reassignment.
- Check-in page includes camera preview, camera choice, QR image upload, manual entry, and live attendance counts. Admin also has a Scan QR entry.
- Forgot/reset password with single-use 15-minute links; existing sessions expire on reset.
- System-generated Organizer numbers; concurrent creation is safe.
- Admin user creation, role assignment, activation, Organizer verification, and password setup.
- First approval announces an event to active Students, with persistent deduplication and retry.
- Venue availability plus daily reservation view; both pending and approved events reserve time.
- Month/week/agenda calendars, scoped per role. Scheduling inputs and calendars use Asia/Kolkata (IST).
- Updated responsive purple/white design, notifications, audit log, pagination, search, filters, cloning, and health view.

## Password recovery and new account setup

Default **console mode** is a local demonstration feature:

1. Choose Forgot password and enter the account email.
2. Look in the terminal running `npm start` for `[LOCAL PASSWORD SETUP]`.
3. Open that link within 15 minutes and choose a password.
4. Log in again. A new link invalidates the old one; a used link cannot be reused.

The public endpoint does not return tokens or expose whether an account exists. The raw link is printed only in development console mode. Never share terminal reset links. Account deactivation is not undone by resetting its password.

For actual email, set `PASSWORD_DELIVERY=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env`. Use credentials supported by your email provider. SMTP delivery needs a reachable mail server and has not been verified against your provider. Console mode requires no email account. New Admin-created users receive their first password setup through the same delivery method.

## QR scanning

Open **Organizer → Check-in** or **Admin → Scan QR**, select the event, then Start Camera. Grant browser permission. Start Camera is the only action that requests camera access. Stop Camera and leaving the page release it. Scans are validated by the backend; the QR content is only an opaque ticket code.

If the camera is blocked, use **Upload QR image** or type the ticket code. On a fresh seed, `TKT-DEMO0001` belongs to Live Check-in Practice and its check-in window opens immediately. The seed does not reset an old event; if its time has passed, create a new event starting within the next hour, approve it, and register a Student.

Camera access works on localhost in supported browsers. A phone opening `http://<laptop-IP>:3000` may not have camera access because that address is not a secure context. This project defaults to loopback access; it does not configure HTTPS or LAN exposure. Test with your laptop camera, or use image/manual input. Physical camera scanning needs a manual test on your device.

## Venue concurrency and crash recovery

This local prototype supports standalone MongoDB; **no replica set is required**. Each API mutation acquires one shared `write_locks` document using MongoDB's unique `_id`. Writes across server processes are serialized before checking overlap or the last active Admin. Waiting requests re-read permissions. Registration and check-in also use conditional single-document updates.

The lock intentionally has **no automatic expiry**: a paused or stale writer cannot continue after another process takes over. A normal request releases the lock in `finally`. A server crash during a write may leave the lock, causing later writes to return 503 after a short wait. To recover:

1. Stop **all** Node servers using this database.
2. Inspect the last operation, affected records and audit entries in Compass; multi-document operations do not have transactional rollback.
3. Run:

```bat
npm run recover-lock -- --confirm-server-stopped
```

4. Start the server again. Do not clear a lock while any writer is still running.

This trades write throughput for simplicity and safe overlap checks in a local academic prototype. It is not a distributed transaction system. Compass edits or separate scripts bypass API locks. Run seed/migration only with the application stopped. Approval announcement intent is stored on the event, then delivered with per-student upserts; notification reads retry pending announcements.

## Migration and backup

Before migrating an existing database, stop the app and make a backup using MongoDB Database Tools:

```bat
mongodump --uri="mongodb://127.0.0.1:27017/campus_connect" --out="backup-before-campus-v2"
```

If Database Tools are not installed, install them separately; they are not provided by npm. Compass JSON exports are useful for inspection but do not replace a full database backup with indexes.

`npm run migrate` preserves documents, adds missing Organizer numbers and original creator fields, clears legacy blank number values, and creates indexes. Conflicting non-empty Organizer numbers stop migration with a review message; they are not overwritten. Running migration twice does not duplicate users or events. Existing approved events are marked as already announced to prevent a notification flood. If migration reports a duplicate number, resolve the ownership of that number explicitly, then rerun migration.

## Test commands

Install test dependencies with `npm install` first.

```bat
npm test
npm run test:upgrades
```

These use `campus_connect_test`, **never the application database**. Tests delete the contents of that test database. Do not store any project data in it.

Alternatively, `npm run test:isolated` downloads and starts a temporary real MongoDB process and runs both suites. It is not a mock database. The download needs internet the first time.

Browser checks:

```bat
npx playwright install chromium
npm run test:ui
```

Or set `CHROME_EXECUTABLE` to a compatible local Chromium executable. See `docs/VALIDATION.md` for what was actually checked in this delivery.

## Troubleshooting

| Problem | Action |
|---|---|
| Connection refused / database unavailable | Open Windows Services, find MongoDB Server, and start it. The server retries connection and the API returns a clear message while disconnected. |
| PowerShell blocks npm.ps1 | Use Command Prompt or type `npm.cmd` instead of `npm`. |
| Port 3000 in use | Stop the older app, or change both `PORT` and `APP_BASE_URL`. |
| No database in Compass | Use the same MongoDB URI; run migration/seed, then refresh Compass. |
| Organizer cannot manage events | Admin must mark the account active and verified. A revoked account keeps basic profile access only. |
| Venue is occupied | Inspect Venue Availability. Pending events also reserve time; edit/cancel the conflicting event or pick another slot. |
| Camera denied | Allow site camera permission in the browser, close other camera apps, or use image/manual entry. |
| Reset email never arrives | Default mode prints the link in the server terminal; it does not send email. Configure SMTP for email. |
| Write stays busy after a crash | Follow the lock recovery procedure above. |
| Index/duplicate Organizer error | Stop the old app and run migration; review duplicate numbers without deleting unrelated data. |
| Old UI appears | Restart the app and hard-refresh the browser with Ctrl+F5. |

See `docs/DEMO.md`, `docs/API.md`, `docs/DATABASE.md`, and `docs/CHANGES.md` for presentation and implementation details.

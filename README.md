# Campus Connect – College Event Management System

Advanced DBMS project: a web application built with HTML/CSS/JS, Node.js/Express, Mongoose, and MongoDB. It can run locally with MongoDB Community Server and MongoDB Compass, or deploy on Render with MongoDB Atlas.

Local development defaults to `http://localhost:3000` and `mongodb://127.0.0.1:27017/campus_connect`. For hosting, configure `MONGODB_URI`, `NODE_ENV=production`, and the other required environment variables in the hosting dashboard; never commit `.env` or paste database credentials into source code.

## Quick start (Windows)

1. **Install Node.js** (LTS 18 or newer) from <https://nodejs.org>. Check: open PowerShell → `node -v`.
2. **Install MongoDB Community Server** from <https://www.mongodb.com/try/download/community>. Choose *Complete*, tick **"Install MongoDB as a Service"** (Run as Network Service).
3. **Install MongoDB Compass** (offered by the installer, or <https://www.mongodb.com/try/download/compass>).
4. **Start the MongoDB service**: press `Win+R` → `services.msc` → find **MongoDB Server** → *Start*. Or in an **Administrator** PowerShell: `net start MongoDB`.
5. **Open the project folder in VS Code** (`File → Open Folder → campus-connect`), then `Terminal → New Terminal`.
6. **Copy the env file**: `copy .env.example .env`
7. **Install packages**: `npm install`
8. **Load demo data** (safe to re-run, never deletes anything): `npm run seed`
9. **Start the server**: `npm start`
10. **Open** <http://localhost:3000>

Shortcuts: double-click `setup-and-start.bat` the first time, `start-local.bat` afterwards.

### Demo accounts (password `Campus@123`)
| Role | Email |
|---|---|
| Admin | admin@campus.local |
| Organizer (verified) | organizer@campus.local |
| Student | student@campus.local |
| Student 2 | student2@campus.local |

Other commands: `npm run dev` (auto-restart), `npm test` (integration tests – uses the separate `campus_connect_test` database).

## Connect MongoDB Compass
1. Open Compass → **Add new connection**.
2. URI: `mongodb://127.0.0.1:27017` → **Connect**.
3. In the left tree click **campus_connect** (it appears after `npm run seed` or `npm start`; click the refresh icon if not).
4. Click a collection name to browse documents. Use **Filter**, **Indexes** and **Aggregations** tabs.

## Event lifecycle safeguards

- An event is shown as **Ongoing** while its start/end times indicate that it is in progress.
- Once an event has started, its details/dates cannot be edited, it cannot be cancelled or deleted, and student registrations cannot be cancelled.
- Organizer accounts cannot be deactivated or unverified while they own an ongoing event. Students with an active registration in an ongoing event cannot be deactivated either.
- Students cannot register for an event that has started or completed.
- An event can be permanently deleted only before it starts and only if it has no registration or feedback history. Events with history should be cancelled/archived so reporting records remain intact.
- These rules are enforced by the server API, not just by the browser UI.

## Collections
| Collection | Purpose |
|---|---|
| `users` | Accounts: hashed password, role (admin/organizer/student), `verified`, `active` |
| `venues` | Venues with capacity and amenities; `active:false` = archived |
| `events` | Events **with embedded `registrations[]`** (student ref, status, ticketCode, registeredAt, checkedInAt) |
| `feedbacks` | One rating/comment per student per event |
| `notifications` | Per-user messages, `read` flag |
| `suggestions` | Platform suggestions/bugs with status |
| `sessions` | Login sessions (SHA-256 token hash, TTL-expiring) |

Details: [docs/DATABASE.md](docs/DATABASE.md) · API: [docs/API.md](docs/API.md) · Presentation script: [docs/DEMO.md](docs/DEMO.md)

## Demonstrations

**CRUD** – In the app: create a venue (Admin → Venues), edit it, archive it; create/edit/cancel an event (Organizer). After each action press refresh in Compass on `venues` / `events` and show the document change (`updatedAt`, `status`). Compass can also edit/delete a document directly (pencil/trash icons).

**Registration & waitlist** – Use *One-seat Waitlist Demo*. Student 1 registers (status `registered`), Student 2 registers (status `waitlisted`). In Compass open `events`, filter `{ title: "One-seat Waitlist Demo" }` and expand `registrations`. Student 1 cancels → Student 2 becomes `registered` automatically and both get notifications.

**QR check-in** – Student 1 registers for *Live Check-in Practice* (or use the pre-issued ticket `TKT-DEMO0001` for student@campus.local) and opens **My events → View QR ticket**. Organizer → **Check-in**, pick the event, type/scan the ticket code. In Compass the registration shows `status: "checked-in"` and `checkedInAt`. A second attempt is rejected. (Check-in is open only from 1 h before start until the end.)

**Aggregation reports** – Admin → **Reports** shows results of the `$match/$group/$project/$lookup/$unwind/$filter/$size/$avg/$sort` pipelines; **Export CSV** downloads them. In Compass → `events` → **Aggregations** tab, paste the pipelines from `docs/DATABASE.md`.

## Troubleshooting
- **MongoDB connection refused / `ECONNREFUSED 127.0.0.1:27017`** – MongoDB is not running. Start the service (step 4). If MongoDB is installed but not as a service, run `"C:\Program Files\MongoDB\Server\<version>\bin\mongod.exe" --dbpath C:\data\db` in a separate window (create `C:\data\db` first).
- **MongoDB service not running / won't start** – `services.msc` → *MongoDB Server* → Properties → Startup type *Automatic* → Start. If it fails, check the log in `C:\Program Files\MongoDB\Server\<version>\log\mongod.log`. `net start MongoDB` needs an *Administrator* terminal.
- **npm: "running scripts is disabled on this system" (PowerShell)** – Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, reopen the terminal. Or use *Command Prompt* instead of PowerShell.
- **Port 3000 already in use** – Change `PORT=3001` in `.env` and open `http://localhost:3001`, or find the process: `netstat -ano | findstr :3000` then `taskkill /PID <pid> /F`.
- **Database not visible in Compass** – MongoDB hides empty databases. Run `npm run seed` or `npm start`, press the refresh button in Compass, and make sure you connected to `mongodb://127.0.0.1:27017` (not a different host).
- **"Your organizer account must be verified"** – Log in as `admin@campus.local` → **Organizer verification** → *Verify*. (The seeded organizer is already verified; newly registered organizers are not.)
- **Event capacity validation errors** – Event capacity must be a positive whole number and ≤ the venue capacity (Innovation Lab = 60, Main Auditorium = 500, Sports Ground = 1000). Admins can raise a venue's capacity in **Venues**. Budgets above ₹10,000 need a budget breakdown; start must be in the future; duration ≥ 1 hour; description ≥ 50 characters.
- **Tests fail with "Refusing to run"** – tests only run against a database whose name ends with `_test`. Do not set `TEST_MONGODB_URI` to the real database.

## Security notes
scrypt-hashed passwords · server-side sessions in MongoDB with HttpOnly + SameSite cookies · role middleware · input validation + Mongoose validation · login rate limiting · origin check on writes · CSP and other security headers · 50 KB JSON limit · CSV formula-injection sanitising · secrets only via `.env`. For any non-localhost deployment you would also add HTTPS (`NODE_ENV=production` turns on the `Secure` cookie flag).

## Scope notes
- Student "attend/check-in" is performed by the organizer scanning/typing the student's QR ticket code (a student cannot check themselves in from home). Camera scanning is not built in – use any QR scanner app or a handheld scanner that types the code.
- Poster/image upload, e-mail confirmation links and sentiment analysis from the original requirements PDF are not part of this prototype.

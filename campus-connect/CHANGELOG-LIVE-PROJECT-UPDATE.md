# Campus-Beats / Campus Connect — live project update

## Changes

- Added server-side protection against editing event details or dates after an event starts.
- Blocked cancellation and deletion of events after they start.
- Added a `DELETE /api/events/:id` route for events that have not started and have no registration or feedback history. It uses an optimistic version check to reduce race-condition risk.
- Kept registration history intact; events with registration history must be cancelled/archived rather than permanently deleted.
- Blocked student registration after an event starts or completes.
- Prevented students from cancelling registrations after an event starts.
- Prevented organizer deactivation or verification revocation while that organizer owns an ongoing event.
- Prevented student account deactivation while the student has an active registration for an ongoing event.
- Added a derived `displayStatus` so in-progress events appear as **Ongoing** without changing the stored status enum.
- Updated the organizer/admin event table with a guarded Delete action for empty events and locked controls for started events.
- Added integration-test cases for these safeguards and updated API/README documentation.

## Safety / deployment notes

- No database migration is required; existing MongoDB documents remain compatible.
- The ZIP intentionally excludes `.env` and `node_modules`. Create your local `.env` from `.env.example` and run `npm install` after extracting it.
- Do not overwrite Render's environment variables with local settings. Keep the existing Atlas `MONGODB_URI` configured in Render, and ensure `NODE_ENV=production` for production cookie behavior.
- Before deploying, commit the changes to your project repository or upload the updated source through your usual deployment workflow, then verify the Render deploy logs and test the live site.

## Verification

- `node --check src/app.js` — passed.
- `node --check public/app.js` — passed.
- `node --check tests/integration.js` — passed.
- The full integration suite was not run in this editing environment because no MongoDB server is listening on `127.0.0.1:27017`. Run `npm test` locally against the dedicated `campus_connect_test` database before relying on the update in production.

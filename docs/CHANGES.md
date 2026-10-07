# Upgrade implementation map

| Files | Changes |
|---|---|
| src/upgrades.js (new) | Database mutation lock, counters, reset delivery, Admin user lifecycle, impact/reassignment, calendar/availability, audit, health, notification retry. |
| src/app.js | Connects upgrades, current authorization checks, camera headers, pagination, atomic check-in, first approval intent, immutable Organizer numbers. |
| src/auth.js | Session authVersion binds sessions to current account security state. |
| src/models.js | Added counter/lock/audit collections; user reset/version fields; event original creator, attention and announcement fields; partial unique indexes. |
| src/domain.js | Public signup no longer accepts a chosen Organizer number; IST event date key. Existing reports and validation retained. |
| src/server.js | Safe connection messages and connection retry while serving the local interface. |
| public/app.js | Hooks for upgraded screens, permissions, forms, timezone handling, clone and reassignment actions. |
| public/enhancements.js (new) | Camera/image/manual scanner, password recovery, Admin forms, calendar, venue availability, paginated screens, audit/health and notification polling. |
| public/index.html, styles.css | Campus Connect branding, responsive purple interface, calendar/scanner layout, accessible notification icon. |
| scripts/migrate.js (new) | Non-destructive, repeatable index/data upgrade with duplicate detection. |
| scripts/recover-lock.js (new) | Explicit crash recovery with stopped-server confirmation flag. |
| scripts/seed.js | Generated Organizer identifier, original creator and consistent event date keys; existing data untouched. |
| tests/* | Updated 34 workflow checks, 13 grouped upgrade checks, real-database isolated runner, Chromium browser checks. |
| package.json / package-lock.json | Added locally served qr-scanner and nodemailer; test-only MongoDB/Playwright; documented npm scripts. |
| .env.example / Windows scripts / docs | Local settings, install/migrate flow, Compass guide, limitations and presentation sequence. |

## Architectural limits

- Intentionally a local prototype, not a hosted or highly available production service.
- A database-wide write lock is safe for overlap checks at this scale but limits concurrent write throughput. Crash recovery is explicit, not automatic.
- Multi-document notification/audit/user changes are not transactions. Primary writes may commit before a later ancillary write fails. Approval announcements have a durable retry marker; other notifications do not have a general-purpose outbox.
- Password reset tokens are embedded in the user for an atomic consume/password change; they use explicit expiry, not a user TTL index.
- Organizer verification revocation allows basic account pages only. Admin can manage preserved events and reassign them.
- Email delivery requires user SMTP settings; no external email account is bundled.
- Physical camera behavior must be checked on the user's device.
- Standard camera policy requires localhost or HTTPS. LAN HTTP phone scanning is not configured.
- Event registrations remain embedded, suitable for this project scale.
- Cloning uses a prefilled create form, requiring new date selection and approval.
- No event image upload, payment module, push/email event broadcast, or drag-to-reschedule feature is added.

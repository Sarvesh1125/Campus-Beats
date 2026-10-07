# Validation for this delivery

Checked on 6 October 2026.

## Completed checks

- JavaScript syntax checks for source, frontend, scripts and tests.
- **34/34 existing integration test groups passed**, updated only where version 2 intentionally changes the expected API contract (generated Organizer numbers, explicit privilege rejection, administrative reasons, revoked/unverified permissions).
- **13/13 upgrade integration test groups passed** against a temporary **real MongoDB 8.2.6 process**, using only `campus_connect_test`.
- Tests cover concurrent booking/adjacent slots, generated Organizer numbers, first-approval retry/deduplication, calendar privacy, revocation and deactivation with a live event, reassignment and preserved tickets, concurrent check-in, password reset/expiry/session invalidation, Admin creation/escalation controls, simultaneous Admin removals, pagination, audit, notifications and repeatable migration.
- Real Chromium browser checks passed: login and forgot-password UI, all 15 Admin views, Organizer calendar/manage/scanner/availability/report/profile views, event creation that persisted in MongoDB, Student views and 390-pixel mobile layout.
- **QR image decoding was executed in the browser** using the installed QR library and a generated PNG; it successfully checked in the seeded Student in MongoDB.
- Desktop dashboard and mobile agenda screenshots were inspected. Screenshots are included under tests/ as examples from disposable seed data.

## Not claimed as tested

- A physical camera and its permission/device switching behavior on your Windows laptop or phone.
- Email delivery through your SMTP provider. Development console password delivery and reset were tested.
- Double-click execution of Windows BAT scripts inside this Linux verification environment.
- Production-scale load or multi-document rollback. This is a local prototype with the documented database lock/recovery tradeoff.

## Reproduce

Normal local MongoDB:

```bat
npm install
npm test
npm run test:upgrades
```

Disposable real MongoDB:

```bat
npm run test:isolated
```

Browser:

```bat
npx playwright install chromium
npm run test:ui
```

The default browser downloader in the verification environment returned invalid archives. Browser testing was completed using a compatible Chromium executable supplied separately through `CHROME_EXECUTABLE`. That verification-only executable is not included in the project. Install Playwright's browser normally on your computer, or point CHROME_EXECUTABLE to a compatible installed browser.

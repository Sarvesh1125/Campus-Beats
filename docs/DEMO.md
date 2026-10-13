# Presentation demo script (≈10 minutes)

**Before you start:** MongoDB service running · `npm run seed` done · `npm start` running · Compass connected to `mongodb://127.0.0.1:27017` with `campus_connect → events` open · use two browser windows (one normal, one private/incognito) so two students can be logged in at once. All passwords: `Campus@123`.

## 1. Student – browse and register
1. Open <http://localhost:3000>, log in `student@campus.local`.
2. **Discover events** → search "AI", filter by category *Workshop* → open **Build with AI** to show details.
3. Open **One-seat Waitlist Demo** → **Register** → toast "Registered! Your QR ticket is ready".
4. **My events** → *View details* → **View QR ticket** – QR with ticket code below it.

## 2. Show the Compass document
5. Compass → `events` → Filter `{ title: "One-seat Waitlist Demo" }` → refresh.
6. Expand `registrations`: one embedded item `{student, status:"registered", ticketCode, registeredAt}`. Explain embedding and `__v` (optimistic concurrency).

## 3. Second student – waitlist and promotion
7. In the private window log in `student2@campus.local` → open the same event → button now says **Join waitlist** → click it.
8. Compass refresh → second item with `status:"waitlisted"`.
9. Back in window 1 (student 1) → event details → **Cancel registration** → confirm.
10. Compass refresh: first item `cancelled` (history kept), second item now **`registered`** – automatic promotion. Show student 2's **Notifications** ("a seat opened up").

## 4. Organizer – QR check-in
11. Log in `organizer@campus.local` → **Check-in** → event *Live Check-in Practice* → ticket code `TKT-DEMO0001` (or the code shown on student 1's ticket after registering) → **Check in** → green confirmation.
12. Enter the same code again → "already been checked in" error. Enter `TKT-FAKE` → "Invalid ticket code".
13. Compass: that registration has `status:"checked-in"` and `checkedInAt`.
14. *Manage events* → **Attendees** to show the table; *Create event* to show validation messages (try capacity above venue capacity, or a start in the past).

## 5. Admin – approvals and reports
15. Log in `admin@campus.local` → **Event approvals** → **Approve** *Cyber Security Summit* (and show **Reject** with a reason dialog). The organizer receives a notification.
16. **Organizer verification**, **Venues** (try archiving *Main Auditorium* → blocked because it has upcoming events), **Users**.
17. **Reports** → show cards, category, venue usage and event-wise tables → click **Export CSV**.

## 6. Aggregation in Compass
18. Compass → `events` → **Aggregations** tab → paste the "Per-event registration counts" pipeline from `docs/DATABASE.md` → show output (uses `$project`, `$filter`, `$size`).
19. Paste "Venue usage" (`$group`, `$lookup`, `$unwind`) and show it matches the Reports page.
20. Optional: **Indexes** tab on `events` – point at the unique `organizer+dateKey+titleKey` and `venue+start+end` indexes; `sessions` → TTL index.

## Talking points
Embedded registrations + atomic seat allocation · optimistic concurrency · references for users/venues · indexes · aggregation framework · RBAC and session security.

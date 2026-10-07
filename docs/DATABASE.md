# MongoDB design — Campus Connect 2

The application connects to local MongoDB through Mongoose. Compass lets you inspect it. No browser accesses MongoDB directly.

## Collections

| Collection | Main fields and purpose |
|---|---|
| users | Name, email, phone, scrypt password hash, role, active, verified, interests, optional generated organizationNumber, authVersion, optional resetHash/resetExpiresAt. Password/reset/version fields are excluded from JSON responses. |
| venues | Name, location, capacity, amenities, active, timestamps. |
| events | Title/titleKey/dateKey, description, category, UTC start/end, venue and organizer references, originalCreator, capacity/budget/budgetNotes, status, reasons, needsAttention, firstApprovedAt/announcementPending, embedded registrations, version. |
| feedbacks | Event/student references, integer rating 1–5, comment, timestamps. |
| notifications | User reference, optional event reference, message, read, deleted, optional dedupeKey, createdAt. Deletion hides the notification while retaining deduplication history. |
| suggestions | User reference, text, status and timestamps. |
| sessions | Hashed opaque session token, user reference, authVersion, expiry. TTL index expires old session records. |
| counters | Atomic sequence per year used for Organizer numbers. Gaps are acceptable; numbers are never reused based on a document count. |
| audit_logs | Actor, action, target ID, reason, non-sensitive changes and timestamp. |
| write_locks | Temporary database-wide mutation lock; unique `_id`, random owner and acquisition time. No automatic expiry. |

Embedded registrations contain student, status, ticketCode, registeredAt, checkedInAt, and checkedInBy. Cancelled entries remain as history. Re-registration appends a new entry. Statuses: registered, waitlisted, checked-in, cancelled, no-show.

## Indexes

- Unique user email.
- Unique Organizer number, partial index applying only to string values. Legacy blank values are removed by migration.
- Unique venue name.
- Unique event organizer/dateKey/titleKey combination.
- Event status/start, venue/start/end, registrations.student.
- Unique ticket codes across event documents via a partial multikey index; application generation and conditional updates also protect embedded registrations.
- Unique feedback event/student.
- Notifications user/createdAt and unique user/dedupeKey for announcement deduplication.
- Unique session tokenHash and expiry TTL.
- Audit createdAt for recent-first pagination.
- Counters and write locks use MongoDB's unique `_id` index.

## Embedding and referencing

Registrations are embedded to support atomic seat decisions, waitlist promotion, and check-in within one event document. Users and venues are referenced because multiple events share them. Feedback is separate for unique student/event validation and aggregation.

Limitations: very large events can approach MongoDB's document size limit; this model targets a college prototype. A production-scale version could separate registration documents and use transactions/counters. Referenced documents are not automatically protected by SQL-style foreign keys; backend validation enforces existence and ownership. Archive/deactivation retains history instead of deleting referenced users/events.

## Concurrency

API mutations use a MongoDB-backed exclusive lock with no expiry. This serializes venue check-and-write operations and administrative decisions across local server processes. The lock is released after each request; a crashed process can leave it requiring explicit recovery with all servers stopped. This is described in README. It works with standalone MongoDB.

Event registration also uses a compare-and-swap filter on `__v`, and successful mutations increment the version. Check-in requires Approved status, current version, and a registered matching ticket. Mongoose event saves use optimistic concurrency.

These mechanisms prevent simultaneous API booking conflicts but do not create multi-document transactional rollback. A failure between a user save and audit/notification creation may leave only the principal update committed. Inspect/reconcile that operation after a crash. Scripts and direct Compass edits must not run concurrently with the application.

## Password recovery

Reset hash and expiry are embedded on the user so a conditional update can atomically set the new password, increment authVersion, and remove the token. This avoids a token-consumed/password-unchanged failure across two documents. **Do not add a TTL index to users.resetExpiresAt**: that would delete the user. Expiry is checked explicitly; obsolete hashes may remain until replaced/consumed, but cannot authenticate. Session TTL cleanup is only storage cleanup; every request checks expiry and current authVersion.

## Announcement delivery

The first approval stores firstApprovedAt and announcementPending on the event. Recipient writes upsert notifications with unique user/dedupeKey. The marker is cleared after the batch succeeds. Notification reads retry unfinished fanout. Students created after the original approval timestamp are not included in its retry audience. Reapproval never re-broadcasts the first announcement. Deleted notifications retain a dedupe record.

## Time and CRUD

MongoDB Date values are UTC instants. Website datetime inputs are interpreted as IST; event dateKey uses the IST calendar date. Create/update validation checks dates and capacity. Admin status changes implement approval, rejection, completion, cancellation and archival. Deletes are soft for venues/accounts/event history and notifications; feedback can be physically deleted by its owner.

Compass Filter examples (not shell commands):

```javascript
{ role: "organizer", verified: false }
{ status: "Approved" }
{ needsAttention: true }
{ "registrations.status": "waitlisted" }
{ "registrations.status": "checked-in" }
{ announcementPending: true }
```

Mongosh examples:

```javascript
use campus_connect
show collections
db.events.find({status: "Approved"}, {title: 1, start: 1, venue: 1})
db.events.getIndexes()
db.users.find({role: "organizer"}, {name: 1, organizationNumber: 1, verified: 1})
```

## Aggregation demonstration

In Compass, open events → Aggregations → text mode and paste:

```javascript
[
  { $match: { status: { $in: ["Approved", "Completed", "Archived"] } } },
  { $project: {
      title: 1, category: 1,
      attendance: { $size: { $filter: {
        input: "$registrations", as: "r",
        cond: { $eq: ["$$r.status", "checked-in"] }
      } } }
  } },
  { $group: { _id: "$category", events: { $sum: 1 }, attendees: { $sum: "$attendance" } } },
  { $sort: { attendees: -1 } }
]
```

The reports endpoint additionally uses `$lookup` for feedback/venue/user references, `$unwind`, `$avg`, and `$round`. Attendance rate uses ended events so future registrations do not reduce the rate. See `src/domain.js` for the complete pipelines.

Advanced DBMS concepts demonstrated: document modeling, embedded/reference relationships, compound/partial/unique/TTL indexes, CRUD, aggregation joins, optimistic concurrency, atomic counters, idempotent delivery, access control, and audit trails.

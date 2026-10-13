# Database design – `campus_connect`

## Design overview
Seven collections. **Registrations are embedded inside events**; users, venues and events are linked by **references** (`ObjectId`).

```
users ◄──────────── events.organizer
venues ◄─────────── events.venue
users ◄──────────── events.registrations[].student      (embedded sub-documents)
events,users ◄───── feedbacks.event / feedbacks.student
users ◄──────────── notifications.user, suggestions.user, sessions.user
```

## Collections
**users** `name, email*, passwordHash, phone, role (admin|organizer|student), interests[], organizationNumber, verified, active, createdAt, updatedAt`

**venues** `name*, location, capacity, amenities[], active, createdAt, updatedAt` (archive = `active:false`)

**events** `title, titleKey, dateKey, description, category, start, end, venue→venues, organizer→users, capacity, budget, budgetNotes, status, rejectionReason, registrations[], createdAt, updatedAt, __v`
- `registrations[]` item: `{ _id, student→users, status (registered|waitlisted|checked-in|cancelled|no-show), ticketCode, registeredAt, checkedInAt }`
- `titleKey` (lower-cased title) and `dateKey` (YYYY-MM-DD) exist only to support the "same organizer, same title, same date" unique index.

**feedbacks** `event→events, student→users, rating 1-5, comment ≤1000, createdAt, updatedAt`
**notifications** `user→users, message, read, createdAt`
**suggestions** `user→users, text, status (Submitted|In progress|Implemented), createdAt, updatedAt`
**sessions** `tokenHash, user→users, expiresAt` (the cookie holds a random token; only its SHA-256 hash is stored)

## Indexes
| Collection | Index | Why |
|---|---|---|
| users | `{email:1}` unique | one account per email |
| venues | `{name:1}` unique | no duplicate venues |
| events | `{organizer:1, dateKey:1, titleKey:1}` unique | same organizer cannot reuse a title on a date |
| events | `{status:1, start:1}` | event lists by status/date |
| events | `{registrations.student:1}` (multikey) | "my events" lookup |
| events | `{venue:1, start:1, end:1}` | venue overlap check |
| events | `{registrations.ticketCode:1}` unique, partial | ticket uniqueness + fast check-in lookup |
| feedbacks | `{event:1, student:1}` unique | one feedback per student per event |
| notifications | `{user:1, createdAt:-1}` | newest-first inbox |
| sessions | `{tokenHash:1}` unique | session lookup |
| sessions | `{expiresAt:1}` TTL (`expireAfterSeconds:0`) | MongoDB deletes expired sessions automatically |

The ticket-code index is *partial* (`registrations.ticketCode` exists) because a plain unique multikey index would treat every empty `registrations` array as the same key.

## CRUD operations used
| Operation | Example |
|---|---|
| Create | `Event.create`, `Venue.create`, `User.create`, `Event.updateOne({…},{$push:{registrations:reg}})` |
| Read | `Event.find(filter).populate('venue organizer')`, `Feedback.findOne` |
| Update | `Event.updateOne({_id, __v}, {$set:{'registrations.2.status':'cancelled'}, $inc:{__v:1}})` |
| Delete | `Notification.deleteOne`, `Feedback.deleteOne`, `Session.deleteMany`. Events/venues/users are *archived or deactivated*, never hard-deleted, so reports stay accurate |

## Concurrency (the last seat)
Registration and cancellation read the event, decide the new status in code, then update with the filter `{ _id, __v: <version read> }` and `$inc: { __v: 1 }`. If another student changed the document in between, `modifiedCount` is 0 and the operation re-reads and retries (so the second student sees the event is now full and is waitlisted). This is **optimistic concurrency control** and needs no locks. A `registrations: {$not: {$elemMatch …}}` condition additionally prevents duplicate registrations.

## Aggregation pipelines (paste into Compass → `events` → Aggregations)
**Per-event registration counts (`$project` + `$filter` + `$size`)**
```js
[
  { $project: { title: 1, status: 1, capacity: 1,
      registered: { $size: { $filter: { input: "$registrations", as: "r", cond: { $eq: ["$$r.status", "registered"] } } } },
      waitlisted: { $size: { $filter: { input: "$registrations", as: "r", cond: { $eq: ["$$r.status", "waitlisted"] } } } },
      checkedIn:  { $size: { $filter: { input: "$registrations", as: "r", cond: { $eq: ["$$r.status", "checked-in"] } } } } } },
  { $sort: { title: 1 } }
]
```
**Events by category (`$group`)**
```js
[ { $group: { _id: "$category", events: { $sum: 1 }, totalCapacity: { $sum: "$capacity" } } }, { $sort: { events: -1 } } ]
```
**Venue usage (`$group` + `$lookup` + `$unwind`)**
```js
[
  { $match: { status: { $in: ["Pending", "Approved", "Completed"] } } },
  { $group: { _id: "$venue", events: { $sum: 1 }, hours: { $sum: { $divide: [{ $subtract: ["$end", "$start"] }, 3600000] } } } },
  { $lookup: { from: "venues", localField: "_id", foreignField: "_id", as: "venue" } },
  { $unwind: "$venue" },
  { $project: { _id: 0, venue: "$venue.name", events: 1, hours: 1 } }
]
```
**Average rating per event (`$lookup` + `$avg`)**
```js
[
  { $lookup: { from: "feedbacks", localField: "_id", foreignField: "event", as: "fb" } },
  { $project: { title: 1, feedbackCount: { $size: "$fb" }, avgRating: { $avg: "$fb.rating" } } }
]
```
**Unwinding embedded registrations – registrations per student**
```js
[ { $unwind: "$registrations" }, { $group: { _id: "$registrations.student", registrations: { $sum: 1 } } }, { $sort: { registrations: -1 } } ]
```
The application's own pipelines live in `src/domain.js` (`buildReport`).

## Handy Compass filters
```js
{ status: "Pending" }                                   // events awaiting approval
{ "registrations.status": "waitlisted" }                // events with a waitlist
{ title: "One-seat Waitlist Demo" }                     // one event
{ registrations: { $elemMatch: { status: "checked-in" } } }
{ role: "organizer", verified: false }                  // users: unverified organizers
{ start: { $gte: new Date() } }                         // upcoming (use ISODate in older Compass)
```

## Why registrations are embedded in events
- A registration has no meaning without its event and is always read together with it (attendee list, seat count, waitlist order).
- The seat count, waitlist promotion and duplicate check all happen in **one document**, so a single atomic write (guarded by `__v`) is enough – MongoDB guarantees single-document atomicity without multi-document transactions.
- Array order = registration order, which gives a natural FIFO waitlist.
- Reports use `$filter/$size` on the array – no joins.

**Advantages:** fewer queries, atomic seat allocation, simple waitlist, history preserved (cancelled entries stay in the array).
**Limitations:** the 16 MB document limit (fine for campus events with thousands of registrations, not millions); "all events of a student" needs the multikey index on `registrations.student`; very hot events rewrite a growing document; students' own history is not a first-class collection (queried through `events`).
Users, venues and feedback are *referenced* because they are shared across many events, change independently, and are queried on their own.

## DBMS concepts demonstrated
Document data model · embedding vs referencing (denormalisation trade-off) · primary keys (`_id`) and foreign-key style references · schema validation (Mongoose) · unique, compound, multikey, partial and TTL indexes · CRUD · aggregation framework (pipeline model, `$lookup` as a left outer join) · optimistic concurrency control · atomic single-document updates · referential rules enforced in application code (venue cannot be archived while in use) · soft deletion/archival · authentication/authorization (RBAC) · query optimisation through indexing.

# API reference — version 2

Base URL `http://localhost:3000/api`. JSON request/response bodies, except `GET /reports?format=csv`. Sessions use an HttpOnly, SameSite cookie. Send cookies on requests. Cross-origin browser writes are rejected. Current user state is reloaded before actions; revoked Organizers cannot use management APIs. All writes use the shared database mutation lock.

## Authentication / profile

| Method / route | Access | Body / response |
|---|---|---|
| POST /auth/register | Public, rate limited | `{name,email,phone,password,role,interests}`; role student/organizer. Organizer number supplied by client is ignored. Returns 201 `{user}` and cookie. |
| POST /auth/login | Public, rate limited | `{email,password}` → `{user}` and cookie. |
| POST /auth/logout | Any | Clears cookie/session → `{ok:true}`. |
| GET /auth/me | Authenticated | `{user}` without password/reset/session version secrets. |
| POST /auth/forgot-password | Public, rate limited | `{email}` → same generic `{message}` for existing/missing accounts. Link goes to configured delivery. |
| POST /auth/reset-password | Public, rate limited | `{token,password}` → `{ok:true}`. Invalid/expired/used token: 400. |
| PATCH /profile | Authenticated | `{name?,phone?,interests?,currentPassword?,newPassword?}` → `{user}`. Role/active/verified/organizationNumber rejected. |
| DELETE /profile | Non-Admin | Deactivate own account, invalidate sessions, preserve history. |

## User administration

| Method / route | Access | Body / response |
|---|---|---|
| GET /users | Admin | Query `role,q,page,limit`; returns `{users,total}`. |
| POST /users | Admin | `{name,email,phone,role,active?,verified?,currentPassword?,reason?}` → 201 `{user,delivery,message}`. Admin grant requires currentPassword. Generates password setup link. |
| GET /users/:id/impact | Admin | `{events}` listing ongoing/upcoming affected events. |
| PATCH /users/:id | Admin | `{name?,phone?,role?,active?,verified?,reason,currentPassword?}` → `{user}`. Reason required. Admin grant requires current password. Self-deactivation/demotion rejected; last active Admin retained. |
| POST /users/:id/password-setup | Admin | Issues one-time setup link → `{ok:true}`; delivery/configuration failure returns error. |

## Events

| Method / route | Access | Body / response |
|---|---|---|
| GET /events | Authenticated, verified for Organizer management | Query `q,category,venue,from,to,status,mine,past,sort,page,limit`; scoped `{events,total}`. |
| GET /events/:id/details | Authorized viewer | `{event}`. Private pending/rejected events restricted to Admin, owner, or registered Student. |
| POST /events | Verified Organizer | Event body below → 201 `{event}` Pending. |
| PATCH /events/:id | Verified owner or Admin | Partial event body → `{event}` returned to Pending. |
| PATCH /events/:id/status | Admin for approval/rejection; verified owner/Admin for lifecycle | `{status,reason?}` → `{event}`. Reason required for Rejected and Cancelled. |
| PATCH /events/:id/reassign | Admin | `{organizer,reason}` → `{ok:true}`. Target must be active/verified Organizer. |
| POST /events/:id/register | Student | No body → 201 `{registration}` registered or waitlisted. |
| DELETE /events/:id/register | Student | Cancels own registration; earliest waitlist promotion when eligible → `{ok,promoted}`. |
| GET /events/:id/ticket | Registered Student | `{ticket}` with QR data URL for eligible registration. |
| GET /events/:id/attendees | Verified owner/Admin | Query `page,limit` → `{event,attendees,total}`. |
| POST /events/:id/checkin | Verified owner/Admin | `{ticketCode}` → `{ok,checkedInAt,student}`. Validated within one hour before start through end. |
| GET /events/:id/feedback | Student for own; verified owner/Admin for all | `{feedback}`; management response also includes averageRating and count. |
| PUT /events/:id/feedback | Checked-in Student after event ends | `{rating,comment?}` → `{feedback}`. |
| DELETE /events/:id/feedback | Feedback owner | `{ok:true}`. |

Event body: `{title,description,category,start,end,venue,capacity,budget,budgetNotes}`. Use ISO timestamps with timezone, e.g. `2026-11-20T10:00:00+05:30`. Minimum one hour; start must be future for create/edit; positive integer capacity no larger than venue; nonnegative budget; breakdown above ₹10,000. Categories: Academic, Cultural, Sports, Social, Workshop, Seminar. Cloning opens a prefilled create form and uses POST /events with new dates; it never copies tickets or attendees.

## Venues and calendars

| Method / route | Access | Body / response |
|---|---|---|
| GET /venues | Authenticated (verified Organizer) | Query `all=1` for Admin archived inclusion → `{venues}`. |
| POST /venues | Admin | `{name,location,capacity,amenities}` → 201 `{venue}`. |
| PATCH /venues/:id | Admin | Partial venue body; optional `active:true` to restore → `{venue}`. |
| DELETE /venues/:id | Admin | Archive; rejected if upcoming/live reservations exist → `{venue}`. |
| GET /venues/:id/availability | Verified Organizer/Admin | Query `start,end,exclude?` → `{venue,available,conflicts}`; private other-Organizer pending title/ID redacted. |
| GET /calendar | Authenticated; verified Organizer | Query `start,end,category?,status?,scope?,history?`. Max 93 days. Returns `{events}`. Student registration scope; Organizer own + other approved; Admin all (archive opt-in). |

Pending and Approved overlap when `existing.start < requested.end && existing.end > requested.start`. Adjacent end/start is allowed. API mutation locking serializes conflict checking and saving.

## Notifications, reports and other modules

| Method / route | Access | Body / response |
|---|---|---|
| GET /notifications | Authenticated | `page,limit` → `{notifications,total,unread}`. Retries pending approval announcements. |
| PATCH /notifications/read-all | Authenticated | `{ok:true}`. |
| PATCH /notifications/:id | Owner | `{read:true/false}` → `{notification}`. |
| DELETE /notifications/:id | Owner | Soft hide, retain dedupe record → `{ok:true}`. |
| GET /suggestions | Own, or Admin all | `{suggestions}`. |
| POST /suggestions | Authenticated | `{text}` → 201 `{suggestion}`. |
| PATCH /suggestions/:id | Admin | `{status}` Submitted/In progress/Implemented → `{suggestion}`. |
| GET /reports | Admin / verified Organizer | MongoDB aggregation report; `format=csv` exports CSV. |
| GET /audit | Admin | `page,limit` → `{logs,total}`. |
| GET /health | Public | Minimal connectivity/time; 503 when database unavailable. |
| GET /admin/health | Admin | Database status, pending announcements, attention count, uptime; no credentials. |

Pagination defaults to 20, maximum 100. Page is one-based. Sort on events is `asc` or `desc`.

Errors use `{error,details?}`: 400 validation, 401 missing/invalid/expired session, 403 role/ownership/verification, 404 missing/inaccessible record, 409 duplicate/conflict/state transition, 429 rate limit, 503 database unavailable/write lock busy. Invalid object IDs return 404 on parameter routes. SMTP failures are not evidence that an email was sent. Admin creation can return `delivery:false` after account creation; retry password setup after fixing SMTP.

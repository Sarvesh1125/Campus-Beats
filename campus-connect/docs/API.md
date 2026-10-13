# API reference

Base URL `http://localhost:3000/api` · JSON in/out · session cookie `sid` (HttpOnly, SameSite=Lax) set by login/register.
Errors: `{ "error": "message", "details": [...optional] }`.
Status codes: **400** validation · **401** not logged in · **403** wrong role / not owner · **404** missing · **409** conflict · **429** too many login attempts.
Roles: **Any** = logged in; **S** = student; **O** = organizer; **A** = admin.

## System
| Method | URL | Role | Response |
|---|---|---|---|
| GET | `/health` | none | `{status:"ok", db:"connected"}` |

## Authentication
| Method | URL | Role | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/auth/register` | none | `{name,email,phone,password,role:"student"|"organizer",interests,organizationNumber}` | 201 `{user}` + cookie | 400 invalid (incl. role admin, phone not 10–15 digits, password <8), 409 email exists |
| POST | `/auth/login` | none | `{email,password}` | 200 `{user}` + cookie | 400, 401 bad credentials, 403 deactivated, 429 rate limit (10 / 15 min per IP+email) |
| POST | `/auth/logout` | any | – | 200 `{ok:true}` | – |
| GET | `/auth/me` | any | – | 200 `{user}` | 401 |

## Profile
| Method | URL | Role | Body | Success | Errors |
|---|---|---|---|---|---|
| PATCH | `/profile` | any | any of `{name,phone,interests,organizationNumber(O),currentPassword+newPassword}` (role/email/verified/active are ignored) | 200 `{user}` | 400, 401 |
| DELETE | `/profile` | S,O | – | 200 `{ok}`; account deactivated, sessions deleted | 409 for admin or while the user has an ongoing event/registration |

## Events
| Method | URL | Role | Body / query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/events` | any | `q, category, from, to, venue, status, mine=1, past=1` | 200 `{events}` – students: Approved + their own; organizers: own; admin: all | 401 |
| POST | `/events` | O (verified) | `{title,category,venue,start,end,capacity,budget,budgetNotes,description}` | 201 `{event}` status Pending | 400 validation, 403 unverified, 404 venue, 409 overlap / duplicate title+date |
| PATCH | `/events/:id` | O (owner), A | any event fields | 200 `{event}` → status **Pending**; registered students notified | 400, 403, 404, 409 (started/terminal event, overlap) |
| DELETE | `/events/:id` | O (owner), A | – | 200 `{ok:true}` only for an event with no registration or feedback history that has not started | 403, 404, 409 started/ongoing, registration history, feedback history, completed/archived |
| PATCH | `/events/:id/status` | A: Approved/Rejected(+`reason`); O owner/A: Cancelled, Completed, Archived | `{status,reason?}` | 200 `{event}` | 400, 403, 404, 409 invalid transition (e.g. started events cannot be cancelled; Completed before end) |
| POST | `/events/:id/register` | S | – | 201 `{registration:{status:"registered"|"waitlisted",ticketCode}}` | 404, 409 not approved / started / duplicate |
| DELETE | `/events/:id/register` | S | – | 200 `{ok,promoted}` (earliest waitlisted student promoted) | 404 no active registration, 409 started / already checked in |
| GET | `/events/:id/ticket` | S | – | 200 `{ticket:{ticketCode,status,qr(data URL PNG),event}}` | 404 |
| GET | `/events/:id/attendees` | O owner, A | – | 200 `{event,attendees[]}` | 403, 404 |
| POST | `/events/:id/checkin` | O owner, A | `{ticketCode}` | 200 `{ok,checkedInAt,student}` | 400, 403, 404 unknown ticket, 409 outside window / duplicate / cancelled / waitlisted / no-show |
| GET | `/events/:id/feedback` | S: own; O owner/A: all + average | – | 200 | 403, 404 |
| PUT | `/events/:id/feedback` | S (checked-in, event ended) | `{rating:1-5,comment≤1000}` | 200 `{feedback}` (create or update) | 400, 403 not checked in, 409 event not ended |
| DELETE | `/events/:id/feedback` | S | – | 200 `{ok}` | 404 |

## Venues
| Method | URL | Role | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/venues` | any | `?all=1` (admin: include archived) | 200 `{venues}` | 401 |
| POST | `/venues` | A | `{name,location,capacity,amenities}` | 201 `{venue}` | 400, 403, 409 duplicate name |
| PATCH | `/venues/:id` | A | any of the fields, `active:true` to restore | 200 `{venue}` | 400, 404, 409 capacity below an upcoming event / name clash |
| DELETE | `/venues/:id` | A | – | 200 `{venue}` (archived) | 404, 409 future pending/approved events |

## Users
| Method | URL | Role | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/users` | A | `?role=organizer` | 200 `{users}` (no password data) | 403 |
| PATCH | `/users/:id` | A | `{verified?:boolean, active?:boolean}` | 200 `{user}` (verification notifies organizer; deactivation ends sessions) | 400, 404, 409 admin deactivation or protecting an ongoing event/registration |

## Notifications
| Method | URL | Role | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/notifications` | any | – | 200 `{notifications,unread}` | 401 |
| PATCH | `/notifications/:id` | any (own) | `{read:true}` | 200 `{notification}` | 404 |
| DELETE | `/notifications/:id` | any (own) | – | 200 `{ok}` | 404 |

## Suggestions
| Method | URL | Role | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/suggestions` | any (own; admin: all) | – | 200 `{suggestions}` | 401 |
| POST | `/suggestions` | any | `{text 5–2000}` | 201 `{suggestion}` | 400 |
| PATCH | `/suggestions/:id` | A | `{status:"Submitted"|"In progress"|"Implemented"}` | 200 `{suggestion}` | 400, 403, 404 |

## Reports (MongoDB aggregation)
| Method | URL | Role | Query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/reports` | A (system-wide), O (own events) | `format=csv` for download | 200 `{summary,eventWise, events/byCategory/venueUsage/organizers (admin)}` or CSV (formula-injection sanitised) | 403 students |

`summary`: `totalRegistrations` (confirmed seats), `attendanceCount`, `waitlistCount`, `cancellationCount`, `noShowCount`, `attendanceRate` / `noShowRate` (% of confirmed seats at events that already ended), `averageRating`, `feedbackCount`.

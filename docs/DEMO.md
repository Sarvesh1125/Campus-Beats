# Advanced DBMS presentation demonstration

Start MongoDB and the application. Open http://localhost:3000 and Compass connected to the same local server. Keep the terminal visible for development password setup links.

## 1. Database design (one minute)

Show users, venues and events. Explain that user/venue IDs are references, while registrations are embedded in events for atomic seat decisions. Show compound indexes in Compass. Explain that Compass is a GUI; Express communicates with MongoDB.

## 2. Student registration and waitlist

1. Log in as `student@campus.local`, password `Campus@123` on a fresh seed.
2. Discover → One-seat Waitlist Demo → Register. Show its registration and QR ticket in Compass/events.
3. In a private browser window, log in as `student2@campus.local` and register for the same event. It becomes waitlisted.
4. Cancel the first Student's registration before event start. Refresh the second Student's notifications: the earliest waiting Student is promoted.
5. Show the cancelled history entry and promoted registration in the same event document.

## 3. Organizer number and Admin permissions

Register a new Organizer without entering an Organizer number. Inspect its generated ORG identifier. Admin → Users → Manage verifies it. Show that Students cannot choose Admin on the public registration form.

Admin → Users → Create user demonstrates role assignment. To create an Admin, enter the current Admin password and confirm the grant. Open its password setup link from the backend terminal in a private window. Do not display or share unrelated terminal reset links.

## 4. Venue availability and first approval

1. Organizer → Create event. Select venue, future time, positive capacity and a 50+ character description.
2. Check venue availability. A conflicting pending/approved event prevents saving. End exactly at another event's start to demonstrate an allowed adjacent slot.
3. Submit. Show Pending in Compass.
4. Admin → Event approvals → Approve.
5. Student → Notifications shows the announcement, event time and venue. Click Event details.
6. Inspect notification dedupeKey in Compass. Reapproval after an edit does not duplicate the original announcement.

## 5. QR check-in

On a fresh seed, choose Live Check-in Practice; it starts in about 30 minutes. Student's ticket is `TKT-DEMO0001`.

Admin → Scan QR (or Organizer → Check-in) → select that event → Start Camera. Show the Student's QR from another screen. If no camera is available, save/screenshot the QR and upload it, or enter the ticket code. Show success and increased attendance. Scanning again is rejected. Inspect checkedInAt/checkedInBy in Compass.

If that sample event has expired, create a new event starting within an hour, approve it, register a Student and use that ticket. Seeding never overwrites old event times.

## 6. Access revocation during an event

1. Keep the Organizer logged in in a separate window.
2. Admin → Users → Manage that Organizer. Review affected events, set Verified to Unverified, and enter a reason.
3. The Organizer can read notifications/profile but cannot manage events or check in attendees.
4. Deactivate the account; its existing session stops working.
5. Show that the event, ticket, and registrations still exist.
6. Admin → All events → Reassign to another active, verified Organizer. Show originalCreator remains unchanged. Admin can also continue scanning tickets directly.

For a truly ongoing event, schedule a new event a few minutes ahead and perform this step after it starts. Do not alter your computer clock.

## 7. Calendar views

- Student: registered/waitlisted/checked-in events, with visible waitlist status.
- Organizer: own events and other Organizers' approved public events. Private budgets/attendees are not exposed.
- Admin: all relevant statuses, details and management entry points.
- Switch month/week/agenda and inspect mobile agenda layout. All displayed schedule times are IST.

## 8. Password recovery and reports

Log out → Forgot password → enter a demo email. Open the terminal link and reset within 15 minutes. A used or expired link is rejected; old sessions expire. Console mode is a local demo, not a sent email.

Admin → Reports: explain live MongoDB aggregation counts, attendance and feedback. Export CSV. In Compass → events → Aggregations, run the example in DATABASE.md. End with Admin → Audit log to show account and lifecycle actions with actor, reason and timestamp.

## Manual checks on your laptop

- Allow and deny camera permission; verify a useful message and image/manual fallback.
- Scan a real Student QR once and again; verify success then duplicate rejection.
- Stop camera, navigate away and verify the camera indicator turns off.
- Try keyboard Tab/Shift+Tab/Escape in dialogs.
- Check phone-sized layout and switch to agenda for comfortable calendar reading.
- If configuring SMTP, test delivery with your own provider; development console mode works without it.

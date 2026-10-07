'use strict';
// Integration tests: real HTTP requests to a real Express server backed by the separate DB "campus_connect_test".
require('dotenv').config();
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const M = require('../src/models');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const TEST_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/campus_connect_test';
const PW = 'Campus@123';
let base; const results = []; const S = {};

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    if (method === 'PATCH' && path.startsWith('/users/')) body = { reason: 'Integration test account administration', ...body };
    const r = await fetch(base + '/api' + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers, raw: text };
  };
  call.cookie = () => cookie;
  return call;
}
const when = (days, hour, hours = 3) => { const s = new Date(); s.setDate(s.getDate() + days); s.setHours(hour, 0, 0, 0); return [s.toISOString(), new Date(s.getTime() + hours * 3600000).toISOString()]; };
const DESC = 'A sufficiently long description for an integration test event that is definitely over fifty characters.';
const evBody = (over = {}) => { const [start, end] = when(3, 10); return { title: 'Workshop A', category: 'Workshop', venue: S.hall?._id, start, end, capacity: 2, budget: 0, description: DESC, ...over }; };
async function t(name, fn) {
  try { await fn(); results.push([name, true]); console.log('  ✔ ' + name); }
  catch (e) { results.push([name, false, e]); console.log('  ✘ ' + name + '\n      ' + String(e.message).split('\n').join('\n      ')); }
}
const register = async (c, name, email, role = 'student', extra = {}) => c('POST', '/auth/register', { name, email, phone: '9876543210', password: PW, role, interests: 'AI, Music', ...(role === 'organizer' ? { organizationNumber: 'ORG-123' } : {}), ...extra });
const login = (c, email, password = PW) => c('POST', '/auth/login', { email, password });
const approve = async (id) => (await S.admin('PATCH', `/events/${id}/status`, { status: 'Approved' }));

(async () => {
  await mongoose.connect(TEST_URI);
  assert.ok(mongoose.connection.name.endsWith('_test'), 'Refusing to run: database name must end with _test');
  await mongoose.connection.dropDatabase(); await M.initAll();
  const server = createApp().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  console.log(`\nIntegration tests against ${base} using database "${mongoose.connection.name}"\n`);

  const adminUser = await M.User.create({ name: 'Admin', email: 'admin@test.local', phone: '9000000000', role: 'admin', verified: true, passwordHash: await hashPassword(PW) });
  Object.assign(S, { admin: client(), org: client(), org2: client(), s1: client(), s2: client(), s3: client(), s4: client(), anon: client() });

  await t('health endpoint reports database connected', async () => { const r = await S.anon('GET', '/health'); assert.equal(r.status, 200); assert.equal(r.data.db, 'connected'); });
  await t('security headers are set', async () => { const r = await S.anon('GET', '/health'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.ok(r.headers.get('content-security-policy')); });

  // ---- registration / auth ----
  await t('registers students and organizer (no password in response)', async () => {
    for (const [k, n, e] of [['s1', 'Stu One', 's1@test.local'], ['s2', 'Stu Two', 's2@test.local'], ['s3', 'Stu Three', 's3@test.local'], ['s4', 'Stu Four', 's4@test.local']]) {
      const r = await register(S[k], n, e); assert.equal(r.status, 201); assert.equal(r.data.user.role, 'student'); assert.ok(!r.raw.includes('passwordHash')); S[k + 'id'] = r.data.user._id;
    }
    const o = await register(S.org, 'Olive Org', 'org@test.local', 'organizer'); assert.equal(o.status, 201); assert.equal(o.data.user.verified, false); S.orgId = o.data.user._id;
  });
  await t('passwords are stored hashed (scrypt)', async () => { const u = await M.User.findOne({ email: 's1@test.local' }); assert.match(u.passwordHash, /^scrypt\$/); assert.ok(!u.passwordHash.includes(PW)); });
  await t('registration rejects duplicate email, bad phone, short password, admin role', async () => {
    assert.equal((await register(S.anon, 'X Y', 's1@test.local')).status, 409);
    assert.equal((await register(S.anon, 'X Y', 'n1@test.local', 'student', { phone: '123' })).status, 400);
    assert.equal((await register(S.anon, 'X Y', 'n2@test.local', 'student', { password: 'short' })).status, 400);
    assert.equal((await register(S.anon, 'X Y', 'n3@test.local', 'admin')).status, 400);
    const generated = await register(client(), 'X Y', 'n4@test.local', 'organizer', { organizationNumber: '' }); assert.equal(generated.status, 201); assert.match(generated.data.user.organizationNumber, /^ORG-/);
  });
  await t('login/logout flow with HttpOnly SameSite cookie', async () => {
    const c = client(); assert.equal((await login(c, 's1@test.local', 'wrong-pass-1')).status, 401);
    const ok = await login(c, 's1@test.local'); assert.equal(ok.status, 200);
    const sc = ok.headers.getSetCookie().join(';'); assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Lax/i);
    assert.equal((await c('GET', '/auth/me')).data.user.email, 's1@test.local');
    assert.equal((await c('POST', '/auth/logout')).status, 200); assert.equal((await c('GET', '/auth/me')).status, 401);
    assert.ok(await M.Session.countDocuments() >= 1);
  });
  await t('login rate limiting returns 429', async () => {
    let last; for (let i = 0; i < 12; i++) last = await login(client(), 'ratelimit@test.local', 'bad-password'); assert.equal(last.status, 429);
  });
  await login(S.admin, 'admin@test.local');

  // ---- unauthorized / roles ----
  await t('unauthenticated requests get 401', async () => { for (const p of ['/events', '/venues', '/notifications', '/reports', '/users']) assert.equal((await S.anon('GET', p)).status, 401, p); });
  await t('role permissions return 403', async () => {
    assert.equal((await S.s1('POST', '/venues', { name: 'V', location: 'L', capacity: 5 })).status, 403);
    assert.equal((await S.s1('GET', '/users')).status, 403); assert.equal((await S.s1('GET', '/reports')).status, 403);
    assert.equal((await S.s1('POST', '/events', evBody())).status, 403);
    assert.equal((await S.org('GET', '/users')).status, 403); assert.equal((await S.org('POST', '/venues', { name: 'V', location: 'L', capacity: 5 })).status, 403);
  });
  await t('profile update cannot escalate role', async () => {
    const r = await S.s4('PATCH', '/profile', { name: 'Stu Four', role: 'admin', verified: false, active: true, interests: 'Chess' });
    assert.equal(r.status, 400); assert.equal((await S.s4('GET', '/auth/me')).data.user.role, 'student');
  });

  // ---- venues ----
  await t('admin manages venues; duplicate name rejected', async () => {
    const a = await S.admin('POST', '/venues', { name: 'Hall', location: 'Block A', capacity: 50, amenities: 'Wi-Fi, Projector' }); assert.equal(a.status, 201); S.hall = a.data.venue;
    S.mini = (await S.admin('POST', '/venues', { name: 'Mini Room', location: 'Block B', capacity: 10 })).data.venue;
    S.lab = (await S.admin('POST', '/venues', { name: 'Lab', location: 'Block C', capacity: 30 })).data.venue;
    assert.equal((await S.admin('POST', '/venues', { name: 'Hall', location: 'x', capacity: 5 })).status, 409);
    assert.equal((await S.admin('POST', '/venues', { name: 'Bad', location: 'x', capacity: -5 })).status, 400);
    assert.equal((await S.admin('GET', '/venues')).data.venues.length, 3);
  });

  // ---- organizer verification ----
  await t('unverified organizer cannot create events; admin verification notifies organizer', async () => {
    assert.equal((await S.org('POST', '/events', evBody())).status, 403);
    assert.equal((await S.admin('PATCH', `/users/${S.s1id}`, { verified: true })).status, 400);
    const v = await S.admin('PATCH', `/users/${S.orgId}`, { verified: true }); assert.equal(v.status, 200); assert.equal(v.data.user.verified, true);
    const n = await S.org('GET', '/notifications'); assert.ok(n.data.notifications.some((x) => /verified/i.test(x.message)));
    await login(S.org, 'org@test.local');
  });

  // ---- events: validation ----
  await t('event validation rules', async () => {
    const bad = async (over, re) => { const r = await S.org('POST', '/events', evBody(over)); assert.equal(r.status, 400, JSON.stringify(over)); if (re) assert.match(r.data.error, re); };
    await bad({ title: 'X' }, /Title/); await bad({ description: 'too short' }, /Description/); await bad({ category: 'Party' }, /Category/);
    await bad({ start: new Date(Date.now() - 3600000).toISOString() }, /future/);
    const [s] = when(3, 10); await bad({ start: s, end: s }, /End time/);
    await bad({ end: new Date(new Date(s).getTime() + 1800000).toISOString() }, /one hour/);
    await bad({ capacity: 0 }, /Capacity/); await bad({ capacity: 1.5 }, /Capacity/); await bad({ budget: -1 }, /Budget/);
    await bad({ budget: 20000 }, /breakdown/);
  });
  await t('capacity cannot exceed venue capacity', async () => { const r = await S.org('POST', '/events', evBody({ venue: S.mini._id, capacity: 11, title: 'Too Big' })); assert.equal(r.status, 400); assert.match(r.data.error, /venue capacity/); });
  await t('organizer creates event (Pending); budget above threshold needs breakdown', async () => {
    const r = await S.org('POST', '/events', evBody()); assert.equal(r.status, 201); assert.equal(r.data.event.status, 'Pending'); S.e1 = r.data.event;
    const [s2, e2] = when(8, 10);
    assert.equal((await S.org('POST', '/events', evBody({ title: 'Funded', venue: S.lab._id, start: s2, end: e2, budget: 20000, budgetNotes: 'Stage 10000, food 6000, prizes 4000' }))).status, 201);
    const admins = await S.admin('GET', '/notifications'); assert.ok(admins.data.notifications.some((n) => /awaiting approval/.test(n.message)));
  });
  await t('duplicate title on same date and overlapping venue are rejected (409)', async () => {
    assert.equal((await S.org('POST', '/events', evBody({ venue: S.lab._id }))).status, 409);
    const [s, e] = when(3, 11, 2); const r = await S.org('POST', '/events', evBody({ title: 'Workshop B', start: s, end: e })); assert.equal(r.status, 409); assert.match(r.data.error, /already booked/);
  });
  await t('students cannot see pending events; only admin can approve', async () => {
    assert.ok(!(await S.s1('GET', '/events')).data.events.some((e) => e._id === S.e1._id));
    assert.equal((await S.s1('PATCH', `/events/${S.e1._id}/status`, { status: 'Approved' })).status, 403);
    assert.equal((await S.org('PATCH', `/events/${S.e1._id}/status`, { status: 'Approved' })).status, 403);
    const a = await approve(S.e1._id); assert.equal(a.status, 200); assert.equal(a.data.event.status, 'Approved');
    assert.ok((await S.s1('GET', '/events')).data.events.some((e) => e._id === S.e1._id));
    assert.ok((await S.org('GET', '/notifications')).data.notifications.some((n) => /approved/.test(n.message)));
    assert.equal((await approve(S.e1._id)).status, 409);
  });
  await t('editing an event returns it to Pending; only owner can edit', async () => {
    await register(S.org2, 'Other Org', 'org2@test.local', 'organizer');
    assert.equal((await S.org2('PATCH', `/events/${S.e1._id}`, { description: DESC + ' more' })).status, 403);
    const r = await S.org('PATCH', `/events/${S.e1._id}`, { description: DESC + ' Updated text.' }); assert.equal(r.status, 200); assert.equal(r.data.event.status, 'Pending');
    assert.ok(!(await S.s1('GET', '/events')).data.events.some((e) => e._id === S.e1._id));
    assert.equal((await approve(S.e1._id)).status, 200);
    assert.equal((await S.org('PATCH', `/events/${S.e1._id}`, { capacity: 500 })).status, 400);
  });
  await t('venue rules: capacity cannot drop below upcoming event; cannot archive venue in use', async () => {
    assert.equal((await S.admin('PATCH', `/venues/${S.hall._id}`, { capacity: 1 })).status, 409);
    assert.equal((await S.admin('PATCH', `/venues/${S.hall._id}`, { capacity: 40 })).status, 200);
    assert.equal((await S.admin('DELETE', `/venues/${S.hall._id}`)).status, 409);
    const spare = (await S.admin('POST', '/venues', { name: 'Spare', location: 'X', capacity: 5 })).data.venue;
    assert.equal((await S.admin('DELETE', `/venues/${spare._id}`)).status, 200);
  });

  // ---- registration / waitlist ----
  await t('student registers; duplicate rejected; ticket + QR generated', async () => {
    const r = await S.s1('POST', `/events/${S.e1._id}/register`); assert.equal(r.status, 201); assert.equal(r.data.registration.status, 'registered'); S.t1 = r.data.registration.ticketCode; assert.match(S.t1, /^TKT-[0-9A-F]{10}$/);
    assert.equal((await S.s1('POST', `/events/${S.e1._id}/register`)).status, 409);
    const t1 = await S.s1('GET', `/events/${S.e1._id}/ticket`); assert.equal(t1.status, 200); assert.ok(t1.data.ticket.qr.startsWith('data:image/png;base64,')); assert.equal(t1.data.ticket.ticketCode, S.t1);
    assert.ok((await S.s1('GET', '/notifications')).data.notifications.some((n) => /registered/.test(n.message)));
    const stored = await M.Event.findById(S.e1._id); assert.equal(stored.registrations.length, 1);
  });
  await t('full event waitlists students; cancellation promotes earliest waitlisted', async () => {
    assert.equal((await S.s2('POST', `/events/${S.e1._id}/register`)).data.registration.status, 'registered');
    const w = await S.s3('POST', `/events/${S.e1._id}/register`); assert.equal(w.data.registration.status, 'waitlisted'); S.t3 = w.data.registration.ticketCode;
    assert.equal((await S.s3('GET', `/events/${S.e1._id}/ticket`)).data.ticket.qr, null);
    assert.ok((await S.s3('GET', '/notifications')).data.notifications.some((n) => /waitlist/.test(n.message)));
    const c = await S.s1('DELETE', `/events/${S.e1._id}/register`); assert.equal(c.status, 200); assert.equal(c.data.promoted, S.s3id);
    const tk = await S.s3('GET', `/events/${S.e1._id}/ticket`); assert.equal(tk.data.ticket.status, 'registered'); assert.ok(tk.data.ticket.qr);
    assert.ok((await S.s3('GET', '/notifications')).data.notifications.some((n) => /seat opened/.test(n.message)));
    assert.ok((await S.s1('GET', '/notifications')).data.notifications.some((n) => /cancelled/.test(n.message)));
    assert.equal((await S.s1('DELETE', `/events/${S.e1._id}/register`)).status, 404);
  });
  await t('cancelled registration history is preserved; re-registering a full event waitlists', async () => {
    const r = await S.s1('POST', `/events/${S.e1._id}/register`); assert.equal(r.status, 201); assert.equal(r.data.registration.status, 'waitlisted');
    const ev = await M.Event.findById(S.e1._id); assert.equal(ev.registrations.length, 4); assert.equal(ev.registrations.filter((x) => x.status === 'cancelled').length, 1);
    assert.equal((await S.s4('GET', `/events/${S.e1._id}/ticket`)).status, 404);
  });
  await t('concurrent registrations for the last seat never overbook', async () => {
    const [s, e] = when(4, 10); const c = await S.org('POST', '/events', evBody({ title: 'Race Day', venue: S.lab._id, start: s, end: e, capacity: 1 })); assert.equal(c.status, 201);
    await approve(c.data.event._id);
    const rs = await Promise.all([S.s1, S.s2, S.s3, S.s4].map((cl) => cl('POST', `/events/${c.data.event._id}/register`)));
    const st = rs.map((r) => r.data.registration.status).sort(); assert.deepEqual(st, ['registered', 'waitlisted', 'waitlisted', 'waitlisted']);
    assert.equal((await M.Event.findById(c.data.event._id)).registrations.filter((x) => x.status === 'registered').length, 1);
  });
  await t('only owner/admin see attendees', async () => {
    const r = await S.org('GET', `/events/${S.e1._id}/attendees`); assert.equal(r.status, 200); assert.equal(r.data.attendees.length, 4); assert.ok(r.data.attendees[0].student.email);
    assert.equal((await S.org2('GET', `/events/${S.e1._id}/attendees`)).status, 403); assert.equal((await S.s1('GET', `/events/${S.e1._id}/attendees`)).status, 403);
  });

  // ---- check-in ----
  await t('check-in window, invalid/duplicate/cancelled tickets', async () => {
    const start = new Date(Date.now() + 30 * 60000), end = new Date(start.getTime() + 2 * 3600000);
    const c = await S.org('POST', '/events', evBody({ title: 'Starting Soon', start: start.toISOString(), end: end.toISOString(), capacity: 5 })); assert.equal(c.status, 201); S.e3 = c.data.event; await approve(S.e3._id);
    S.t1b = (await S.s1('POST', `/events/${S.e3._id}/register`)).data.registration.ticketCode;
    const tmp = (await S.s3('POST', `/events/${S.e3._id}/register`)).data.registration.ticketCode; await S.s3('DELETE', `/events/${S.e3._id}/register`);
    assert.equal((await S.org('POST', `/events/${S.e3._id}/checkin`, { ticketCode: 'TKT-NOPE' })).status, 404);
    assert.equal((await S.org('POST', `/events/${S.e3._id}/checkin`, { ticketCode: tmp })).status, 409);
    assert.equal((await S.s1('POST', `/events/${S.e3._id}/checkin`, { ticketCode: S.t1b })).status, 403);
    assert.equal((await S.org2('POST', `/events/${S.e3._id}/checkin`, { ticketCode: S.t1b })).status, 403);
    assert.equal((await S.org('POST', `/events/${S.e1._id}/checkin`, { ticketCode: S.t3 })).status, 409); // window not open yet
    const ok = await S.org('POST', `/events/${S.e3._id}/checkin`, { ticketCode: S.t1b }); assert.equal(ok.status, 200); assert.ok(ok.data.checkedInAt);
    const dup = await S.org('POST', `/events/${S.e3._id}/checkin`, { ticketCode: S.t1b }); assert.equal(dup.status, 409); assert.match(dup.data.error, /already/);
    const reg = (await M.Event.findById(S.e3._id)).registrations.find((r) => r.ticketCode === S.t1b); assert.equal(reg.status, 'checked-in'); assert.ok(reg.checkedInAt);
    assert.ok((await S.s1('GET', '/notifications')).data.notifications.some((n) => /checked in/.test(n.message)));
  });

  // ---- feedback ----
  await t('feedback create/update/delete with eligibility rules', async () => {
    assert.equal((await S.s1('PUT', `/events/${S.e3._id}/feedback`, { rating: 5 })).status, 409); // event not ended
    const past = await M.Event.create({ title: 'Past Fest', titleKey: 'past fest', dateKey: '2020-01-01', description: DESC, category: 'Social', start: new Date(Date.now() - 5 * 3600000), end: new Date(Date.now() - 2 * 3600000),
      venue: S.hall._id, organizer: S.orgId, capacity: 10, status: 'Approved',
      registrations: [{ student: S.s1id, status: 'checked-in', ticketCode: 'TKT-PAST000001', checkedInAt: new Date() }, { student: S.s2id, status: 'registered', ticketCode: 'TKT-PAST000002' }] });
    S.past = past;
    assert.equal((await S.s2('PUT', `/events/${past._id}/feedback`, { rating: 4 })).status, 403);
    assert.equal((await S.s1('PUT', `/events/${past._id}/feedback`, { rating: 6 })).status, 400);
    assert.equal((await S.s1('PUT', `/events/${past._id}/feedback`, { rating: 4, comment: 'x'.repeat(1001) })).status, 400);
    const a = await S.s1('PUT', `/events/${past._id}/feedback`, { rating: 4, comment: 'Good' }); assert.equal(a.status, 200);
    const b = await S.s1('PUT', `/events/${past._id}/feedback`, { rating: 5, comment: 'Great' }); assert.equal(b.status, 200); assert.equal(b.data.feedback._id, a.data.feedback._id);
    assert.equal(await M.Feedback.countDocuments({ event: past._id }), 1);
    assert.equal((await S.s1('GET', `/events/${past._id}/feedback`)).data.feedback.rating, 5);
    const o = await S.org('GET', `/events/${past._id}/feedback`); assert.equal(o.data.count, 1); assert.equal(o.data.averageRating, 5);
    assert.equal((await S.org2('GET', `/events/${past._id}/feedback`)).status, 403);
    assert.equal((await S.s1('DELETE', `/events/${past._id}/feedback`)).status, 200); assert.equal((await S.s1('DELETE', `/events/${past._id}/feedback`)).status, 404);
    assert.equal((await S.org('GET', `/events/${past._id}/feedback`)).data.count, 0);
    await S.s1('PUT', `/events/${past._id}/feedback`, { rating: 4, comment: 'Back again' });
  });

  // ---- completion / archive ----
  await t('event lifecycle: complete only after end, no-show marking, archive', async () => {
    assert.equal((await S.org('PATCH', `/events/${S.e1._id}/status`, { status: 'Completed' })).status, 409);
    assert.equal((await S.org('PATCH', `/events/${S.past._id}/status`, { status: 'Completed' })).status, 200);
    const reg = (await M.Event.findById(S.past._id)).registrations.find((r) => r.ticketCode === 'TKT-PAST000002'); assert.equal(reg.status, 'no-show');
    assert.equal((await S.org('PATCH', `/events/${S.past._id}`, { title: 'Nope' })).status, 409);
    assert.equal((await S.org('PATCH', `/events/${S.past._id}/status`, { status: 'Archived' })).status, 200);
    assert.ok(await M.Event.exists({ _id: S.past._id, status: 'Archived' }));
  });

  // ---- notifications ----
  await t('notifications: list, mark read, delete (own only)', async () => {
    const l = (await S.s1('GET', '/notifications')).data; assert.ok(l.notifications.length > 0); const n = l.notifications[0];
    assert.equal((await S.s1('PATCH', `/notifications/${n._id}`, { read: true })).data.notification.read, true);
    assert.equal((await S.s2('PATCH', `/notifications/${n._id}`, { read: true })).status, 404);
    assert.equal((await S.s2('DELETE', `/notifications/${n._id}`)).status, 404);
    assert.equal((await S.s1('DELETE', `/notifications/${n._id}`)).status, 200);
  });
  await t('event cancellation notifies registered students', async () => {
    const before = (await S.s2('GET', '/notifications')).data.notifications.length;
    assert.equal((await S.org('PATCH', `/events/${S.e1._id}/status`, { status: 'Cancelled', reason: 'Cancelled for integration test' })).status, 200);
    assert.ok((await S.s2('GET', '/notifications')).data.notifications.length > before);
    assert.equal((await S.s4('POST', `/events/${S.e1._id}/register`)).status, 409);
  });

  // ---- suggestions ----
  await t('suggestions: submit, scoped listing, admin status update', async () => {
    assert.equal((await S.s1('POST', '/suggestions', { text: 'abc' })).status, 400);
    const r = await S.s1('POST', '/suggestions', { text: 'Please add dark mode to the app' }); assert.equal(r.status, 201); assert.equal(r.data.suggestion.status, 'Submitted');
    await S.org('POST', '/suggestions', { text: 'Bug: export button slow sometimes' });
    assert.equal((await S.s1('GET', '/suggestions')).data.suggestions.length, 1); assert.equal((await S.admin('GET', '/suggestions')).data.suggestions.length, 2);
    assert.equal((await S.s1('PATCH', `/suggestions/${r.data.suggestion._id}`, { status: 'Implemented' })).status, 403);
    assert.equal((await S.admin('PATCH', `/suggestions/${r.data.suggestion._id}`, { status: 'Bogus' })).status, 400);
    assert.equal((await S.admin('PATCH', `/suggestions/${r.data.suggestion._id}`, { status: 'In progress' })).data.suggestion.status, 'In progress');
  });

  // ---- reports ----
  await t('MongoDB aggregation reports for admin and organizer', async () => {
    const a = await S.admin('GET', '/reports'); assert.equal(a.status, 200);
    assert.ok(a.data.events.total >= 4); assert.ok(a.data.events.cancelled >= 1); assert.ok(Array.isArray(a.data.byCategory) && a.data.byCategory.length); assert.ok(a.data.venueUsage.every((v) => v.venue));
    assert.equal(a.data.summary.noShowCount, 1); assert.equal(a.data.summary.attendanceRate, 50); assert.equal(a.data.summary.averageRating, 4); assert.equal(a.data.summary.feedbackCount, 1);
    const o = await S.org('GET', '/reports'); assert.equal(o.status, 200); assert.equal(o.data.summary.attendanceCount, 2); assert.ok(o.data.eventWise.length >= 4);
    const o2 = await S.org2('GET', '/reports'); assert.equal(o2.status, 403);
  });
  await t('CSV export neutralises formula injection', async () => {
    const [s, e] = when(12, 10); const c = await S.org('POST', '/events', evBody({ title: '=HYPERLINK("http://evil")', venue: S.lab._id, start: s, end: e })); assert.equal(c.status, 201);
    const r = await S.org('GET', '/reports?format=csv'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.ok(r.raw.includes('Event,Category,Status')); assert.ok(r.raw.includes(`"'=HYPERLINK(""http://evil"")"`), 'formula cell should be prefixed with a quote');
  });

  // ---- deactivation ----
  await t('user deactivation (self and by admin) blocks login and kills sessions', async () => {
    assert.equal((await S.s4('DELETE', '/profile')).status, 200); assert.equal((await S.s4('GET', '/auth/me')).status, 401);
    assert.equal((await login(client(), 's4@test.local')).status, 403);
    assert.equal((await S.admin('PATCH', `/users/${S.s3id}`, { active: false })).status, 200);
    assert.equal((await S.s3('GET', '/auth/me')).status, 401); assert.equal((await login(client(), 's3@test.local')).status, 403);
    assert.equal((await S.admin('PATCH', `/users/${adminUser._id}`, { active: false })).status, 409);
    assert.equal((await S.admin('PATCH', `/users/${S.s3id}`, { active: true })).status, 200); assert.equal((await login(client(), 's3@test.local')).status, 200);
  });
  await t('malformed input handled safely', async () => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' }); assert.equal(r.status, 400);
    assert.equal((await S.anon('GET', '/nope')).status, 404);
  });

  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} tests passed\n`);
  server.close(); await mongoose.disconnect(); process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('Test run crashed:', e); process.exit(1); });

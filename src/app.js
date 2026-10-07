'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const M = require('./models');
const D = require('./domain');
const A = require('./auth');
const U = require('./upgrades');

const { User, Venue, Event, Feedback, Notification, Suggestion, Session } = M;
const { HttpError } = D;
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wrap = (fn) => (req, res, next) => {
  const run = async () => {
    if (req.user) {
      const fresh = await User.findById(req.user._id);
      if (!fresh || !fresh.active || fresh.role !== req.user.role || (fresh.authVersion || 0) !== (req.user.authVersion || 0)) throw new HttpError(401, 'Session expired');
      req.user = fresh;
      if (fresh.role === 'organizer' && !fresh.verified && /^\/(events|reports|venues|calendar)/.test(req.path)) throw new HttpError(403, 'Organizer verification is required. Your profile and notifications remain available.');
    }
    return fn(req, res, next);
  };
  Promise.resolve(['POST','PUT','PATCH','DELETE'].includes(req.method) ? U.locked(run) : run()).catch(next);
};
const notify = (users, message) => {
  const list = (Array.isArray(users) ? users : [users]).filter(Boolean);
  return list.length ? Notification.insertMany(list.map((u) => ({ user: u, message: message.slice(0, 500) }))) : null;
};
const fmt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const ticketCode = () => 'TKT-' + crypto.randomBytes(5).toString('hex').toUpperCase();
const canManage = (u, ev) => u.role === 'admin' || (u.role === 'organizer' && u.verified && String(ev.organizer._id || ev.organizer) === String(u._id));

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/vendor/qr-scanner', express.static(path.join(__dirname, '..', 'node_modules', 'qr-scanner')));
  app.use(express.json({ limit: '50kb' }));
  // CSRF defence in depth (cookie is SameSite): reject cross-origin browser writes.
  app.use((req, _res, next) => {
    const o = req.headers.origin;
    if (o && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      try { if (new URL(o).host !== req.headers.host) return next(new HttpError(403, 'Cross-origin request blocked')); } catch { return next(new HttpError(403, 'Bad origin')); }
    }
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const api = express.Router();
  api.use((req, res, next) => mongoose.connection.readyState === 1 ? next() : res.status(503).json({ error: 'Database unavailable. Start the MongoDB service, then retry.' }));
  api.use(A.loadUser);
  api.use(A.duplicateGuard);
  api.param('id', (req, _res, next, id) => (mongoose.isValidObjectId(id) ? next() : next(new HttpError(404, 'Record not found'))));

  api.get('/health', (_req, res) => res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', time: new Date() }));

  // ---------------- Auth ----------------
  const loginLimit = A.rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyFn: (r) => `${r.ip}:${String(r.body && r.body.email).toLowerCase()}` });
  api.post('/auth/register', A.rateLimiter({ windowMs: 15 * 60 * 1000, max: 30, keyFn: (r) => r.ip }), wrap(async (req, res) => {
    const d = D.validateRegistration(req.body || {});
    if (await User.exists({ email: d.email })) throw new HttpError(409, 'Email is already registered');
    try {
      if (d.role === 'organizer') d.organizationNumber = await U.nextOrgNumber();
      const u = await User.create({ ...d, passwordHash: await A.hashPassword(d.password), verified: d.role === 'student' });
      await A.startSession(res, u._id);
      res.status(201).json({ user: u });
    } catch (e) { if (e.code === 11000) throw new HttpError(409, 'Email is already registered'); throw e; }
  }));
  api.post('/auth/login', loginLimit, wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Email and password are required');
    const u = await User.findOne({ email: email.trim().toLowerCase() });
    if (!u) { await A.burnTime(password); throw new HttpError(401, 'Invalid email or password'); }
    if (!(await A.verifyPassword(password, u.passwordHash))) throw new HttpError(401, 'Invalid email or password');
    if (!u.active) throw new HttpError(403, 'This account has been deactivated');
    await A.startSession(res, u._id);
    res.json({ user: u });
  }));
  api.post('/auth/logout', wrap(async (req, res) => { await A.endSession(req, res); res.json({ ok: true }); }));
  api.get('/auth/me', A.requireAuth, (req, res) => res.json({ user: req.user }));

  // ---------------- Profile ----------------
  api.patch('/profile', A.requireAuth, wrap(async (req, res) => {
    const b = req.body || {}; const u = req.user; const errors = [];
    if (b.name !== undefined) { const n = D.str(b.name, 100); n.length < 2 ? errors.push('Name must be at least 2 characters') : (u.name = n); }
    if (b.phone !== undefined) { const p = D.normalizePhone(b.phone); p ? (u.phone = p) : errors.push('Phone number must contain 10 to 15 digits'); }
    if (b.interests !== undefined) u.interests = D.parseInterests(b.interests);
    if (['role', 'verified', 'active', 'organizationNumber'].some(k => b[k] !== undefined)) throw new HttpError(400, 'Role, status and Organizer number cannot be changed from your profile');
    if (b.newPassword !== undefined) {
      if (typeof b.newPassword !== 'string' || (b.newPassword.length < 8 || b.newPassword.length > 200)) errors.push('New password must contain 8 to 200 characters');
      else if (!(await A.verifyPassword(String(b.currentPassword || ''), u.passwordHash))) errors.push('Current password is incorrect');
      else { u.passwordHash = await A.hashPassword(b.newPassword); u.authVersion = (u.authVersion || 0) + 1; }
    }
    if (errors.length) throw new HttpError(400, errors.join('; '), errors);
    await u.save(); if (b.newPassword) { await Session.deleteMany({ user: u._id }); await A.startSession(res, u._id); } // role / email / verified / active are never taken from this body
    res.json({ user: u });
  }));
  api.delete('/profile', A.requireAuth, wrap(async (req, res) => {
    if (req.user.role === 'admin') throw new HttpError(409, 'Admin accounts cannot be deactivated');
    req.user.active = false; req.user.authVersion = (req.user.authVersion || 0) + 1; await req.user.save(); await U.markAttention(req.user);
    await Session.deleteMany({ user: req.user._id });
    res.setHeader('Set-Cookie', `${A.COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  }));

  U.install(api, wrap, { shape: (...a) => shape(...a), populateEv: (...a) => populateEv(...a), ratingsFor: (...a) => ratingsFor(...a) });

  // ---------------- Users (admin) ----------------
  api.get('/users', A.requireRole('admin'), wrap(async (req, res) => {
    const q = {}; if (req.query.role) q.role = String(req.query.role);
    if (req.query.q) q.$or = ['name','email','organizationNumber'].map(k => ({ [k]: new RegExp(esc(String(req.query.q).slice(0,100)), 'i') }));
    const p = U.page(req.query); res.json({ users: await User.find(q).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit), total: await User.countDocuments(q) });
  }));
  // ---------------- Venues ----------------
  api.get('/venues', A.requireAuth, wrap(async (req, res) => {
    const q = req.user.role === 'admin' && req.query.all === '1' ? {} : { active: true };
    res.json({ venues: await Venue.find(q).sort({ name: 1 }) });
  }));
  const venueFields = (b, partial) => {
    const out = {}; const errors = [];
    if (!partial || b.name !== undefined) { const n = D.str(b.name, 100); n.length < 2 ? errors.push('Venue name must be at least 2 characters') : (out.name = n); }
    if (!partial || b.location !== undefined) { const l = D.str(b.location, 200); l ? (out.location = l) : errors.push('Location is required'); }
    if (!partial || b.capacity !== undefined) { const c = Number(b.capacity); Number.isInteger(c) && c > 0 ? (out.capacity = c) : errors.push('Capacity must be a positive integer'); }
    if (b.amenities !== undefined) out.amenities = D.parseInterests(b.amenities);
    if (errors.length) throw new HttpError(400, errors.join('; '), errors);
    return out;
  };
  api.post('/venues', A.requireRole('admin'), wrap(async (req, res) => {
    try { res.status(201).json({ venue: await Venue.create(venueFields(req.body || {}, false)) }); }
    catch (e) { if (e.code === 11000) throw new HttpError(409, 'A venue with this name already exists'); throw e; }
  }));
  api.patch('/venues/:id', A.requireRole('admin'), wrap(async (req, res) => {
    const v = await Venue.findById(req.params.id); if (!v) throw new HttpError(404, 'Venue not found');
    const f = venueFields(req.body || {}, true);
    if (f.capacity !== undefined && f.capacity < v.capacity) {
      const clash = await Event.findOne({ venue: v._id, status: { $in: ['Pending', 'Approved'] }, end: { $gt: new Date() }, capacity: { $gt: f.capacity } });
      if (clash) throw new HttpError(409, `Capacity cannot be below the capacity (${clash.capacity}) of upcoming event "${clash.title}"`);
    }
    if (req.body.active === true) f.active = true;
    Object.assign(v, f);
    try { await v.save(); } catch (e) { if (e.code === 11000) throw new HttpError(409, 'A venue with this name already exists'); throw e; }
    res.json({ venue: v });
  }));
  api.delete('/venues/:id', A.requireRole('admin'), wrap(async (req, res) => {
    const v = await Venue.findById(req.params.id); if (!v) throw new HttpError(404, 'Venue not found');
    if (await Event.exists({ venue: v._id, status: { $in: ['Pending', 'Approved'] }, end: { $gt: new Date() } })) throw new HttpError(409, 'Venue has future pending or approved events and cannot be archived');
    v.active = false; await v.save(); res.json({ venue: v });
  }));

  // ---------------- Events ----------------
  const shape = (ev, user, ratings) => {
    const regs = ev.registrations || [];
    const cnt = (s) => regs.filter((r) => r.status === s).length;
    const my = user.role === 'student' ? D.lastReg(ev, user._id) : null;
    const out = {
      _id: ev._id, title: ev.title, description: ev.description, category: ev.category, start: ev.start, end: ev.end,
      venue: ev.venue, capacity: ev.capacity, status: ev.status, rejectionReason: ev.rejectionReason, cancellationReason: ev.cancellationReason, needsAttention: ev.needsAttention, canManage: canManage(user, ev),
      organizer: canManage(user, ev) ? ev.organizer : { _id: ev.organizer?._id, name: ev.organizer?.name },
      seatsTaken: D.seatsTaken(ev), waitlistCount: cnt('waitlisted'),
      rating: ratings[String(ev._id)] || { avg: null, count: 0 }, updatedAt: ev.updatedAt,
      myRegistration: my ? { status: my.status, ticketCode: my.ticketCode, registeredAt: my.registeredAt, checkedInAt: my.checkedInAt } : null,
    };
    if (canManage(user, ev)) {
      Object.assign(out, { budget: ev.budget, budgetNotes: ev.budgetNotes, counts: { registered: cnt('registered'), waitlisted: cnt('waitlisted'), checkedIn: cnt('checked-in'), cancelled: cnt('cancelled'), noShow: cnt('no-show') } });
    }
    return out;
  };
  const ratingsFor = async (ids) => {
    const rows = await Feedback.aggregate([{ $match: { event: { $in: ids } } }, { $group: { _id: '$event', avg: { $avg: '$rating' }, count: { $sum: 1 } } }]);
    return Object.fromEntries(rows.map((r) => [String(r._id), { avg: Math.round(r.avg * 10) / 10, count: r.count }]));
  };
  const populateEv = (q) => q.populate('venue', 'name location capacity').populate('organizer', 'name email verified');

  api.get('/events', A.requireAuth, wrap(async (req, res) => {
    const u = req.user; const { q, category, from, to, venue, status, mine, past } = req.query;
    const and = [];
    if (u.role === 'student') {
      if (mine === '1') and.push({ 'registrations.student': u._id });
      else {
        and.push({ $or: [{ status: 'Approved' }, { 'registrations.student': u._id }] });
        if (past !== '1') and.push({ end: { $gt: new Date() } });
      }
    } else if (u.role === 'organizer') and.push({ organizer: u._id });
    if (q) and.push({ $or: [{ title: new RegExp(esc(String(q).slice(0, 100)), 'i') }, { description: new RegExp(esc(String(q).slice(0, 100)), 'i') }] });
    if (category && D.CATEGORIES.includes(category)) and.push({ category });
    if (venue && mongoose.isValidObjectId(venue)) and.push({ venue: oid(venue) });
    if (from && !isNaN(new Date(from))) and.push({ start: { $gte: new Date(String(from).length === 10 ? from + 'T00:00:00+05:30' : from) } });
    if (to && !isNaN(new Date(to))) and.push({ start: { $lte: new Date(new Date(to).getTime() + 86400000) } });
    if (status && D.EVENT_STATUS.includes(status) && u.role !== 'student') and.push({ status });
    const query = and.length ? { $and: and } : {}; const p = U.page(req.query);
    const evs = await populateEv(Event.find(query).sort({ start: req.query.sort === 'desc' ? -1 : 1 }).skip(p.skip).limit(p.limit));
    const ratings = await ratingsFor(evs.map((e) => e._id));
    res.json({ events: evs.map((e) => shape(e, u, ratings)), total: await Event.countDocuments(query) });
  }));

  async function overlapCheck(venueId, start, end, excludeId) {
    const q = { venue: venueId, status: { $in: ['Pending', 'Approved'] }, start: { $lt: end }, end: { $gt: start } };
    if (excludeId) q._id = { $ne: excludeId };
    const c = await Event.findOne(q);
    if (c) throw new HttpError(409, `Venue is already booked for "${c.title}" (${fmt(c.start)} – ${fmt(c.end)})`);
  }
  async function getVenue(id) {
    if (!id || !mongoose.isValidObjectId(id)) throw new HttpError(400, 'A valid venue is required');
    const v = await Venue.findById(id);
    if (!v) throw new HttpError(404, 'Venue not found');
    if (!v.active) throw new HttpError(409, 'Venue is archived');
    return v;
  }

  api.post('/events', A.requireRole('organizer'), wrap(async (req, res) => {
    if (!req.user.verified) throw new HttpError(403, 'Your organizer account must be verified by an admin before creating events');
    const venue = await getVenue(req.body && req.body.venue);
    const f = D.validateEvent(req.body, venue);
    await overlapCheck(venue._id, f.start, f.end);
    try {
      const ev = await Event.create({ ...f, venue: venue._id, organizer: req.user._id, originalCreator: req.user._id, status: 'Pending' });
      const admins = await User.find({ role: 'admin', active: true }, '_id');
      await notify(admins.map((a) => a._id), `New event "${ev.title}" is awaiting approval.`);
      res.status(201).json({ event: ev });
    } catch (e) { if (e.code === 11000) throw new HttpError(409, 'You already have an event with this title on that date'); throw e; }
  }));

  api.patch('/events/:id', A.requireRole('organizer', 'admin'), wrap(async (req, res) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ev = await Event.findById(req.params.id); if (!ev) throw new HttpError(404, 'Event not found');
      if (!canManage(req.user, ev)) throw new HttpError(403, 'You can only edit your own events');
      if (['Completed', 'Cancelled', 'Archived'].includes(ev.status)) throw new HttpError(409, `${ev.status} events cannot be edited`);
      const venue = await getVenue(req.body.venue || ev.venue);
      const merged = { title: ev.title, description: ev.description, category: ev.category, start: ev.start, end: ev.end, capacity: ev.capacity, budget: ev.budget, budgetNotes: ev.budgetNotes, ...req.body };
      const f = D.validateEvent(merged, venue);
      const seats = D.seatsTaken(ev);
      if (f.capacity < seats) throw new HttpError(400, `Capacity cannot be below the ${seats} seats already taken`);
      await overlapCheck(venue._id, f.start, f.end, ev._id);
      const set = { ...f, venue: venue._id, status: 'Pending', rejectionReason: '' };
      // if capacity grew, promote waitlisted students into the new seats
      const promoted = []; let free = f.capacity - seats;
      ev.registrations.forEach((r, i) => { if (r.status === 'waitlisted' && free > 0) { set[`registrations.${i}.status`] = 'registered'; promoted.push(r.student); free--; } });
      let r;
      try { r = await Event.updateOne({ _id: ev._id, __v: ev.__v }, { $set: set, $inc: { __v: 1 } }); }
      catch (e) { if (e.code === 11000) throw new HttpError(409, 'You already have an event with this title on that date'); throw e; }
      if (r.modifiedCount !== 1) continue;
      const audience = ev.registrations.filter((x) => ['registered', 'waitlisted', 'checked-in'].includes(x.status)).map((x) => x.student);
      await notify(audience, `Event "${f.title}" was updated and is awaiting re-approval.`);
      await notify(promoted, `Good news! A seat opened up for "${f.title}" – you are now registered.`);
      return res.json({ event: await populateEv(Event.findById(ev._id)) });
    }
    throw new HttpError(409, 'Event was modified concurrently, please retry');
  }));

  api.patch('/events/:id/status', A.requireRole('organizer', 'admin'), wrap(async (req, res) => {
    const target = D.str((req.body || {}).status, 20);
    if (!D.EVENT_STATUS.includes(target)) throw new HttpError(400, 'Invalid status');
    const ev = await Event.findById(req.params.id); if (!ev) throw new HttpError(404, 'Event not found');
    const u = req.user; const cur = ev.status; const now = new Date();
    if (['Approved', 'Rejected'].includes(target)) {
      if (u.role !== 'admin') throw new HttpError(403, 'Only an admin can approve or reject events');
      if (cur !== 'Pending') throw new HttpError(409, 'Only pending events can be approved or rejected');
      const organizer = await User.findById(ev.organizer);
      if (target === 'Approved') {
        if (!organizer || !organizer.verified || !organizer.active) throw new HttpError(409, 'Organizer is not verified or active');
        if (ev.end <= now) throw new HttpError(409, 'Event has already ended');
        await overlapCheck(ev.venue, ev.start, ev.end, ev._id);
      }
      if (target === 'Rejected' && !D.str(req.body.reason,500)) throw new HttpError(400, 'Rejection reason is required');
      if (target === 'Approved' && !ev.firstApprovedAt && ev.start > now) { ev.firstApprovedAt = now; ev.announcementPending = true; }
      ev.status = target; ev.rejectionReason = target === 'Rejected' ? D.str(req.body.reason, 500) : '';
      await ev.save();
      await U.audit(req.user, 'event-' + target.toLowerCase(), ev.id, D.str(req.body.reason,500));
      if (target === 'Approved') { try { await U.flushAnnouncements(); } catch { console.error('Announcement queued for retry'); } }
      await notify(ev.organizer, target === 'Approved' ? `Your event "${ev.title}" was approved.` : `Your event "${ev.title}" was rejected.${ev.rejectionReason ? ' Reason: ' + ev.rejectionReason : ''}`);
      return res.json({ event: ev });
    }
    if (!canManage(u, ev)) throw new HttpError(403, 'You can only change the status of your own events');
    if (target === 'Cancelled') {
      if (!['Pending', 'Approved', 'Rejected'].includes(cur)) throw new HttpError(409, `A ${cur} event cannot be cancelled`);
      ev.cancellationReason = D.str(req.body.reason,500); if (!ev.cancellationReason) throw new HttpError(400, 'Cancellation reason is required');
      const audience = ev.registrations.filter((r) => ['registered', 'waitlisted', 'checked-in'].includes(r.status)).map((r) => r.student);
      ev.registrations.forEach((r) => { if (['registered', 'waitlisted'].includes(r.status)) r.status = 'cancelled'; }); // history kept, seats released
      ev.status = 'Cancelled'; await ev.save();
      await notify(audience, `Event "${ev.title}" has been cancelled. Reason: ${ev.cancellationReason}`);
    } else if (target === 'Completed') {
      if (cur !== 'Approved') throw new HttpError(409, 'Only approved events can be completed');
      if (ev.end > now) throw new HttpError(409, 'The event has not ended yet');
      ev.registrations.forEach((r) => { if (r.status === 'registered') r.status = 'no-show'; });
      ev.status = 'Completed'; await ev.save();
    } else if (target === 'Archived') {
      if (!['Cancelled', 'Completed'].includes(cur)) throw new HttpError(409, 'Only cancelled or completed events can be archived');
      ev.status = 'Archived'; await ev.save(); // document is preserved for reports
    } else throw new HttpError(409, `Cannot change status from ${cur} to ${target}`);
    await U.audit(req.user, 'event-' + target.toLowerCase(), ev.id, D.str(req.body.reason,500));
    res.json({ event: ev });
  }));

  api.post('/events/:id/register', A.requireRole('student'), wrap(async (req, res) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ev = await Event.findById(req.params.id); if (!ev) throw new HttpError(404, 'Event not found');
      if (ev.status !== 'Approved') throw new HttpError(409, 'Event is not open for registration');
      if (ev.start <= new Date()) throw new HttpError(409, 'Event has already started');
      if (D.activeReg(ev, req.user._id)) throw new HttpError(409, 'You are already registered for this event');
      const status = D.seatsTaken(ev) < ev.capacity ? 'registered' : 'waitlisted';
      const reg = { student: req.user._id, status, ticketCode: ticketCode(), registeredAt: new Date() };
      // optimistic concurrency: only succeeds if nobody changed the document since we read it
      const r = await Event.updateOne({ _id: ev._id, __v: ev.__v, registrations: { $not: { $elemMatch: { student: req.user._id, status: { $ne: 'cancelled' } } } } }, { $push: { registrations: reg }, $inc: { __v: 1 } });
      if (r.modifiedCount !== 1) continue;
      await notify(req.user._id, status === 'registered' ? `You are registered for "${ev.title}" (${fmt(ev.start)}). Ticket: ${reg.ticketCode}` : `"${ev.title}" is full – you joined the waitlist.`);
      return res.status(201).json({ registration: { status, ticketCode: reg.ticketCode, registeredAt: reg.registeredAt } });
    }
    throw new HttpError(409, 'Registration is busy, please try again');
  }));

  api.delete('/events/:id/register', A.requireRole('student'), wrap(async (req, res) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ev = await Event.findById(req.params.id); if (!ev) throw new HttpError(404, 'Event not found');
      const idx = ev.registrations.findLastIndex((r) => String(r.student) === String(req.user._id) && r.status !== 'cancelled');
      if (idx < 0) throw new HttpError(404, 'You have no active registration for this event');
      const mine = ev.registrations[idx];
      if (mine.status === 'checked-in' || mine.status === 'no-show') throw new HttpError(409, `A ${mine.status} registration cannot be cancelled`);
      if (ev.start <= new Date()) throw new HttpError(409, 'Event has already started');
      const set = { [`registrations.${idx}.status`]: 'cancelled' }; let promoted = null;
      if (mine.status === 'registered') {
        const j = ev.registrations.findIndex((r) => r.status === 'waitlisted'); // array order == registration order
        if (j >= 0 && ev.status === 'Approved') { set[`registrations.${j}.status`] = 'registered'; promoted = ev.registrations[j]; }
      }
      const r = await Event.updateOne({ _id: ev._id, __v: ev.__v }, { $set: set, $inc: { __v: 1 } });
      if (r.modifiedCount !== 1) continue;
      await notify(req.user._id, `Your registration for "${ev.title}" was cancelled.`);
      if (promoted) await notify(promoted.student, `Good news! A seat opened up for "${ev.title}" – you are now registered. Ticket: ${promoted.ticketCode}`);
      return res.json({ ok: true, promoted: promoted ? String(promoted.student) : null });
    }
    throw new HttpError(409, 'Please try again');
  }));

  api.get('/events/:id/ticket', A.requireRole('student'), wrap(async (req, res) => {
    const ev = await populateEv(Event.findById(req.params.id)); if (!ev) throw new HttpError(404, 'Event not found');
    const reg = D.activeReg(ev, req.user._id) || D.lastReg(ev, req.user._id);
    if (!reg) throw new HttpError(404, 'You have no ticket for this event');
    const valid = ['registered', 'checked-in'].includes(reg.status);
    const qr = valid ? await QRCode.toDataURL(reg.ticketCode, { width: 280, margin: 2, color: { dark: '#4c1d95', light: '#ffffff' } }) : null;
    res.json({ ticket: { ticketCode: reg.ticketCode, status: reg.status, checkedInAt: reg.checkedInAt, qr, event: { _id: ev._id, title: ev.title, start: ev.start, end: ev.end, venue: ev.venue } } });
  }));

  api.get('/events/:id/attendees', A.requireRole('organizer', 'admin'), wrap(async (req, res) => {
    const ev = await Event.findById(req.params.id).populate('registrations.student', 'name email phone'); if (!ev) throw new HttpError(404, 'Event not found');
    if (!canManage(req.user, ev)) throw new HttpError(403, 'You can only view attendees of your own events');
    res.json({ event: { _id: ev._id, title: ev.title, status: ev.status, start: ev.start, end: ev.end, capacity: ev.capacity },
      total: ev.registrations.length, attendees: ev.registrations.slice(U.page(req.query).skip, U.page(req.query).skip + U.page(req.query).limit).map((r) => ({ student: r.student, status: r.status, ticketCode: r.ticketCode, registeredAt: r.registeredAt, checkedInAt: r.checkedInAt })) });
  }));

  api.post('/events/:id/checkin', A.requireRole('organizer', 'admin'), wrap(async (req, res) => {
    const ev = await Event.findById(req.params.id); if (!ev) throw new HttpError(404, 'Event not found');
    if (!canManage(req.user, ev)) throw new HttpError(403, 'You can only check in attendees for your own events');
    const code = D.str((req.body || {}).ticketCode, 40).toUpperCase();
    if (!code) throw new HttpError(400, 'Ticket code is required');
    if (ev.status !== 'Approved') throw new HttpError(409, 'Check-in is only available for approved events');
    const now = new Date();
    if (now < new Date(ev.start.getTime() - D.HOUR)) throw new HttpError(409, `Check-in opens one hour before the event (${fmt(new Date(ev.start.getTime() - D.HOUR))})`);
    if (now >= ev.end) throw new HttpError(409, 'Check-in closed when the event ended');
    const reg = ev.registrations.find((r) => r.ticketCode === code);
    if (!reg) throw new HttpError(404, 'Invalid ticket code for this event');
    if (reg.status === 'checked-in') throw new HttpError(409, 'This ticket has already been checked in');
    if (reg.status !== 'registered') throw new HttpError(409, `Ticket is ${reg.status} and cannot be checked in`);
    const r = await Event.updateOne({ _id: ev._id, status: 'Approved', __v: ev.__v, registrations: { $elemMatch: { ticketCode: code, status: 'registered' } } }, { $set: { 'registrations.$.status': 'checked-in', 'registrations.$.checkedInAt': now, 'registrations.$.checkedInBy': req.user._id }, $inc: { __v: 1 } });
    if (r.modifiedCount !== 1) throw new HttpError(409, 'This ticket has already been checked in');
    const student = await User.findById(reg.student, 'name email');
    await notify(reg.student, `You are checked in to "${ev.title}". Enjoy the event!`);
    res.json({ ok: true, checkedInAt: now, student });
  }));

  // ---------------- Feedback ----------------
  api.get('/events/:id/feedback', A.requireAuth, wrap(async (req, res) => {
    const ev = await Event.findById(req.params.id); if (!ev) throw new HttpError(404, 'Event not found');
    if (req.user.role === 'student') return res.json({ feedback: await Feedback.findOne({ event: ev._id, student: req.user._id }) });
    if (!canManage(req.user, ev)) throw new HttpError(403, 'You can only view feedback for your own events');
    const items = await Feedback.find({ event: ev._id }).populate('student', 'name').sort({ createdAt: -1 });
    const avg = items.length ? Math.round((items.reduce((s, f) => s + f.rating, 0) / items.length) * 100) / 100 : null;
    res.json({ feedback: items, averageRating: avg, count: items.length });
  }));
  api.put('/events/:id/feedback', A.requireRole('student'), wrap(async (req, res) => {
    const ev = await Event.findById(req.params.id); if (!ev) throw new HttpError(404, 'Event not found');
    const rating = Number((req.body || {}).rating); const comment = D.str((req.body || {}).comment, 5000);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Rating must be a whole number from 1 to 5');
    if (comment.length > 1000) throw new HttpError(400, 'Comment cannot exceed 1000 characters');
    const reg = ev.registrations.find((r) => String(r.student) === String(req.user._id) && r.status === 'checked-in');
    if (!reg) throw new HttpError(403, 'Only students who checked in can leave feedback');
    if (!['Approved', 'Completed'].includes(ev.status)) throw new HttpError(409, 'Feedback is not available for this event');
    if (ev.end > new Date()) throw new HttpError(409, 'Feedback opens after the event has ended');
    const fb = await Feedback.findOneAndUpdate({ event: ev._id, student: req.user._id }, { $set: { rating, comment } }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
    res.json({ feedback: fb });
  }));
  api.delete('/events/:id/feedback', A.requireRole('student'), wrap(async (req, res) => {
    const r = await Feedback.deleteOne({ event: req.params.id, student: req.user._id });
    if (!r.deletedCount) throw new HttpError(404, 'No feedback to delete');
    res.json({ ok: true });
  }));

  // ---------------- Notifications ----------------
  api.get('/notifications', A.requireAuth, wrap(async (req, res) => {
    try { await U.flushAnnouncements(); } catch { console.error('Announcement retry deferred'); }
    const p = U.page(req.query); const q = { user: req.user._id, deleted: { $ne: true } };
    const notifications = await Notification.find(q).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit);
    res.json({ notifications, total: await Notification.countDocuments(q), unread: await Notification.countDocuments({ ...q, read: false }) });
  }));
  api.patch('/notifications/:id', A.requireAuth, wrap(async (req, res) => {
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { read: (req.body || {}).read !== false }, { new: true });
    if (!n) throw new HttpError(404, 'Notification not found'); res.json({ notification: n });
  }));
  api.delete('/notifications/:id', A.requireAuth, wrap(async (req, res) => {
    const r = await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { $set: { deleted: true, read: true } });
    if (!r.matchedCount) throw new HttpError(404, 'Notification not found'); res.json({ ok: true });
  }));

  // ---------------- Suggestions ----------------
  api.get('/suggestions', A.requireAuth, wrap(async (req, res) => {
    const q = req.user.role === 'admin' ? {} : { user: req.user._id };
    res.json({ suggestions: await Suggestion.find(q).populate('user', 'name role').sort({ createdAt: -1 }).limit(300) });
  }));
  api.post('/suggestions', A.requireAuth, wrap(async (req, res) => {
    const text = D.str((req.body || {}).text, 5000);
    if (text.length < 5 || text.length > 2000) throw new HttpError(400, 'Suggestion must be 5 to 2000 characters');
    res.status(201).json({ suggestion: await Suggestion.create({ user: req.user._id, text }) });
  }));
  api.patch('/suggestions/:id', A.requireRole('admin'), wrap(async (req, res) => {
    const status = (req.body || {}).status;
    if (!D.SUGGESTION_STATUS.includes(status)) throw new HttpError(400, 'Status must be one of: ' + D.SUGGESTION_STATUS.join(', '));
    const s = await Suggestion.findByIdAndUpdate(req.params.id, { status }, { new: true }); if (!s) throw new HttpError(404, 'Suggestion not found');
    await notify(s.user, `Your suggestion is now "${status}".`); res.json({ suggestion: s });
  }));

  // ---------------- Reports ----------------
  api.get('/reports', A.requireRole('admin', 'organizer'), wrap(async (req, res) => {
    const report = await D.buildReport(M, req.user);
    if (req.query.format === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="campus-report.csv"' });
      return res.send('\uFEFF' + D.reportToCsv(report));
    }
    res.json(report);
  }));

  api.use((_req, _res, next) => next(new HttpError(404, 'API route not found')));
  app.use('/api', api);

  app.use((err, req, res, _next) => {
    let status = err.status || 500; let message = err.message; let details = err.details;
    if (err.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON body'; }
    else if (err.type === 'entity.too.large') { status = 413; message = 'Request body too large'; }
    else if (err.name === 'ValidationError') { status = 400; details = Object.values(err.errors).map((e) => e.message); message = details.join('; '); }
    else if (err.name === 'CastError') { status = 400; message = 'Invalid value for ' + err.path; }
    else if (err.code === 11000) { status = 409; message = 'Duplicate value conflict'; }
    else if (status === 500) { console.error(err); message = 'Internal server error'; }
    res.status(status).json({ error: message, ...(details ? { details } : {}) });
  });
  return app;
}
module.exports = { createApp };

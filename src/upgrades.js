'use strict';
const crypto = require('crypto');
const mongoose = require('mongoose');
const M = require('./models');
const A = require('./auth');
const D = require('./domain');
const { HttpError } = D;
const hash = t => crypto.createHash('sha256').update(t).digest('hex');
const page = q => ({ skip: (Math.max(1, Number(q.page) || 1) - 1) * Math.min(100, Math.max(1, Number(q.limit) || 20)), limit: Math.min(100, Math.max(1, Number(q.limit) || 20)) });
const audit = (user, action, target, reason = '', changes = {}) => M.Audit.create({ actor: user?._id, action, target: String(target), reason, changes });
// Standalone MongoDB compatible, cross-process serialization. No lease expiry:
// a dead owner fails closed, rather than allowing a stale writer to overlap a new writer.
async function locked(fn) {
  const owner = crypto.randomUUID(); const deadline = Date.now() + 15000;
  while (true) {
    try { await M.WriteLock.create({ _id: 'mutations', owner, acquiredAt: new Date() }); break; }
    catch (e) { if (e.code !== 11000) throw e; if (Date.now() > deadline) throw new HttpError(503, 'Database write is busy. If the server previously crashed, follow lock recovery in README.'); await new Promise(r => setTimeout(r, 35)); }
  }
  try { return await fn(); } finally { await M.WriteLock.deleteOne({ _id: 'mutations', owner }); }
}
async function nextOrgNumber() {
  const year = new Date().getUTCFullYear();
  for (;;) {
    const c = await M.Counter.findOneAndUpdate({ _id: `organizer-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
    const number = `ORG-${year}-${String(c.seq).padStart(6, '0')}`;
    if (!await M.User.exists({ organizationNumber: number })) return number;
  }
}
async function issueReset(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await M.User.updateOne({ _id: user._id }, { $set: { resetHash: hash(token), resetExpiresAt: new Date(Date.now() + 900000) } });
  const link = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/#reset=${token}`;
  const mode = process.env.PASSWORD_DELIVERY || 'console';
  if (mode === 'console' && process.env.NODE_ENV !== 'production') console.log(`[LOCAL PASSWORD SETUP] ${user.email}: ${link}`);
  else if (mode === 'smtp') {
    const transport = require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}) });
    await transport.sendMail({ from: process.env.SMTP_FROM, to: user.email, subject: 'Campus Connect password setup', text: `Set your password within 15 minutes: ${link}\nIf you did not request this, ignore this message.` });
  } else throw new Error('Configure PASSWORD_DELIVERY; console mode is development-only');
}
async function flushAnnouncements() {
  for (const ev of await M.Event.find({ announcementPending: true }).limit(30)) {
    const venue = await M.Venue.findById(ev.venue);
    const cursor = M.User.find({ role: 'student', active: true, createdAt: { $lte: ev.firstApprovedAt } }).select('_id').cursor();
    let batch = [];
    const send = async () => { if (batch.length) await M.Notification.bulkWrite(batch, { ordered: false }); batch = []; };
    for await (const u of cursor) {
      batch.push({ updateOne: { filter: { user: u._id, dedupeKey: `approved:${ev.id}` }, update: { $setOnInsert: { user: u._id, event: ev._id, dedupeKey: `approved:${ev.id}`, message: `New event approved: ${ev.title}. ${ev.start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · ${venue?.name || 'Venue to be confirmed'}. Open details for availability.`, read: false, createdAt: new Date() } }, upsert: true } });
      if (batch.length === 100) await send();
    }
    await send(); await M.Event.updateOne({ _id: ev._id }, { $set: { announcementPending: false } });
  }
}
async function markAttention(user) {
  await M.Event.updateMany({ organizer: user._id, status: { $in: ['Pending', 'Approved'] }, end: { $gt: new Date() }, needsAttention: { $ne: !user.active || user.role !== 'organizer' || !user.verified } }, { $set: { needsAttention: !user.active || user.role !== 'organizer' || !user.verified }, $inc: { __v: 1 } });
}
function install(api, wrap, { shape, populateEv, ratingsFor }) {
  const admin = A.requireRole('admin');
  const resetLimit = A.rateLimiter({ windowMs: 900000, max: 20, keyFn: r => r.ip });
  api.post('/auth/forgot-password', resetLimit, wrap(async (req, res) => {
    const email = D.str(req.body?.email, 200).toLowerCase();
    const u = await M.User.findOne({ email });
    if (u) { try { await issueReset(u); } catch { console.error('Password delivery failed. Check server mail configuration.'); } }
    res.json({ message: 'If the account exists, password instructions are available through the configured delivery method. In the local demo, check the backend terminal.' });
  }));
  api.post('/auth/reset-password', resetLimit, wrap(async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, 'Invalid or expired reset link');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new HttpError(400, 'Password must contain 8 to 200 characters');
    const u = await M.User.findOneAndUpdate({ resetHash: hash(token), resetExpiresAt: { $gt: new Date() } }, { $set: { passwordHash: await A.hashPassword(password) }, $unset: { resetHash: '', resetExpiresAt: '' }, $inc: { authVersion: 1 } }, { new: true });
    if (!u) throw new HttpError(400, 'Invalid or expired reset link');
    await M.Session.deleteMany({ user: u._id }); await audit(u, 'password-reset', u.id);
    res.json({ ok: true });
  }));
  api.get('/users/:id/impact', admin, wrap(async (req, res) => {
    res.json({ events: await M.Event.find({ organizer: req.params.id, status: { $in: ['Pending', 'Approved'] }, end: { $gt: new Date() } }).select('title start end status') });
  }));
  api.post('/users', admin, wrap(async (req, res) => {
    const b = req.body || {}; for (const k of ['active','verified']) if (b[k] !== undefined && typeof b[k] !== 'boolean') throw new HttpError(400, `${k} must be a boolean`); if (!['admin', 'organizer', 'student'].includes(b.role)) throw new HttpError(400, 'Invalid role');
    if (b.role === 'admin' && !await A.verifyPassword(String(b.currentPassword || ''), req.user.passwordHash)) throw new HttpError(403, 'Confirm your current password to grant Admin access');
    const f = D.validateRegistration({ ...b, role: b.role === 'admin' ? 'student' : b.role, password: crypto.randomBytes(32).toString('hex') });
    const u = await M.User.create({ ...f, role: b.role, passwordHash: await A.hashPassword(f.password), active: b.active !== false, verified: b.role !== 'organizer' || b.verified === true, ...(b.role === 'organizer' ? { organizationNumber: await nextOrgNumber() } : {}) });
    await audit(req.user, 'create-user', u.id, D.str(b.reason, 500), { role: u.role });
    let delivery = true; try { await issueReset(u); } catch { delivery = false; }
    res.status(201).json({ user: u, delivery, message: delivery ? 'Account created. Password setup sent through configured delivery.' : 'Account created, but delivery failed. Fix mail configuration and request password setup again.' });
  }));
  api.patch('/users/:id', admin, wrap(async (req, res) => {
    const u = await M.User.findById(req.params.id); if (!u) throw new HttpError(404, 'User not found');
    const b = req.body || {}; const reason = D.str(b.reason, 500);
    const old = { role: u.role, active: u.active, verified: u.verified };
    if (!reason) throw new HttpError(400, 'A reason is required for administrative changes');
    if (b.role !== undefined && !['student', 'organizer', 'admin'].includes(b.role)) throw new HttpError(400, 'Invalid role');
    for (const k of ['active', 'verified']) if (b[k] !== undefined && typeof b[k] !== 'boolean') throw new HttpError(400, `${k} must be a boolean`);
    if (String(u._id) === String(req.user._id) && (b.active === false || (b.role && b.role !== 'admin'))) throw new HttpError(409, 'You cannot deactivate or demote your own Admin account');
    if (u.role === 'admin' && u.active && (b.active === false || (b.role && b.role !== 'admin')) && await M.User.countDocuments({ role: 'admin', active: true }) <= 1) throw new HttpError(409, 'The last active Admin must be retained');
    if (b.role === 'admin' && u.role !== 'admin' && !await A.verifyPassword(String(b.currentPassword || ''), req.user.passwordHash)) throw new HttpError(403, 'Confirm your current password to grant Admin access');
    if (b.name !== undefined) u.name = D.str(b.name, 100);
    if (b.phone !== undefined) { const phone = D.normalizePhone(b.phone); if (!phone) throw new HttpError(400, 'Invalid phone'); u.phone = phone; }
    if (b.role !== undefined) { if (b.role !== u.role) u.verified = b.role !== 'organizer'; u.role = b.role; }
    if (b.active !== undefined) u.active = b.active;
    if (b.verified !== undefined) { if (u.role !== 'organizer') throw new HttpError(400, 'Verification is only for Organizers'); u.verified = b.verified; }
    if (u.role === 'organizer' && !u.organizationNumber) u.organizationNumber = await nextOrgNumber();
    const invalidate = old.role !== u.role || old.active !== u.active;
    if (invalidate) u.authVersion = (u.authVersion || 0) + 1;
    await u.save(); if (invalidate) await M.Session.deleteMany({ user: u._id });
    await markAttention(u);
    await M.Notification.create({ user: u._id, message: `Admin updated your account: role ${u.role}, ${u.active ? 'active' : 'deactivated'}, ${u.verified ? 'verified' : 'unverified'}. Reason: ${reason.slice(0,250)}` });
    await audit(req.user, 'update-user', u.id, reason, { before: old, after: { role: u.role, active: u.active, verified: u.verified } });
    res.json({ user: u });
  }));
  api.post('/users/:id/password-setup', admin, wrap(async (req, res) => {
    const u = await M.User.findById(req.params.id); if (!u) throw new HttpError(404, 'User not found');
    await issueReset(u); await audit(req.user, 'password-setup-request', u.id); res.json({ ok: true });
  }));
  api.patch('/events/:id/reassign', admin, wrap(async (req, res) => {
    const reason = D.str(req.body?.reason, 500); if (!reason) throw new HttpError(400, 'Reason is required');
    const u = await M.User.findOne({ _id: req.body.organizer, role: 'organizer', active: true, verified: true });
    if (!u) throw new HttpError(400, 'Choose an active, verified Organizer');
    const ev = await M.Event.findById(req.params.id); if (!ev) throw new HttpError(404, 'Event not found');
    const old = ev.organizer; ev.originalCreator ||= old; ev.organizer = u._id; ev.needsAttention = false; await ev.save();
    const recipients = [...new Set([String(old), u.id, ...ev.registrations.filter(r => ['registered', 'waitlisted', 'checked-in'].includes(r.status)).map(r => String(r.student))])];
    await M.Notification.insertMany(recipients.map(user => ({ user, event: ev._id, message: `${ev.title} is now managed by ${u.name}. Event time and tickets are unchanged.` })));
    await audit(req.user, 'reassign-event', ev.id, reason, { from: String(old), to: u.id }); res.json({ ok: true });
  }));
  api.get('/venues/:id/availability', A.requireRole('admin', 'organizer'), wrap(async (req, res) => {
    const v = await M.Venue.findById(req.params.id); if (!v) throw new HttpError(404, 'Venue not found');
    const start = new Date(req.query.start), end = new Date(req.query.end);
    if (isNaN(start) || isNaN(end) || end <= start) throw new HttpError(400, 'Select a valid start and end time');
    const q = { venue: v._id, status: { $in: ['Pending', 'Approved'] }, start: { $lt: end }, end: { $gt: start } };
    if (req.query.exclude) { if (!mongoose.isValidObjectId(req.query.exclude)) throw new HttpError(400, 'Invalid event'); q._id = { $ne: req.query.exclude }; }
    const conflicts = await M.Event.find(q).sort({ start: 1 });
    res.json({ venue: v, available: v.active && conflicts.length === 0, conflicts: conflicts.map(e => ({ start: e.start, end: e.end, title: req.user.role === 'admin' || String(e.organizer) === req.user.id || e.status === 'Approved' ? e.title : 'Reserved slot', _id: req.user.role === 'admin' || String(e.organizer) === req.user.id || e.status === 'Approved' ? e.id : undefined })) });
  }));
  api.get('/calendar', A.requireAuth, wrap(async (req, res) => {
    const start = new Date(req.query.start), end = new Date(req.query.end);
    if (isNaN(start) || isNaN(end) || end <= start || end - start > 93 * 86400000) throw new HttpError(400, 'Calendar range must be between 1 and 93 days');
    const u = req.user; const and = [{ start: { $lt: end }, end: { $gt: start } }];
    if (u.role === 'student') and.push({ registrations: { $elemMatch: { student: u._id, status: { $in: req.query.history === '1' ? D.REG_STATUS : ['registered', 'waitlisted', 'checked-in'] } } } });
    if (u.role === 'organizer') and.push(req.query.scope === 'mine' ? { organizer: u._id } : req.query.scope === 'others' ? { organizer: { $ne: u._id }, status: 'Approved' } : { $or: [{ organizer: u._id }, { status: 'Approved' }] });
    if (u.role === 'admin' && req.query.history !== '1') and.push({ status: { $ne: 'Archived' } });
    if (D.CATEGORIES.includes(req.query.category)) and.push({ category: req.query.category });
    if (D.EVENT_STATUS.includes(req.query.status)) and.push({ status: req.query.status });
    const events = await populateEv(M.Event.find({ $and: and }).sort({ start: 1 }));
    const ratings = await ratingsFor(events.map(e => e._id));
    res.json({ events: events.map(e => shape(e, u, ratings)) });
  }));
  api.get('/events/:id/details', A.requireAuth, wrap(async (req, res) => {
    const e = await populateEv(M.Event.findById(req.params.id)); if (!e) throw new HttpError(404, 'Event not found');
    const u = req.user; const allowed = u.role === 'admin' || e.status === 'Approved' || (u.role === 'organizer' && String(e.organizer._id) === u.id) || (u.role === 'student' && e.registrations.some(r => String(r.student) === u.id));
    if (!allowed) throw new HttpError(403, 'Event is private');
    res.json({ event: shape(e, u, await ratingsFor([e._id])) });
  }));
  api.patch('/notifications/read-all', A.requireAuth, wrap(async (req, res) => { await M.Notification.updateMany({ user: req.user._id }, { $set: { read: true } }); res.json({ ok: true }); }));
  api.get('/audit', admin, wrap(async (req, res) => { const p = page(req.query); res.json({ logs: await M.Audit.find().populate('actor', 'name').sort({ createdAt: -1 }).skip(p.skip).limit(p.limit), total: await M.Audit.countDocuments() }); }));
  api.get('/admin/health', admin, wrap(async (_req, res) => res.json({ db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', pendingAnnouncements: await M.Event.countDocuments({ announcementPending: true }), attention: await M.Event.countDocuments({ needsAttention: true }), uptimeSeconds: Math.floor(process.uptime()) })));
}
module.exports = { install, locked, nextOrgNumber, issueReset, flushAnnouncements, markAttention, audit, page };

'use strict';
// Pure business rules, validation helpers and MongoDB aggregation pipelines.

const CATEGORIES = ['Academic', 'Cultural', 'Sports', 'Social', 'Workshop', 'Seminar'];
const EVENT_STATUS = ['Pending', 'Approved', 'Rejected', 'Completed', 'Cancelled', 'Archived'];
const REG_STATUS = ['registered', 'waitlisted', 'checked-in', 'cancelled', 'no-show'];
const SEAT_STATUSES = ['registered', 'checked-in', 'no-show']; // statuses that occupy a seat
const SUGGESTION_STATUS = ['Submitted', 'In progress', 'Implemented'];
const BUDGET_THRESHOLD = 10000;
const HOUR = 3600000;

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const fail = (errors) => { throw new HttpError(400, errors.join('; '), errors); };

const str = (v, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizePhone(p) {
  const s = String(p == null ? '' : p).trim();
  if (!/^\+?[\d\s\-().]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return (s.startsWith('+') ? '+' : '') + digits;
}

function parseInterests(v) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return [...new Set(arr.map((x) => str(String(x), 40)).filter(Boolean))].slice(0, 10);
}

function validateRegistration(b) {
  const errors = [];
  const name = str(b.name, 100);
  const email = str(b.email, 200).toLowerCase();
  const phone = normalizePhone(b.phone);
  const password = typeof b.password === 'string' ? b.password : '';
  const role = str(b.role, 20).toLowerCase();
  const organizationNumber = str(b.organizationNumber, 50);
  if (name.length < 2) errors.push('Full name must be at least 2 characters');
  if (!EMAIL_RE.test(email)) errors.push('A valid email is required');
  if (!phone) errors.push('Phone number must contain 10 to 15 digits');
  if (password.length < 8) errors.push('Password must contain at least 8 characters');
  if (password.length > 200) errors.push('Password is too long');
  if (!['student', 'organizer'].includes(role)) errors.push('Role must be Student or Organizer');
  if (role === 'organizer' && organizationNumber.length < 3) errors.push('Organization registration number is required for organizers');
  if (errors.length) fail(errors);
  return { name, email, phone, password, role, organizationNumber: role === 'organizer' ? organizationNumber : '', interests: parseInterests(b.interests) };
}

function validateEvent(b, venue, now = new Date()) {
  const errors = [];
  const title = str(b.title, 300);
  const description = str(b.description, 5000);
  const category = str(b.category, 30);
  const start = new Date(b.start);
  const end = new Date(b.end);
  const capacity = Number(b.capacity);
  const budget = b.budget === undefined || b.budget === null || b.budget === '' ? 0 : Number(b.budget);
  const budgetNotes = str(b.budgetNotes, 2000);
  if (title.length < 2 || title.length > 200) errors.push('Title must be 2 to 200 characters');
  if (description.length < 50) errors.push('Description must be at least 50 characters');
  if (!CATEGORIES.includes(category)) errors.push('Category must be one of: ' + CATEGORIES.join(', '));
  if (isNaN(start) || isNaN(end)) errors.push('Valid start and end date/time are required');
  else {
    if (start <= now) errors.push('Start time must be in the future');
    if (end <= start) errors.push('End time must be after start time');
    else if (end - start < HOUR) errors.push('Event must last at least one hour');
  }
  if (!Number.isInteger(capacity) || capacity <= 0) errors.push('Capacity must be a positive integer');
  else if (venue && capacity > venue.capacity) errors.push(`Capacity cannot exceed venue capacity (${venue.capacity})`);
  if (!Number.isFinite(budget) || budget < 0) errors.push('Budget cannot be negative');
  else if (budget > BUDGET_THRESHOLD && budgetNotes.length < 10) errors.push(`Budget breakdown is required for budgets above ₹${BUDGET_THRESHOLD.toLocaleString('en-IN')}`);
  if (errors.length) fail(errors);
  return { title, titleKey: title.toLowerCase(), description, category, start, end, capacity, budget, budgetNotes, dateKey: start.toISOString().slice(0, 10) };
}

const activeReg = (ev, studentId) => ev.registrations.find((r) => String(r.student) === String(studentId) && r.status !== 'cancelled');
const lastReg = (ev, studentId) => [...ev.registrations].reverse().find((r) => String(r.student) === String(studentId));
const seatsTaken = (ev) => ev.registrations.filter((r) => SEAT_STATUSES.includes(r.status)).length;

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // CSV formula-injection guard
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

// ---------- Aggregation pipelines ----------
const countOf = (status) => ({ $size: { $filter: { input: '$registrations', as: 'r', cond: { $eq: ['$$r.status', status] } } } });
const perEventCounts = {
  $project: {
    title: 1, category: 1, status: 1, start: 1, end: 1, venue: 1, capacity: 1,
    registered: countOf('registered'), checkedIn: countOf('checked-in'), waitlisted: countOf('waitlisted'),
    cancelled: countOf('cancelled'), noShow: countOf('no-show'),
  },
};
const sumGroup = {
  $group: {
    _id: null, events: { $sum: 1 }, registered: { $sum: '$registered' }, checkedIn: { $sum: '$checkedIn' },
    waitlisted: { $sum: '$waitlisted' }, cancelled: { $sum: '$cancelled' }, noShow: { $sum: '$noShow' },
  },
};
const rate = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

async function buildReport({ Event, Feedback }, user) {
  const scope = user.role === 'organizer' ? { organizer: user._id } : {};
  const now = new Date();
  const match = { $match: scope };
  const [totals, endedTotals, eventWise, rating] = await Promise.all([
    Event.aggregate([match, perEventCounts, sumGroup]),
    Event.aggregate([{ $match: { ...scope, end: { $lt: now }, status: { $in: ['Approved', 'Completed', 'Archived'] } } }, perEventCounts, sumGroup]),
    Event.aggregate([
      match, perEventCounts,
      { $lookup: { from: 'feedbacks', localField: '_id', foreignField: 'event', as: 'fb' } },
      { $project: { title: 1, category: 1, status: 1, start: 1, capacity: 1, registered: 1, checkedIn: 1, waitlisted: 1, cancelled: 1, noShow: 1,
          feedbackCount: { $size: '$fb' }, avgRating: { $round: [{ $avg: '$fb.rating' }, 2] } } },
      { $sort: { start: -1 } },
    ]),
    Feedback.aggregate([
      { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'ev' } },
      { $unwind: '$ev' },
      { $match: user.role === 'organizer' ? { 'ev.organizer': user._id } : {} },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
  ]);
  const t = totals[0] || { events: 0, registered: 0, checkedIn: 0, waitlisted: 0, cancelled: 0, noShow: 0 };
  const e = endedTotals[0] || { registered: 0, checkedIn: 0, noShow: 0 };
  const endedConfirmed = e.registered + e.checkedIn + e.noShow;
  const summary = {
    totalRegistrations: t.registered + t.checkedIn + t.noShow, // confirmed seats
    attendanceCount: t.checkedIn, waitlistCount: t.waitlisted, cancellationCount: t.cancelled, noShowCount: t.noShow,
    attendanceRate: rate(e.checkedIn, endedConfirmed),
    noShowRate: rate(e.noShow, endedConfirmed),
    averageRating: rating[0] ? Math.round(rating[0].avg * 100) / 100 : null,
    feedbackCount: rating[0] ? rating[0].count : 0,
  };
  const report = { role: user.role, generatedAt: now, summary, eventWise };
  if (user.role === 'admin') {
    const [statusCounts, byCategory, venueUsage, topOrganizers] = await Promise.all([
      Event.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Event.aggregate([{ $group: { _id: '$category', events: { $sum: 1 }, capacity: { $sum: '$capacity' } } }, { $sort: { events: -1 } }]),
      Event.aggregate([
        { $match: { status: { $in: ['Pending', 'Approved', 'Completed'] } } },
        { $group: { _id: '$venue', events: { $sum: 1 }, hoursBooked: { $sum: { $divide: [{ $subtract: ['$end', '$start'] }, HOUR] } } } },
        { $lookup: { from: 'venues', localField: '_id', foreignField: '_id', as: 'venue' } },
        { $unwind: '$venue' },
        { $project: { _id: 0, venue: '$venue.name', capacity: '$venue.capacity', events: 1, hoursBooked: { $round: ['$hoursBooked', 1] } } },
        { $sort: { events: -1 } },
      ]),
      Event.aggregate([
        { $group: { _id: '$organizer', events: { $sum: 1 }, approved: { $sum: { $cond: [{ $in: ['$status', ['Approved', 'Completed']] }, 1, 0] } } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
        { $unwind: '$u' },
        { $project: { _id: 0, organizer: '$u.name', events: 1, approved: 1 } },
        { $sort: { events: -1 } },
      ]),
    ]);
    const sc = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
    report.events = { total: t.events, approved: sc.Approved || 0, pending: sc.Pending || 0, cancelled: sc.Cancelled || 0, completed: sc.Completed || 0, rejected: sc.Rejected || 0 };
    report.byCategory = byCategory.map((c) => ({ category: c._id, events: c.events, capacity: c.capacity }));
    report.venueUsage = venueUsage;
    report.organizers = topOrganizers;
  }
  return report;
}

function reportToCsv(r) {
  const rows = [['Event', 'Category', 'Status', 'Start', 'Capacity', 'Registered', 'Checked-in', 'Waitlisted', 'Cancelled', 'No-show', 'Avg rating', 'Feedback count']];
  r.eventWise.forEach((e) => rows.push([e.title, e.category, e.status, new Date(e.start).toISOString(), e.capacity, e.registered, e.checkedIn, e.waitlisted, e.cancelled, e.noShow, e.avgRating ?? '', e.feedbackCount]));
  rows.push([], ['Summary']);
  Object.entries(r.summary).forEach(([k, v]) => rows.push([k, v]));
  return toCsv(rows);
}

module.exports = {
  CATEGORIES, EVENT_STATUS, REG_STATUS, SEAT_STATUSES, SUGGESTION_STATUS, BUDGET_THRESHOLD, HOUR, HttpError,
  str, EMAIL_RE, normalizePhone, parseInterests, validateRegistration, validateEvent,
  activeReg, lastReg, seatsTaken, csvCell, toCsv, buildReport, reportToCsv,
};

'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { CATEGORIES, EVENT_STATUS, REG_STATUS, SUGGESTION_STATUS } = require('./domain');

const ref = (model, extra = {}) => ({ type: Schema.Types.ObjectId, ref: model, required: true, ...extra });
const isInt = { validator: Number.isInteger, message: '{PATH} must be an integer' };

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ },
  passwordHash: { type: String, required: true },
  phone: { type: String, required: true, match: /^\+?\d{10,15}$/ },
  role: { type: String, enum: ['admin', 'organizer', 'student'], required: true },
  interests: [{ type: String, trim: true, maxlength: 40 }],
  organizationNumber: { type: String, trim: true, default: undefined },
  authVersion: { type: Number, default: 0 },
  resetHash: String, resetExpiresAt: Date,
  verified: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { timestamps: true, collection: 'users' });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ organizationNumber: 1 }, { unique: true, partialFilterExpression: { organizationNumber: { $type: 'string' } } });
userSchema.set('toJSON', { transform: (_d, ret) => { delete ret.passwordHash; delete ret.resetHash; delete ret.resetExpiresAt; delete ret.authVersion; delete ret.__v; return ret; } });

const venueSchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  location: { type: String, required: true, trim: true, maxlength: 200 },
  capacity: { type: Number, required: true, min: 1, validate: isInt },
  amenities: [{ type: String, trim: true, maxlength: 60 }],
  active: { type: Boolean, default: true },
}, { timestamps: true, collection: 'venues' });
venueSchema.index({ name: 1 }, { unique: true });

const registrationSchema = new Schema({
  student: ref('User'),
  status: { type: String, enum: REG_STATUS, required: true },
  ticketCode: { type: String, required: true },
  registeredAt: { type: Date, default: Date.now },
  checkedInAt: { type: Date, default: null },
  checkedInBy: ref('User', { required: false }),
});

const eventSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
  titleKey: { type: String, required: true },
  dateKey: { type: String, required: true },
  description: { type: String, required: true, minlength: 50, maxlength: 5000 },
  category: { type: String, enum: CATEGORIES, required: true },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  venue: ref('Venue'),
  organizer: ref('User'),
  originalCreator: ref('User', { required: false }),
  needsAttention: { type: Boolean, default: false },
  firstApprovedAt: Date, announcementPending: { type: Boolean, default: false },
  cancellationReason: { type: String, default: '' },
  capacity: { type: Number, required: true, min: 1, validate: isInt },
  budget: { type: Number, default: 0, min: 0 },
  budgetNotes: { type: String, default: '', maxlength: 2000 },
  status: { type: String, enum: EVENT_STATUS, default: 'Pending' },
  rejectionReason: { type: String, default: '' },
  registrations: [registrationSchema],
}, { timestamps: true, collection: 'events', optimisticConcurrency: true });
eventSchema.index({ organizer: 1, dateKey: 1, titleKey: 1 }, { unique: true });
eventSchema.index({ status: 1, start: 1 });
eventSchema.index({ 'registrations.student': 1 });
eventSchema.index({ venue: 1, start: 1, end: 1 });
// partial (not sparse): empty registrations arrays must not collide as a duplicate key
eventSchema.index({ 'registrations.ticketCode': 1 }, { unique: true, partialFilterExpression: { 'registrations.ticketCode': { $exists: true } } });

const feedbackSchema = new Schema({
  event: ref('Event'), student: ref('User'),
  rating: { type: Number, required: true, min: 1, max: 5, validate: isInt },
  comment: { type: String, default: '', maxlength: 1000, trim: true },
}, { timestamps: true, collection: 'feedbacks' });
feedbackSchema.index({ event: 1, student: 1 }, { unique: true });

const notificationSchema = new Schema({
  event: ref('Event', { required: false }), dedupeKey: String, deleted: { type: Boolean, default: false },
  user: ref('User'), message: { type: String, required: true, maxlength: 500 }, read: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'notifications' });
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });

const suggestionSchema = new Schema({
  user: ref('User'), text: { type: String, required: true, trim: true, minlength: 5, maxlength: 2000 },
  status: { type: String, enum: SUGGESTION_STATUS, default: 'Submitted' },
}, { timestamps: true, collection: 'suggestions' });

const sessionSchema = new Schema({
  authVersion: { type: Number, default: 0 },
  tokenHash: { type: String, required: true }, user: ref('User'), expiresAt: { type: Date, required: true },
}, { collection: 'sessions' });
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL

const m = (n, s) => mongoose.models[n] || mongoose.model(n, s);
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } }, { collection: 'counters' });
const lockSchema = new Schema({ _id: String, owner: String, acquiredAt: Date }, { collection: 'write_locks' });
const auditSchema = new Schema({ actor: ref('User', { required: false }), action: String, target: String, reason: String, changes: Schema.Types.Mixed }, { timestamps: { createdAt: true, updatedAt: false }, collection: 'audit_logs' });
auditSchema.index({ createdAt: -1 });
const models = {
  Counter: m('Counter', counterSchema), WriteLock: m('WriteLock', lockSchema), Audit: m('Audit', auditSchema),
  User: m('User', userSchema), Venue: m('Venue', venueSchema), Event: m('Event', eventSchema),
  Feedback: m('Feedback', feedbackSchema), Notification: m('Notification', notificationSchema),
  Suggestion: m('Suggestion', suggestionSchema), Session: m('Session', sessionSchema),
};
models.initAll = () => Promise.all(['User', 'Venue', 'Event', 'Feedback', 'Notification', 'Suggestion', 'Session', 'Counter', 'WriteLock', 'Audit'].map((k) => models[k].init()));
module.exports = models;

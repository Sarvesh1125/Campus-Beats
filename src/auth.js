'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const { User, Session } = require('./models');
const { HttpError } = require('./domain');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'sid';
const SESSION_MS = 7 * 24 * 3600 * 1000;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const derived = await scrypt(pw, Buffer.from(salt, 'hex'), 64);
  const expected = Buffer.from(key, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
}
let dummyHash;
async function burnTime(pw) { dummyHash = dummyHash || (await hashPassword('dummy-password')); await verifyPassword(pw, dummyHash); }

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((p) => p.trim()).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
}
const cookieStr = (value, maxAgeSec) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` + (process.env.NODE_ENV === 'production' ? '; Secure' : '');

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const current = await User.findById(userId);
  await Session.create({ authVersion: current.authVersion || 0, tokenHash: sha(token), user: userId, expiresAt: new Date(Date.now() + SESSION_MS) });
  res.setHeader('Set-Cookie', cookieStr(token, SESSION_MS / 1000));
}
async function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await Session.deleteOne({ tokenHash: sha(token) });
  res.setHeader('Set-Cookie', cookieStr('', 0));
}

async function loadUser(req, _res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const s = await Session.findOne({ tokenHash: sha(token), expiresAt: { $gt: new Date() } });
      const u = s && (await User.findById(s.user));
      if (u && u.active && (u.authVersion || 0) === (s.authVersion || 0)) req.user = u;
    }
    next();
  } catch (e) { next(e); }
}
const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Authentication required')));
const requireRole = (...roles) => (req, _res, next) =>
  !req.user ? next(new HttpError(401, 'Authentication required')) : roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have permission for this action'));

function rateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = keyFn(req); const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.count > max) return next(new HttpError(429, 'Too many attempts. Please try again later.'));
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}

// Rejects a second identical write request from the same user while the first is still running.
const inflight = new Set();
function duplicateGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.user) return next();
  const key = `${req.user.id}:${req.method}:${req.originalUrl}`;
  if (inflight.has(key)) return next(new HttpError(409, 'Duplicate request in progress'));
  inflight.add(key);
  res.on('finish', () => inflight.delete(key)); res.on('close', () => inflight.delete(key));
  next();
}

module.exports = { hashPassword, verifyPassword, burnTime, startSession, endSession, loadUser, requireAuth, requireRole, rateLimiter, duplicateGuard, COOKIE };

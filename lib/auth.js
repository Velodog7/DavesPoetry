/**
 * auth.js — the author's own account: a PIN he chooses, and sessions.
 *
 * A four-digit PIN on a page anyone can find is only safe if guessing is made
 * expensive, so three things happen here and none of them are optional:
 *
 *   1. The PIN is never stored. Only a scrypt hash of it, with a random salt.
 *   2. Wrong guesses are counted and the account locks — 15 minutes, then an
 *      hour, then four. Ten thousand guesses stop being a weekend's work.
 *   3. Signing in issues a session token, so the PIN itself travels once per
 *      device rather than on every request.
 *
 * Setting the PIN in the first place needs AUTHOR_TOKEN, the secret only the
 * site's owner has. Without that gate, the first stranger to find the page
 * would simply claim it.
 */
'use strict';

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 90;
const MAX_SESSIONS = 12;

/* Lockout ladder. Five wrong guesses buys a quarter of an hour; keep going and
   the wait grows. Index by how many times this account has already locked. */
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MINUTES = [15, 60, 240];

/* PINs that are the first thing anyone tries. Rejecting them costs your dad
   one extra moment and costs an attacker most of their odds. */
const COMMON = new Set([
  '1234', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888',
  '9999', '1212', '6969', '1004', '2000', '4321', '2001', '1010', '1122', '1313',
  '2580', '5683', '0852', '123456', '111111', '000000', '123123', '654321',
  '121212', '112233', '789456', '159753'
]);

function now() { return Date.now(); }

/* ------------------------------------------------------------- shaping --- */

/* ensure() has to be idempotent. It is called from inside checkPin, from
   isConfigured, from publicState — and if each call handed back a *fresh*
   object, the one the caller is holding would be orphaned the moment another
   call replaced data.auth, and every mutation on it would be silently lost.
   Normalise once; hand back the same object every time after that. */
const NORMALISED = new WeakSet();

function ensure(data) {
  if (data.auth && typeof data.auth === 'object' && NORMALISED.has(data.auth)) {
    return data.auth;
  }
  const a = data.auth && typeof data.auth === 'object' ? data.auth : {};
  data.auth = {
    name: typeof a.name === 'string' ? a.name : '',
    pin: a.pin && typeof a.pin === 'object' ? a.pin : null,
    createdAt: a.createdAt || null,
    updatedAt: a.updatedAt || null,
    sessions: Array.isArray(a.sessions) ? a.sessions : [],
    fails: Array.isArray(a.fails) ? a.fails.filter(t => typeof t === 'number') : [],
    lockedUntil: typeof a.lockedUntil === 'number' ? a.lockedUntil : 0,
    lockCount: typeof a.lockCount === 'number' ? a.lockCount : 0
  };
  NORMALISED.add(data.auth);
  return data.auth;
}

function isConfigured(data) {
  const a = ensure(data);
  return !!(a.pin && a.pin.hash && a.pin.salt);
}

/* What the sign-in screen is allowed to know before anyone has proved
   anything: whether an account exists, whose it is, and whether it is locked.
   Never the hash, never the salt, never how many sessions are open. */
function publicState(data, hasMasterToken) {
  const a = ensure(data);
  const locked = a.lockedUntil > now();
  return {
    configured: isConfigured(data),
    name: a.name || null,
    locked,
    retryAfter: locked ? Math.ceil((a.lockedUntil - now()) / 1000) : null,
    attemptsRemaining: locked ? 0 : Math.max(0, MAX_FAILS - recentFails(a).length),
    setupAvailable: !!hasMasterToken
  };
}

/* --------------------------------------------------------------- hashing --- */

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem
  });
}

function sameBuffer(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validatePin(pin) {
  const s = String(pin == null ? '' : pin);
  if (!/^\d{4,8}$/.test(s)) {
    return 'A PIN is 4 to 8 digits — numbers only.';
  }
  if (/^(\d)\1+$/.test(s)) {
    return 'That is the same digit repeated. Pick something less guessable.';
  }
  if (isRun(s)) {
    return 'That is a straight run of digits. Pick something less guessable.';
  }
  if (COMMON.has(s)) {
    return 'That is one of the most commonly used PINs. Pick another.';
  }
  return null;
}

function isRun(s) {
  let up = true, down = true;
  for (let i = 1; i < s.length; i++) {
    const step = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (step !== 1) up = false;
    if (step !== -1) down = false;
  }
  return up || down;
}

/* -------------------------------------------------------------- attempts --- */

function recentFails(a) {
  const cutoff = now() - FAIL_WINDOW_MS;
  return a.fails.filter(t => t > cutoff);
}

function noteFailure(a) {
  a.fails = recentFails(a).concat(now());
  if (a.fails.length >= MAX_FAILS) {
    const minutes = LOCK_MINUTES[Math.min(a.lockCount, LOCK_MINUTES.length - 1)];
    a.lockedUntil = now() + minutes * 60 * 1000;
    a.lockCount += 1;
    a.fails = [];
    return minutes;
  }
  return 0;
}

function noteSuccess(a) {
  a.fails = [];
  a.lockedUntil = 0;
  a.lockCount = 0;
}

/* --------------------------------------------------------------- account --- */

function setPin(data, pin, name) {
  const problem = validatePin(pin);
  if (problem) return { ok: false, message: problem };

  const a = ensure(data);
  const salt = crypto.randomBytes(16);
  const hash = hashPin(pin, salt);

  a.pin = {
    alg: 'scrypt',
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
    salt: salt.toString('base64'),
    hash: hash.toString('base64')
  };
  if (typeof name === 'string' && name.trim()) a.name = name.trim().slice(0, 40);
  a.createdAt = a.createdAt || new Date().toISOString();
  a.updatedAt = new Date().toISOString();
  noteSuccess(a);
  /* A new PIN retires every session opened with the old one. If the PIN was
     changed because someone else might know it, half-measures are no good. */
  a.sessions = [];
  return { ok: true };
}

function checkPin(data, pin) {
  const a = ensure(data);

  if (!isConfigured(data)) {
    return { ok: false, code: 'not_configured', message: 'No author account has been set up yet.' };
  }
  if (a.lockedUntil > now()) {
    return {
      ok: false,
      code: 'locked',
      retryAfter: Math.ceil((a.lockedUntil - now()) / 1000),
      message: 'Too many wrong tries. Signing in is paused for a while.'
    };
  }
  if (!/^\d{4,8}$/.test(String(pin || ''))) {
    /* Malformed input still counts — otherwise it is a free probe. */
    const locked = noteFailure(a);
    return failure(a, locked);
  }

  const stored = a.pin;
  const candidate = crypto.scryptSync(String(pin), Buffer.from(stored.salt, 'base64'), SCRYPT.keylen, {
    N: stored.N || SCRYPT.N, r: stored.r || SCRYPT.r, p: stored.p || SCRYPT.p, maxmem: SCRYPT.maxmem
  });

  if (!sameBuffer(candidate, Buffer.from(stored.hash, 'base64'))) {
    const locked = noteFailure(a);
    return failure(a, locked);
  }

  noteSuccess(a);
  return { ok: true };
}

function failure(a, lockedMinutes) {
  if (lockedMinutes) {
    return {
      ok: false,
      code: 'locked',
      retryAfter: Math.ceil((a.lockedUntil - now()) / 1000),
      message: `That is ${MAX_FAILS} wrong tries. Signing in is paused for ${lockedMinutes} minutes.`
    };
  }
  const left = Math.max(0, MAX_FAILS - recentFails(a).length);
  return {
    ok: false,
    code: 'wrong_pin',
    attemptsRemaining: left,
    message: left === 1
      ? 'That PIN is not right. One more wrong try and sign-in pauses.'
      : `That PIN is not right. ${left} tries left.`
  };
}

/* -------------------------------------------------------------- sessions --- */

function fingerprint(token) {
  return crypto.createHash('sha256').update(String(token)).digest('base64');
}

function issueSession(data, label) {
  const a = ensure(data);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  a.sessions = a.sessions
    .filter(s => s && typeof s.expires === 'number' && s.expires > now())
    .slice(-(MAX_SESSIONS - 1));
  a.sessions.push({
    h: fingerprint(token),
    created: now(),
    expires,
    label: String(label || '').slice(0, 60)
  });

  return { token, expiresAt: new Date(expires).toISOString() };
}

function validSession(data, token) {
  if (!token) return false;
  const a = ensure(data);
  const want = fingerprint(token);
  return a.sessions.some(s => s && s.h === want && s.expires > now());
}

function revokeSession(data, token) {
  const a = ensure(data);
  const want = fingerprint(token);
  const before = a.sessions.length;
  a.sessions = a.sessions.filter(s => !(s && s.h === want));
  return a.sessions.length < before;
}

function revokeAll(data) {
  ensure(data).sessions = [];
}

/* Strip the account out of anything leaving the server. An export is a backup
   of poems; it has no business carrying a password hash around with it. */
function withoutAuth(data) {
  const copy = Object.assign({}, data);
  delete copy.auth;
  return copy;
}

module.exports = {
  ensure, isConfigured, publicState,
  validatePin, setPin, checkPin,
  issueSession, validSession, revokeSession, revokeAll,
  withoutAuth,
  MAX_FAILS, SESSION_DAYS
};

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { cookieSecure, proxyPinned, sessionSecret, sessionSecretSource } from './runtimeConfig.js';
import { getSecurity } from './securitySettings.js';
import { readJson, removeFile, writeJson } from './store.js';

const COOKIE = 'du_session';

// Session lifetime and brute-force limits are editable in Admin -> Settings (securitySettings.js):
//   ipMaxFailures failures from one IP within lockoutMinutes -> that IP is locked lockoutMinutes
//   globalMaxFailures failures from all IPs (defeats IP rotation) -> login locked lockoutMinutes
const sessionMs = () => getSecurity().sessionHours * 3600_000;
const idleMs = () => getSecurity().idleMinutes * 60_000;
const windowMs = () => getSecurity().lockoutMinutes * 60_000;
const FAILURE_DELAY_MS = 1000;

// ADMIN_USER / ADMIN_PASSWORD from the environment are the initial login. Once the username or
// password is changed in Settings → Account, the new values are kept in DATA_DIR/login.json
// (password as a scrypt hash) and take precedence. RESET_LOGIN_CONFIG=true deletes that file at
// startup, so the .env login works again (for a forgotten username or password).
const ENV_USER = process.env.ADMIN_USER;
const ENV_PASSWORD = process.env.ADMIN_PASSWORD;
const LOGIN_FILE = 'login.json';

// ---------- Startup checks ----------

const WEAK = new Set(['change-me', 'changeme', 'admin', 'password', 'password123', '123456', '12345678', 'docker', 'dockerupdates']);
export const MIN_PASSWORD = 8;

/** Reason why a password is not acceptable, or null. */
export function passwordProblem(password, user) {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters (12+ recommended)`;
  if (password.length > 1024) return 'The password is too long';
  if (WEAK.has(password.toLowerCase())) return 'This password is too common';
  if (password === user) return 'The password cannot be the same as the username';
  return null;
}

if (!ENV_USER || !ENV_PASSWORD) {
  console.error('ADMIN_USER and ADMIN_PASSWORD must be set (see .env.example).');
  process.exit(1);
}
if (passwordProblem(ENV_PASSWORD, ENV_USER)) {
  console.error('ADMIN_PASSWORD is too weak: use at least 8 characters (12+ recommended) and not a default value.');
  process.exit(1);
}

export const RESET_LOGIN = process.env.RESET_LOGIN_CONFIG?.trim().toLowerCase() === 'true';
if (RESET_LOGIN) {
  await removeFile(LOGIN_FILE);
  console.warn(
    'RESET_LOGIN_CONFIG=true: the username and password set in Settings were removed, ADMIN_USER / ADMIN_PASSWORD ' +
      'from the .env file apply. Set RESET_LOGIN_CONFIG=false (or remove it), otherwise every restart resets them again.',
  );
}

// { user?, hash?, salt? }: only what was changed in Settings → Account
let stored = RESET_LOGIN ? {} : await readJson(LOGIN_FILE, {});

const currentUser = () => stored.user || ENV_USER;
export const loginSource = () => ({ user: stored.user ? 'settings' : 'env', password: stored.hash ? 'settings' : 'env' });

if (!stored.hash && ENV_PASSWORD.length < 12) {
  console.warn('ADMIN_PASSWORD is shorter than 12 characters: consider a longer one.');
}

const secretRaw = process.env.SESSION_SECRET?.trim();
if (sessionSecretSource() === 'random') {
  console.warn('SESSION_SECRET not set: using a random one (sessions reset on restart). Set one in Settings → Server & access.');
} else if (sessionSecretSource() === 'env' && secretRaw.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters (openssl rand -hex 32).');
  process.exit(1);
}

const scrypt = promisify(crypto.scrypt);
const SCRYPT_KEYLEN = 64;

async function hashPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
  const key = await scrypt(password, salt, SCRYPT_KEYLEN);
  return { salt, hash: key.toString('base64') };
}

async function passwordMatches(password) {
  if (stored.hash && stored.salt) {
    const { hash } = await hashPassword(password, stored.salt);
    return safeEqual(hash, stored.hash);
  }
  return safeEqual(password, ENV_PASSWORD);
}

// ---------- Helpers ----------

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));
const sign = (data) => crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function audit(req, message) {
  const ip = req.ip ?? req.socket?.remoteAddress;
  const peer = req.socket?.remoteAddress;
  // When the IP comes from X-Forwarded-For, also log who actually connected
  const via = peer && ip !== peer ? ` via=${peer}` : '';
  console.log(`[audit] ${new Date().toISOString()} ip=${ip}${via} ${message}`);
}

/**
 * Audit line for events any client can trigger without signing in (blocked origins, refused
 * console upgrades): at most one per address per minute, so a flood cannot push real audit
 * entries out of the in-memory log shown in Admin -> Server logs.
 */
const lastUnauthAudit = new Map(); // ip -> time
export function auditThrottled(req, message) {
  const ip = String(req.ip ?? req.socket?.remoteAddress ?? '-');
  const now = Date.now();
  if ((lastUnauthAudit.get(ip) ?? 0) > now - 60_000) return;
  lastUnauthAudit.set(ip, now);
  if (lastUnauthAudit.size > 5000) lastUnauthAudit.clear();
  audit(req, message);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    // Settings → Server & access (COOKIE_SECURE) forces the Secure flag; otherwise it follows req.secure
    secure: cookieSecure() || req.secure,
    path: '/',
  };
}

// ---------- Server-side sessions (revocable, persisted in the data volume) ----------
// Only a SHA-256 hash of each session id is stored, so a copy of sessions.json cannot be
// used to log in. Changing the username, password or session secret invalidates them.

const SESSIONS_FILE = 'sessions.json';
const fingerprint = () =>
  crypto.createHmac('sha256', sessionSecret()).update(`${currentUser()}\n${stored.hash ?? ENV_PASSWORD}`).digest('hex');
const hashId = (id) => crypto.createHash('sha256').update(id).digest('hex');

// hash(id) -> { user, created, lastSeen, ip, lastIp, agent }
const sessions = new Map();
let dirty = false;

{
  const saved = await readJson(SESSIONS_FILE, {});
  if (saved.fingerprint === fingerprint()) {
    for (const [k, v] of Object.entries(saved.sessions ?? {})) sessions.set(k, v);
  }
}

function persistSessions() {
  dirty = false;
  return writeJson(SESSIONS_FILE, { fingerprint: fingerprint(), sessions: Object.fromEntries(sessions) });
}

const expired = (s, now = Date.now()) => now - s.created > sessionMs() || now - s.lastSeen > idleMs();

const agentOf = (req) => String(req.headers?.['user-agent'] ?? '').slice(0, 300);

function createSession(user, req) {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(hashId(id), { user, created: now, lastSeen: now, ip: req.ip, lastIp: req.ip, agent: agentOf(req) });
  void persistSessions();
  return `${id}.${sign(id)}`;
}

function sessionFromCookie(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const [id, sig] = token.split('.');
  if (!id || !sig || !safeEqual(sig, sign(id))) return null;
  const key = hashId(id);
  const s = sessions.get(key);
  if (!s || s.user !== currentUser()) return null;
  if (expired(s)) {
    sessions.delete(key);
    void persistSessions();
    return null;
  }
  s.lastSeen = Date.now();
  if (req.ip && s.lastIp !== req.ip) s.lastIp = req.ip;
  dirty = true; // lastSeen is flushed to disk once per minute
  return { id: key, ...s };
}

/** Username of a valid session, or null (used for WebSocket upgrades). */
export function userFor(req) {
  return sessionFromCookie(req)?.user ?? null;
}

setInterval(() => {
  if (dirty) void persistSessions();
}, 60_000).unref();

setInterval(() => {
  const now = Date.now();
  let removed = false;
  for (const [id, s] of sessions) {
    if (expired(s, now)) {
      sessions.delete(id);
      removed = true;
    }
  }
  if (removed) void persistSessions();
}, 10 * 60_000).unref();

// ---------- Brute-force protection ----------

const ipFailures = new Map(); // ip -> { times: number[], lockedUntil }

// Without a pinned reverse proxy (TRUST_PROXY), every private-network host is trusted to send
// X-Forwarded-For, so a LAN client could rotate fake client IPs to dodge the per-IP lockout.
// In that case the lockout also counts the address that actually opened the connection.
if (!proxyPinned()) {
  console.warn('TRUST_PROXY not set: any private-network host may send X-Forwarded-For. Set your reverse proxy IP in Settings → Server & access.');
}

/** Addresses the login lockout applies to for this request. */
function lockoutKeys(req) {
  const peer = req.socket?.remoteAddress;
  if (proxyPinned() || !peer) return [req.ip];
  // The connection counter is shared by direct attempts and attempts with a forwarded IP,
  // so alternating with and without X-Forwarded-For does not reset anything
  return peer === req.ip ? [`peer:${peer}`] : [req.ip, `peer:${peer}`];
}
let globalFailures = [];
let globalLockedUntil = 0;
// Most recent failed logins, newest first (Admin dashboard)
const recentFailures = [];
const RECENT_FAILURES_MAX = 100;

function lockedFor(req) {
  const now = Date.now();
  if (globalLockedUntil > now) return globalLockedUntil - now;
  let wait = 0;
  for (const key of lockoutKeys(req)) {
    const entry = ipFailures.get(key);
    if (entry?.lockedUntil > now) wait = Math.max(wait, entry.lockedUntil - now);
  }
  return wait;
}

function registerFailure(req, username) {
  const now = Date.now();
  const { ipMaxFailures, globalMaxFailures, lockoutMinutes } = getSecurity();
  for (const key of lockoutKeys(req)) {
    const entry = ipFailures.get(key) ?? { times: [], lockedUntil: 0, total: 0 };
    entry.times = entry.times.filter((t) => now - t < windowMs()).concat(now);
    entry.total = (entry.total ?? 0) + 1;
    if (entry.times.length >= ipMaxFailures) {
      entry.lockedUntil = now + windowMs();
      entry.times = [];
      audit(req, `login locked for ${key} after ${ipMaxFailures} failed attempts`);
    }
    ipFailures.set(key, entry);
  }

  globalFailures = globalFailures.filter((t) => now - t < windowMs()).concat(now);
  if (globalFailures.length >= globalMaxFailures) {
    globalLockedUntil = now + windowMs();
    globalFailures = [];
    audit(req, `login locked globally after ${globalMaxFailures} failed attempts in ${lockoutMinutes} min`);
  }

  recentFailures.unshift({ at: new Date(now).toISOString(), ip: req.ip, peer: req.socket?.remoteAddress ?? null, username });
  if (recentFailures.length > RECENT_FAILURES_MAX) recentFailures.length = RECENT_FAILURES_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of ipFailures) {
    if (e.lockedUntil < now && e.times.every((t) => now - t > windowMs())) ipFailures.delete(ip);
  }
}, 10 * 60_000).unref();

// ---------- Handlers ----------

export async function login(req, res) {
  const wait = lockedFor(req);
  if (wait) {
    res.set('Retry-After', String(Math.ceil(wait / 1000)));
    return res.status(429).json({ error: `Too many failed attempts, try again in ${Math.ceil(wait / 60_000)} min` });
  }
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 256 || password.length > 1024) {
    return res.status(400).json({ error: 'Invalid username or password' });
  }
  // Evaluate both comparisons to avoid leaking which one failed.
  const user = currentUser();
  const userOk = safeEqual(username, user);
  const passOk = await passwordMatches(password);
  if (!(userOk && passOk)) {
    const shown = username.slice(0, 64).replace(/[^\w.@-]/g, '?');
    registerFailure(req, shown);
    audit(req, `login failed user="${shown}"`);
    await sleep(FAILURE_DELAY_MS);
    return res.status(400).json({ error: 'Invalid username or password' });
  }
  for (const key of lockoutKeys(req)) ipFailures.delete(key);
  res.cookie(COOKIE, createSession(user, req), {
    ...cookieOptions(req),
    maxAge: sessionMs(),
  });
  audit(req, `login ok user="${user}"`);
  res.json({ user });
}

export function logout(req, res) {
  const s = sessionFromCookie(req);
  if (s) {
    sessions.delete(s.id);
    void persistSessions();
    audit(req, `logout user="${s.user}"`);
  }
  res.clearCookie(COOKIE, cookieOptions(req));
  res.json({ ok: true });
}

export function me(req, res) {
  res.json({ user: req.user });
}

/** Rejects requests without a valid session cookie. */
export function requireAuth(req, res, next) {
  const s = sessionFromCookie(req);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });
  req.user = s.user;
  req.sessionKey = s.id;
  next();
}

// ---------- Admin panel helpers ----------

// Public id of a session: derived from the stored hash, never usable to sign in
const publicId = (key) => crypto.createHash('sha256').update(`public:${key}`).digest('hex').slice(0, 16);

/** Active sessions, most recent activity first. `currentKey` marks the caller's own session. */
export function listSessions(currentKey) {
  const now = Date.now();
  return [...sessions.entries()]
    .filter(([, s]) => !expired(s, now))
    .map(([key, s]) => ({
      id: publicId(key),
      user: s.user,
      ip: s.ip ?? null,
      lastIp: s.lastIp ?? s.ip ?? null,
      agent: s.agent ?? '',
      created: new Date(s.created).toISOString(),
      lastSeen: new Date(s.lastSeen).toISOString(),
      expires: new Date(Math.min(s.created + sessionMs(), s.lastSeen + idleMs())).toISOString(),
      current: key === currentKey,
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/** Signs out one session by its public id. Returns false if it does not exist. */
export function revokeSession(id) {
  for (const key of sessions.keys()) {
    if (publicId(key) === id) {
      sessions.delete(key);
      void persistSessions();
      return true;
    }
  }
  return false;
}

/** Signs out every session except the caller's. Returns how many were removed. */
export function revokeOtherSessions(currentKey) {
  let count = 0;
  for (const key of [...sessions.keys()]) {
    if (key !== currentKey) {
      sessions.delete(key);
      count++;
    }
  }
  if (count) void persistSessions();
  return count;
}

/** Locked addresses, failure counters and recent failed logins. */
export function loginProtectionState() {
  const now = Date.now();
  const locked = [];
  const watching = [];
  for (const [key, e] of ipFailures) {
    const recent = e.times.filter((t) => now - t < windowMs()).length;
    const row = {
      key,
      ip: key.replace(/^peer:/, ''),
      viaConnection: key.startsWith('peer:'),
      recentFailures: recent,
      totalFailures: e.total ?? recent,
      retryAfterSeconds: e.lockedUntil > now ? Math.ceil((e.lockedUntil - now) / 1000) : 0,
    };
    if (row.retryAfterSeconds) locked.push(row);
    else if (recent) watching.push(row);
  }
  return {
    locked: locked.sort((a, b) => b.retryAfterSeconds - a.retryAfterSeconds),
    watching: watching.sort((a, b) => b.recentFailures - a.recentFailures),
    global: {
      recentFailures: globalFailures.filter((t) => now - t < windowMs()).length,
      retryAfterSeconds: globalLockedUntil > now ? Math.ceil((globalLockedUntil - now) / 1000) : 0,
    },
    recentFailures: recentFailures.slice(0, 50),
    proxyPinned: proxyPinned(),
  };
}

/** Lifts a lockout: a `key` from loginProtectionState, or 'global'. */
export function clearLockout(key) {
  if (key === 'global') {
    const was = globalLockedUntil > Date.now() || globalFailures.length > 0;
    globalLockedUntil = 0;
    globalFailures = [];
    return was;
  }
  return ipFailures.delete(key);
}

// ---------- Account changes (Settings → Account) ----------

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Checks the current password before a sensitive change. Wrong answers count as failed
 * logins (same lockout), so a stolen session cannot be used to guess the password.
 */
async function verifyCurrentPassword(req, password) {
  const wait = lockedFor(req);
  if (wait) throw httpError(429, `Too many failed attempts, try again in ${Math.ceil(wait / 60_000)} min`);
  if (typeof password !== 'string' || !password || password.length > 1024 || !(await passwordMatches(password))) {
    registerFailure(req, currentUser());
    audit(req, `user="${req.user}" entered a wrong current password`);
    await sleep(FAILURE_DELAY_MS);
    throw httpError(400, 'The current password is not correct');
  }
}

/** Keeps the caller signed in and signs out every other session (after a credential change). */
async function keepOnlyCurrentSession(req, res) {
  sessions.clear();
  res.cookie(COOKIE, createSession(currentUser(), req), { ...cookieOptions(req), maxAge: sessionMs() });
  await persistSessions();
}

async function saveLogin(next) {
  stored = next;
  await writeJson(LOGIN_FILE, stored);
}

export async function changeUsername(req, res) {
  const { username, currentPassword } = req.body ?? {};
  const value = String(username ?? '').trim();
  if (!/^[\w.@-]{1,64}$/.test(value)) throw httpError(400, 'Username: 1 to 64 letters, numbers, dots, dashes, underscores or @');
  if (value === currentUser()) throw httpError(400, 'That is already your username');
  await verifyCurrentPassword(req, currentPassword);
  const before = currentUser();
  await saveLogin({ ...stored, user: value });
  await keepOnlyCurrentSession(req, res);
  audit(req, `username changed from "${before}" to "${value}" (other sessions signed out)`);
  return { user: value };
}

export async function changePassword(req, res) {
  const { newPassword, currentPassword } = req.body ?? {};
  const value = String(newPassword ?? '');
  const problem = passwordProblem(value, currentUser());
  if (problem) throw httpError(400, problem);
  await verifyCurrentPassword(req, currentPassword);
  if (await passwordMatches(value)) throw httpError(400, 'The new password is the same as the current one');
  await saveLogin({ ...stored, ...(await hashPassword(value)) });
  await keepOnlyCurrentSession(req, res);
  audit(req, `user="${currentUser()}" changed the password (other sessions signed out)`);
  return { ok: true };
}

/** After the session secret changed: every cookie is invalid, re-issue the caller's. */
export async function afterSecretChange(req, res) {
  await keepOnlyCurrentSession(req, res);
  audit(req, `user="${req.user}" changed the session secret (other sessions signed out)`);
}

export function accountInfo() {
  return {
    user: currentUser(),
    source: loginSource(),
    resetLoginConfig: RESET_LOGIN,
    minPassword: MIN_PASSWORD,
    passwordLength: stored.hash ? null : ENV_PASSWORD.length,
  };
}

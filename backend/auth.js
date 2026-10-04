import crypto from 'node:crypto';
import { getSecurity } from './securitySettings.js';
import { readJson, writeJson } from './store.js';

const COOKIE = 'du_session';
// "true" forces the Secure flag (recommended behind HTTPS); otherwise it follows req.secure
const FORCE_SECURE = process.env.COOKIE_SECURE === 'true';

// Session lifetime and brute-force limits are editable in Admin -> Settings (securitySettings.js):
//   ipMaxFailures failures from one IP within lockoutMinutes -> that IP is locked lockoutMinutes
//   globalMaxFailures failures from all IPs (defeats IP rotation) -> login locked lockoutMinutes
const sessionMs = () => getSecurity().sessionHours * 3600_000;
const idleMs = () => getSecurity().idleMinutes * 60_000;
const windowMs = () => getSecurity().lockoutMinutes * 60_000;
const FAILURE_DELAY_MS = 1000;

const USER = process.env.ADMIN_USER;
const PASSWORD = process.env.ADMIN_PASSWORD;

// ---------- Startup checks ----------

const WEAK = new Set(['change-me', 'changeme', 'admin', 'password', 'password123', '123456', '12345678', 'docker', 'dockerupdates']);

if (!USER || !PASSWORD) {
  console.error('ADMIN_USER and ADMIN_PASSWORD must be set (see .env.example).');
  process.exit(1);
}
if (PASSWORD.length < 8 || WEAK.has(PASSWORD.toLowerCase()) || PASSWORD === USER) {
  console.error('ADMIN_PASSWORD is too weak: use at least 8 characters (12+ recommended) and not a default value.');
  process.exit(1);
}
if (PASSWORD.length < 12) {
  console.warn('ADMIN_PASSWORD is shorter than 12 characters: consider a longer one.');
}

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set: using a random one (sessions reset on restart).');
} else if (process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters (openssl rand -hex 32).');
  process.exit(1);
}

// ---------- Helpers ----------

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function audit(req, message) {
  const ip = req.ip ?? req.socket?.remoteAddress;
  const peer = req.socket?.remoteAddress;
  // When the IP comes from X-Forwarded-For, also log who actually connected
  const via = peer && ip !== peer ? ` via=${peer}` : '';
  console.log(`[audit] ${new Date().toISOString()} ip=${ip}${via} ${message}`);
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
    secure: FORCE_SECURE || req.secure,
    path: '/',
  };
}

// ---------- Server-side sessions (revocable, persisted in the data volume) ----------
// Only a SHA-256 hash of each session id is stored, so a copy of sessions.json cannot be
// used to log in. Changing ADMIN_USER, ADMIN_PASSWORD or SESSION_SECRET invalidates them.

const SESSIONS_FILE = 'sessions.json';
const FINGERPRINT = crypto.createHmac('sha256', SECRET).update(`${USER}\n${PASSWORD}`).digest('hex');
const hashId = (id) => crypto.createHash('sha256').update(id).digest('hex');

// hash(id) -> { user, created, lastSeen, ip, lastIp, agent }
const sessions = new Map();
let dirty = false;

{
  const saved = await readJson(SESSIONS_FILE, {});
  if (saved.fingerprint === FINGERPRINT) {
    for (const [k, v] of Object.entries(saved.sessions ?? {})) sessions.set(k, v);
  }
}

function persistSessions() {
  dirty = false;
  return writeJson(SESSIONS_FILE, { fingerprint: FINGERPRINT, sessions: Object.fromEntries(sessions) });
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
  if (!s || s.user !== USER) return null;
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

// Without TRUST_PROXY, every private-network host is trusted to send X-Forwarded-For, so a
// LAN client could rotate fake client IPs to dodge the per-IP lockout. In that case the
// lockout also counts the address that actually opened the connection.
const PROXY_PINNED = Boolean(process.env.TRUST_PROXY?.trim());
if (!PROXY_PINNED) {
  console.warn('TRUST_PROXY not set: any private-network host may send X-Forwarded-For. Set it to your reverse proxy IP.');
}

/** Addresses the login lockout applies to for this request. */
function lockoutKeys(req) {
  const peer = req.socket?.remoteAddress;
  if (PROXY_PINNED || !peer) return [req.ip];
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
  const userOk = safeEqual(username, USER);
  const passOk = safeEqual(password, PASSWORD);
  if (!(userOk && passOk)) {
    const shown = username.slice(0, 64).replace(/[^\w.@-]/g, '?');
    registerFailure(req, shown);
    audit(req, `login failed user="${shown}"`);
    await sleep(FAILURE_DELAY_MS);
    return res.status(400).json({ error: 'Invalid username or password' });
  }
  for (const key of lockoutKeys(req)) ipFailures.delete(key);
  res.cookie(COOKIE, createSession(USER, req), {
    ...cookieOptions(req),
    maxAge: sessionMs(),
  });
  audit(req, `login ok user="${USER}"`);
  res.json({ user: USER });
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
    proxyPinned: PROXY_PINNED,
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

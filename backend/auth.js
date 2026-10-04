import crypto from 'node:crypto';

const COOKIE = 'du_session';
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES) || 120;
// "true" forces the Secure flag (recommended behind HTTPS); otherwise it follows req.secure
const FORCE_SECURE = process.env.COOKIE_SECURE === 'true';

// Brute-force protection
const IP_MAX_FAILURES = 5; // per IP...
const IP_WINDOW_MS = 15 * 60_000; // ...within 15 min -> locked 15 min
const GLOBAL_MAX_FAILURES = 30; // across all IPs (defeats IP rotation / spoofing)...
const GLOBAL_WINDOW_MS = 15 * 60_000; // ...within 15 min -> login locked 15 min
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
  console.error('ADMIN_PASSWORD is too weak: use at least 12 characters and not a default value.');
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
  console.log(`[audit] ${new Date().toISOString()} ip=${req.ip} ${message}`);
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

// ---------- Server-side sessions (revocable; all cleared on restart) ----------

// id -> { user, created, lastSeen }
const sessions = new Map();

function createSession(user) {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(id, { user, created: now, lastSeen: now });
  return `${id}.${sign(id)}`;
}

function sessionFromCookie(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const [id, sig] = token.split('.');
  if (!id || !sig || !safeEqual(sig, sign(id))) return null;
  const s = sessions.get(id);
  if (!s) return null;
  const now = Date.now();
  if (now - s.created > SESSION_HOURS * 3600_000 || now - s.lastSeen > IDLE_MINUTES * 60_000) {
    sessions.delete(id);
    return null;
  }
  s.lastSeen = now;
  return { id, ...s };
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.created > SESSION_HOURS * 3600_000 || now - s.lastSeen > IDLE_MINUTES * 60_000) sessions.delete(id);
  }
}, 10 * 60_000).unref();

// ---------- Brute-force protection ----------

const ipFailures = new Map(); // ip -> { times: number[], lockedUntil }
let globalFailures = [];
let globalLockedUntil = 0;

function lockedFor(ip) {
  const now = Date.now();
  if (globalLockedUntil > now) return globalLockedUntil - now;
  const entry = ipFailures.get(ip);
  return entry?.lockedUntil > now ? entry.lockedUntil - now : 0;
}

function registerFailure(req) {
  const now = Date.now();
  const entry = ipFailures.get(req.ip) ?? { times: [], lockedUntil: 0 };
  entry.times = entry.times.filter((t) => now - t < IP_WINDOW_MS).concat(now);
  if (entry.times.length >= IP_MAX_FAILURES) {
    entry.lockedUntil = now + IP_WINDOW_MS;
    entry.times = [];
    audit(req, `login locked for this IP after ${IP_MAX_FAILURES} failed attempts`);
  }
  ipFailures.set(req.ip, entry);

  globalFailures = globalFailures.filter((t) => now - t < GLOBAL_WINDOW_MS).concat(now);
  if (globalFailures.length >= GLOBAL_MAX_FAILURES) {
    globalLockedUntil = now + GLOBAL_WINDOW_MS;
    globalFailures = [];
    audit(req, `login locked globally after ${GLOBAL_MAX_FAILURES} failed attempts in 15 min`);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of ipFailures) {
    if (e.lockedUntil < now && e.times.every((t) => now - t > IP_WINDOW_MS)) ipFailures.delete(ip);
  }
}, 10 * 60_000).unref();

// ---------- Handlers ----------

export async function login(req, res) {
  const wait = lockedFor(req.ip);
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
    registerFailure(req);
    audit(req, `login failed user="${username.slice(0, 64).replace(/[^\w.@-]/g, '?')}"`);
    await sleep(FAILURE_DELAY_MS);
    return res.status(400).json({ error: 'Invalid username or password' });
  }
  ipFailures.delete(req.ip);
  res.cookie(COOKIE, createSession(USER), {
    ...cookieOptions(req),
    maxAge: SESSION_HOURS * 3600_000,
  });
  audit(req, `login ok user="${USER}"`);
  res.json({ user: USER });
}

export function logout(req, res) {
  const s = sessionFromCookie(req);
  if (s) {
    sessions.delete(s.id);
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
  next();
}

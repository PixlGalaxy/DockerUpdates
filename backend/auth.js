import crypto from 'node:crypto';

const COOKIE = 'du_session';
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

const USER = process.env.ADMIN_USER;
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!USER || !PASSWORD) {
  console.error('ADMIN_USER and ADMIN_PASSWORD must be set (see .env.example).');
  process.exit(1);
}

// Without a fixed secret, sessions are invalidated on every restart.
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set: using a random one (sessions reset on restart).');
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function createToken(user) {
  const payload = Buffer.from(
    JSON.stringify({ u: user, exp: Date.now() + SESSION_HOURS * 3600_000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data.u : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    path: '/',
  };
}

// Simple per-IP brute-force protection.
const attempts = new Map();

function isLocked(ip) {
  const a = attempts.get(ip);
  if (!a) return false;
  if (a.lockedUntil && a.lockedUntil > Date.now()) return true;
  if (a.lockedUntil) attempts.delete(ip);
  return false;
}

function registerFailure(ip) {
  const a = attempts.get(ip) ?? { count: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) a.lockedUntil = Date.now() + LOCK_MS;
  attempts.set(ip, a);
}

export function login(req, res) {
  const ip = req.ip;
  if (isLocked(ip)) {
    return res.status(429).json({ error: 'Too many attempts, try again later' });
  }
  const { username = '', password = '' } = req.body ?? {};
  // Evaluate both comparisons to avoid leaking which one failed.
  const userOk = safeEqual(username, USER);
  const passOk = safeEqual(password, PASSWORD);
  if (!(userOk && passOk)) {
    registerFailure(ip);
    return res.status(400).json({ error: 'Invalid username or password' });
  }
  attempts.delete(ip);
  res.cookie(COOKIE, createToken(USER), {
    ...cookieOptions(req),
    maxAge: SESSION_HOURS * 3600_000,
  });
  res.json({ user: USER });
}

export function logout(req, res) {
  res.clearCookie(COOKIE, cookieOptions(req));
  res.json({ ok: true });
}

export function me(req, res) {
  res.json({ user: req.user });
}

/** Rejects requests without a valid session cookie. */
export function requireAuth(req, res, next) {
  const user = verifyToken(readCookie(req, COOKIE));
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

// Admin panel API (/api/admin/*): sessions, server logs, IP access, security settings, system.
// Mounted after requireAuth in server.js, so every route needs a valid session.
import express from 'express';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as auth from './auth.js';
import { docker, selfId } from './docker.js';
import { addBan, isBanned, listBans, normalizeIp, removeBan } from './ipBans.js';
import { LOG_CHANNELS, LOG_LEVELS, logPage, logsSince, recentLevels, subscribeLogs } from './logBuffer.js';
import { getSecurity, securityInfo, updateSecurity } from './securitySettings.js';
import { DATA_DIR } from './store.js';

const PAGE_SIZES = [100, 250, 1000];
const STARTED_AT = new Date().toISOString();
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    const code = err.status || 500;
    if (code >= 500) console.error(err);
    res.status(code).json({ error: code >= 500 ? 'Internal server error' : err.message });
  }
};

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
};

export const adminRouter = express.Router();

// ---------- Dashboard ----------

adminRouter.get('/overview', handle((req) => {
  const protection = auth.loginProtectionState();
  return {
    sessions: auth.listSessions(req.sessionKey),
    yourIp: normalizeIp(req.ip),
    lockoutMinutes: getSecurity().lockoutMinutes,
    failedLogins: protection.global.recentFailures,
    globalLocked: protection.global.retryAfterSeconds,
    lockedCount: protection.locked.length,
    bannedCount: listBans().length,
    recentFailures: protection.recentFailures.slice(0, 10),
    logLevels: recentLevels(3600_000),
    startedAt: STARTED_AT,
  };
}));

adminRouter.post('/sessions/revoke-others', handle((req) => {
  const count = auth.revokeOtherSessions(req.sessionKey);
  auth.audit(req, `user="${req.user}" signed out ${count} other session(s)`);
  return { revoked: count };
}));

adminRouter.post('/sessions/:sid/revoke', handle((req) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.sid)) throw bad('Invalid session id');
  if (!auth.revokeSession(req.params.sid)) throw bad('Session not found (it may have expired)', 404);
  return { ok: true };
}));

// ---------- Server logs ----------

adminRouter.get('/logs', handle((req) => {
  const requested = positiveInt(req.query.limit, PAGE_SIZES[0]);
  const limit = PAGE_SIZES.includes(requested) ? requested : PAGE_SIZES[0];
  const channel = LOG_CHANNELS.includes(req.query.channel) ? req.query.channel : undefined;
  const level = LOG_LEVELS.includes(req.query.level) ? req.query.level : undefined;
  return { ...logPage(limit, positiveInt(req.query.page, 1), { channel, level }), limit };
}));

/** Server-Sent Events: entries newer than ?after=<id>, then new ones as they are logged. */
adminRouter.get('/logs/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  let pending = logsSince(Number(req.query.after) || 0).slice(-1000);
  // Bursts are sent as one message so a busy server cannot flood the browser
  const flush = () => {
    if (!pending.length) return;
    res.write(`data: ${JSON.stringify(pending)}\n\n`);
    pending = [];
  };
  const unsubscribe = subscribeLogs((entry) => {
    pending.push(entry);
    if (pending.length > 2000) pending.shift();
  });
  const flusher = setInterval(flush, 250);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    unsubscribe();
    clearInterval(flusher);
    clearInterval(heartbeat);
  });
});

// ---------- IP access ----------

adminRouter.get('/ip-access', handle((req) => ({
  ...auth.loginProtectionState(),
  banned: listBans(),
  yourIp: normalizeIp(req.ip),
  limits: getSecurity(),
})));

adminRouter.post('/ip-access/unlock', handle((req) => {
  const key = String(req.body?.key ?? '');
  if (!key || key.length > 100) throw bad('Invalid lockout');
  if (!auth.clearLockout(key)) throw bad('This lockout has already expired', 404);
  auth.audit(req, `user="${req.user}" lifted login lockout ${key}`);
  return { ok: true };
}));

adminRouter.post('/ip-access/bans', handle(async (req) => {
  if (typeof req.body?.ip !== 'string') throw bad('Enter an IP address');
  if (req.body.reason !== undefined && req.body.reason !== null && typeof req.body.reason !== 'string') throw bad('Invalid reason');
  // Never let the admin lock themselves (or their reverse proxy) out
  const ip = await addBan(req.body.ip, req.body.reason, req.user, [req.ip, req.socket.remoteAddress]);
  auth.audit(req, `user="${req.user}" banned ${ip}`);
  return { ip };
}));

adminRouter.post('/ip-access/bans/remove', handle(async (req) => {
  const ip = String(req.body?.ip ?? '');
  await removeBan(ip);
  auth.audit(req, `user="${req.user}" removed ban ${ip}`);
  return { ok: true };
}));

// ---------- Security settings ----------

function securityStatus(req) {
  const trustProxy = process.env.TRUST_PROXY?.trim() || '';
  return {
    trustProxy,
    cookieSecureForced: process.env.COOKIE_SECURE === 'true',
    connectionSecure: req.secure,
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    sessionSecretSet: Boolean(process.env.SESSION_SECRET),
    passwordLength: (process.env.ADMIN_PASSWORD ?? '').length,
    yourIp: normalizeIp(req.ip),
    peerIp: normalizeIp(req.socket.remoteAddress),
  };
}

adminRouter.get('/security', handle((req) => ({ ...securityInfo(), status: securityStatus(req) })));

adminRouter.put('/security', handle(async (req) => {
  const info = await updateSecurity(req.body);
  auth.audit(req, `user="${req.user}" changed security settings ${JSON.stringify(info.values)}`);
  return { ...info, status: securityStatus(req) };
}));

// ---------- System ----------

function containerized() {
  if (existsSync('/.dockerenv')) return true;
  try {
    return /docker|containerd|kubepods/.test(readFileSync('/proc/1/cgroup', 'utf8'));
  } catch {
    return false;
  }
}

async function dirSize(dir) {
  let total = 0;
  let files = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await dirSize(full);
      total += sub.bytes;
      files += sub.files;
    } else if (e.isFile()) {
      total += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
      files++;
    }
  }
  return { bytes: total, files };
}

async function dataUsage() {
  const parts = [];
  let entries = [];
  try {
    entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  } catch {
    // no data yet
  }
  for (const e of entries) {
    const full = path.join(DATA_DIR, e.name);
    if (e.isDirectory()) parts.push({ name: `${e.name}/`, ...(await dirSize(full)) });
    else if (e.isFile()) parts.push({ name: e.name, bytes: (await fs.stat(full).catch(() => ({ size: 0 }))).size, files: 1 });
  }
  let disk = null;
  try {
    const s = await fs.statfs(DATA_DIR);
    disk = { totalBytes: s.blocks * s.bsize, usedBytes: (s.blocks - s.bfree) * s.bsize };
  } catch {
    // statfs not available
  }
  return { path: DATA_DIR, disk, parts: parts.sort((a, b) => b.bytes - a.bytes) };
}

async function selfImage() {
  const id = await selfId();
  if (!id) return null;
  try {
    const info = await docker.getContainer(id).inspect();
    return {
      container: info.Name.replace(/^\//, ''),
      id: info.Id.slice(0, 12),
      image: info.Config.Image,
      imageId: info.Image.replace(/^sha256:/, '').slice(0, 12),
      created: info.Created,
      restartPolicy: info.HostConfig?.RestartPolicy?.Name || 'no',
      noNewPrivileges: (info.HostConfig?.SecurityOpt ?? []).some((o) => /no-new-privileges(:true|=true)?$/.test(o)),
    };
  } catch {
    return null;
  }
}

adminRouter.get('/system', handle(async () => {
  const [info, version, self, data] = await Promise.all([
    docker.info().catch(() => null),
    docker.version().catch(() => null),
    selfImage(),
    dataUsage(),
  ]);
  const mem = process.memoryUsage();
  return {
    app: {
      version: process.env.APP_VERSION || 'dev',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      startedAt: STARTED_AT,
      uptimeSeconds: Math.round(process.uptime()),
      containerized: containerized(),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      osRelease: os.release(),
    },
    self,
    docker: info && {
      name: info.Name,
      serverVersion: info.ServerVersion,
      apiVersion: version?.ApiVersion ?? null,
      os: info.OperatingSystem,
      kernel: info.KernelVersion,
      arch: info.Architecture,
      cpus: info.NCPU,
      memTotal: info.MemTotal,
      storageDriver: info.Driver,
      loggingDriver: info.LoggingDriver,
      rootDir: info.DockerRootDir,
      containers: { total: info.Containers, running: info.ContainersRunning, paused: info.ContainersPaused, stopped: info.ContainersStopped },
      images: info.Images,
    },
    data,
  };
}));

/** Banned clients get nothing: used for every HTTP request (mounted first in server.js). */
const lastBlockedLog = new Map();
export function banGuard(req, res, next) {
  if (!isBanned(req.ip) && !isBanned(req.socket.remoteAddress)) return next();
  // One audit line per address per minute, so a flood cannot fill the log
  const key = normalizeIp(req.ip);
  const now = Date.now();
  if ((lastBlockedLog.get(key) ?? 0) < now - 60_000) {
    lastBlockedLog.set(key, now);
    if (lastBlockedLog.size > 5000) lastBlockedLog.clear();
    auth.audit(req, `blocked banned address ${req.method} ${req.path}`);
  }
  res.status(403).type('text/plain').send('Forbidden');
}

/** WebSocket upgrades (no Express req.ip): checks the connection and every forwarded address. */
export function bannedUpgrade(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [req.socket.remoteAddress, ...forwarded].some((ip) => isBanned(ip));
}

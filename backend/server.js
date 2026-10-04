import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as auth from './auth.js';
import { attachConsole } from './console.js';
import * as dk from './docker.js';
import { startHealthMonitor } from './health.js';
import { listHistory } from './history.js';
import { hostUsage } from './hostUsage.js';
import { checkIp } from './ipCheck.js';
import { detectLan, enableLan, lanStatus } from './macvlan.js';
import { streamLogs } from './logs.js';
import { notify, testChannel } from './notify.js';
import { startOperation, streamOperation } from './operations.js';
import * as scheduler from './scheduler.js';
import { loadSettings, publicSettings, updateSettings } from './settings.js';
import { deleteTemplate, getTemplate, listTemplates } from './templates.js';
import { iconFile, initIcons, resetAutoIcon } from './icons.js';
import {
  auditLog,
  isSameOrigin,
  permissionsPolicy,
  sameOriginOnly,
  securityHeaders,
  trustProxySetting,
  validContainerRef,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || 'dev';

// Proxies trusted for X-Forwarded-For / X-Forwarded-Proto (set TRUST_PROXY to the NPM IP).
app.set('trust proxy', trustProxySetting());
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(permissionsPolicy);
app.use('/api', sameOriginOnly);
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.param('id', validContainerRef);

const ok = { ok: true };
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    // Never forward a Docker API 401: the frontend treats 401 as "session expired".
    const code = err.status || (err.statusCode && err.statusCode !== 401 ? err.statusCode : 500);
    if (code >= 500) console.error(err);
    res.status(code).json({ error: err.json?.message ?? err.message });
  }
};

// --- API ---
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/version', (_req, res) => res.json({ version: VERSION }));

app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);

// Everything below requires a valid session
app.use('/api', auth.requireAuth);
app.use('/api', auditLog);
app.get('/api/auth/me', auth.me);

app.get('/api/containers', handle(async () => ({
  hostIp: dk.hostIp(),
  hostName: await dk.hostName(),
  containers: await dk.listContainers(),
})));
app.post('/api/containers', handle(async (req) => ({ id: await dk.createContainer(req.body) })));
// Live CPU / memory, polled every second by the UI
app.get('/api/stats', handle(() => dk.getStats()));
app.get('/api/host', handle(() => dk.hostInfo()));
app.get('/api/host/usage', handle(() => hostUsage()));
app.get('/api/networks', handle(() => dk.listNetworks()));
app.get('/api/lan-network', handle(() => lanStatus()));
app.post('/api/lan-network/detect', handle(() => detectLan()));
app.post('/api/lan-network/enable', handle((req) => enableLan(req.body ?? {})));
app.post('/api/networks/check-ip', handle((req) =>
  checkIp(String(req.body?.network ?? ''), String(req.body?.ip ?? '').trim(), req.body?.container)));
app.post('/api/extra-params/check', handle((req) => dk.checkExtraParams(req.body?.extraParams ?? '')));

// Container icons (cached files, see icons.js)
app.get('/api/icons/:key', async (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.key)) return res.status(404).end();
  const file = await iconFile(req.params.key);
  if (!file) return res.status(404).end();
  res.set({
    'Content-Type': file.mime,
    'Cache-Control': 'private, max-age=604800, immutable',
    // SVGs could contain scripts: never let them run if opened directly
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(file.path, (err) => err && !res.headersSent && res.status(404).end());
});

// Fixed routes before the ones taking :id
app.post('/api/containers/check-updates', handle(() => dk.checkAllUpdates()));
app.post('/api/containers/update-all', handle(async () => {
  const summary = await dk.updateAll();
  const host = await dk.hostName();
  if (summary.items.length) void notify('updated', { items: summary.items, trigger: 'manual', host });
  if (summary.failed.length) void notify('update-failed', { items: summary.failed, trigger: 'manual', host });
  return summary;
}));
app.post('/api/containers/bulk/:action', handle((req) => dk.bulk(req.params.action)));

app.post('/api/containers/:id/autostart', handle(async (req) => {
  await dk.setAutostart(req.params.id, Boolean(req.body.enabled));
  return ok;
}));
app.post('/api/containers/:id/check-update', handle((req) => dk.checkUpdate(req.params.id)));
app.post('/api/containers/:id/update', handle(async (req) => {
  const host = await dk.hostName();
  try {
    const r = await dk.updateContainer(req.params.id);
    if (!r.selfUpdate) void notify('updated', { items: [r], trigger: 'manual', host });
    return r;
  } catch (err) {
    void notify('update-failed', { items: [{ name: req.params.id, error: err.message }], trigger: 'manual', host });
    throw err;
  }
}));
app.post('/api/containers/:id/refresh-icon', handle(async (req) => {
  const image = (await dk.docker.getContainer(req.params.id).inspect()).Config.Image;
  const reset = await resetAutoIcon(image);
  if (reset) await dk.listContainers(); // starts a new search in the background
  return { reset };
}));
app.post('/api/containers/:id/:action', handle(async (req) => {
  await dk.doAction(req.params.id, req.params.action);
  return ok;
}));
app.get('/api/containers/:id/spec', handle((req) => dk.getContainerSpec(req.params.id)));
app.get('/api/containers/:id/logs/stream', streamLogs);

// --- Updates with live progress (Unraid-style log) ---
// body: { ids?: string[] } — omitted: every container with an update available
app.post('/api/operations/update', handle(async (req) => {
  const ids = req.body?.ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((x) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(String(x))))) {
    throw Object.assign(new Error('Invalid container ids'), { status: 400 });
  }
  const single = ids?.length === 1;
  const title = single ? 'Updating the container' : 'Updating all containers';
  const host = await dk.hostName();
  const id = startOperation(title, async (log) => {
    const summary = await dk.updateMany({ ids, trigger: 'manual', log });
    if (!ids && !summary.items.length && !summary.failed.length && !summary.selfUpdate) {
      log.section('Nothing to update');
      log.line('Every container is up to date.');
    }
    if (summary.items.length) void notify('updated', { items: summary.items, trigger: 'manual', host });
    if (summary.failed.length) void notify('update-failed', { items: summary.failed, trigger: 'manual', host });
    return summary;
  });
  return { id, title };
}));
app.get('/api/operations/:opId/stream', (req, res) => {
  if (!/^[a-f0-9-]{36}$/.test(req.params.opId)) return res.status(404).end();
  streamOperation(req, res);
});

// --- History, templates ---
app.get('/api/history', handle((req) => listHistory({ container: req.query.container, limit: req.query.limit })));
app.get('/api/templates', handle(() => listTemplates()));
app.get('/api/templates/:name', handle((req) => getTemplate(req.params.name)));
app.delete('/api/templates/:name', handle(async (req) => { await deleteTemplate(req.params.name); return ok; }));

// --- Settings, auto-update, cleanup ---
app.get('/api/settings', handle(() => publicSettings()));
app.put('/api/settings', handle((req) => updateSettings(req.body ?? {})));
app.post('/api/settings/test/:channel', handle(async (req) => {
  await testChannel(req.params.channel, await dk.hostName());
  return ok;
}));
app.get('/api/timezones', handle(() => Intl.supportedValuesOf('timeZone')));
app.get('/api/auto-update/status', handle(() => scheduler.status()));
app.post('/api/auto-update/run', handle(() => scheduler.runNow()));
app.post('/api/schedule/preview', handle((req) => scheduler.previewSchedule(req.body ?? {})));
app.get('/api/cleanup/preview', handle((req) => dk.cleanupPreview(req.query.mode)));
app.post('/api/cleanup/run', handle(() => scheduler.cleanupNow()));
app.put('/api/containers/:id', handle((req) => dk.editContainer(req.params.id, req.body)));
app.delete('/api/containers/:id', handle(async (req) => { await dk.removeContainer(req.params.id); return ok; }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// --- Static React files (Vite build) ---
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { index: false }));

// Fallback SPA (Express 5 compatible); index.html is never cached so new versions load
app.get(/.*/, (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Malformed JSON, oversized bodies, unexpected errors: JSON answer, no stack traces
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

await Promise.all([initIcons(), loadSettings()]);
await scheduler.startScheduler();
startHealthMonitor();

const server = http.createServer(app);
attachConsole(server, {
  userFor: auth.userFor,
  sameOrigin: isSameOrigin,
  clientIp: (req) => req.socket.remoteAddress,
});
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

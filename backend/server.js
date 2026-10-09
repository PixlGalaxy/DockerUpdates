// First: captures console output (Admin -> Server logs), including messages printed while loading
import './logBuffer.js';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminRouter, banGuard, bannedUpgrade } from './admin.js';
import * as auth from './auth.js';
import { attachConsole } from './console.js';
import * as dk from './docker.js';
import { startHealthMonitor } from './health.js';
import { listHistory } from './history.js';
import { startHostAddressDetection } from './hostAddress.js';
import { hostUsage } from './hostUsage.js';
import { checkIp } from './ipCheck.js';
import { checkPorts } from './portCheck.js';
import { detectLan, enableLan, lanStatus } from './macvlan.js';
import { streamLogs } from './logs.js';
import { notify, testChannel } from './notify.js';
import { startOperation, streamOperation } from './operations.js';
import { getOrder, saveOrder } from './order.js';
import * as scheduler from './scheduler.js';
import { onConfigChange, publicConfig, trustProxySetting as currentTrustProxy, updateConfig } from './runtimeConfig.js';
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
// Saved in Settings → Server & access: applies to the next request, no restart needed
onConfigChange(() => app.set('trust proxy', currentTrustProxy()));
app.disable('x-powered-by');
// Banned addresses (Admin -> IP access) get nothing, not even the static files
app.use(banGuard);
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
    res.json(await fn(req, res));
  } catch (err) {
    // Never forward a Docker API 401: the frontend treats 401 as "session expired".
    const code = err.status || (err.statusCode && err.statusCode !== 401 ? err.statusCode : 500);
    if (code >= 500) console.error(err);
    // Docker errors carry a readable message (err.json); unexpected 500s stay in the server log
    const message = err.json?.message ?? (code >= 500 && !err.status ? 'Internal server error' : err.message);
    res.status(code).json({ error: message });
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
app.use('/api/admin', adminRouter);

app.get('/api/containers', handle(async () => ({
  hostIp: dk.hostIp(),
  hostName: await dk.hostName(),
  containers: await dk.listContainers(),
  order: await getOrder(),
})));
// Custom order of the list (lock button): body { names: string[] }
app.put('/api/containers/order', handle(async (req) => ({ order: await saveOrder(req.body?.names) })));
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
app.post('/api/ports/check', handle((req) => checkPorts(req.body?.ports, req.body?.container)));

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
// body: container spec. Bad input is rejected here (the form shows it); the install itself runs with a live log
app.post('/api/operations/create', handle(async (req) => {
  const { run } = await dk.prepareCreate(req.body ?? {});
  const title = 'Installing the container';
  return { id: startOperation(title, (log) => run(log)), title };
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
// Server & access settings (values from .env can be overridden here) and the login account
async function configView(req) {
  const detected = dk.detectedHostInfo();
  const ip = dk.hostIp();
  return {
    ...publicConfig(),
    account: auth.accountInfo(),
    host: {
      ip,
      detectedIp: detected?.ip ?? null,
      addresses: detected?.addresses ?? null,
      // null = could not be verified (detection not available outside a bridge container)
      ipIsLocal: detected ? detected.addresses.includes(ip) : null,
      autoName: await dk.autoHostName(),
    },
    connectionSecure: req.secure,
  };
}
const SECRET_KEYS = new Set(['sessionSecret', 'registryAuth']);
app.get('/api/config', handle((req) => configView(req)));
app.put('/api/config', handle(async (req, res) => {
  const body = req.body ?? {};
  await updateConfig(body);
  if ('sessionSecret' in body) await auth.afterSecretChange(req, res);
  const shown = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, SECRET_KEYS.has(k) ? '(changed)' : v]));
  auth.audit(req, `user="${req.user}" changed server settings ${JSON.stringify(shown)}`);
  return configView(req);
}));
app.post('/api/config/username', handle(async (req, res) => ({ ...(await auth.changeUsername(req, res)), config: await configView(req) })));
app.post('/api/config/password', handle(async (req, res) => {
  await auth.changePassword(req, res);
  return configView(req);
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
startHostAddressDetection();

const server = http.createServer(app);
attachConsole(server, {
  userFor: auth.userFor,
  sameOrigin: isSameOrigin,
  clientIp: (req) => req.socket.remoteAddress,
  banned: bannedUpgrade,
});
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

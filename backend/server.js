import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as auth from './auth.js';
import * as dk from './docker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || 'dev';

// Trust reverse proxies on private networks (e.g. Nginx Proxy Manager) for req.ip / req.secure.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.use(express.json());

const ok = { ok: true };
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    console.error(err);
    res.status(err.status || err.statusCode || 500).json({ error: err.message });
  }
};

// --- API ---
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/version', (_req, res) => res.json({ version: VERSION }));

app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);

// Everything below requires a valid session
app.use('/api', auth.requireAuth);
app.get('/api/auth/me', auth.me);

app.get('/api/containers', handle(async () => ({
  hostIp: dk.hostIp(),
  containers: await dk.listContainers(),
})));
app.post('/api/containers', handle(async (req) => ({ id: await dk.createContainer(req.body) })));

// Fixed routes before the ones taking :id
app.post('/api/containers/check-updates', handle(async () => { await dk.checkAllUpdates(); return ok; }));
app.post('/api/containers/update-all', handle(async () => { await dk.updateAll(); return ok; }));
app.post('/api/containers/bulk/:action', handle(async (req) => { await dk.bulk(req.params.action); return ok; }));

app.post('/api/containers/:id/autostart', handle(async (req) => {
  await dk.setAutostart(req.params.id, Boolean(req.body.enabled));
  return ok;
}));
app.post('/api/containers/:id/check-update', handle(async (req) => { await dk.checkUpdate(req.params.id); return ok; }));
app.post('/api/containers/:id/update', handle(async (req) => { await dk.updateContainer(req.params.id); return ok; }));
app.post('/api/containers/:id/:action', handle(async (req) => {
  await dk.doAction(req.params.id, req.params.action);
  return ok;
}));
app.delete('/api/containers/:id', handle(async (req) => { await dk.removeContainer(req.params.id); return ok; }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// --- Static React files (Vite build) ---
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Fallback SPA (Express 5 compatible)
app.get(/.*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

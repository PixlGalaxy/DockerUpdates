// Server settings editable in Settings → Server & access, persisted in DATA_DIR/config.json.
// A value saved here takes precedence over the matching environment variable (.env); fields
// that were never saved keep following the environment. Login credentials live in auth.js.
import crypto from 'node:crypto';
import net from 'node:net';
import { readJson, writeJson } from './store.js';

const FILE = 'config.json';
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const env = (name) => process.env[name]?.trim() ?? '';

// Default when no proxy is pinned: every private network may send X-Forwarded-*
export const PRIVATE_NETWORKS = 'loopback, linklocal, uniquelocal';

const listOf = (value) =>
  String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * Shape of config.json. `null` / '' = not set here (the environment variable applies).
 *   hostIp, hostName: string
 *   trustProxy: { enabled: boolean, value: string } | null
 *   cookieSecure: boolean | null
 *   allowedOrigins: string[] | null
 *   sessionSecret: string
 *   registryAuth: [{ registry, username, password }] | null
 *   consoleKeepalive: number | null   (seconds, 0 = off)
 */
function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    hostIp: typeof r.hostIp === 'string' ? r.hostIp : '',
    hostName: typeof r.hostName === 'string' ? r.hostName : '',
    trustProxy:
      r.trustProxy && typeof r.trustProxy === 'object'
        ? { enabled: Boolean(r.trustProxy.enabled), value: String(r.trustProxy.value ?? '') }
        : null,
    cookieSecure: typeof r.cookieSecure === 'boolean' ? r.cookieSecure : null,
    allowedOrigins: Array.isArray(r.allowedOrigins) ? r.allowedOrigins.map(String) : null,
    sessionSecret: typeof r.sessionSecret === 'string' ? r.sessionSecret : '',
    registryAuth: Array.isArray(r.registryAuth)
      ? r.registryAuth
          .filter((e) => e && typeof e === 'object')
          .map((e) => ({ registry: String(e.registry ?? ''), username: String(e.username ?? ''), password: String(e.password ?? '') }))
      : null,
    consoleKeepalive: Number.isInteger(r.consoleKeepalive) ? r.consoleKeepalive : null,
  };
}

let cfg = sanitize(await readJson(FILE, {}));
const listeners = new Set();

/** Called after every save (e.g. to re-apply Express' "trust proxy"). */
export function onConfigChange(fn) {
  listeners.add(fn);
}

// ---------- Effective values (settings > .env > automatic) ----------

export function trustProxy() {
  if (cfg.trustProxy) return { ...cfg.trustProxy, source: 'settings' };
  const v = env('TRUST_PROXY');
  return { enabled: Boolean(v) && v !== 'false', value: v === 'false' ? '' : v, source: v ? 'env' : 'default' };
}

/** Value for Express' "trust proxy" setting. */
export function trustProxySetting() {
  const { enabled, value } = trustProxy();
  if (!enabled || !value) return PRIVATE_NETWORKS;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/** A specific proxy is configured: only it may set X-Forwarded-For. */
export const proxyPinned = () => {
  const { enabled, value } = trustProxy();
  return enabled && Boolean(value);
};

export const cookieSecure = () => cfg.cookieSecure ?? env('COOKIE_SECURE') === 'true';

export const allowedOrigins = () => (cfg.allowedOrigins ?? listOf(env('ALLOWED_ORIGINS'))).map((o) => o.replace(/\/$/, ''));

// Without any secret, a random one is used until the next restart
const randomSecret = crypto.randomBytes(32).toString('hex');
export const sessionSecret = () => cfg.sessionSecret || env('SESSION_SECRET') || randomSecret;
export const sessionSecretSource = () => (cfg.sessionSecret ? 'settings' : env('SESSION_SECRET') ? 'env' : 'random');

/** HOST_IP chosen in Settings or .env ('' = automatic). */
export const hostIpOverride = () => cfg.hostIp || env('HOST_IP');
export const hostIpSource = () => (cfg.hostIp ? 'settings' : env('HOST_IP') ? 'env' : 'auto');
export const hostNameOverride = () => cfg.hostName || env('HOST_NAME');
export const hostNameSource = () => (cfg.hostName ? 'settings' : env('HOST_NAME') ? 'env' : 'auto');

/** REGISTRY_AUTH entries ("ghcr.io=user:token,..."); the password may contain ":". */
function envRegistryAuth() {
  const out = [];
  for (const entry of listOf(env('REGISTRY_AUTH'))) {
    const eq = entry.indexOf('=');
    const colon = entry.indexOf(':', eq + 1);
    if (eq === -1 || colon === -1) continue;
    out.push({ registry: entry.slice(0, eq).trim(), username: entry.slice(eq + 1, colon), password: entry.slice(colon + 1) });
  }
  return out;
}

// Console keep-alive: reverse proxies close idle WebSockets (nginx / Nginx Proxy Manager after
// 60 s). A ping every N seconds keeps an idle console open. 0 = off.
export const KEEPALIVE_RANGE = { min: 10, max: 300 };
const validKeepalive = (n) => Number.isInteger(n) && (n === 0 || (n >= KEEPALIVE_RANGE.min && n <= KEEPALIVE_RANGE.max));

function envKeepalive() {
  const raw = env('CONSOLE_WS_KEEPALIVE');
  if (!raw) return null;
  const n = Number(raw);
  if (validKeepalive(n)) return n;
  console.warn(`CONSOLE_WS_KEEPALIVE=${raw} is not valid (0, or ${KEEPALIVE_RANGE.min} to ${KEEPALIVE_RANGE.max} seconds): ignored.`);
  return null;
}
const ENV_KEEPALIVE = envKeepalive();

/** Seconds between WebSocket pings on an open console (0 = off). */
export const consoleKeepalive = () => cfg.consoleKeepalive ?? ENV_KEEPALIVE ?? 0;

/** Registry credentials: the list saved in Settings replaces REGISTRY_AUTH. */
export const registryAuth = () => cfg.registryAuth ?? envRegistryAuth();

// ---------- Browser view ----------

const MASK = '********';

export function publicConfig() {
  const tp = trustProxy();
  return {
    hostIp: { value: hostIpOverride(), source: hostIpSource() },
    hostName: { value: hostNameOverride(), source: hostNameSource() },
    trustProxy: { enabled: tp.enabled, value: tp.value, source: tp.source },
    cookieSecure: { value: cookieSecure(), source: cfg.cookieSecure !== null ? 'settings' : env('COOKIE_SECURE') ? 'env' : 'default' },
    allowedOrigins: { value: allowedOrigins(), source: cfg.allowedOrigins ? 'settings' : env('ALLOWED_ORIGINS') ? 'env' : 'default' },
    sessionSecret: { set: sessionSecretSource() !== 'random', source: sessionSecretSource() },
    registryAuth: {
      // Tokens never leave the server: the browser gets a mask and sends it back unchanged
      value: registryAuth().map((e) => ({ registry: e.registry, username: e.username, password: e.password ? MASK : '' })),
      source: cfg.registryAuth ? 'settings' : env('REGISTRY_AUTH') ? 'env' : 'default',
    },
    consoleKeepalive: {
      value: consoleKeepalive(),
      source: cfg.consoleKeepalive !== null ? 'settings' : ENV_KEEPALIVE !== null ? 'env' : 'default',
      ...KEEPALIVE_RANGE,
    },
    // Only configurable in the environment: changing them needs the container to be recreated
    readOnly: {
      port: env('PORT') || '3000',
      docker: env('DOCKER_HOST') || env('DOCKER_SOCKET') || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
    },
  };
}

// ---------- Validation ----------

function validIpOrRange(v) {
  const [ip, bits] = v.split('/');
  if (!net.isIP(ip)) return false;
  if (bits === undefined) return true;
  const n = Number(bits);
  return Number.isInteger(n) && n >= 0 && n <= (net.isIPv6(ip) ? 128 : 32);
}

function checkTrustProxy(tp) {
  if (!tp.enabled) return;
  if (!tp.value) throw bad('Enter the IP of your reverse proxy, or turn "Trust a reverse proxy" off');
  for (const part of listOf(tp.value)) {
    if (!validIpOrRange(part)) throw bad(`"${part}" is not an IP address or range (e.g. 192.168.1.10 or 172.18.0.0/16)`);
  }
}

function checkOrigin(o) {
  let url;
  try {
    url = new URL(o);
  } catch {
    throw bad(`"${o}" is not a valid origin (e.g. https://docker.example.com)`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== o.replace(/\/$/, '')) {
    throw bad(`"${o}" must be just scheme and host, e.g. https://docker.example.com`);
  }
}

const HOSTNAME_RE = /^[\w .()'-]{1,64}$/;

/**
 * Applies a partial update from the browser. Only the keys present are changed;
 * hostIp / hostName '' = back to automatic.
 */
export async function updateConfig(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad('Invalid settings');
  const next = structuredClone(cfg);

  if ('hostIp' in patch) {
    const v = String(patch.hostIp ?? '').trim();
    if (v && !net.isIPv4(v)) throw bad(`"${v}" is not a valid IPv4 address`);
    next.hostIp = v;
  }
  if ('hostName' in patch) {
    const v = String(patch.hostName ?? '').trim();
    if (v && !HOSTNAME_RE.test(v)) throw bad('Server name: up to 64 letters, numbers, spaces, dots or dashes');
    next.hostName = v;
  }
  if ('trustProxy' in patch) {
    const tp = { enabled: Boolean(patch.trustProxy?.enabled), value: listOf(patch.trustProxy?.value).join(', ') };
    checkTrustProxy(tp);
    next.trustProxy = tp;
  }
  if ('cookieSecure' in patch) next.cookieSecure = Boolean(patch.cookieSecure);
  if ('allowedOrigins' in patch) {
    const list = (Array.isArray(patch.allowedOrigins) ? patch.allowedOrigins : listOf(patch.allowedOrigins)).map((o) => String(o).trim()).filter(Boolean);
    list.forEach(checkOrigin);
    next.allowedOrigins = list.map((o) => o.replace(/\/$/, ''));
  }
  if ('sessionSecret' in patch) {
    const v = String(patch.sessionSecret ?? '').trim();
    if (v.length < 32) throw bad('The session secret must be at least 32 characters');
    next.sessionSecret = v;
  }
  if ('consoleKeepalive' in patch) {
    const n = Number(patch.consoleKeepalive);
    if (!validKeepalive(n)) throw bad(`Console keep-alive: 0 (off) or ${KEEPALIVE_RANGE.min} to ${KEEPALIVE_RANGE.max} seconds`);
    next.consoleKeepalive = n;
  }
  if ('registryAuth' in patch) {
    if (!Array.isArray(patch.registryAuth)) throw bad('Invalid registry credentials');
    const current = registryAuth();
    next.registryAuth = patch.registryAuth.map((e, i) => {
      const registry = String(e?.registry ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const username = String(e?.username ?? '').trim();
      let password = String(e?.password ?? '');
      // Unchanged mask: keep the stored token of the same registry
      if (password === MASK) password = current.find((c) => c.registry === registry)?.password ?? current[i]?.password ?? '';
      if (!registry || !/^[\w.-]+(:\d+)?$/.test(registry)) throw bad(`Row ${i + 1}: enter a registry host, e.g. ghcr.io`);
      if (!username || !password) throw bad(`${registry}: enter a username and a token`);
      return { registry, username, password };
    });
  }

  cfg = next;
  await writeJson(FILE, cfg);
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.error('Config listener failed:', err.message);
    }
  }
  return publicConfig();
}

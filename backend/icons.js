// Container icons, stored per image repository (e.g. "ghcr.io/nye69/apex") so every
// container of that repo shares it. Sources, in priority order:
//   1. custom Icon URL set in the editor (downloaded and cached)
//   2. Unraid label "net.unraid.docker.icon"
//   3. favicon discovered on the container's exposed HTTP ports
// Files live in DATA_DIR/icons and are served by GET /api/icons/:key.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ICON_DIR = path.join(DATA_DIR, 'icons');
const DB_FILE = path.join(DATA_DIR, 'icons.json');

const MAX_BYTES = 1024 * 1024;
// Favicon discovery probes LAN services: keep it short. A custom Icon URL is usually on the
// internet (GitHub, a CDN...), which can be much slower.
const FETCH_TIMEOUT_MS = 2500;
const CUSTOM_FETCH_TIMEOUT_MS = 15_000;
const FAVICON_RETRY_MS = 6 * 3600_000;
const UNRAID_LABEL = 'net.unraid.docker.icon';

const EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};
export const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

const bad = (message) => Object.assign(new Error(message), { status: 400 });

// db: { [repo]: { source: 'custom' | 'label' | 'favicon', url?, file?, hash?, failedAt? } }
let db = null;
let saveChain = Promise.resolve();
const discovering = new Set();

async function load() {
  if (db) return db;
  try {
    db = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch {
    db = {};
  }
  return db;
}

function save() {
  saveChain = saveChain
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
    })
    .catch((err) => console.error('Could not save icons.json:', err.message));
  return saveChain;
}

/** "ghcr.io/owner/app:tag" / "...@sha256:..." -> "ghcr.io/owner/app" */
export function repoOf(image) {
  const noDigest = image.split('@')[0];
  const slash = noDigest.lastIndexOf('/');
  const colon = noDigest.lastIndexOf(':');
  return (colon > slash ? noDigest.slice(0, colon) : noDigest).toLowerCase();
}

const keyOf = (repo) => crypto.createHash('sha1').update(repo).digest('hex').slice(0, 16);

function sniffType(buf, headerType) {
  const type = String(headerType ?? '').split(';')[0].trim().toLowerCase();
  if (EXT[type]) return type;
  // Some servers send favicon.ico as text/plain or application/octet-stream
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(buf.slice(0, 512).toString())) return 'image/svg+xml';
  return null;
}

async function fetchLimited(url, { accept, timeout = FETCH_TIMEOUT_MS } = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
    headers: { 'User-Agent': 'DockerUpdates', ...(accept ? { Accept: accept } : {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('File too large (max 1 MB)');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('File too large (max 1 MB)');
    chunks.push(chunk);
  }
  return { buf: Buffer.concat(chunks), type: res.headers.get('content-type'), url: res.url };
}

async function downloadImage(url, { timeout } = {}) {
  const { buf, type } = await fetchLimited(url, { accept: 'image/*', timeout });
  const mime = sniffType(buf, type);
  if (!mime || buf.length === 0) {
    if (/^\s*(<!doctype html|<html)/i.test(buf.slice(0, 512).toString())) {
      throw new Error('the URL opens a web page, not an image. Use the direct link to the image file (right-click the image > Copy image address).');
    }
    throw new Error('the URL does not point to an image (png, jpg, webp, gif, svg, ico)');
  }
  return { buf, mime };
}

/**
 * Links copied from a repository page point to the HTML viewer, not the file:
 *   github.com/owner/repo/blob/branch/path -> raw.githubusercontent.com/owner/repo/branch/path
 *   gitlab.com/owner/repo/-/blob/branch/path -> gitlab.com/owner/repo/-/raw/branch/path
 */
export function directImageUrl(url) {
  if (url.hostname === 'github.com') {
    const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
    if (m) return new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`);
  }
  if (url.hostname === 'gitlab.com' && url.pathname.includes('/-/blob/')) {
    return new URL(url.href.replace('/-/blob/', '/-/raw/'));
  }
  return url;
}

function describeFetchError(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return `the server did not answer within ${CUSTOM_FETCH_TIMEOUT_MS / 1000} s. Check the URL, and that DockerUpdates can reach the internet (DNS / firewall).`;
  }
  // fetch() hides the real reason (DNS, refused, TLS...) in err.cause
  const cause = err.cause?.code || err.cause?.message;
  if (err.message === 'fetch failed' && cause) return `could not connect (${cause})`;
  return err.message;
}

async function storeFile(repo, { buf, mime }) {
  await fs.mkdir(ICON_DIR, { recursive: true });
  const old = db[repo]?.file;
  const file = `${keyOf(repo)}.${EXT[mime]}`;
  await fs.writeFile(path.join(ICON_DIR, file), buf);
  if (old && old !== file) await fs.rm(path.join(ICON_DIR, old), { force: true });
  return { file, hash: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8) };
}

async function removeFile(repo) {
  const file = db[repo]?.file;
  if (file) await fs.rm(path.join(ICON_DIR, file), { force: true });
}

/** Custom Icon URL currently set for a repo ('' if none). */
export async function customIconUrl(image) {
  await load();
  const entry = db[repoOf(image)];
  return entry?.source === 'custom' ? entry.url : '';
}

/**
 * Sets (downloads + validates) or clears (empty url) the custom icon of an image's repo.
 * Throws 400 with a readable message if the URL is not a usable image.
 */
export async function setCustomIcon(image, url) {
  await setIcon(repoOf(image), url);
}

/** Sets or clears (empty url) the custom icon stored under `repo` (an image repo or a group key). */
async function setIcon(repo, url) {
  await load();
  const value = String(url ?? '').trim();
  if (value === (db[repo]?.source === 'custom' ? db[repo].url : '')) return; // unchanged

  if (!value) {
    await removeFile(repo);
    delete db[repo]; // favicon / label discovery takes over again
    await save();
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw bad('Icon URL is not a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw bad('Icon URL must start with http:// or https://');

  let image_;
  try {
    image_ = await downloadImage(directImageUrl(parsed).href, { timeout: CUSTOM_FETCH_TIMEOUT_MS });
  } catch (err) {
    throw bad(`Could not use Icon URL: ${describeFetchError(err)}`);
  }
  const stored = await storeFile(repo, image_);
  // Keep the URL as typed so the editor shows what the user entered
  db[repo] = { source: 'custom', url: parsed.href, ...stored };
  await save();
}

/** URL the UI should use for a container's icon, or undefined. */
export function iconUrlFor(image) {
  return servedUrl(repoOf(image));
}

function servedUrl(repo) {
  const entry = db?.[repo];
  return entry?.file ? `/api/icons/${keyOf(repo)}?v=${entry.hash}` : undefined;
}

// ---------- Stacks and folders ----------
// Their icons live in the same store as container icons, under "group:stack:<project>" /
// "group:folder:<id>" (an image repo never starts with "group:").

const GROUP_KEY_RE = /^(stack:[a-z0-9][a-z0-9_-]{0,62}|folder:[a-z0-9]{1,32})$/;

function groupRepo(key) {
  if (!GROUP_KEY_RE.test(String(key))) throw bad('Invalid stack or folder');
  return `group:${key}`;
}

/** Sets (downloads + validates) or clears (empty url) the icon of a stack or folder. */
export async function setGroupIcon(key, url) {
  await setIcon(groupRepo(key), url);
}

/** { "stack:media": { url: icon URL as typed, icon: URL to show } } for every stack / folder with one. */
export async function groupIcons() {
  await load();
  return Object.fromEntries(
    Object.entries(db)
      .filter(([repo, entry]) => repo.startsWith('group:') && entry.source === 'custom')
      .map(([repo, entry]) => [repo.slice('group:'.length), { url: entry.url, icon: servedUrl(repo) }]),
  );
}

/** Resolves /api/icons/:key to a file on disk. */
export async function iconFile(key) {
  await load();
  for (const [repo, entry] of Object.entries(db)) {
    if (entry.file && keyOf(repo) === key) {
      return { path: path.join(ICON_DIR, entry.file), mime: MIME[entry.file.split('.').pop()] };
    }
  }
  return null;
}

// ---------- Automatic discovery ----------

function iconLinksFromHtml(html, baseUrl) {
  const links = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/\brel\s*=\s*["']?([^"'>]+)/i)?.[1]?.toLowerCase() ?? '';
    const href = tag.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    if (!href || !/\bicon\b|apple-touch-icon/.test(rel)) continue;
    const sizes = Number(tag.match(/\bsizes\s*=\s*["']?(\d+)/i)?.[1] ?? 0);
    // Prefer big icons: apple-touch (180px) and declared sizes beat a 16px favicon
    const score = (rel.includes('apple-touch') ? 180 : 0) + sizes + (/\.svg(\?|$)/i.test(href) ? 120 : 0);
    try {
      links.push({ url: new URL(href, baseUrl).href, score });
    } catch {
      // ignore bad href
    }
  }
  return links.sort((a, b) => b.score - a.score).map((l) => l.url);
}

/**
 * Looks at every reachable port and prefers icons declared in a page's HTML (the real web UI,
 * e.g. NPM's admin on :81) over a bare /favicon.ico (e.g. a default landing page on :80).
 */
async function findFavicon(baseUrls) {
  const declared = [];
  const fallbacks = [];
  const reached = new Set();
  for (const base of baseUrls) {
    try {
      const page = await fetchLimited(base, { accept: 'text/html' });
      // Same service reached through two addresses (LAN IP / gateway): look at it once
      const key = new URL(page.url).port || new URL(base).port;
      if (reached.has(key)) continue;
      reached.add(key);
      if (/html/i.test(page.type ?? '')) declared.push(...iconLinksFromHtml(page.buf.toString(), page.url));
      fallbacks.push(new URL('/favicon.ico', page.url).href);
    } catch {
      // port is not HTTP / not reachable from here
    }
  }
  for (const url of [...declared, ...fallbacks]) {
    try {
      return await downloadImage(url);
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Forgets the automatic icon of an image so it is searched again (custom icons are kept). */
export async function resetAutoIcon(image) {
  await load();
  const repo = repoOf(image);
  if (db[repo]?.source === 'custom') return false;
  await removeFile(repo);
  delete db[repo];
  await save();
  return true;
}

/**
 * Finds icons for containers whose repo has none yet (runs in the background).
 * `containers`: [{ image, labels, running, targets: ["http://ip:port", ...] }]
 */
export async function discoverIcons(containers) {
  await load();
  for (const c of containers) {
    const repo = repoOf(c.image);
    const entry = db[repo];
    if (entry?.file || discovering.has(repo)) continue;
    // A failed search is retried after 6 h, or right away if the container restarted since
    // (e.g. it was crashing when we looked)
    const restartedSince = c.startedAt && Date.parse(c.startedAt) > (entry?.failedAt ?? 0);
    if (entry?.failedAt && Date.now() - entry.failedAt < FAVICON_RETRY_MS && !restartedSince) continue;
    const unraidIcon = c.labels?.[UNRAID_LABEL];
    if (!unraidIcon && (!c.running || c.targets.length === 0)) continue;

    discovering.add(repo);
    (async () => {
      try {
        let found = null;
        let source = 'favicon';
        // The label comes from the image: only follow plain web URLs
        if (unraidIcon && /^https?:\/\//i.test(unraidIcon)) {
          found = await downloadImage(unraidIcon).catch(() => null);
          source = 'label';
        }
        if (!found) {
          found = await findFavicon(c.targets);
          source = 'favicon';
        }
        if (found) db[repo] = { source, ...(await storeFile(repo, found)) };
        else db[repo] = { failedAt: Date.now() };
        await save();
      } catch (err) {
        console.error(`Icon discovery failed for ${repo}:`, err.message);
      } finally {
        discovering.delete(repo);
      }
    })();
  }
}

export async function initIcons() {
  await load();
}

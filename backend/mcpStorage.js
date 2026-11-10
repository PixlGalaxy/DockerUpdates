// Where AI assistants (MCP) must keep container data: bind mounts in the same folder layout
// as the existing containers (e.g. /opt/appdata/<name>/config), never Docker volumes, whose
// data would end up in /var/lib/docker/volumes.
import path from 'node:path';
import { docker, pull, withTag } from './docker.js';
import { isAnonymousVolume } from './containerSpec.js';
import { getSettings } from './settings.js';

const bad = (message) => Object.assign(new Error(message), { status: 400 });

// Host paths that are not "app data" (sockets, system files, Docker internals)
const SYSTEM = /^\/(?:var\/run|run|etc|proc|sys|dev|tmp|usr|lib|lib64|bin|sbin|boot|var\/lib\/docker)(?:\/|$)/;
const DOCKER_DATA = /^\/var\/lib\/docker(?:\/|$)/;
const isHostPath = (p) => /^\//.test(p) || /^[A-Za-z]:[\\/]/.test(p);
const trimSlash = (p) => String(p).replace(/\/+$/, '') || '/';

let detected = { at: 0, value: null };

/**
 * Folder most containers keep their data in: for a bind like /opt/appdata/plex/config on the
 * container "plex", the part before the container's name. Falls back to the deepest folder
 * shared by most containers. Cached for a minute.
 */
export async function detectBasePath() {
  if (Date.now() - detected.at < 60_000) return detected.value;
  const binds = await bindsByContainer();
  const votes = new Map();
  const vote = (base) => votes.set(base, (votes.get(base) ?? 0) + 1);

  for (const { names, sources } of binds) {
    const bases = new Set();
    for (const src of sources) {
      const parts = src.split('/');
      const i = parts.findIndex((seg, idx) => idx > 0 && names.has(seg.toLowerCase()));
      if (i > 1) bases.add(parts.slice(0, i).join('/'));
    }
    for (const b of bases) vote(b);
  }
  let best = [...votes.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? null;

  if (!best) {
    // No container name in the paths: deepest prefix (1 to 3 levels) used by most containers
    const prefixVotes = new Map();
    for (const { sources } of binds) {
      const prefixes = new Set();
      for (const src of sources) {
        const parts = src.split('/');
        for (let n = 2; n <= Math.min(4, parts.length - 1); n++) prefixes.add(parts.slice(0, n).join('/'));
      }
      for (const p of prefixes) prefixVotes.set(p, (prefixVotes.get(p) ?? 0) + 1);
    }
    const needed = Math.max(1, Math.ceil(binds.length * 0.6));
    best = [...prefixVotes.entries()]
      .filter(([, n]) => n >= needed)
      .sort((a, b) => b[0].split('/').length - a[0].split('/').length || b[1] - a[1])[0]?.[0] ?? null;
  }
  detected = { at: Date.now(), value: best };
  return best;
}

/** Bind mount sources of every container (system paths left out). */
async function bindsByContainer() {
  const list = await docker.listContainers({ all: true });
  return list
    .map((info) => {
      const names = new Set([
        ...info.Names.map((n) => n.replace(/^\//, '').toLowerCase()),
        info.Labels?.['com.docker.compose.service']?.toLowerCase(),
        info.Labels?.['com.docker.compose.project']?.toLowerCase(),
      ].filter(Boolean));
      const sources = (info.Mounts ?? [])
        .filter((m) => m.Type === 'bind' && m.Source && !SYSTEM.test(m.Source))
        .map((m) => trimSlash(m.Source));
      return { name: info.Names[0]?.replace(/^\//, ''), names, sources };
    })
    .filter((c) => c.sources.length);
}

/** Configured folder (Settings) or the detected one. */
export async function basePath() {
  const configured = trimSlash(getSettings().mcp?.dataPath ?? '').trim();
  if (configured && configured !== '/') return { path: configured, source: 'settings' };
  const found = await detectBasePath().catch(() => null);
  return { path: found, source: found ? 'detected' : 'none' };
}

/** What get_storage_conventions returns: the folder, the pattern and real examples. */
export async function conventions() {
  const base = await basePath();
  const binds = await bindsByContainer().catch(() => []);
  return {
    basePath: base.path,
    basePathSource: base.source,
    pattern: base.path ? `${base.path}/<container-name>/<subfolder>` : null,
    rules: [
      'Persistent data must use bind mounts (absolute host paths). Named volumes and anonymous volumes are rejected, so no data ends up in /var/lib/docker/volumes.',
      'Every VOLUME declared by the image must be mapped to a host path, otherwise Docker would create an anonymous volume: the request is rejected.',
      base.path
        ? `Put each container's data in its own folder: ${base.path}/<container-name>/... (e.g. ${base.path}/jellyfin/config -> /config).`
        : 'No data folder is configured or detectable: ask the user where container data should live before creating containers.',
      'Follow the examples below (same layout, same style of subfolders). Docker creates missing host folders.',
    ],
    examples: binds.slice(0, 10).map((c) => ({ container: c.name, hostPaths: c.sources.slice(0, 6) })),
  };
}

/** Suggested host folder for a container path, e.g. /opt/appdata/jellyfin/config. */
async function suggest(name, target) {
  const base = (await basePath()).path;
  return base ? path.posix.join(base, name, target) : null;
}

/** Image VOLUME paths (pulls the image when it is not on the host yet). */
async function imageVolumes(image) {
  const ref = withTag(image);
  let info;
  try {
    info = await docker.getImage(ref).inspect();
  } catch {
    await pull(ref);
    info = await docker.getImage(ref).inspect();
  }
  return Object.keys(info.Config?.Volumes ?? {}).map(trimSlash);
}

const covers = (mountTarget, volume) => volume === mountTarget || volume.startsWith(`${mountTarget}/`);

/**
 * Rejects a container spec that would store data in Docker volumes. `keep`: volume names /
 * paths the container already had (an edit does not have to fix what was there before).
 */
export async function checkContainerSpec(spec, { keep = new Set(), checkImage = true } = {}) {
  const rows = (spec.volumes ?? []).filter((v) => v?.host || v?.container);
  for (const v of rows) {
    const host = String(v.host ?? '').trim();
    if (keep.has(host)) continue;
    if (!isHostPath(host) || isAnonymousVolume(host)) {
      const hint = await suggest(spec.name, v.container);
      throw bad(`"${host}" is a Docker volume. Use a host folder instead${hint ? `, e.g. ${hint}` : ''} (see get_storage_conventions).`);
    }
    if (DOCKER_DATA.test(host)) throw bad(`"${host}" is inside Docker's own data folder: use a host folder instead (see get_storage_conventions).`);
  }
  if (!checkImage) return;
  const targets = rows.map((v) => trimSlash(v.container));
  const missing = (await imageVolumes(spec.image)).filter((vol) => !targets.some((t) => covers(t, vol)));
  if (missing.length) {
    const hints = await Promise.all(missing.map(async (vol) => `${(await suggest(spec.name, vol)) ?? '<host folder>'} -> ${vol}`));
    throw bad(`The image declares VOLUME ${missing.join(', ')}: map ${missing.length === 1 ? 'it' : 'them'} to a host folder or Docker creates an anonymous volume. Add: ${hints.join('; ')}`);
  }
}

/** Same rules for a compose stack (`config`: output of `docker compose config --format json`). */
export async function checkComposeConfig(config) {
  const declared = config.volumes ?? {};
  // A named volume of the "local" driver bound to a host folder is a bind mount in disguise
  const isBoundVolume = (name) => {
    const v = declared[name];
    return v?.driver_opts?.o?.split(',').includes('bind') && isHostPath(String(v.driver_opts.device ?? ''));
  };
  for (const [service, s] of Object.entries(config.services ?? {})) {
    const mounts = s.volumes ?? [];
    for (const m of mounts) {
      if (m.type === 'volume') {
        if (m.source && isBoundVolume(m.source)) continue;
        throw bad(`Service "${service}": ${m.source ? `named volume "${m.source}"` : `anonymous volume at ${m.target}`} is not allowed. Use a host folder (bind mount) instead (see get_storage_conventions).`);
      }
      if (m.type === 'bind' && DOCKER_DATA.test(String(m.source ?? ''))) {
        throw bad(`Service "${service}": "${m.source}" is inside Docker's own data folder.`);
      }
    }
    if (!s.image) continue;
    const targets = mounts.filter((m) => m.type === 'bind' || m.type === 'volume' || m.type === 'tmpfs').map((m) => trimSlash(m.target));
    const missing = (await imageVolumes(s.image)).filter((vol) => !targets.some((t) => covers(t, vol)));
    if (missing.length) {
      throw bad(`Service "${service}": the image declares VOLUME ${missing.join(', ')}; map ${missing.length === 1 ? 'it' : 'them'} to a host folder, or Docker creates an anonymous volume.`);
    }
  }
}

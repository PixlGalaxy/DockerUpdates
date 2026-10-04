import Docker from 'dockerode';
import fs from 'node:fs/promises';
import os from 'node:os';
import { buildCreateOptions, specFromInspect, validateSpec } from './containerSpec.js';
import { describeExtraParams } from './extraParams.js';
import { customIconUrl, discoverIcons, iconUrlFor, setCustomIcon } from './icons.js';
import { authFor, authHint, isAuthError } from './registryAuth.js';
import { cachedStats, getStats, initStats, parseSample } from './stats.js';

// Connection: DOCKER_HOST (tcp/ssh/npipe) > DOCKER_SOCKET > platform default.
// Linux/macOS: unix socket. Windows (Docker Desktop): named pipe.
const defaultSocket = process.platform === 'win32'
  ? '//./pipe/docker_engine'
  : '/var/run/docker.sock';

export const docker = new Docker(
  process.env.DOCKER_HOST
    ? undefined
    : { socketPath: process.env.DOCKER_SOCKET || defaultSocket },
);

initStats(docker);
export { getStats };

// Update status by container name (in memory): { status, message? }
const updateStatus = new Map();

const httpError = (status, message) => Object.assign(new Error(message), { status });
const cleanName = (name) => name.replace(/^\//, '');

// ---------- Self detection (DockerUpdates' own container) ----------

let selfIdPromise;

/** ID of the container this app runs in, or null when running outside Docker. */
export function selfId() {
  selfIdPromise ??= detectSelf();
  return selfIdPromise;
}

async function detectSelf() {
  const tryInspect = async (ref) => {
    try {
      return (await docker.getContainer(ref).inspect()).Id;
    } catch {
      return null;
    }
  };
  if (process.env.SELF_CONTAINER) return tryInspect(process.env.SELF_CONTAINER);
  try {
    // Docker bind-mounts /etc/hostname etc. from /var/lib/docker/containers/<id>/
    const m = (await fs.readFile('/proc/self/mountinfo', 'utf8')).match(/\/containers\/([a-f0-9]{64})\//);
    if (m) return m[1];
  } catch {
    // not Linux / not in a container
  }
  // Default container hostname is the short container ID
  return process.platform === 'linux' ? tryInspect(os.hostname()) : null;
}

async function isSelf(id) {
  const self = await selfId();
  return Boolean(self && (id === self || self.startsWith(id)));
}

async function assertNotSelf(id, what) {
  if (await isSelf(id)) throw httpError(400, `DockerUpdates cannot ${what} its own container.`);
}

/** Image reference is just an image ID (locally built / untagged): nothing to pull. */
function isLocalImageRef(image) {
  return /^(sha256:)?[a-f0-9]{12,64}$/.test(image);
}

// ---------- Listing ----------

export function hostIp() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

// Hostname of the Docker host (inside a container os.hostname() is the container ID).
let hostNameCache = { value: null, at: 0 };

export async function hostName() {
  if (process.env.HOST_NAME) return process.env.HOST_NAME;
  if (hostNameCache.value && Date.now() - hostNameCache.at < 10 * 60_000) return hostNameCache.value;
  try {
    hostNameCache = { value: (await docker.info()).Name, at: Date.now() };
  } catch {
    // keep the previous value if the daemon is unreachable
  }
  return hostNameCache.value ?? os.hostname();
}

async function stats(id) {
  const cached = cachedStats(id);
  if (cached) return cached;
  try {
    return parseSample(await docker.getContainer(id).stats({ stream: false }));
  } catch {
    return { cpuPercent: 0, memUsage: 0, memLimit: 0 };
  }
}

export async function listContainers() {
  const [list, self] = await Promise.all([docker.listContainers({ all: true }), selfId()]);
  const visible = list.filter((info) => !info.Labels?.[UPDATER_LABEL]);
  const result = await Promise.all(
    visible.map(async (info) => {
      const c = docker.getContainer(info.Id);
      const [inspect, st] = await Promise.all([
        c.inspect(),
        info.State === 'running' ? stats(info.Id) : { cpuPercent: 0, memUsage: 0, memLimit: 0 },
      ]);
      const name = cleanName(info.Names[0]);
      const networkMode = inspect.HostConfig.NetworkMode;
      const net = Object.values(inspect.NetworkSettings.Networks ?? {})[0];
      const ports = new Map();
      for (const [key, bindings] of Object.entries(inspect.NetworkSettings.Ports ?? {})) {
        const [port, protocol] = key.split('/');
        ports.set(key, {
          containerPort: Number(port),
          protocol,
          hostPort: bindings?.[0] ? Number(bindings[0].HostPort) : undefined,
        });
      }
      const update = updateStatus.get(name);
      return {
        id: info.Id,
        name,
        image: inspect.Config.Image,
        state: info.State,
        status: info.Status,
        network: networkMode === 'default' ? 'bridge' : networkMode,
        ip: net?.IPAddress || undefined,
        mac: net?.MacAddress || undefined,
        ports: [...ports.values()],
        volumes: (inspect.Mounts ?? []).map((m) => ({ container: m.Destination, host: m.Source })),
        ...st,
        autostart: inspect.HostConfig.RestartPolicy?.Name === 'always'
          || inspect.HostConfig.RestartPolicy?.Name === 'unless-stopped',
        startedAt: inspect.State.StartedAt,
        createdAt: inspect.Created,
        updateStatus: isLocalImageRef(inspect.Config.Image) ? 'local' : update?.status ?? 'unknown',
        updateMessage: update?.message,
        updateFrom: update?.from,
        updateTo: update?.to,
        updateKind: update?.kind,
        isSelf: info.Id === self,
        // Limits configured on the container (0 = no limit, falls back to host RAM in stats)
        memLimitConfigured: inspect.HostConfig.Memory || 0,
        cpuLimit: inspect.HostConfig.NanoCpus
          ? inspect.HostConfig.NanoCpus / 1e9
          : inspect.HostConfig.CpuQuota > 0
            ? inspect.HostConfig.CpuQuota / (inspect.HostConfig.CpuPeriod || 100000)
            : 0,
        icon: iconUrlFor(inspect.Config.Image),
        _discover: {
          image: inspect.Config.Image,
          labels: inspect.Config.Labels,
          running: info.State === 'running',
          targets: httpTargets(inspect, ports),
        },
      };
    }),
  );
  // Look for favicons in the background for containers without an icon
  void discoverIcons(result.map((c) => c._discover));
  return result.map(({ _discover, ...c }) => c);
}

/** Base URLs where a container's web UI might answer (used to find its favicon). */
function httpTargets(inspect, ports) {
  const urls = [];
  const nets = Object.values(inspect.NetworkSettings.Networks ?? {});
  const hostMode = inspect.HostConfig.NetworkMode === 'host';
  for (const p of ports.values()) {
    if (p.protocol !== 'tcp') continue;
    for (const n of nets) if (n.IPAddress) urls.push(`http://${n.IPAddress}:${p.containerPort}`);
    if (p.hostPort) {
      urls.push(`http://${hostIp()}:${p.hostPort}`);
      for (const n of nets) if (n.Gateway) urls.push(`http://${n.Gateway}:${p.hostPort}`);
    }
  }
  if (hostMode) {
    for (const port of Object.keys(inspect.Config.ExposedPorts ?? {})) {
      const [num, proto] = port.split('/');
      if (proto === 'tcp') urls.push(`http://${hostIp()}:${num}`);
    }
  }
  return [...new Set(urls)].slice(0, 6);
}

// ---------- Actions ----------

export async function doAction(id, action) {
  const c = docker.getContainer(id);
  const fn = { start: 'start', stop: 'stop', restart: 'restart', pause: 'pause', unpause: 'unpause' }[action];
  if (!fn) throw httpError(400, 'Invalid action');
  if (action === 'stop' || action === 'pause') await assertNotSelf(id, action);
  await c[fn]();
}

export async function bulk(action) {
  const wanted = {
    start: ['exited', 'created'],
    stop: ['running', 'paused'],
    pause: ['running'],
    unpause: ['paused'],
  }[action];
  if (!wanted) throw httpError(400, 'Invalid action');
  const [list, self] = await Promise.all([docker.listContainers({ all: true }), selfId()]);
  // Never stop/pause DockerUpdates itself, otherwise nobody could resume it from the UI.
  const targets = list.filter((i) => wanted.includes(i.State) && i.Id !== self && !i.Labels?.[UPDATER_LABEL]);
  const results = await Promise.allSettled(targets.map((i) => doAction(i.Id, action)));
  return {
    affected: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  };
}

export async function setAutostart(id, enabled) {
  await docker.getContainer(id).update({
    RestartPolicy: { Name: enabled ? 'unless-stopped' : 'no' },
  });
}

export async function removeContainer(id) {
  await assertNotSelf(id, 'remove');
  await docker.getContainer(id).remove({ force: true });
}

// ---------- Updates ----------

async function pull(image) {
  const authconfig = await authFor(image);
  try {
    await new Promise((resolve, reject) => {
      docker.pull(image, authconfig ? { authconfig } : {}, (err, stream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()));
      });
    });
  } catch (err) {
    if (isAuthError(err)) throw Object.assign(httpError(502, await authHint(image)), { auth: true });
    // Docker API status codes (e.g. 401) must not reach the browser as-is.
    throw httpError(502, `Pull failed for ${image}: ${err.json?.message ?? err.message}`);
  }
}

/** Pulls the image and compares its ID with the one the container uses. */
export async function checkUpdate(id) {
  const inspect = await docker.getContainer(id).inspect();
  const name = cleanName(inspect.Name);
  const image = inspect.Config.Image;

  let result;
  if (isLocalImageRef(image)) {
    result = { status: 'local', message: 'Container uses a local image ID, there is no registry to check.' };
  } else {
    try {
      await pull(image);
      const latest = await docker.getImage(image).inspect();
      if (latest.Id === inspect.Image) {
        result = { status: 'up-to-date' };
      } else {
        const current = await docker.getImage(inspect.Image).inspect().catch(() => ({ Id: inspect.Image }));
        result = { status: 'update-available', ...versionChange(current, latest) };
      }
    } catch (err) {
      result = { status: err.auth ? 'auth-required' : 'error', message: err.message };
    }
  }
  updateStatus.set(name, result);
  return { name, ...result };
}

const LABEL_VERSION = 'org.opencontainers.image.version';
const LABEL_REVISION = 'org.opencontainers.image.revision';

/**
 * Human-readable "from -> to" for an update. Uses the image version label when both images
 * have a distinct one (e.g. 1.2.3 -> 1.3.0), else the git revision (commit SHA, set by
 * docker/metadata-action), else the short image ID.
 */
function versionChange(current, latest) {
  const label = (img, key) => img.Config?.Labels?.[key];
  const v1 = label(current, LABEL_VERSION);
  const v2 = label(latest, LABEL_VERSION);
  if (v1 && v2 && v1 !== v2 && !/^(latest|main|master)$/.test(v2)) return { from: v1, to: v2, kind: 'version' };
  const r1 = label(current, LABEL_REVISION);
  const r2 = label(latest, LABEL_REVISION);
  if (r1 && r2 && r1 !== r2) return { from: r1.slice(0, 7), to: r2.slice(0, 7), kind: 'revision' };
  const id = (img) => img.Id.replace(/^sha256:/, '').slice(0, 12);
  return { from: id(current), to: id(latest), kind: 'image' };
}

export async function checkAllUpdates() {
  const list = (await docker.listContainers({ all: true })).filter((i) => !i.Labels?.[UPDATER_LABEL]);
  const summary = { upToDate: 0, available: 0, authRequired: 0, failed: 0, local: 0 };
  // Sequential to avoid hitting registry rate limits (Docker Hub).
  for (const i of list) {
    const { status } = await checkUpdate(i.Id);
    if (status === 'up-to-date') summary.upToDate++;
    else if (status === 'update-available') summary.available++;
    else if (status === 'auth-required') summary.authRequired++;
    else if (status === 'local') summary.local++;
    else summary.failed++;
  }
  return summary;
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Container config minus the values inherited from its (old) image, so the new image's
 * defaults (ENV, CMD, ENTRYPOINT, labels, healthcheck...) apply after the update.
 */
async function userConfig(inspect) {
  const config = { ...inspect.Config };
  let image;
  try {
    image = (await docker.getImage(inspect.Image).inspect()).Config ?? {};
  } catch {
    return config; // old image gone: keep the config as-is
  }

  const imageEnv = new Set(image.Env ?? []);
  config.Env = (config.Env ?? []).filter((e) => !imageEnv.has(e));

  if (config.Labels && image.Labels) {
    config.Labels = Object.fromEntries(
      Object.entries(config.Labels).filter(([k, v]) => image.Labels[k] !== v),
    );
  }
  for (const key of ['Cmd', 'Entrypoint', 'WorkingDir', 'User', 'Healthcheck', 'ExposedPorts', 'Volumes', 'StopSignal']) {
    if (sameJson(config[key], image[key])) delete config[key];
  }
  // Default hostname is the old container's short ID
  if (config.Hostname === inspect.Id.slice(0, 12)) delete config.Hostname;
  return config;
}

/**
 * Replaces a container with a new one from the same image reference, keeping its configuration.
 * Rolls back to the old container if anything fails. Used directly and by the self-update helper.
 */
export async function recreateContainer(id, buildOptions) {
  const old = docker.getContainer(id);
  const inspect = await old.inspect();
  const name = cleanName(inspect.Name);
  const wasRunning = inspect.State.Running;
  const config = await userConfig(inspect);
  const networks = inspect.NetworkSettings.Networks ?? {};
  const options = buildOptions
    ? buildOptions({ config, hostConfig: inspect.HostConfig, networks, inspect })
    : sameOptions(inspect, config);
  const newName = options.name ?? name;

  if (newName !== name && (await exists(newName))) {
    throw httpError(409, `A container named "${newName}" already exists`);
  }

  if (wasRunning) await old.stop();
  await old.rename({ name: `${name}_old` });

  let created;
  try {
    created = await docker.createContainer({ ...options, name: newName });
    // Reconnect additional networks (create only accepts one)
    const primary = options.HostConfig.NetworkMode;
    if (!['host', 'none'].includes(primary) && !primary.startsWith('container:')) {
      for (const [net, ep] of Object.entries(networks)) {
        if (net === primary || (primary === 'default' && net === 'bridge')) continue;
        const shortId = inspect.Id.slice(0, 12);
        await docker.getNetwork(net).connect({
          Container: created.id,
          EndpointConfig: { IPAMConfig: ep.IPAMConfig, Aliases: (ep.Aliases ?? []).filter((a) => a !== shortId) },
        });
      }
    }
    if (wasRunning) await created.start();
  } catch (err) {
    // Rollback: restore the previous container.
    if (created) await created.remove({ force: true }).catch(() => {});
    await old.rename({ name });
    if (wasRunning) await old.start();
    throw err;
  }

  await old.remove();
  return newName;
}

async function exists(name) {
  try {
    await docker.getContainer(name).inspect();
    return true;
  } catch {
    return false;
  }
}

/** Create options identical to the current container (used for image updates). */
function sameOptions(inspect, config) {
  const host = { ...inspect.HostConfig };
  // Anonymous volumes (image VOLUME) would be recreated empty: re-attach them by name
  const covered = new Set([
    ...(host.Binds ?? []).map((b) => b.split(':')[1]),
    ...(host.Mounts ?? []).map((m) => m.Target),
  ]);
  const anon = (inspect.Mounts ?? [])
    .filter((m) => m.Type === 'volume' && !covered.has(m.Destination))
    .map((m) => `${m.Name}:${m.Destination}${m.RW === false ? ':ro' : ''}`);
  if (anon.length) host.Binds = [...(host.Binds ?? []), ...anon];

  const net = host.NetworkMode;
  const ep = inspect.NetworkSettings.Networks?.[net];
  const shortId = inspect.Id.slice(0, 12);
  return {
    ...config,
    HostConfig: host,
    NetworkingConfig: net && !['default', 'bridge', 'host', 'none'].includes(net) && !net.startsWith('container:')
      ? { EndpointsConfig: { [net]: ep ? { IPAMConfig: ep.IPAMConfig, Aliases: (ep.Aliases ?? []).filter((a) => a !== shortId) } : {} } }
      : undefined,
  };
}

/** Pulls the latest image and recreates the container. Self-updates go through a helper container. */
export async function updateContainer(id) {
  const inspect = await docker.getContainer(id).inspect();
  const name = cleanName(inspect.Name);

  if (isLocalImageRef(inspect.Config.Image)) {
    throw httpError(400, `${name} uses a local image ID and cannot be updated from a registry.`);
  }

  // Pull first: if it fails (e.g. auth) the container is left untouched.
  try {
    await pull(inspect.Config.Image);
  } catch (err) {
    if (err.auth) updateStatus.set(name, { status: 'auth-required', message: err.message });
    throw err;
  }

  if (await isSelf(id)) {
    await scheduleSelfUpdate(inspect);
    return { name, selfUpdate: true };
  }

  await recreateContainer(id);
  updateStatus.set(name, { status: 'up-to-date' });
  return { name, selfUpdate: false };
}

export async function updateAll() {
  const summary = { updated: 0, failed: [], selfUpdate: false };
  const pending = (await listContainers()).filter((c) => c.updateStatus === 'update-available');
  // DockerUpdates itself goes last: its update restarts this process.
  pending.sort((a, b) => Number(a.isSelf) - Number(b.isSelf));
  for (const c of pending) {
    try {
      const r = await updateContainer(c.id);
      if (r.selfUpdate) summary.selfUpdate = true;
      else summary.updated++;
    } catch (err) {
      summary.failed.push({ name: c.name, error: err.message });
    }
  }
  return summary;
}

// ---------- Self-update ----------

const UPDATER_LABEL = 'dockerupdates.updater';

/**
 * A container cannot replace itself (stopping it kills the process doing the work).
 * Instead, start a short-lived helper container from the freshly pulled image that
 * recreates DockerUpdates from outside, then removes itself (AutoRemove).
 */
async function scheduleSelfUpdate(selfInspect) {
  const sock = (selfInspect.Mounts ?? []).find((m) => m.Destination === '/var/run/docker.sock');
  const env = ['DOCKER_HOST', 'DOCKER_SOCKET']
    .filter((k) => process.env[k])
    .map((k) => `${k}=${process.env[k]}`);
  if (!sock && !process.env.DOCKER_HOST) {
    throw httpError(500, 'Cannot self-update: Docker socket mount not found.');
  }

  const helper = await docker.createContainer({
    name: `dockerupdates-updater-${Date.now()}`,
    Image: selfInspect.Config.Image,
    Cmd: ['node', 'self-update.js', selfInspect.Id],
    Env: env,
    Labels: { [UPDATER_LABEL]: 'true' },
    HostConfig: {
      AutoRemove: true,
      Binds: sock ? [`${sock.Source}:/var/run/docker.sock`] : [],
    },
  });
  await helper.start();
}

// ---------- Create ----------

let logDriverPromise;
const daemonLogDriver = () => {
  logDriverPromise ??= docker.info().then((i) => i.LoggingDriver).catch(() => 'json-file');
  return logDriverPromise;
};

const withTag = (image) => {
  const ref = image.trim();
  const slash = ref.lastIndexOf('/');
  return ref.includes('@') || ref.lastIndexOf(':') > slash ? ref : `${ref}:latest`;
};

/** Current settings of a container, as shown in the Edit form. */
export async function getContainerSpec(id) {
  const inspect = await docker.getContainer(id).inspect();
  const config = await userConfig(inspect);
  const spec = specFromInspect(inspect, config, { logDriver: await daemonLogDriver() });
  return { ...spec, iconUrl: await customIconUrl(inspect.Config.Image) };
}

/** Validates Extra parameters and returns a readable summary (live feedback in the form). */
export function checkExtraParams(input) {
  const parsed = validateSpec({ name: 'x', image: 'x', extraParams: input });
  return { summary: describeExtraParams(parsed) };
}

export async function listNetworks() {
  const nets = await docker.listNetworks();
  return nets.map((n) => n.Name).sort();
}

/** Applies an edited spec: validates, pulls a new image if needed, recreates the container. */
export async function editContainer(id, spec) {
  await assertNotSelf(id, 'edit');
  const current = await docker.getContainer(id).inspect();
  const next = { ...spec, image: withTag(spec.image ?? '') };
  validateSpec(next); // fail before touching anything

  // Icon first: a bad URL aborts the edit
  if (spec.iconUrl !== undefined) await setCustomIcon(next.image, spec.iconUrl);

  if (next.image !== current.Config.Image) await pull(next.image);

  const name = await recreateContainer(id, (base) => buildCreateOptions(next, base));
  updateStatus.delete(cleanName(current.Name));
  return { name };
}

export async function createContainer(spec) {
  const next = { ...spec, image: withTag(spec?.image ?? '') };
  const options = buildCreateOptions(next);
  if (await exists(next.name)) throw httpError(409, `A container named "${next.name}" already exists`);
  if (spec.iconUrl) await setCustomIcon(next.image, spec.iconUrl);
  await pull(next.image);
  const container = await docker.createContainer(options);
  await container.start();
  return container.id;
}

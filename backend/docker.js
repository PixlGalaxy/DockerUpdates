import Docker from 'dockerode';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCreateOptions, specFromInspect, validateSpec } from './containerSpec.js';
import { describeExtraParams } from './extraParams.js';
import { suppressHealthAlerts } from './health.js';
import { addHistory, renameInHistory } from './history.js';
import { validateFixedIp } from './ipCheck.js';
import { customIconUrl, discoverIcons, iconUrlFor, setCustomIcon } from './icons.js';
import { authFor, authHint, isAuthError } from './registryAuth.js';
import { silent } from './operations.js';
import { renameInOrder } from './order.js';
import { dockerRunCommand, humanSize } from './runCommand.js';
import { hostIpOverride, hostIpSource, hostNameOverride } from './runtimeConfig.js';
import { getSettings } from './settings.js';
import { setStackColor } from './stackColors.js';
import { compose, listStacks, prepareDeploy, removeStack, safeStackName, setStackRestart } from './stacks.js';
import { cachedStats, getStats, initStats, parseSample } from './stats.js';
import { saveTemplate } from './templates.js';

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

/**
 * Path of `p` (a path of this process) on the Docker host: the same path outside a container,
 * else through the mount that holds it; null when it is only inside the container.
 */
async function hostPathFor(p) {
  const id = await selfId();
  if (!id) return p;
  const mounts = (await docker.getContainer(id).inspect()).Mounts ?? [];
  const m = mounts
    .filter((x) => p === x.Destination || p.startsWith(`${x.Destination}/`))
    .sort((a, b) => b.Destination.length - a.Destination.length)[0];
  return m ? path.posix.join(m.Source, p.slice(m.Destination.length)) : null;
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

// Set by hostAddress.js: the server's real LAN IP, read from the host network namespace
// (inside a container, os.networkInterfaces() only shows the container's own addresses).
let detectedHost = null; // { ip, addresses: string[] }

export function setDetectedHost(value) {
  detectedHost = value;
}

/** Detected LAN IP and every IPv4 address of the server (null until detected / not needed). */
export const detectedHostInfo = () => detectedHost;

/**
 * Host IP: one chosen in Settings is always used (the UI warns when it is not an address of
 * the server); HOST_IP from .env only when it is one, since it is often stale. Else detected.
 */
export function hostIp() {
  const configured = hostIpOverride();
  const fromSettings = hostIpSource() === 'settings';
  if (configured && (fromSettings || !detectedHost || detectedHost.addresses.includes(configured))) return configured;
  if (detectedHost) return detectedHost.ip;
  if (configured) return configured;
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
  return hostNameOverride() || autoHostName();
}

/** Hostname reported by the Docker daemon (cached 10 min). */
export async function autoHostName() {
  if (hostNameCache.value && Date.now() - hostNameCache.at < 10 * 60_000) return hostNameCache.value;
  try {
    hostNameCache = { value: (await docker.info()).Name, at: Date.now() };
  } catch {
    // keep the previous value if the daemon is unreachable
  }
  return hostNameCache.value ?? os.hostname();
}

/** Docker host summary (header, memory slider max). */
export async function hostInfo() {
  const info = await docker.info();
  return {
    name: hostNameOverride() || info.Name,
    ip: hostIp(),
    memTotal: info.MemTotal,
    cpus: info.NCPU,
    os: info.OperatingSystem,
    dockerVersion: info.ServerVersion,
    containers: info.Containers,
    images: info.Images,
  };
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

/** Number of cores in a cpuset such as "0-3,6" (0 when empty or unreadable). */
function cpusetCount(set) {
  let n = 0;
  for (const part of String(set ?? '').split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (m) n += m[2] === undefined ? 1 : Math.max(0, Number(m[2]) - Number(m[1]) + 1);
  }
  return n;
}

export async function listContainers() {
  const [list, self, stacks] = await Promise.all([docker.listContainers({ all: true }), selfId(), listStacks()]);
  const managed = new Set(stacks);
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
      const project = inspect.Config.Labels?.[COMPOSE_PROJECT];
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
        // Only for images with a HEALTHCHECK: 'healthy' | 'unhealthy' | 'starting'
        health: inspect.State.Health?.Status ?? null,
        healthLog: inspect.State.Health?.Log?.at(-1)?.Output?.trim().slice(0, 300) || undefined,
        exitCode: info.State === 'exited' ? inspect.State.ExitCode : undefined,
        restartCount: inspect.RestartCount ?? 0,
        createdAt: inspect.Created,
        updateStatus: isLocalImageRef(inspect.Config.Image) ? 'local' : update?.status ?? 'unknown',
        updateMessage: update?.message,
        updatePublished: update?.published,
        updateFrom: update?.from,
        updateTo: update?.to,
        updateKind: update?.kind,
        isSelf: info.Id === self,
        // Compose stack the container belongs to; `managed`: its compose file lives in DockerUpdates
        stack: project
          ? { project, service: inspect.Config.Labels[COMPOSE_SERVICE], managed: managed.has(project) }
          : undefined,
        // Limits configured on the container (0 = no limit, falls back to host RAM in stats)
        memLimitConfigured: inspect.HostConfig.Memory || 0,
        cpuLimit: inspect.HostConfig.NanoCpus
          ? inspect.HostConfig.NanoCpus / 1e9
          : inspect.HostConfig.CpuQuota > 0
            ? inspect.HostConfig.CpuQuota / (inspect.HostConfig.CpuPeriod || 100000)
            : 0,
        // Cores the container is pinned to with --cpuset-cpus (0 = all of them)
        cpusetCount: cpusetCount(inspect.HostConfig.CpusetCpus),
        icon: iconUrlFor(inspect.Config.Image),
        projectUrl: projectUrl(inspect.Config.Labels),
        _discover: {
          image: inspect.Config.Image,
          labels: inspect.Config.Labels,
          running: info.State === 'running',
          startedAt: inspect.State.StartedAt,
          targets: httpTargets(inspect, ports),
        },
      };
    }),
  );
  // Look for favicons in the background for containers without an icon
  void discoverIcons(result.map((c) => c._discover));
  return result.map(({ _discover, ...c }) => c);
}

const COMPOSE_PROJECT = 'com.docker.compose.project';
const COMPOSE_SERVICE = 'com.docker.compose.service';

/** Project page from OCI / Unraid labels (shown as "Project page" in the context menu). */
function projectUrl(labels = {}) {
  const url = labels?.['org.opencontainers.image.source']
    || labels?.['org.opencontainers.image.url']
    || labels?.['net.unraid.docker.webui.project'];
  return /^https?:\/\//.test(url ?? '') ? url : undefined;
}

/** Base URLs where a container's web UI might answer (used to find its favicon). */
function httpTargets(inspect, ports) {
  const urls = [];
  const nets = Object.values(inspect.NetworkSettings.Networks ?? {});
  const hostMode = inspect.HostConfig.NetworkMode === 'host';
  // Addresses that reach ports published on the server: its LAN IP and, from inside
  // DockerUpdates' own container, the Docker gateway (always routed to the host)
  const hostAddrs = [hostIp(), ownGateway].filter(Boolean);

  // Unraid WebUI label first, e.g. "http://[IP]:[PORT:81]/"
  const webuiPort = inspect.Config.Labels?.['net.unraid.docker.webui']?.match(/\[PORT:(\d+)\]/)?.[1];
  if (webuiPort) {
    const published = [...ports.values()].find((p) => String(p.containerPort) === webuiPort)?.hostPort;
    if (hostMode || published) for (const a of hostAddrs) urls.push(`http://${a}:${published ?? webuiPort}`);
    for (const n of nets) if (n.IPAddress) urls.push(`http://${n.IPAddress}:${webuiPort}`);
  }

  for (const p of ports.values()) {
    if (p.protocol !== 'tcp') continue;
    for (const n of nets) if (n.IPAddress) urls.push(`http://${n.IPAddress}:${p.containerPort}`);
    if (p.hostPort) {
      for (const a of hostAddrs) urls.push(`http://${a}:${p.hostPort}`);
      for (const n of nets) if (n.Gateway) urls.push(`http://${n.Gateway}:${p.hostPort}`);
    }
  }
  if (hostMode) {
    // Host network: no port mappings, use the ports the image declares (EXPOSE)
    for (const port of Object.keys(inspect.Config.ExposedPorts ?? {})) {
      const [num, proto] = port.split('/');
      if (proto === 'tcp') for (const a of hostAddrs) urls.push(`http://${a}:${num}`);
    }
  }
  return [...new Set(urls)].slice(0, 12);
}

// Default gateway of the network DockerUpdates runs in (Linux), e.g. 172.17.0.1
let ownGateway = null;
if (process.platform === 'linux') {
  fs.readFile('/proc/net/route', 'utf8').then((routes) => {
    const hex = routes.split('\n').map((l) => l.trim().split(/\s+/)).find((c) => c[1] === '00000000')?.[2];
    if (hex) ownGateway = [3, 2, 1, 0].map((i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).join('.');
  }, () => {});
}

// ---------- Actions ----------

export async function doAction(id, action) {
  const c = docker.getContainer(id);
  const ACTIONS = { start: 'start', stop: 'stop', restart: 'restart', pause: 'pause', unpause: 'unpause' };
  // Object.hasOwn: "constructor" / "toString" must not resolve to Object.prototype members
  const fn = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) throw httpError(400, 'Invalid action');
  if (action === 'stop' || action === 'pause') await assertNotSelf(id, action);
  await c[fn]();
}

export async function bulk(action) {
  const WANTED = {
    start: ['exited', 'created'],
    stop: ['running', 'paused'],
    pause: ['running'],
    unpause: ['paused'],
  };
  const wanted = Object.hasOwn(WANTED, action) ? WANTED[action] : null;
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

/**
 * Turns Docker pull progress events into Unraid-style lines, one per layer, updated in place:
 * "IMAGE ID [62af1e5c2891]: Pulling fs layer.Downloading 100% of 21 MB.Download complete.Pull complete."
 */
function pullReporter(log) {
  const layers = new Map(); // id -> { steps: [], total, lastEmit }
  let pulled = 0;
  let newLayers = 0;
  let status = '';
  return {
    onProgress(e) {
      if (e.status?.startsWith('Status:')) {
        status = e.status;
        return;
      }
      if (e.status?.startsWith('Pulling from')) {
        log.line(`${e.status}.`);
        return;
      }
      if (!e.id || e.status?.startsWith('Digest:')) return;
      const layer = layers.get(e.id) ?? { steps: [], total: 0, lastEmit: 0 };
      layers.set(e.id, layer);
      let step = e.status;
      if (e.status === 'Downloading' && e.progressDetail?.total) {
        layer.total = e.progressDetail.total;
        const pct = Math.floor((e.progressDetail.current / e.progressDetail.total) * 100);
        step = `Downloading ${pct}% of ${humanSize(layer.total)}`;
      } else if (e.status === 'Extracting' && e.progressDetail?.total) {
        step = 'Extracting';
      }
      // Progress events come in chunks: a finished download always reads 100%
      if (e.status === 'Download complete' && layer.total) {
        const k = layer.steps.findIndex((st) => st.startsWith('Downloading'));
        if (k !== -1) layer.steps[k] = `Downloading 100% of ${humanSize(layer.total)}`;
      }
      // Replace the previous step when it is the same kind (progress updates)
      const last = layer.steps.at(-1);
      if (last && last.split(' ')[0] === step.split(' ')[0]) layer.steps[layer.steps.length - 1] = step;
      else layer.steps.push(step);
      if (e.status === 'Pull complete') {
        pulled += layer.total;
        newLayers++;
      }

      const final = /complete|exists/i.test(e.status);
      const now = Date.now();
      if (final || now - layer.lastEmit > 250) {
        layer.lastEmit = now;
        log.layer(e.id, `IMAGE ID [${e.id}]: ${layer.steps.join('.')}.`);
      }
    },
    finish(image) {
      if (status) log.line(status);
      else log.line(`Status: Image is up to date for ${image}`);
      log.line('');
      log.line('TOTAL DATA PULLED:');
      // Tiny / cached layers come without size information: count them instead of showing "0 B"
      log.line(` ${pulled || !newLayers ? humanSize(pulled) : `${newLayers} new layer${newLayers === 1 ? '' : 's'}`}`);
    },
  };
}

async function pull(image, log = silent) {
  const authconfig = await authFor(image);
  const progress = pullReporter(log);
  try {
    await new Promise((resolve, reject) => {
      docker.pull(image, authconfig ? { authconfig } : {}, (err, stream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()), (e) => progress.onProgress(e));
      });
    });
    progress.finish(image);
  } catch (err) {
    if (isAuthError(err)) throw Object.assign(httpError(502, await authHint(image)), { auth: true });
    // Docker API status codes (e.g. 401) must not reach the browser as-is.
    throw httpError(502, `Pull failed for ${image}: ${err.json?.message ?? err.message}`);
  }
}

// Delay before checking a container that was just created / edited, so it shows its
// update status instead of "Not checked" until the next background check.
const CHECK_AFTER_START_MS = 3000;

function checkUpdateSoon(ref) {
  setTimeout(() => {
    checkUpdate(ref).catch((err) => console.warn(`Update check after start failed for ${ref}: ${err.message}`));
  }, CHECK_AFTER_START_MS).unref();
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
        // `published`: build date of the new image (used by the auto-update cooldown)
        result = { status: 'update-available', ...versionChange(current, latest), published: latest.Created };
      }
    } catch (err) {
      result = { status: err.auth ? 'auth-required' : 'error', message: err.message };
    }
  }
  updateStatus.set(name, result);
  return { name, image, ...result };
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
export async function recreateContainer(id, buildOptions, log = silent) {
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

  suppressHealthAlerts(name);
  suppressHealthAlerts(newName);
  if (wasRunning) {
    log.section(`Stopping container: ${name}`);
    await old.stop({ t: stopTimeout() });
    log.line(`Successfully stopped container: ${name}`);
  }
  // The old container is only renamed (not removed) until the new one is running: rollback stays possible
  log.section(`Renaming container: ${name}`);
  await old.rename({ name: `${name}_old` });
  log.line(`Kept as ${name}_old until the new container is running`);

  let created;
  try {
    log.section('Command execution');
    log.line(dockerRunCommand({ ...options, name: newName }));
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
    log.line(created.id);
    log.line('');
    log.line('The command finished successfully!');
  } catch (err) {
    // Rollback: restore the previous container.
    log.line(`ERROR: ${err.json?.message ?? err.message}`);
    log.section(`Rolling back: ${name}`);
    if (created) await created.remove({ force: true }).catch(() => {});
    await old.rename({ name });
    if (wasRunning) await old.start();
    log.line(`Previous container restored${wasRunning ? ' and started' : ''}`);
    throw err;
  }

  log.section(`Removing container: ${name}_old`);
  await old.remove();
  log.line(`Successfully removed container: ${name}_old`);
  return newName;
}

function stopTimeout() {
  try {
    return getSettings().autoUpdate.stopTimeout;
  } catch {
    return 15;
  }
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

/**
 * Pulls the latest image and recreates the container. Self-updates go through a helper container.
 * Every attempt is recorded in the update history. Returns { name, image, from, to, selfUpdate }.
 */
export async function updateContainer(id, { trigger = 'manual', log = silent } = {}) {
  const inspect = await docker.getContainer(id).inspect();
  const name = cleanName(inspect.Name);
  const image = inspect.Config.Image;
  const project = inspect.Config.Labels?.[COMPOSE_PROJECT];
  if (project && (await listStacks()).includes(project) && !(await isSelf(id))) {
    const service = inspect.Config.Labels[COMPOSE_SERVICE];
    const [item] = await updateStackServices(project, [{ id, name, service }], { trigger, log });
    return { ...item, selfUpdate: false };
  }
  const started = Date.now();
  let change = {};

  const record = (result, extra = {}) => addHistory({
    container: name, image, ...change, trigger, result, durationMs: Date.now() - started, ...extra,
  }).catch((e) => console.error('Could not save history:', e.message));

  try {
    if (isLocalImageRef(image)) {
      throw httpError(400, `${name} uses a local image ID and cannot be updated from a registry.`);
    }
    // Pull first: if it fails (e.g. auth) the container is left untouched.
    log.section(`Pulling image: ${image}`);
    try {
      await pull(image, log);
    } catch (err) {
      log.line(`ERROR: ${err.message}`);
      log.line(`${name} was not modified.`);
      if (err.auth) updateStatus.set(name, { status: 'auth-required', message: err.message });
      throw err;
    }
    const latest = await docker.getImage(image).inspect();
    const current = await docker.getImage(inspect.Image).inspect().catch(() => ({ Id: inspect.Image }));
    change = latest.Id === inspect.Image
      ? { from: versionChange(current, latest).from, to: versionChange(current, latest).from, kind: 'reinstall' }
      : versionChange(current, latest);

    if (await isSelf(id)) {
      log.section('Updating DockerUpdates');
      log.line('DockerUpdates cannot replace itself while running: a short-lived helper container will');
      log.line('recreate it with the new image in a few seconds. This page reloads automatically.');
      await scheduleSelfUpdate(inspect);
      await record('scheduled');
      return { name, image, ...change, selfUpdate: true };
    }

    await recreateContainer(id, undefined, log);
    updateStatus.set(name, { status: 'up-to-date' });
    await record('success');
    if (latest.Id !== inspect.Image) {
      const removed = await removeOldImage(inspect.Image);
      if (removed) {
        const short = inspect.Image.replace(/^sha256:/, '').slice(0, 12);
        log.section(`Removing orphan image: ${short}`);
        log.line(`Successfully removed orphan image: ${short}`);
      }
    }
    return { name, image, ...change, selfUpdate: false };
  } catch (err) {
    await record('failed', { error: err.message });
    throw err;
  }
}

/**
 * Updates services of a managed stack with docker compose (pull, then up -d for just those
 * services), so the compose file stays the source of truth. One history entry per service.
 * `services`: [{ id, name, service }]. Returns [{ name, image, from, to }].
 */
async function updateStackServices(project, services, { trigger = 'manual', log = silent } = {}) {
  const started = Date.now();
  const before = await Promise.all(services.map(async (s) => {
    const inspect = await docker.getContainer(s.id).inspect();
    return { ...s, image: inspect.Config.Image, imageId: inspect.Image };
  }));
  const names = [...new Set(before.map((b) => b.service))];
  const record = (b, result, extra = {}) => addHistory({
    container: b.name, image: b.image, stack: project, trigger, result, durationMs: Date.now() - started, ...extra,
  }).catch((e) => console.error('Could not save history:', e.message));

  try {
    log.section(`Pulling images: ${project} (${names.join(', ')})`);
    await compose(project, ['pull', '--ignore-buildable', ...names], log);
    log.section(`Recreating services: ${names.join(', ')}`);
    // --no-deps: a dependency whose new image was already pulled (by an update check) is not
    // recreated along with them; it is updated when it is selected
    await compose(project, ['up', '-d', '--no-deps', ...names], log);
  } catch (err) {
    log.line(`ERROR: ${err.message}`);
    await Promise.all(before.map((b) => record(b, 'failed', { error: err.message })));
    throw err;
  }

  const items = [];
  for (const b of before) {
    const latest = await docker.getImage(b.image).inspect();
    const current = await docker.getImage(b.imageId).inspect().catch(() => ({ Id: b.imageId }));
    const change = latest.Id === b.imageId
      ? { from: versionChange(current, latest).from, to: versionChange(current, latest).from, kind: 'reinstall' }
      : versionChange(current, latest);
    updateStatus.set(b.name, { status: 'up-to-date' });
    await record(b, 'success', change);
    if (latest.Id !== b.imageId && (await removeOldImage(b.imageId))) {
      log.line(`Removed orphan image: ${b.imageId.replace(/^sha256:/, '').slice(0, 12)}`);
    }
    items.push({ name: b.name, image: b.image, ...change });
  }
  log.line('');
  log.line('The command finished successfully!');
  return items;
}

// ---------- Compose stacks ----------

/** Containers of a compose project (managed or external). */
async function stackContainers(project) {
  return docker.listContainers({ all: true, filters: { label: [`${COMPOSE_PROJECT}=${project}`] } });
}

/** Validates and saves a new / edited managed stack; returns `run(log)` that deploys it. */
export function prepareStackDeploy(body) {
  return prepareDeploy(body ?? {}, {
    projectInUse: async (name) => (await stackContainers(name)).length > 0,
    hostPath: (p) => hostPathFor(p).catch(() => null),
  });
}

/**
 * start / stop / restart every service of a stack: with docker compose when it is managed here
 * (respects depends_on), else container by container. DockerUpdates itself is never stopped.
 */
export async function stackAction(project, action) {
  safeStackName(project);
  if (!['start', 'stop', 'restart', 'down'].includes(action)) throw httpError(400, 'Invalid action');
  const [list, self] = await Promise.all([stackContainers(project), selfId()]);
  if (list.some((i) => i.Id === self) && action !== 'start') {
    throw httpError(400, 'This stack runs DockerUpdates itself: stop its other services one by one');
  }
  const managed = (await listStacks()).includes(project);
  if (action === 'down') {
    if (!managed) throw httpError(400, 'Only stacks created in DockerUpdates can be removed here');
    await removeStack(project);
    await setStackColor(project, null).catch(() => {});
    return { affected: list.length, failed: 0 };
  }
  if (managed) {
    // `up -d` only to deploy a stack with no container: on existing ones it would also recreate
    // the services whose new image an update check already pulled (an update without history)
    await compose(project, action === 'start' && list.length === 0 ? ['up', '-d'] : [action]);
    return { affected: list.length, failed: 0 };
  }
  const results = await Promise.allSettled(list.map((i) => doAction(i.Id, action)));
  return {
    affected: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  };
}

/** Checks every service of a stack for updates. */
export async function checkStackUpdates(project) {
  safeStackName(project);
  const summary = { upToDate: 0, available: 0, authRequired: 0, failed: 0, local: 0 };
  for (const i of await stackContainers(project)) {
    const { status } = await checkUpdate(i.Id);
    if (status === 'up-to-date') summary.upToDate++;
    else if (status === 'update-available') summary.available++;
    else if (status === 'auth-required') summary.authRequired++;
    else if (status === 'local') summary.local++;
    else summary.failed++;
  }
  return summary;
}

/**
 * Autostart (restart policy unless-stopped / no) for every service of a stack, applied to the
 * running containers at once (no restart). A managed stack also gets it in its compose file
 * first, so a redeploy or an update does not bring the old policy back.
 */
export async function setStackAutostart(project, enabled) {
  safeStackName(project);
  if ((await listStacks()).includes(project)) await setStackRestart(project, enabled);
  const list = await stackContainers(project);
  const results = await Promise.allSettled(list.map((i) => setAutostart(i.Id, enabled)));
  return {
    affected: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  };
}

/** Checks the containers of a stack shortly after it was deployed. */
export async function checkStackSoon(project) {
  for (const i of await stackContainers(project)) checkUpdateSoon(i.Id);
}

/** Deletes the image a container used before an update (if enabled and nothing else uses it). */
async function removeOldImage(imageId) {
  try {
    if (!getSettings().cleanup.removeOldImageAfterUpdate) return false;
    await docker.getImage(imageId).remove();
    return true;
  } catch {
    return false; // still used by another container / already gone
  }
}

/**
 * Updates the given containers (default: every one with an update available).
 * DockerUpdates itself always goes last because its update restarts this process.
 */
export async function updateMany({ ids, trigger = 'manual', log = silent } = {}) {
  const summary = { updated: 0, failed: [], selfUpdate: false, items: [] };
  const all = await listContainers();
  const pending = ids
    ? all.filter((c) => ids.includes(c.id))
    : all.filter((c) => c.updateStatus === 'update-available');
  pending.sort((a, b) => Number(a.isSelf) - Number(b.isSelf));

  // Services of stacks managed here: one `docker compose pull` + `up -d` per stack
  const byStack = new Map();
  for (const c of pending) {
    if (!c.stack?.managed || c.isSelf) continue;
    byStack.set(c.stack.project, [...(byStack.get(c.stack.project) ?? []), c]);
  }
  for (const [project, list] of byStack) {
    try {
      const items = await updateStackServices(
        project,
        list.map((c) => ({ id: c.id, name: c.name, service: c.stack.service })),
        { trigger, log },
      );
      summary.updated += items.length;
      summary.items.push(...items);
    } catch (err) {
      for (const c of list) summary.failed.push({ name: c.name, image: c.image, error: err.message });
    }
  }

  for (const c of pending.filter((x) => !(x.stack?.managed && !x.isSelf))) {
    try {
      const r = await updateContainer(c.id, { trigger, log });
      if (r.selfUpdate) summary.selfUpdate = true;
      else summary.updated++;
      summary.items.push({ name: r.name, image: r.image, from: r.from, to: r.to });
    } catch (err) {
      summary.failed.push({ name: c.name, image: c.image, error: err.message });
    }
  }
  return summary;
}

export const updateAll = () => updateMany();

// ---------- Image cleanup ----------

/** Images that a cleanup would remove: { images: [{ id, tags, size }], size } */
export async function cleanupPreview(mode = getSettings().cleanup.mode) {
  const [images, containers] = await Promise.all([
    docker.listImages({ all: false }),
    docker.listContainers({ all: true }),
  ]);
  const used = new Set(containers.map((c) => c.ImageID));
  const candidates = images.filter((img) => {
    if (used.has(img.Id)) return false;
    const dangling = !img.RepoTags?.length || img.RepoTags.every((t) => t === '<none>:<none>');
    return mode === 'unused' || dangling;
  });
  return {
    mode,
    images: candidates.map((img) => ({
      id: img.Id.replace(/^sha256:/, '').slice(0, 12),
      tags: (img.RepoTags ?? []).filter((t) => t !== '<none>:<none>'),
      size: img.Size,
      created: new Date(img.Created * 1000).toISOString(),
    })),
    size: candidates.reduce((sum, img) => sum + img.Size, 0),
  };
}

/** Removes the images listed by cleanupPreview. Returns { count, freed, failed }. */
export async function runCleanup(mode = getSettings().cleanup.mode) {
  const preview = await cleanupPreview(mode);
  let count = 0;
  let freed = 0;
  const failed = [];
  for (const img of preview.images) {
    try {
      await docker.getImage(img.id).remove({ force: false });
      count++;
      freed += img.size;
    } catch (err) {
      failed.push({ id: img.id, error: err.json?.message ?? err.message });
    }
  }
  return { mode, count, freed, failed };
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

export { listNetworkInfo as listNetworks } from './ipCheck.js';

/** Applies an edited spec: validates, pulls a new image if needed, recreates the container. */
export async function editContainer(id, spec) {
  await assertNotSelf(id, 'edit');
  const current = await docker.getContainer(id).inspect();
  // Recreating it here would make it differ from its compose file
  const project = current.Config.Labels?.[COMPOSE_PROJECT];
  if (project) throw httpError(409, `${cleanName(current.Name)} belongs to the compose stack "${project}": edit its compose file instead`);
  const next = { ...spec, image: withTag(spec.image ?? '') };
  validateSpec(next); // fail before touching anything
  await validateFixedIp(next.network || 'bridge', String(next.ip ?? '').trim());

  // Icon first: a bad URL aborts the edit
  if (spec.iconUrl !== undefined) await setCustomIcon(next.image, spec.iconUrl);

  if (next.image !== current.Config.Image) await pull(next.image);

  const oldName = cleanName(current.Name);
  const name = await recreateContainer(id, (base) => buildCreateOptions(next, base));
  updateStatus.delete(oldName);
  if (name !== oldName) {
    await renameInHistory(oldName, name);
    await renameInOrder(oldName, name).catch((e) => console.error('Could not update the container order:', e.message));
  }
  await saveTemplate(next).catch((e) => console.error('Could not save template:', e.message));
  checkUpdateSoon(name);
  return { name };
}

/**
 * Validates a new container's spec (bad input fails here, before anything is pulled or created)
 * and returns `run(log)`, which pulls the image, creates and starts the container.
 */
export async function prepareCreate(spec) {
  const next = { ...spec, image: withTag(spec?.image ?? '') };
  const options = buildCreateOptions(next);
  await validateFixedIp(next.network || 'bridge', String(next.ip ?? '').trim());
  if (await exists(next.name)) throw httpError(409, `A container named "${next.name}" already exists`);
  if (spec.iconUrl) await setCustomIcon(next.image, spec.iconUrl);

  const run = async (log = silent) => {
    log.section(`Pulling image: ${next.image}`);
    try {
      await pull(next.image, log);
    } catch (err) {
      log.line(`ERROR: ${err.message}`);
      log.line(`${next.name} was not created.`);
      throw err;
    }
    // Saved before starting: if the container fails, it can be re-created from Templates
    log.section(`Saving template: ${next.name}`);
    try {
      await saveTemplate(next);
      log.line(`Successfully saved template: ${next.name}`);
    } catch (e) {
      console.error('Could not save template:', e.message);
      log.line(`WARNING: could not save the template (${e.message})`);
    }

    log.section('Command execution');
    log.line(dockerRunCommand(options));
    let container;
    try {
      container = await docker.createContainer(options);
      await container.start();
    } catch (err) {
      log.line(`ERROR: ${err.json?.message ?? err.message}`);
      if (container) log.line(`${next.name} was created but could not start. Fix its settings with Edit, or remove it.`);
      throw httpError(err.statusCode && err.statusCode !== 401 ? err.statusCode : 500, err.json?.message ?? err.message);
    }
    log.line(container.id);
    log.line('');
    log.line('The command finished successfully!');
    checkUpdateSoon(container.id);
    return { name: next.name, id: container.id };
  };
  return { name: next.name, run };
}

export async function createContainer(spec) {
  const { run } = await prepareCreate(spec);
  return (await run()).id;
}

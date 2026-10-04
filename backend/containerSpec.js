// Editable container "spec" (what the Add / Edit form shows) and its conversion to and
// from Docker API create options.
import {
  MANAGED_CONFIG_KEYS,
  isSystemLabel,
  parseExtraParams,
  serializeExtraParams,
} from './extraParams.js';

const bad = (message) => Object.assign(new Error(message), { status: 400 });

const RESTART = ['no', 'always', 'unless-stopped', 'on-failure'];

/** Docker-generated name of an anonymous volume (image VOLUME without a mapping). */
export const isAnonymousVolume = (host) => /^[a-f0-9]{64}$/.test(String(host ?? ''));

/**
 * Drops anonymous volumes whose container path is now mapped explicitly (e.g. the image's
 * /data volume after adding "/docker/app/data -> /data"); otherwise Docker would fail
 * with "Duplicate mount point".
 */
export function effectiveVolumes(volumes = []) {
  const rows = volumes.filter((v) => v.host && v.container);
  const explicit = new Set(rows.filter((v) => !isAnonymousVolume(v.host)).map((v) => normalizePath(v.container)));
  return rows.filter((v) => !isAnonymousVolume(v.host) || !explicit.has(normalizePath(v.container)));
}

const normalizePath = (p) => String(p).replace(/\/+$/, '') || '/';
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/** Spec of an existing container. `config` is the container config minus image defaults. */
export function specFromInspect(inspect, config, { logDriver } = {}) {
  const host = inspect.HostConfig;

  const ports = [];
  const seen = new Set();
  for (const [key, bindings] of Object.entries(host.PortBindings ?? {})) {
    const [container, protocol = 'tcp'] = key.split('/');
    for (const b of bindings?.length ? bindings : [{}]) {
      const ip = b.HostIp && b.HostIp !== '0.0.0.0' && b.HostIp !== '::' ? b.HostIp : '';
      const row = { host: b.HostPort ? (ip ? `${ip}:${b.HostPort}` : b.HostPort) : '', container, protocol };
      const k = JSON.stringify(row);
      if (!seen.has(k)) ports.push(row);
      seen.add(k);
    }
  }

  const volumes = (inspect.Mounts ?? [])
    .filter((m) => m.Type === 'bind' || m.Type === 'volume')
    .map((m) => ({
      host: m.Type === 'volume' ? m.Name : m.Source,
      container: m.Destination,
      mode: m.RW === false ? 'ro' : 'rw',
    }));

  const env = (config.Env ?? []).map((e) => {
    const eq = e.indexOf('=');
    return eq === -1 ? { key: e, value: '' } : { key: e.slice(0, eq), value: e.slice(eq + 1) };
  });

  const restart = host.RestartPolicy?.Name || 'no';
  const networkName = host.NetworkMode === 'default' ? 'bridge' : host.NetworkMode;
  return {
    name: inspect.Name.replace(/^\//, ''),
    image: inspect.Config.Image,
    network: networkName,
    // Only an explicitly configured IP (not one assigned automatically by Docker)
    ip: inspect.NetworkSettings?.Networks?.[networkName]?.IPAMConfig?.IPv4Address ?? '',
    restart: RESTART.includes(restart) ? restart : 'no',
    ports,
    volumes,
    env,
    // Memory limit has its own slider in the form, so it is not repeated in Extra parameters
    memory: host.Memory || 0,
    extraParams: serializeExtraParams(config, host, { logDriver, skipMemory: true }),
  };
}

function parseHostPort(value) {
  const v = String(value).trim();
  const colon = v.lastIndexOf(':');
  const ip = colon === -1 ? '' : v.slice(0, colon).replace(/^\[|\]$/g, '');
  const port = colon === -1 ? v : v.slice(colon + 1);
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw bad(`Invalid host port "${value}"`);
  }
  return { HostIp: ip, HostPort: port };
}

/** Validates a spec and throws a 400 with a readable message. */
export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw bad('Invalid container definition');
  if (!NAME_RE.test(spec.name ?? '')) throw bad('Invalid name: use letters, numbers, "_", "." or "-"');
  if (!String(spec.image ?? '').trim()) throw bad('Repository (image) is required');
  if (spec.restart && !RESTART.includes(spec.restart)) throw bad(`Invalid restart policy "${spec.restart}"`);
  for (const p of spec.ports ?? []) {
    if (!p.container && !p.host) continue;
    if (!/^\d+$/.test(String(p.container)) || Number(p.container) < 1 || Number(p.container) > 65535) {
      throw bad(`Invalid container port "${p.container}"`);
    }
    if (p.host) parseHostPort(p.host);
  }
  for (const v of spec.volumes ?? []) {
    if (!v.host && !v.container) continue;
    if (!v.host || !v.container) throw bad('Each volume needs both a host path and a container path');
    if (!String(v.container).startsWith('/')) throw bad(`Container path "${v.container}" must be absolute`);
  }
  const seen = new Set();
  for (const v of effectiveVolumes(spec.volumes)) {
    const target = normalizePath(v.container);
    if (seen.has(target)) throw bad(`Two volume mappings use the same container path "${target}"`);
    seen.add(target);
  }
  if (spec.memory !== undefined && (!Number.isFinite(Number(spec.memory)) || Number(spec.memory) < 0)) {
    throw bad('Invalid memory limit');
  }
  if (Number(spec.memory) > 0 && Number(spec.memory) < 6 * 1024 ** 2) throw bad('Memory limit must be at least 6 MB');
  for (const e of spec.env ?? []) {
    if (e.key && !/^[^=\s]+$/.test(e.key)) throw bad(`Invalid environment variable name "${e.key}"`);
  }
  return parseExtraParams(spec.extraParams ?? '');
}

/**
 * Docker create options from a spec.
 * `base` (optional) is the existing container: { config, hostConfig, networks, inspect }.
 * Settings the form does not manage (Cmd, extra mounts, compose labels...) are preserved.
 */
export function buildCreateOptions(spec, base = null) {
  const extra = validateSpec(spec);
  const config = { ...(base?.config ?? {}) };
  for (const key of MANAGED_CONFIG_KEYS) delete config[key];
  const { Labels: extraLabels, ...extraConfig } = extra.config;
  Object.assign(config, extraConfig);

  const keptLabels = Object.fromEntries(
    Object.entries(base?.config?.Labels ?? {}).filter(([k]) => isSystemLabel(k)),
  );
  config.Labels = { ...keptLabels, ...extraLabels };
  config.Image = spec.image.trim();
  config.Env = [
    ...(spec.env ?? []).filter((e) => e.key).map((e) => `${e.key}=${e.value ?? ''}`),
    ...extra.env,
  ];

  const network = spec.network || 'bridge';
  const exposed = {};
  const bindings = {};
  for (const p of spec.ports ?? []) {
    if (!p.container) continue;
    const key = `${p.container}/${p.protocol === 'udp' ? 'udp' : 'tcp'}`;
    exposed[key] = {};
    if (p.host && network !== 'host') (bindings[key] ??= []).push(parseHostPort(p.host));
  }
  config.ExposedPorts = exposed;

  const host = { ...(base?.hostConfig ?? {}), ...extra.host };
  // --memory in Extra parameters wins over the slider
  if (!host.Memory && Number(spec.memory) > 0) host.Memory = Math.round(Number(spec.memory));
  host.PortBindings = bindings;
  host.Binds = effectiveVolumes(spec.volumes).map((v) => `${v.host}:${v.container}${v.mode === 'ro' ? ':ro' : ''}`);
  // All bind/volume mounts are now in Binds; keep only tmpfs mounts from --mount
  host.Mounts = (host.Mounts ?? []).filter((m) => m.Type === 'tmpfs');
  host.NetworkMode = network;
  host.RestartPolicy = extra.restart ?? {
    Name: !spec.restart || spec.restart === 'no' ? '' : spec.restart,
    MaximumRetryCount: 0,
  };

  let NetworkingConfig;
  if (!['bridge', 'host', 'none', 'default'].includes(network) && !network.startsWith('container:')) {
    const old = base?.networks?.[network];
    const shortId = base?.inspect?.Id.slice(0, 12);
    const endpoint = old
      ? { IPAMConfig: old.IPAMConfig, Aliases: (old.Aliases ?? []).filter((a) => a !== shortId) }
      : {};
    // Fixed IP from the form ('' = automatic)
    const ip = String(spec.ip ?? '').trim();
    endpoint.IPAMConfig = ip ? { ...(endpoint.IPAMConfig ?? {}), IPv4Address: ip } : undefined;
    NetworkingConfig = { EndpointsConfig: { [network]: endpoint } };
  }

  return { name: spec.name, ...config, HostConfig: host, NetworkingConfig };
}

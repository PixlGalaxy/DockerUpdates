// "Extra parameters" (Unraid style): a subset of `docker run` flags that is parsed into
// Docker API create options, and generated back from an existing container for editing.

const bad = (message) => Object.assign(new Error(message), { status: 400 });

const UNITS = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
const MIN_MEMORY = 6 * 1024 ** 2; // Docker's minimum
const DEFAULT_SHM = 64 * 1024 ** 2;

/** "512m", "2g", "1.5G", "1024" (bytes) -> bytes */
export function parseSize(value, flag) {
  const m = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*([bkmgt])?(?:i?b)?$/i);
  if (!m) throw bad(`Invalid size "${value}" for --${flag} (use e.g. 512m or 2g)`);
  return Math.round(parseFloat(m[1]) * UNITS[(m[2] ?? 'b').toLowerCase()]);
}

/** bytes -> "2g" / "512m" (largest exact unit) */
export function formatSize(bytes) {
  for (const u of ['t', 'g', 'm', 'k']) {
    if (bytes % UNITS[u] === 0) return `${bytes / UNITS[u]}${u}`;
  }
  return String(bytes);
}

const human = (bytes) => {
  for (const u of ['T', 'G', 'M', 'K']) {
    const v = bytes / UNITS[u.toLowerCase()];
    if (v >= 1) return `${Number(v.toFixed(2))} ${u}iB`;
  }
  return `${bytes} B`;
};

/** Shell-like split: supports quotes, backslash escapes and line continuations. */
export function tokenize(input) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < input.length) cur += input[++i];
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === '\\' && /[\r\n]/.test(input[i + 1] ?? '')) {
      // line continuation: "\" + newline
      i++;
      if (input[i] === '\r' && input[i + 1] === '\n') i++;
    } else if (ch === '\\' && i + 1 < input.length) {
      cur += input[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (quote) throw bad('Unclosed quote in Extra parameters');
  if (started) out.push(cur);
  return out;
}

function splitKv(value, flag) {
  const eq = value.indexOf('=');
  if (eq <= 0) throw bad(`--${flag} expects key=value, got "${value}"`);
  return [value.slice(0, eq), value.slice(eq + 1)];
}

function toInt(value, flag, min = 0) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw bad(`Invalid value "${value}" for --${flag}`);
  return n;
}

const RESTART = ['no', 'always', 'unless-stopped', 'on-failure'];

/** Supported flags. `bool` flags take no value (or =true/false). */
const FLAGS = {
  memory: { alias: 'm', apply: (v, t) => {
    const n = parseSize(v, 'memory');
    if (n > 0 && n < MIN_MEMORY) throw bad('--memory must be at least 6m');
    t.host.Memory = n;
  } },
  'memory-swap': { apply: (v, t) => { t.host.MemorySwap = String(v) === '-1' ? -1 : parseSize(v, 'memory-swap'); } },
  'memory-reservation': { apply: (v, t) => { t.host.MemoryReservation = parseSize(v, 'memory-reservation'); } },
  cpus: { apply: (v, t) => {
    const n = Number(v);
    if (!(n > 0)) throw bad(`Invalid value "${v}" for --cpus (e.g. 1.5)`);
    t.host.NanoCpus = Math.round(n * 1e9);
  } },
  'cpu-shares': { alias: 'c', apply: (v, t) => { t.host.CpuShares = toInt(v, 'cpu-shares', 2); } },
  'cpuset-cpus': { apply: (v, t) => {
    if (!/^[\d,-]+$/.test(v)) throw bad(`Invalid value "${v}" for --cpuset-cpus (e.g. 0-3 or 0,2)`);
    t.host.CpusetCpus = v;
  } },
  restart: { apply: (v, t) => {
    const [name, count] = String(v).split(':');
    if (!RESTART.includes(name)) throw bad(`Invalid --restart "${v}" (no, always, unless-stopped, on-failure[:N])`);
    if (count !== undefined && name !== 'on-failure') throw bad('Only --restart=on-failure accepts a retry count');
    t.restart = { Name: name === 'no' ? '' : name, MaximumRetryCount: count ? toInt(count, 'restart') : 0 };
  } },
  hostname: { alias: 'h', apply: (v, t) => { t.config.Hostname = v; } },
  label: { alias: 'l', apply: (v, t) => { const [k, val] = splitKv(v, 'label'); t.config.Labels[k] = val; } },
  env: { alias: 'e', apply: (v, t) => { splitKv(v, 'env'); t.env.push(v); } },
  'add-host': { apply: (v, t) => {
    if (!/^[^:\s]+:.+$/.test(v)) throw bad(`--add-host expects host:ip, got "${v}"`);
    t.host.ExtraHosts.push(v);
  } },
  'cap-add': { apply: (v, t) => { t.host.CapAdd.push(v); } },
  'cap-drop': { apply: (v, t) => { t.host.CapDrop.push(v); } },
  device: { apply: (v, t) => {
    const [onHost, inContainer, perms] = v.split(':');
    t.host.Devices.push({ PathOnHost: onHost, PathInContainer: inContainer || onHost, CgroupPermissions: perms || 'rwm' });
  } },
  privileged: { bool: true, apply: (v, t) => { t.host.Privileged = v; } },
  init: { bool: true, apply: (v, t) => { t.host.Init = v || null; } },
  'read-only': { bool: true, apply: (v, t) => { t.host.ReadonlyRootfs = v; } },
  'shm-size': { apply: (v, t) => { t.host.ShmSize = parseSize(v, 'shm-size'); } },
  'pids-limit': { apply: (v, t) => { t.host.PidsLimit = toInt(v, 'pids-limit', -1); } },
  'log-driver': { apply: (v, t) => { t.host.LogConfig.Type = v; } },
  'log-opt': { apply: (v, t) => { const [k, val] = splitKv(v, 'log-opt'); t.host.LogConfig.Config[k] = val; } },
  user: { alias: 'u', apply: (v, t) => { t.config.User = v; } },
  workdir: { alias: 'w', apply: (v, t) => { t.config.WorkingDir = v; } },
  dns: { apply: (v, t) => { t.host.Dns.push(v); } },
  tmpfs: { apply: (v, t) => {
    const colon = v.indexOf(':');
    t.host.Tmpfs[colon === -1 ? v : v.slice(0, colon)] = colon === -1 ? '' : v.slice(colon + 1);
  } },
  'security-opt': { apply: (v, t) => { t.host.SecurityOpt.push(v); } },
  sysctl: { apply: (v, t) => { const [k, val] = splitKv(v, 'sysctl'); t.host.Sysctls[k] = val; } },
  ulimit: { apply: (v, t) => {
    const m = String(v).match(/^([a-z]+)=(-?\d+)(?::(-?\d+))?$/);
    if (!m) throw bad(`--ulimit expects name=soft[:hard], got "${v}"`);
    t.host.Ulimits.push({ Name: m[1], Soft: Number(m[2]), Hard: Number(m[3] ?? m[2]) });
  } },
  gpus: { apply: (v, t) => {
    const req = { Driver: '', Count: 0, DeviceIDs: null, Capabilities: [['gpu']], Options: {} };
    if (v === 'all') req.Count = -1;
    else if (/^\d+$/.test(v)) req.Count = Number(v);
    else if (/^"?device=/.test(v)) req.DeviceIDs = v.replace(/^"?device=|"$/g, '').split(',');
    else throw bad(`Invalid --gpus "${v}" (all, a number, or device=0,1)`);
    t.host.DeviceRequests.push(req);
  } },
  'stop-timeout': { apply: (v, t) => { t.config.StopTimeout = toInt(v, 'stop-timeout'); } },
  'stop-signal': { apply: (v, t) => { t.config.StopSignal = v; } },
};

const ALIASES = Object.fromEntries(
  Object.entries(FLAGS).filter(([, d]) => d.alias).map(([name, d]) => [d.alias, name]),
);
// Handled by the form instead
Object.assign(ALIASES, { p: 'publish', v: 'volume' });
const HINTS = {
  publish: 'Ports are configured in the "Port mappings" section, not in Extra parameters',
  volume: 'Volumes are configured in the "Volume mappings" section, not in Extra parameters',
  mount: 'Volumes are configured in the "Volume mappings" section, not in Extra parameters',
  network: 'Use the "Network" field instead of --network',
  net: 'Use the "Network" field instead of --net',
  name: 'Use the "Name" field instead of --name',
  detach: '--detach is not needed: containers always run in the background',
  d: '--detach is not needed: containers always run in the background',
  rm: '--rm is not supported for managed containers',
  it: 'Interactive flags (-it) are not supported',
};

/** Host config keys owned by Extra parameters (reset to defaults before applying). */
function emptyTarget() {
  return {
    host: {
      Memory: 0, MemorySwap: 0, MemoryReservation: 0, NanoCpus: 0, CpuShares: 0, CpusetCpus: '',
      ExtraHosts: [], CapAdd: [], CapDrop: [], Devices: [], Privileged: false, Init: null,
      ReadonlyRootfs: false, ShmSize: 0, PidsLimit: null, LogConfig: { Type: '', Config: {} },
      Dns: [], Tmpfs: {}, SecurityOpt: [], Sysctls: {}, Ulimits: [], DeviceRequests: [],
    },
    config: { Labels: {} },
    env: [],
    restart: null,
  };
}

/** Config keys owned by Extra parameters. */
// StopTimeout is not managed: Docker fills it in on every container, so it is preserved as-is
// on recreate (--stop-timeout in Extra parameters still overrides it).
export const MANAGED_CONFIG_KEYS = ['Hostname', 'User', 'WorkingDir', 'StopSignal'];

/** Labels kept untouched (not shown in Extra parameters). */
export const isSystemLabel = (key) => /^(com\.docker\.|org\.opencontainers\.|dockerupdates\.)/.test(key);

export function parseExtraParams(input = '') {
  const t = emptyTarget();
  const tokens = tokenize(String(input));
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.startsWith('-') || tok === '-' || tok === '--') {
      throw bad(`Unexpected "${tok}" in Extra parameters: only --flags are allowed`);
    }
    let name;
    let value;
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      name = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      value = eq === -1 ? undefined : tok.slice(eq + 1);
    } else {
      name = ALIASES[tok[1]] ?? tok.slice(1);
      value = tok.length > 2 ? tok.slice(2).replace(/^=/, '') : undefined;
    }
    const def = FLAGS[name];
    if (!def) throw bad(HINTS[name] ?? `Unsupported flag "${tok}" in Extra parameters`);
    if (def.bool) {
      if (value !== undefined && !['true', 'false'].includes(value)) throw bad(`--${name} only accepts true or false`);
      value = value !== 'false';
    } else if (value === undefined) {
      value = tokens[++i];
      if (value === undefined) throw bad(`--${name} needs a value`);
    }
    def.apply(value, t);
  }
  return t;
}

/** Short human summary, shown under the Extra parameters field while typing. */
export function describeExtraParams(t) {
  const h = t.host;
  const out = [];
  if (h.Memory) out.push(`Memory limit: ${human(h.Memory)}`);
  if (h.MemorySwap) out.push(`Memory + swap: ${h.MemorySwap === -1 ? 'unlimited' : human(h.MemorySwap)}`);
  if (h.MemoryReservation) out.push(`Memory reservation: ${human(h.MemoryReservation)}`);
  if (h.NanoCpus) out.push(`CPU limit: ${h.NanoCpus / 1e9} cores`);
  if (h.CpuShares) out.push(`CPU shares: ${h.CpuShares}`);
  if (h.CpusetCpus) out.push(`CPU set: ${h.CpusetCpus}`);
  if (t.restart) {
    out.push(`Restart: ${t.restart.Name || 'no'}${t.restart.MaximumRetryCount ? ` (max ${t.restart.MaximumRetryCount})` : ''}`);
  }
  if (h.Privileged) out.push('Privileged');
  if (h.DeviceRequests.length) out.push('GPU access');
  if (h.Devices.length) out.push(`${h.Devices.length} device(s)`);
  if (h.ShmSize) out.push(`/dev/shm: ${human(h.ShmSize)}`);
  if (h.PidsLimit) out.push(`PIDs limit: ${h.PidsLimit}`);
  if (t.config.Hostname) out.push(`Hostname: ${t.config.Hostname}`);
  const labels = Object.keys(t.config.Labels).length;
  if (labels) out.push(`${labels} label(s)`);
  if (t.env.length) out.push(`${t.env.length} env var(s)`);
  if (h.LogConfig.Type || Object.keys(h.LogConfig.Config).length) out.push('Custom logging');
  return out;
}

function quote(value) {
  const s = String(value);
  return /[\s"'\\]/.test(s) ? `"${s.replace(/(["\\])/g, '\\$1')}"` : s;
}

/**
 * Builds the Extra parameters string for an existing container.
 * `config` must already be stripped of image defaults (see userConfig in docker.js).
 */
export function serializeExtraParams(config, host, { logDriver, skipMemory = false, skipCpuset = false } = {}) {
  const out = [];
  const add = (flag, value) => out.push(value === undefined ? `--${flag}` : `--${flag}=${quote(value)}`);

  if (host.Memory && !skipMemory) add('memory', formatSize(host.Memory));
  // Docker defaults swap to 2x memory when only --memory is given
  if (host.MemorySwap && host.MemorySwap !== host.Memory * 2) {
    add('memory-swap', host.MemorySwap === -1 ? '-1' : formatSize(host.MemorySwap));
  }
  if (host.MemoryReservation) add('memory-reservation', formatSize(host.MemoryReservation));
  if (host.NanoCpus) add('cpus', String(host.NanoCpus / 1e9));
  if (host.CpuShares) add('cpu-shares', host.CpuShares);
  if (host.CpusetCpus && !skipCpuset) add('cpuset-cpus', host.CpusetCpus);
  if (host.RestartPolicy?.Name === 'on-failure' && host.RestartPolicy.MaximumRetryCount) {
    add('restart', `on-failure:${host.RestartPolicy.MaximumRetryCount}`);
  }
  if (config.Hostname) add('hostname', config.Hostname);
  for (const [k, v] of Object.entries(config.Labels ?? {})) if (!isSystemLabel(k)) add('label', `${k}=${v}`);
  for (const h of host.ExtraHosts ?? []) add('add-host', h);
  for (const c of host.CapAdd ?? []) add('cap-add', c);
  for (const c of host.CapDrop ?? []) add('cap-drop', c);
  for (const d of host.Devices ?? []) {
    const perms = d.CgroupPermissions && d.CgroupPermissions !== 'rwm' ? `:${d.CgroupPermissions}` : '';
    const target = d.PathInContainer && (d.PathInContainer !== d.PathOnHost || perms) ? `:${d.PathInContainer}` : '';
    add('device', `${d.PathOnHost}${target}${perms}`);
  }
  if (host.Privileged) add('privileged');
  if (host.Init) add('init');
  if (host.ReadonlyRootfs) add('read-only');
  if (host.ShmSize && host.ShmSize !== DEFAULT_SHM) add('shm-size', formatSize(host.ShmSize));
  if (host.PidsLimit > 0) add('pids-limit', host.PidsLimit);
  if (host.LogConfig?.Type && host.LogConfig.Type !== logDriver) add('log-driver', host.LogConfig.Type);
  for (const [k, v] of Object.entries(host.LogConfig?.Config ?? {})) add('log-opt', `${k}=${v}`);
  if (config.User) add('user', config.User);
  if (config.WorkingDir) add('workdir', config.WorkingDir);
  for (const d of host.Dns ?? []) add('dns', d);
  for (const [p, o] of Object.entries(host.Tmpfs ?? {})) add('tmpfs', o ? `${p}:${o}` : p);
  for (const s of host.SecurityOpt ?? []) add('security-opt', s);
  for (const [k, v] of Object.entries(host.Sysctls ?? {})) add('sysctl', `${k}=${v}`);
  for (const u of host.Ulimits ?? []) add('ulimit', `${u.Name}=${u.Soft}${u.Hard !== u.Soft ? `:${u.Hard}` : ''}`);
  for (const r of host.DeviceRequests ?? []) {
    if (!r.Capabilities?.some((c) => c.includes('gpu'))) continue;
    add('gpus', r.DeviceIDs?.length ? `device=${r.DeviceIDs.join(',')}` : r.Count === -1 ? 'all' : String(r.Count));
  }
  if (config.StopSignal) add('stop-signal', config.StopSignal);
  return out.join(' ');
}

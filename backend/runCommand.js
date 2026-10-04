// Human-readable `docker run` equivalent of Docker API create options (shown in the update
// log, like Unraid's "Command execution"). Secret-looking environment values are masked.

const SECRET_KEY = /(pass(word)?|secret|token|api[_-]?key|private|credential|auth|cookie|session)/i;

const q = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;

export function maskEnv(entry) {
  const eq = entry.indexOf('=');
  if (eq === -1) return entry;
  const key = entry.slice(0, eq);
  return SECRET_KEY.test(key) ? `${key}=********` : entry;
}

export function dockerRunCommand(options) {
  const h = options.HostConfig ?? {};
  const lines = ['docker run', '  -d', `  --name=${q(options.name)}`];
  const add = (s) => lines.push(`  ${s}`);

  if (h.NetworkMode) add(`--net=${q(h.NetworkMode === 'default' ? 'bridge' : h.NetworkMode)}`);
  const ip = Object.values(options.NetworkingConfig?.EndpointsConfig ?? {})[0]?.IPAMConfig?.IPv4Address;
  if (ip) add(`--ip=${q(ip)}`);
  if (options.Hostname) add(`--hostname=${q(options.Hostname)}`);
  if (h.CpusetCpus) add(`--cpuset-cpus=${q(h.CpusetCpus)}`);
  if (h.NanoCpus) add(`--cpus=${h.NanoCpus / 1e9}`);
  if (h.PidsLimit > 0) add(`--pids-limit ${h.PidsLimit}`);
  if (h.Privileged) add('--privileged');
  for (const d of h.Devices ?? []) add(`--device=${q(`${d.PathOnHost}:${d.PathInContainer}`)}`);
  for (const c of h.CapAdd ?? []) add(`--cap-add=${c}`);
  for (const e of options.Env ?? []) {
    const m = maskEnv(e);
    const eq = m.indexOf('=');
    add(eq === -1 ? `-e ${q(m)}` : `-e ${q(m.slice(0, eq))}=${q(m.slice(eq + 1))}`);
  }
  for (const [k, v] of Object.entries(options.Labels ?? {})) {
    if (/^(com\.docker\.compose\.|org\.opencontainers\.)/.test(k)) continue;
    add(`-l ${k}=${q(v)}`);
  }
  for (const [port, bindings] of Object.entries(h.PortBindings ?? {})) {
    for (const b of bindings ?? []) add(`-p ${q(`${b.HostIp ? `${b.HostIp}:` : ''}${b.HostPort}:${port}`)}`);
  }
  for (const bind of h.Binds ?? []) {
    const parts = bind.split(':');
    const mode = parts.length > 2 && !parts.at(-1).startsWith('/') ? parts.pop() : 'rw';
    const target = parts.pop();
    add(`-v ${q(parts.join(':'))}:${q(target)}:${q(mode)}`);
  }
  const restart = h.RestartPolicy?.Name;
  if (restart && restart !== 'no') {
    add(`--restart ${restart}${restart === 'on-failure' && h.RestartPolicy.MaximumRetryCount ? `:${h.RestartPolicy.MaximumRetryCount}` : ''}`);
  }
  const memory = h.Memory ? `--memory=${formatMem(h.Memory)} ` : '';
  const cmd = (options.Cmd ?? []).map(q).join(' ');
  add(`${memory}${q(options.Image)}${cmd ? ` ${cmd}` : ''}`);
  return lines.join('\n');
}

function formatMem(bytes) {
  for (const [u, n] of [['G', 1024 ** 3], ['M', 1024 ** 2], ['K', 1024]]) {
    if (bytes % n === 0) return `${bytes / n}${u}`;
  }
  return String(bytes);
}

/** "1.2 MB" style sizes used in the pull log (decimal like Docker / Unraid). */
export function humanSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? v : Math.round(v)} ${units[i]}`;
}

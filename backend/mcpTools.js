// Tools offered to AI assistants over MCP (see mcp.js). Each tool has a minimum access level
// (Settings → AI assistants): read < basic < full. Tools that change or remove something
// existing are marked destructiveHint, so Claude / ChatGPT ask the user before running them.
import { PassThrough } from 'node:stream';
import * as dk from './docker.js';
import { listHistory } from './history.js';
import { checkComposeConfig, checkContainerSpec, conventions } from './mcpStorage.js';
import { notify } from './notify.js';
import { SECRET_KEY } from './runCommand.js';
import * as scheduler from './scheduler.js';
import { getStack, listStacks } from './stacks.js';

const MASK = '********';
const MAX_OUTPUT = 100_000;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

const REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
function ref(value) {
  const v = String(value ?? '').trim();
  if (!REF_RE.test(v)) throw bad('Invalid container name or id');
  return v;
}

async function assertNotSelf(id, what) {
  const self = await dk.selfId();
  const info = await dk.docker.getContainer(id).inspect();
  if (self && info.Id === self) throw bad(`AI assistants cannot ${what} DockerUpdates' own container.`);
  return info;
}

// ---------- Secrets: masked for the AI, restored when it sends the mask back ----------

const maskEnvList = (env = []) => env.map((e) => (e.value && SECRET_KEY.test(e.key) ? { ...e, value: MASK } : e));

function restoreEnvList(next = [], current = []) {
  return next.map((e) => {
    if (e?.value !== MASK) return e;
    const old = current.find((c) => c.key === e.key);
    if (!old) throw bad(`Environment variable ${e.key} has the masked value "${MASK}" but did not exist before: give its real value`);
    return { ...e, value: old.value };
  });
}

// "KEY=value", "KEY: value", "- KEY=value" lines (.env files and compose environment entries)
const SECRET_LINE = /^(\s*-?\s*["']?)([A-Za-z_][\w.-]*)(["']?\s*[:=][ \t]*)(.*)$/;

function maskText(text) {
  return String(text ?? '').split('\n').map((line) => {
    const m = SECRET_LINE.exec(line);
    return m && SECRET_KEY.test(m[2]) && m[4].trim() && !/^[|>]/.test(m[4].trim()) ? `${m[1]}${m[2]}${m[3]}${MASK}` : line;
  }).join('\n');
}

function restoreText(next, current) {
  const old = String(current ?? '').split('\n');
  const used = new Set();
  return String(next ?? '').split('\n').map((line) => {
    if (!line.includes(MASK)) return line;
    const m = SECRET_LINE.exec(line);
    const i = m ? old.findIndex((o, idx) => !used.has(idx) && SECRET_LINE.exec(o)?.[2] === m[2]) : -1;
    if (i === -1) throw bad(`A line has the masked value "${MASK}" but its previous value is unknown: ${line.trim().slice(0, 80)}`);
    used.add(i);
    return `${m[1]}${m[2]}${m[3]}${SECRET_LINE.exec(old[i])[4]}`;
  }).join('\n');
}

// ---------- Helpers ----------

/** Splits Docker's multiplexed stdout/stderr frames (non-TTY containers). */
function demux(buffer) {
  let out = '';
  let i = 0;
  while (i + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(i + 4);
    out += buffer.subarray(i + 8, i + 8 + size).toString('utf8');
    i += 8 + size;
  }
  return out;
}

const cap = (text) => (text.length > MAX_OUTPUT ? `[... cut, last ${MAX_OUTPUT} characters ...]\n${text.slice(-MAX_OUTPUT)}` : text);

async function readLogs(id, { lines = 200, since } = {}) {
  const c = dk.docker.getContainer(id);
  const info = await c.inspect();
  const opts = { follow: false, stdout: true, stderr: true, timestamps: true, tail: Math.min(Math.max(Number(lines) || 200, 1), 2000) };
  if (since) {
    const m = /^(\d+)\s*([smhd])$/.exec(String(since).trim());
    if (!m) throw bad('since: use a duration like 30m, 6h or 2d');
    opts.since = Math.floor(Date.now() / 1000) - Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  }
  const raw = await c.logs(opts);
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  return { container: info.Name.replace(/^\//, ''), logs: cap(info.Config.Tty ? buf.toString('utf8') : demux(buf)) };
}

async function exec(id, command, timeoutSeconds = 30) {
  const info = await assertNotSelf(id, 'run commands in');
  if (!info.State.Running) throw bad('The container is not running');
  const c = dk.docker.getContainer(id);
  const run = await c.exec({ Cmd: ['sh', '-c', command], AttachStdout: true, AttachStderr: true, Tty: false });
  const stream = await run.start({ hijack: true, stdin: false });
  let stdout = '';
  let stderr = '';
  const out = new PassThrough().on('data', (d) => { stdout += d; });
  const err = new PassThrough().on('data', (d) => { stderr += d; });
  dk.docker.modem.demuxStream(stream, out, err);
  const limit = Math.min(Math.max(Number(timeoutSeconds) || 30, 1), 300) * 1000;
  const finished = await Promise.race([
    new Promise((resolve) => {
      stream.on('end', () => resolve(true));
      stream.on('error', () => resolve(true));
    }),
    new Promise((resolve) => setTimeout(() => resolve(false), limit)),
  ]);
  if (!finished) stream.destroy();
  const { ExitCode } = await run.inspect().catch(() => ({ ExitCode: null }));
  return {
    exitCode: finished ? ExitCode : null,
    timedOut: !finished,
    ...(finished ? {} : { note: `No answer after ${limit / 1000} s: output so far is shown, the command may still be running.` }),
    stdout: cap(stdout),
    stderr: cap(stderr),
  };
}

function summary(c) {
  return {
    name: c.name,
    image: c.image,
    state: c.state,
    status: c.status,
    health: c.health ?? undefined,
    network: c.network,
    ip: c.ip,
    ports: c.ports.filter((p) => p.hostPort).map((p) => `${p.hostPort}->${p.containerPort}/${p.protocol}`),
    autostart: c.autostart,
    update: c.updateStatus,
    ...(c.updateStatus === 'available' && c.updateTo ? { updateFrom: c.updateFrom, updateTo: c.updateTo } : {}),
    stack: c.stack ? `${c.stack.project}/${c.stack.service}${c.stack.managed ? ' (managed)' : ''}` : undefined,
    isDockerUpdates: c.isSelf || undefined,
  };
}

async function notifyUpdate(result, error, name) {
  const host = await dk.hostName();
  if (error) void notify('update-failed', { items: [{ name, error: error.message }], trigger: 'manual', host });
  else if (!result.selfUpdate) void notify('updated', { items: [result], trigger: 'manual', host });
}

// ---------- Schemas ----------

const containerArg = { type: 'string', description: 'Container name (or id)' };
const SPEC_SCHEMA = {
  type: 'object',
  description: 'Container definition (same fields get_container returns)',
  properties: {
    name: { type: 'string', description: 'Container name' },
    image: { type: 'string', description: 'Image, e.g. lscr.io/linuxserver/jellyfin:latest' },
    network: { type: 'string', description: 'Network: bridge (default), host, or a network from list_networks' },
    ip: { type: 'string', description: 'Fixed IPv4 (only on custom / LAN networks), empty = automatic' },
    restart: { type: 'string', enum: ['no', 'always', 'unless-stopped', 'on-failure'] },
    ports: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'Host port, optionally "ip:port"' },
          container: { type: 'string', description: 'Container port' },
          protocol: { type: 'string', enum: ['tcp', 'udp'] },
        },
        required: ['container'],
      },
    },
    volumes: {
      type: 'array',
      description: 'Bind mounts only: absolute host folder -> container path. Follow get_storage_conventions.',
      items: {
        type: 'object',
        properties: {
          host: { type: 'string' },
          container: { type: 'string' },
          mode: { type: 'string', enum: ['rw', 'ro'] },
        },
        required: ['host', 'container'],
      },
    },
    env: {
      type: 'array',
      description: `Environment variables. A value of "${MASK}" keeps the current (hidden) value.`,
      items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key'] },
    },
    memory: { type: 'number', description: 'Memory limit in bytes (0 = none)' },
    cpuset: { type: 'string', description: 'CPU pinning, e.g. 0-3' },
    extraParams: { type: 'string', description: 'Extra docker run flags, e.g. "--device=/dev/dri --cap-add=NET_ADMIN"' },
  },
  required: ['name', 'image'],
};

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const CHANGE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

// ---------- Tools ----------

export const TOOLS = [
  {
    name: 'list_containers',
    level: 'read',
    title: 'List containers',
    description: 'Every container with its state, image, ports, network, health and update status.',
    annotations: READ,
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await dk.listContainers()).map(summary),
  },
  {
    name: 'get_container',
    level: 'read',
    title: 'Get container settings',
    description: `Full settings of one container (image, ports, volumes, env, network, limits, extra docker run flags), in the format edit_container takes. Secret-looking environment values are shown as "${MASK}".`,
    annotations: READ,
    inputSchema: { type: 'object', properties: { container: containerArg }, required: ['container'] },
    run: async ({ container }) => {
      const id = ref(container);
      const [spec, inspect] = await Promise.all([dk.getContainerSpec(id), dk.docker.getContainer(id).inspect()]);
      const { iconUrl, ...rest } = spec;
      return {
        ...rest,
        env: maskEnvList(rest.env),
        state: inspect.State.Status,
        startedAt: inspect.State.StartedAt,
        restartCount: inspect.RestartCount,
        stack: inspect.Config.Labels?.['com.docker.compose.project'] ?? undefined,
      };
    },
  },
  {
    name: 'get_container_logs',
    level: 'read',
    title: 'Read container logs',
    description: 'Last lines of a container\'s logs (stdout and stderr, with timestamps).',
    annotations: READ,
    inputSchema: {
      type: 'object',
      properties: {
        container: containerArg,
        lines: { type: 'number', description: 'How many lines (default 200, max 2000)' },
        since: { type: 'string', description: 'Only logs newer than this, e.g. 30m, 6h, 2d' },
      },
      required: ['container'],
    },
    run: ({ container, lines, since }) => readLogs(ref(container), { lines, since }),
  },
  {
    name: 'list_stacks',
    level: 'read',
    title: 'List compose stacks',
    description: 'Compose stacks: the ones managed by DockerUpdates (their compose file can be read and changed here) and external ones (only their containers are visible).',
    annotations: READ,
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const [managed, containers] = await Promise.all([listStacks(), dk.listContainers()]);
      const projects = new Map(managed.map((n) => [n, { name: n, managed: true, services: [] }]));
      for (const c of containers) {
        if (!c.stack) continue;
        const p = projects.get(c.stack.project) ?? { name: c.stack.project, managed: false, services: [] };
        p.services.push({ service: c.stack.service, container: c.name, state: c.state, update: c.updateStatus });
        projects.set(c.stack.project, p);
      }
      return [...projects.values()];
    },
  },
  {
    name: 'get_stack',
    level: 'read',
    title: 'Read a compose stack',
    description: `compose.yaml and .env of a stack managed by DockerUpdates. Secret-looking values are shown as "${MASK}" (sending the mask back keeps them).`,
    annotations: READ,
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: async ({ name }) => {
      const s = await getStack(String(name ?? ''));
      return { name: s.name, yaml: maskText(s.yaml), env: maskText(s.env) };
    },
  },
  {
    name: 'get_update_history',
    level: 'read',
    title: 'Update history',
    description: 'Past updates (manual and automatic), newest first.',
    annotations: READ,
    inputSchema: {
      type: 'object',
      properties: { container: { type: 'string', description: 'Only this container' }, limit: { type: 'number', description: 'Default 50' } },
    },
    run: ({ container, limit }) => listHistory({ container: container ? String(container) : undefined, limit: Math.min(Number(limit) || 50, 500) }),
  },
  {
    name: 'get_auto_update_status',
    level: 'read',
    title: 'Auto-update status',
    description: 'Auto-update schedule state: time zone, next run, last run and last check.',
    annotations: READ,
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const { containers, ...s } = await scheduler.status();
      return s;
    },
  },
  {
    name: 'get_host_info',
    level: 'read',
    title: 'Host info',
    description: 'Docker host: name, IP, CPUs, memory, OS and Docker version.',
    annotations: READ,
    inputSchema: { type: 'object', properties: {} },
    run: () => dk.hostInfo(),
  },
  {
    name: 'list_networks',
    level: 'read',
    title: 'List networks',
    description: 'Docker networks containers can join (and their subnets).',
    annotations: READ,
    inputSchema: { type: 'object', properties: {} },
    run: () => dk.listNetworks(),
  },
  {
    name: 'get_storage_conventions',
    level: 'read',
    title: 'Storage conventions',
    description: 'Where container data lives on this server (base folder, pattern and real examples). Call it before creating a container or a stack, and follow it.',
    annotations: READ,
    inputSchema: { type: 'object', properties: {} },
    run: () => conventions(),
  },

  // ----- basic -----
  {
    name: 'container_action',
    level: 'basic',
    title: 'Start / stop / restart a container',
    description: 'Starts, stops or restarts a container.',
    annotations: CHANGE,
    inputSchema: {
      type: 'object',
      properties: { container: containerArg, action: { type: 'string', enum: ['start', 'stop', 'restart'] } },
      required: ['container', 'action'],
    },
    run: async ({ container, action }) => {
      if (!['start', 'stop', 'restart'].includes(action)) throw bad('action: start, stop or restart');
      await dk.doAction(ref(container), action);
      return { ok: true };
    },
  },
  {
    name: 'check_updates',
    level: 'basic',
    title: 'Check for updates',
    description: 'Checks the registry for a newer image: one container, or all of them when no container is given. Nothing is updated.',
    annotations: { ...CHANGE, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: 'object', properties: { container: { type: 'string', description: 'Only this container (optional)' } } },
    run: ({ container }) => (container ? dk.checkUpdate(ref(container)) : dk.checkAllUpdates()),
  },
  {
    name: 'update_container',
    level: 'basic',
    title: 'Update a container',
    description: 'Pulls the newest image and recreates the container with the same settings (like the Update button).',
    annotations: { ...CHANGE, openWorldHint: true },
    inputSchema: { type: 'object', properties: { container: containerArg }, required: ['container'] },
    run: async ({ container }) => {
      const id = ref(container);
      try {
        const r = await dk.updateContainer(id);
        await notifyUpdate(r, null, id);
        return r;
      } catch (err) {
        await notifyUpdate(null, err, id);
        throw err;
      }
    },
  },
  {
    name: 'stack_action',
    level: 'basic',
    title: 'Start / stop / restart a stack',
    description: 'Starts, stops or restarts every service of a compose stack.',
    annotations: CHANGE,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, action: { type: 'string', enum: ['start', 'stop', 'restart'] } },
      required: ['name', 'action'],
    },
    run: ({ name, action }) => {
      if (!['start', 'stop', 'restart'].includes(action)) throw bad('action: start, stop or restart');
      return dk.stackAction(String(name ?? ''), action);
    },
  },

  // ----- full -----
  {
    name: 'create_container',
    level: 'full',
    title: 'Create a container',
    description: 'Pulls the image, creates and starts a new container. Data must go in host folders following get_storage_conventions: Docker volumes (named, or image VOLUMEs left unmapped) are rejected.',
    annotations: { ...CHANGE, openWorldHint: true },
    inputSchema: { type: 'object', properties: { spec: SPEC_SCHEMA }, required: ['spec'] },
    run: async ({ spec }) => {
      if (!spec || typeof spec !== 'object') throw bad('spec is required');
      const next = { ...spec, image: dk.withTag(String(spec.image ?? '')) };
      await checkContainerSpec(next);
      const { run } = await dk.prepareCreate(next);
      return run();
    },
  },
  {
    name: 'edit_container',
    level: 'full',
    title: 'Edit a container',
    description: `Recreates a container with new settings (send the whole definition from get_container, changed). "${MASK}" values keep the current secret. New volumes must be host folders (get_storage_conventions).`,
    annotations: DESTRUCTIVE,
    inputSchema: { type: 'object', properties: { container: containerArg, spec: SPEC_SCHEMA }, required: ['container', 'spec'] },
    run: async ({ container, spec }) => {
      const id = ref(container);
      if (!spec || typeof spec !== 'object') throw bad('spec is required');
      await assertNotSelf(id, 'edit');
      const current = await dk.getContainerSpec(id);
      const next = { ...spec, env: restoreEnvList(spec.env ?? current.env, current.env) };
      // Volumes the container already had may stay as they are
      const keep = new Set(current.volumes.map((v) => v.host));
      await checkContainerSpec({ ...next, image: dk.withTag(String(next.image ?? '')) }, {
        keep,
        checkImage: dk.withTag(String(next.image ?? '')) !== dk.withTag(current.image),
      });
      return dk.editContainer(id, next);
    },
  },
  {
    name: 'remove_container',
    level: 'full',
    title: 'Remove a container',
    description: 'Stops and removes a container. Its host folders are kept.',
    annotations: DESTRUCTIVE,
    inputSchema: { type: 'object', properties: { container: containerArg }, required: ['container'] },
    run: async ({ container }) => {
      const id = ref(container);
      await assertNotSelf(id, 'remove');
      await dk.removeContainer(id);
      return { ok: true };
    },
  },
  {
    name: 'create_stack',
    level: 'full',
    title: 'Create a compose stack',
    description: 'Saves a new compose stack (compose.yaml + optional .env) and deploys it. Bind mounts to host folders only (get_storage_conventions): named / anonymous volumes are rejected.',
    annotations: { ...CHANGE, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Stack name: lowercase letters, digits, - and _' },
        yaml: { type: 'string', description: 'compose.yaml content' },
        env: { type: 'string', description: '.env content (optional)' },
      },
      required: ['name', 'yaml'],
    },
    run: async ({ name, yaml, env }) => deployStack({ name, yaml, env, isNew: true }),
  },
  {
    name: 'update_stack',
    level: 'full',
    title: 'Change a compose stack',
    description: `Replaces the compose.yaml / .env of a managed stack and redeploys it. "${MASK}" values keep the current secret. Same storage rules as create_stack.`,
    annotations: DESTRUCTIVE,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, yaml: { type: 'string' }, env: { type: 'string', description: 'Omit to keep the current .env' } },
      required: ['name', 'yaml'],
    },
    run: async ({ name, yaml, env }) => {
      const current = await getStack(String(name ?? ''));
      return deployStack({
        name,
        yaml: restoreText(yaml, current.yaml),
        env: env === undefined ? current.env : restoreText(env, current.env),
        isNew: false,
      });
    },
  },
  {
    name: 'remove_stack',
    level: 'full',
    title: 'Remove a compose stack',
    description: 'docker compose down on a managed stack and deletes its compose file. Host folders are kept.',
    annotations: DESTRUCTIVE,
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: ({ name }) => dk.stackAction(String(name ?? ''), 'down'),
  },
  {
    name: 'exec_command',
    level: 'full',
    title: 'Run a command in a container',
    description: 'Runs a shell command (sh -c) inside a running container and returns its output. Not available for DockerUpdates itself.',
    annotations: DESTRUCTIVE,
    inputSchema: {
      type: 'object',
      properties: {
        container: containerArg,
        command: { type: 'string', description: 'Shell command, e.g. "df -h /config"' },
        timeoutSeconds: { type: 'number', description: 'Default 30, max 300' },
      },
      required: ['container', 'command'],
    },
    run: ({ container, command, timeoutSeconds }) => {
      if (typeof command !== 'string' || !command.trim() || command.length > 10_000) throw bad('command is required');
      return exec(ref(container), command, timeoutSeconds);
    },
  },
];

async function deployStack({ name, yaml, env, isNew }) {
  const { run } = await dk.prepareStackDeploy({ name, yaml, env: env ?? '', isNew }, { check: checkComposeConfig });
  const result = await run();
  void dk.checkStackSoon(String(name)).catch(() => {});
  return result;
}

export const LEVEL_RANK = { read: 0, basic: 1, full: 2 };
export const toolsFor = (level) => TOOLS.filter((t) => LEVEL_RANK[t.level] <= LEVEL_RANK[level]);

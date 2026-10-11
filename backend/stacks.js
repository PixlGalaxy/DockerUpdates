// Compose stacks managed by DockerUpdates: STACKS_DIR/<name>/compose.yaml (+ optional .env),
// STACKS_DIR defaults to DATA_DIR/stacks.
// The compose file is the source of truth: creating, editing and updating a managed stack always
// goes through `docker compose`, never through the Docker API, so the file and the containers
// never drift apart. Stacks started elsewhere (external) are only grouped in the UI.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { silent } from './operations.js';
import { dataPath } from './store.js';

const bad = (status, message) => Object.assign(new Error(message), { status });

// Compose project names: lowercase letters, digits, dashes and underscores
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const FILE = 'compose.yaml';
// compose.yaml + .env must fit in a request body (express.json limit: 100 kB)
const MAX_SIZE = 64 * 1024;

// docker CLI with the compose plugin (DOCKER_CLI: absolute path when it is not in PATH)
const DOCKER_CLI = process.env.DOCKER_CLI || 'docker';

// docker compose resolves relative paths (./data) against this folder, and the Docker daemon
// creates them on the host: when DockerUpdates runs in a container, it must be mounted at the
// same path on the host and in the container (e.g. -v /opt/stacks:/opt/stacks).
export const STACKS_DIR = path.resolve(process.env.STACKS_DIR || dataPath('stacks'));

const stackDir = (name) => path.join(STACKS_DIR, name);

export function safeStackName(name) {
  if (!NAME_RE.test(String(name ?? ''))) {
    throw bad(400, 'Stack name: lowercase letters, digits, "-" and "_" only (it becomes the compose project name)');
  }
  return name;
}

/** Names of the stacks managed here (folders with a compose file). */
export async function listStacks() {
  const names = (await fs.readdir(STACKS_DIR).catch(() => [])).filter((n) => NAME_RE.test(n));
  const found = await Promise.all(
    names.map((n) => fs.access(path.join(stackDir(n), FILE)).then(() => n, () => null)),
  );
  return found.filter(Boolean).sort();
}

export async function getStack(name) {
  safeStackName(name);
  try {
    const yaml = await fs.readFile(path.join(stackDir(name), FILE), 'utf8');
    const env = await fs.readFile(path.join(stackDir(name), '.env'), 'utf8').catch(() => '');
    return { name, yaml, env };
  } catch {
    throw bad(404, `Stack "${name}" not found`);
  }
}

/**
 * Runs `docker compose` for a managed stack inside its folder (relative paths like ./data resolve
 * there). Every output line goes to `log`; resolves with stdout, fails with the last lines of output.
 */
export function compose(name, args, log = silent) {
  const env = { ...process.env };
  // Same daemon as the API connection (DOCKER_SOCKET is only read by dockerode)
  if (!env.DOCKER_HOST && env.DOCKER_SOCKET) env.DOCKER_HOST = `unix://${env.DOCKER_SOCKET}`;
  // Credential helpers (docker-credential-*) live next to the CLI
  if (path.isAbsolute(DOCKER_CLI)) env.PATH = `${path.dirname(DOCKER_CLI)}${path.delimiter}${env.PATH ?? ''}`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      DOCKER_CLI,
      ['compose', '--progress', 'plain', '--ansi', 'never', '-p', name, '-f', FILE, ...args],
      { cwd: stackDir(name), env },
    );
    const tail = [];
    let stdout = '';
    let rest = '';
    const onData = (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        log.line(line);
        tail.push(line);
        if (tail.length > 8) tail.shift();
      }
    };
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      onData(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', onData);
    child.on('error', (err) => {
      reject(bad(500, err.code === 'ENOENT'
        ? `docker CLI not found (${DOCKER_CLI}). Compose stacks need the docker CLI with the compose plugin.`
        : err.message));
    });
    child.on('close', (code) => {
      if (rest.trim()) {
        log.line(rest);
        tail.push(rest);
      }
      if (code === 0) resolve(stdout);
      else reject(bad(400, tail.join('\n') || `docker compose exited with code ${code}`));
    });
  });
}

async function writeStack(name, yaml, env) {
  const dir = stackDir(name);
  await fs.writeFile(path.join(dir, FILE), yaml, { mode: 0o600 });
  if (env.trim()) await fs.writeFile(path.join(dir, '.env'), env, { mode: 0o600 });
  else await fs.rm(path.join(dir, '.env'), { force: true });
}

/**
 * Writes a compose file and checks it with `docker compose config`. Returns `restore()`, which
 * puts `previous` back (or deletes the folder of a new stack); a rejected file is restored at once.
 */
async function saveChecked(name, yaml, env, previous) {
  await fs.mkdir(stackDir(name), { recursive: true, mode: 0o700 });
  await writeStack(name, yaml, env);
  const restore = async () => {
    if (previous) await writeStack(name, previous.yaml, previous.env);
    else await fs.rm(stackDir(name), { recursive: true, force: true });
  };
  try {
    await compose(name, ['config', '--quiet']);
  } catch (err) {
    await restore();
    throw bad(400, `Invalid compose file:\n${err.message}`);
  }
  return restore;
}

/**
 * Bind mounts that would land somewhere else on the host: relative paths (./data) resolve inside
 * STACKS_DIR, a path the Docker daemon only sees the same way when STACKS_DIR is mounted at the
 * same path on the host. `hostPath`: path of STACKS_DIR on the host (null: not on the host).
 */
async function misplacedBinds(name, hostPath) {
  if ((await hostPath(STACKS_DIR)) === STACKS_DIR) return [];
  const config = JSON.parse(await compose(name, ['config', '--format', 'json']));
  return Object.values(config.services ?? {})
    .flatMap((s) => s.volumes ?? [])
    .filter((v) => v.type === 'bind' && (v.source === STACKS_DIR || v.source?.startsWith(`${STACKS_DIR}/`)))
    .map((v) => path.relative(stackDir(name), v.source) || '.');
}

/**
 * Saves the compose file (and .env) of a new or edited stack after `docker compose config`
 * accepts it; a rejected file leaves the previous one in place. Returns `run(log)`, which pulls
 * the images and starts the stack. `projectInUse(name)`: a compose project with that name
 * already has containers (started outside DockerUpdates). `hostPath(p)`: path of `p` on the
 * Docker host (null when it is not there).
 */
export async function prepareDeploy({ name, yaml, env = '', isNew }, { projectInUse, hostPath }) {
  safeStackName(name);
  if (typeof yaml !== 'string' || !yaml.trim()) throw bad(400, 'The compose file is empty');
  if (yaml.length > MAX_SIZE || String(env).length > MAX_SIZE) throw bad(400, 'The compose file is too large');

  const dir = stackDir(name);
  const exists = await fs.access(path.join(dir, FILE)).then(() => true, () => false);
  if (isNew && exists) throw bad(409, `A stack named "${name}" already exists`);
  if (!isNew && !exists) throw bad(404, `Stack "${name}" not found`);
  if (isNew && (await projectInUse(name))) {
    throw bad(409, `Containers of a compose project named "${name}" already exist (started outside DockerUpdates)`);
  }

  const previous = exists ? await getStack(name) : null;
  const restore = await saveChecked(name, yaml, String(env), previous);
  const misplaced = await misplacedBinds(name, hostPath);
  if (misplaced.length) {
    await restore();
    throw bad(400, [
      `Relative paths (${misplaced.map((p) => `./${p}`).join(', ')}) would be created in a different folder on the host,`,
      'because the stacks folder is not mounted at the same path in DockerUpdates.',
      'Use absolute host paths or named volumes, or mount a stacks folder at the same path on both sides:',
      '  -v /opt/stacks:/opt/stacks  and  STACKS_DIR=/opt/stacks',
    ].join('\n'));
  }

  const run = async (log = silent) => {
    log.section(`Pulling images: ${name}`);
    await compose(name, ['pull', '--ignore-buildable'], log);
    log.section(`Starting stack: ${name}`);
    await compose(name, ['up', '-d', '--remove-orphans'], log);
    log.line('');
    log.line('The command finished successfully!');
    return { name };
  };
  return { name, run };
}

/**
 * Autostart in the compose file: `restart: "no"` on every service, or `unless-stopped` on the
 * ones that do not start with Docker yet (always / unless-stopped are kept). Comments and
 * formatting are kept. The running containers are not recreated here: the caller applies the
 * same policy to them, so the next `up` (redeploy, update) creates them with it.
 */
export async function setStackRestart(name, enabled) {
  const previous = await getStack(name);
  const doc = YAML.parseDocument(previous.yaml);
  if (doc.errors.length) throw bad(400, `Invalid compose file: ${doc.errors[0].message}`);
  const services = doc.get('services');
  if (!YAML.isMap(services)) throw bad(400, 'The compose file has no services');
  let changed = false;
  for (const { value: service } of services.items) {
    if (!YAML.isMap(service)) continue;
    const current = String(service.get('restart') ?? 'no');
    if (enabled ? ['always', 'unless-stopped'].includes(current) : current === 'no') continue;
    const policy = doc.createNode(enabled ? 'unless-stopped' : 'no');
    // Quoted: an unquoted no is the boolean false in YAML 1.1
    if (!enabled) policy.type = 'QUOTE_DOUBLE';
    service.set('restart', policy);
    changed = true;
  }
  if (!changed) return false;
  await saveChecked(name, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), previous.env, previous);
  return true;
}

/** `docker compose down` (volumes are kept) and deletes the stack folder. */
export async function removeStack(name) {
  safeStackName(name);
  await getStack(name);
  await compose(name, ['down', '--remove-orphans']);
  await fs.rm(stackDir(name), { recursive: true, force: true });
}

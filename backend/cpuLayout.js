// CPU layout of the Docker host (CPU pinning picker in the Add / Edit form): which CPU ids
// exist and which ones are hyper-threads of the same physical core.
//
// Read from /sys/devices/system/cpu: CPUs are not namespaced, so inside a container this is
// the layout of the kernel Docker runs on. When Docker is remote (DOCKER_HOST=tcp/ssh) or the
// numbers do not match Docker's, only the CPU count from Docker is known and every CPU is
// listed as its own core. In a virtual machine the CPUs are the vCPUs the hypervisor shows,
// grouped the way it declares them (often one thread per core).
import fs from 'node:fs/promises';
import os from 'node:os';
import { docker } from './docker.js';

const SYS = '/sys/devices/system/cpu';

let cached = null;
let pending = null;

/** "0-3,8,10-11" -> [0, 1, 2, 3, 8, 10, 11] */
export function parseCpuList(list) {
  const ids = new Set();
  for (const part of String(list ?? '').split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!m) continue;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    for (let i = from; i <= to && i - from < 4096; i++) ids.add(i);
  }
  return [...ids].sort((a, b) => a - b);
}

async function readTopology() {
  const online = parseCpuList(await fs.readFile(`${SYS}/online`, 'utf8'));
  const read = async (id, file) => Number((await fs.readFile(`${SYS}/cpu${id}/topology/${file}`, 'utf8')).trim());
  return Promise.all(online.map(async (id) => ({
    id,
    socket: await read(id, 'physical_package_id').catch(() => 0),
    core: await read(id, 'core_id'),
  })));
}

async function cpuInfo() {
  try {
    const text = await fs.readFile('/proc/cpuinfo', 'utf8');
    const model = /^(?:model name|Model|Hardware)\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
    return { model, virtual: /^flags\s*:.*\bhypervisor\b/m.test(text) };
  } catch {
    return { model: os.cpus()[0]?.model?.trim() ?? '', virtual: false };
  }
}

async function detect() {
  const ncpu = (await docker.info()).NCPU;
  const remote = /^(tcp|ssh|https?):/i.test(process.env.DOCKER_HOST ?? '');
  let cpus = null;
  if (!remote && process.platform === 'linux') {
    const topo = await readTopology().catch(() => null);
    if (topo?.length === ncpu) cpus = topo;
  }
  const source = cpus ? 'topology' : 'count';
  cpus ??= Array.from({ length: ncpu }, (_, id) => ({ id, socket: 0, core: id }));

  // Physical cores, each with its CPU ids (first = the core, next ones = its hyper-threads)
  const byCore = new Map();
  for (const c of cpus) {
    const key = `${c.socket}:${c.core}`;
    byCore.set(key, [...(byCore.get(key) ?? []), c.id]);
  }
  const cores = [...byCore.values()].map((ids) => ids.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  const info = remote ? { model: '', virtual: false } : await cpuInfo();
  return {
    cpus: ncpu,
    cores,
    sockets: new Set(cpus.map((c) => c.socket)).size,
    threadsPerCore: Math.max(...cores.map((t) => t.length)),
    source,
    model: info.model,
    virtual: info.virtual,
  };
}

/** Layout of the Docker host's CPUs (detected once, at startup or on first use). */
export function cpuLayout() {
  if (cached) return Promise.resolve(cached);
  pending ??= detect()
    .then((layout) => (cached = layout))
    .finally(() => (pending = null));
  return pending;
}

/** Called at startup: logs what was found. */
export async function detectCpuLayout() {
  try {
    const l = await cpuLayout();
    const threads = l.source === 'count' ? ' (thread layout unknown)' : `, ${l.cores.length} cores / ${l.cpus} threads`;
    console.log(`CPU: ${l.cpus} CPUs${threads}${l.virtual ? ', virtual machine' : ''}${l.model ? ` · ${l.model}` : ''}`);
  } catch (err) {
    console.warn(`Could not read the CPU layout: ${err.message}`);
  }
}

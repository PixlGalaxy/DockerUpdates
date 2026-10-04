// Live CPU / memory stats. Keeps one `docker stats` stream open per running container
// (Docker pushes a sample every ~1s) and caches the latest value, so the API can answer
// instantly instead of waiting ~1-2s per container for a one-shot sample.

const SYNC_INTERVAL_MS = 3000;
const IDLE_TIMEOUT_MS = 30_000;

const streams = new Map(); // id -> { stream, latest }
let docker;
let lastSync = 0;
let syncing = null;
let lastRequest = 0;
let idleTimer = null;

export function initStats(dockerClient) {
  docker = dockerClient;
}

function cpuPercent(s) {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats.cpu_usage?.total_usage ?? 0);
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  return sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;
}

/** Converts a raw Docker stats sample into the shape the UI uses. */
export function parseSample(s) {
  const cache = s.memory_stats?.stats?.inactive_file ?? s.memory_stats?.stats?.cache ?? 0;
  return {
    cpuPercent: s.cpu_stats ? cpuPercent(s) : 0,
    memUsage: Math.max(0, (s.memory_stats?.usage ?? 0) - cache),
    memLimit: s.memory_stats?.limit ?? 0,
  };
}

async function openStream(id) {
  const entry = { stream: null, latest: null };
  streams.set(id, entry);
  try {
    const stream = await docker.getContainer(id).stats({ stream: true });
    entry.stream = stream;
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      // Samples are newline-delimited JSON; a chunk may hold a partial line.
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          entry.latest = parseSample(JSON.parse(line));
        } catch {
          // ignore malformed line
        }
      }
    });
    const drop = () => {
      if (streams.get(id) === entry) streams.delete(id);
    };
    stream.on('end', drop);
    stream.on('error', drop);
  } catch {
    streams.delete(id);
  }
}

function closeStream(id) {
  const entry = streams.get(id);
  streams.delete(id);
  entry?.stream?.destroy?.();
}

/** Opens streams for newly running containers and closes those that stopped. */
async function sync() {
  const running = new Set(
    (await docker.listContainers({ filters: { status: ['running'] } })).map((c) => c.Id),
  );
  for (const id of streams.keys()) if (!running.has(id)) closeStream(id);
  await Promise.all([...running].filter((id) => !streams.has(id)).map(openStream));
  lastSync = Date.now();
}

function closeAllWhenIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (Date.now() - lastRequest >= IDLE_TIMEOUT_MS) {
      for (const id of [...streams.keys()]) closeStream(id);
    }
  }, IDLE_TIMEOUT_MS);
}

/** Latest stats for every running container: { [id]: { cpuPercent, memUsage, memLimit } } */
export async function getStats() {
  lastRequest = Date.now();
  closeAllWhenIdle(); // nobody watching the UI -> stop streaming
  if (Date.now() - lastSync > SYNC_INTERVAL_MS) {
    syncing ??= sync().finally(() => {
      syncing = null;
    });
    // Only wait on the very first sync; afterwards serve the cache immediately.
    if (streams.size === 0) await syncing;
  }
  const out = {};
  for (const [id, { latest }] of streams) if (latest) out[id] = latest;
  return out;
}

/** Cached sample for one container, if a stream is open. */
export function cachedStats(id) {
  return streams.get(id)?.latest ?? null;
}

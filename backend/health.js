// Health alerts: listens to Docker events and notifies when a container becomes unhealthy,
// recovers, crashes (exits on its own with an error) or keeps restarting.
import { docker, hostName } from './docker.js';
import { notify } from './notify.js';

const RESTART_WINDOW_MS = 10 * 60_000;
const RESTART_LOOP_COUNT = 3; // crashes within the window -> "restart loop"
const STOP_GRACE_MS = 30_000; // a "die" right after a stop/kill is intentional
const ALERT_COOLDOWN_MS = 15 * 60_000; // same alert for the same container at most every 15 min

// Containers being recreated by DockerUpdates (updates, edits): no alerts meanwhile
const suppressed = new Map(); // name -> until
const lastStop = new Map(); // id -> time of the last stop/kill request
const crashes = new Map(); // name -> [timestamps]
const unhealthy = new Set(); // names currently unhealthy (to announce recovery)
const lastAlert = new Map(); // `${name}:${kind}` -> time

/** Silences alerts for a container for a while (called around updates and edits). */
export function suppressHealthAlerts(name, ms = 3 * 60_000) {
  suppressed.set(name, Date.now() + ms);
}

const isSuppressed = (name) => (suppressed.get(name) ?? 0) > Date.now();

function shouldAlert(name, kind) {
  const key = `${name}:${kind}`;
  if (Date.now() - (lastAlert.get(key) ?? 0) < ALERT_COOLDOWN_MS) return false;
  lastAlert.set(key, Date.now());
  return true;
}

async function lastHealthOutput(id) {
  try {
    const log = (await docker.getContainer(id).inspect()).State.Health?.Log ?? [];
    return log.at(-1)?.Output?.trim().slice(0, 400) || undefined;
  } catch {
    return undefined;
  }
}

async function send(event, item) {
  void notify(event, { items: [item], trigger: 'auto', host: await hostName().catch(() => '') });
}

async function onEvent(e) {
  const attrs = e.Actor?.Attributes ?? {};
  const name = attrs.name;
  const id = e.Actor?.ID ?? e.id;
  if (!name || attrs['dockerupdates.updater']) return;
  const action = e.Action ?? e.status ?? '';

  if (action === 'stop' || action === 'kill') {
    lastStop.set(id, Date.now());
    return;
  }

  if (action.startsWith('health_status')) {
    const status = action.split(':')[1]?.trim();
    if (status === 'unhealthy') {
      unhealthy.add(name);
      if (!isSuppressed(name) && shouldAlert(name, 'unhealthy')) {
        await send('unhealthy', { name, image: attrs.image, error: await lastHealthOutput(id) });
      }
    } else if (status === 'healthy' && unhealthy.delete(name) && !isSuppressed(name)) {
      lastAlert.delete(`${name}:unhealthy`);
      await send('recovered', { name, image: attrs.image });
    }
    return;
  }

  if (action === 'die') {
    const exitCode = Number(attrs.exitCode ?? 0);
    const intentional = Date.now() - (lastStop.get(id) ?? 0) < STOP_GRACE_MS;
    lastStop.delete(id);
    // Exit code 0 is a normal end (one-shot jobs, scheduled tasks), not a crash
    if (intentional || exitCode === 0 || isSuppressed(name)) return;

    const now = Date.now();
    const recent = (crashes.get(name) ?? []).filter((t) => now - t < RESTART_WINDOW_MS).concat(now);
    crashes.set(name, recent);

    if (recent.length >= RESTART_LOOP_COUNT) {
      if (shouldAlert(name, 'loop')) {
        await send('crashed', { name, image: attrs.image, error: `Restart loop: crashed ${recent.length} times in 10 minutes (last exit code ${exitCode})` });
      }
    } else if (exitCode !== 0 && shouldAlert(name, 'crash')) {
      await send('crashed', { name, image: attrs.image, error: `Exited with code ${exitCode}${exitCode === 137 ? ' (killed, possibly out of memory)' : ''}` });
    }
    return;
  }

  if (action === 'oom' && !isSuppressed(name) && shouldAlert(name, 'oom')) {
    await send('crashed', { name, image: attrs.image, error: 'Out of memory: the container hit its memory limit' });
  }
}

/** Subscribes to Docker events and reconnects with backoff if the stream ends. */
export function startHealthMonitor() {
  let delay = 2000;
  const connect = async () => {
    try {
      const stream = await docker.getEvents({
        filters: { type: ['container'], event: ['health_status', 'die', 'oom', 'stop', 'kill'] },
      });
      delay = 2000;
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk.toString();
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            void onEvent(JSON.parse(line)).catch((err) => console.error('Health event failed:', err.message));
          } catch {
            // ignore malformed line
          }
        }
      });
      const retry = () => {
        stream.removeAllListeners();
        setTimeout(connect, delay);
        delay = Math.min(delay * 2, 60_000);
      };
      stream.on('end', retry);
      stream.on('error', retry);
    } catch {
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 60_000);
    }
  };
  void connect();
}

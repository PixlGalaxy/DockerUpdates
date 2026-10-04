import Docker from 'dockerode';
import os from 'node:os';

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

// Update status by container name (in memory).
const updateStatus = new Map();

export function hostIp() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

function cpuPercent(s) {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  return sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;
}

async function stats(id) {
  try {
    const s = await docker.getContainer(id).stats({ stream: false });
    const cache = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.cache ?? 0;
    return {
      cpuPercent: cpuPercent(s),
      memUsage: Math.max(0, (s.memory_stats.usage ?? 0) - cache),
      memLimit: s.memory_stats.limit ?? 0,
    };
  } catch {
    return { cpuPercent: 0, memUsage: 0, memLimit: 0 };
  }
}

export async function listContainers() {
  const list = await docker.listContainers({ all: true });
  return Promise.all(
    list.map(async (info) => {
      const c = docker.getContainer(info.Id);
      const [inspect, st] = await Promise.all([
        c.inspect(),
        info.State === 'running' ? stats(info.Id) : { cpuPercent: 0, memUsage: 0, memLimit: 0 },
      ]);
      const name = info.Names[0].replace(/^\//, '');
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
        updateStatus: updateStatus.get(name) ?? 'unknown',
      };
    }),
  );
}

export async function doAction(id, action) {
  const c = docker.getContainer(id);
  const fn = { start: 'start', stop: 'stop', restart: 'restart', pause: 'pause', unpause: 'unpause' }[action];
  if (!fn) throw Object.assign(new Error('Invalid action'), { status: 400 });
  await c[fn]();
}

export async function bulk(action) {
  const list = await docker.listContainers({ all: true });
  const wanted = {
    start: ['exited', 'created'],
    stop: ['running', 'paused'],
    pause: ['running'],
    unpause: ['paused'],
  }[action];
  if (!wanted) throw Object.assign(new Error('Invalid action'), { status: 400 });
  await Promise.allSettled(
    list.filter((i) => wanted.includes(i.State)).map((i) => doAction(i.Id, action)),
  );
}

export async function setAutostart(id, enabled) {
  await docker.getContainer(id).update({
    RestartPolicy: { Name: enabled ? 'unless-stopped' : 'no' },
  });
}

export async function removeContainer(id) {
  await docker.getContainer(id).remove({ force: true });
}

function pull(image) {
  return new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()));
    });
  });
}

/** Pulls the image and compares its ID with the one the container uses. */
export async function checkUpdate(id) {
  const c = docker.getContainer(id);
  const inspect = await c.inspect();
  const name = inspect.Name.replace(/^\//, '');
  try {
    await pull(inspect.Config.Image);
    const latest = await docker.getImage(inspect.Config.Image).inspect();
    updateStatus.set(name, latest.Id === inspect.Image ? 'up-to-date' : 'update-available');
  } catch {
    updateStatus.set(name, 'unknown');
  }
}

export async function checkAllUpdates() {
  const list = await docker.listContainers({ all: true });
  // Sequential to avoid hitting registry rate limits (Docker Hub).
  for (const i of list) await checkUpdate(i.Id);
}

/** Recreates the container with the latest image, keeping its configuration. */
export async function updateContainer(id) {
  const old = docker.getContainer(id);
  const inspect = await old.inspect();
  const name = inspect.Name.replace(/^\//, '');
  const wasRunning = inspect.State.Running;

  await pull(inspect.Config.Image);
  if (wasRunning) await old.stop();
  await old.rename({ name: `${name}_old` });

  try {
    const net = inspect.HostConfig.NetworkMode;
    const created = await docker.createContainer({
      ...inspect.Config,
      name,
      HostConfig: inspect.HostConfig,
      NetworkingConfig: net && !['default', 'host', 'none'].includes(net)
        ? { EndpointsConfig: { [net]: {} } }
        : undefined,
    });
    if (wasRunning) await created.start();
  } catch (err) {
    // Rollback: restore the previous container.
    await old.rename({ name });
    if (wasRunning) await old.start();
    throw err;
  }

  await old.remove();
  updateStatus.set(name, 'up-to-date');
}

export async function updateAll() {
  for (const c of await listContainers()) {
    if (c.updateStatus === 'update-available') await updateContainer(c.id);
  }
}

export async function createContainer(data) {
  if (!data.name || !data.image) {
    throw Object.assign(new Error('Name and image are required'), { status: 400 });
  }
  const image = data.image.includes(':') ? data.image : `${data.image}:latest`;
  await pull(image);

  const exposed = {};
  const bindings = {};
  for (const p of data.ports ?? []) {
    const key = `${p.container}/${p.protocol}`;
    exposed[key] = {};
    if (p.host) bindings[key] = [{ HostPort: String(p.host) }];
  }

  const container = await docker.createContainer({
    name: data.name,
    Image: image,
    Env: (data.env ?? []).map((e) => `${e.key}=${e.value}`),
    ExposedPorts: exposed,
    HostConfig: {
      NetworkMode: data.network || 'bridge',
      PortBindings: bindings,
      Binds: (data.volumes ?? []).map((v) => `${v.host}:${v.container}`),
      RestartPolicy: { Name: data.restart === 'no' ? '' : data.restart },
    },
  });
  await container.start();
  return container.id;
}

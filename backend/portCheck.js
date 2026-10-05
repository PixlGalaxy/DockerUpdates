// Host port check for the Add / Edit form: is a host port already taken by another container
// (running, or stopped with the port reserved) or by a service running on the server itself?
import net from 'node:net';
import os from 'node:os';
import { docker, hostIp, selfId } from './docker.js';

const PROBE_TIMEOUT_MS = 700;

/** "8080" / "127.0.0.1:8080" / "[::1]:8080" -> { ip, port } (null if invalid) */
function parseHost(value) {
  const v = String(value ?? '').trim();
  const colon = v.lastIndexOf(':');
  const ip = colon === -1 ? '' : v.slice(0, colon).replace(/^\[|\]$/g, '');
  const port = Number(colon === -1 ? v : v.slice(colon + 1));
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? { ip, port } : null;
}

const ANY = ['', '0.0.0.0', '::'];
/** Two bindings clash when one listens on every address or both use the same one. */
const sameAddress = (a, b) => ANY.includes(a) || ANY.includes(b) || a === b;

/** Published ports of every container: { name, state, ip, port, protocol } */
async function containerBindings() {
  const list = await docker.listContainers({ all: true });
  const out = [];
  await Promise.all(
    list.map(async (c) => {
      const name = c.Names?.[0]?.replace(/^\//, '');
      if (!name) return;
      if (c.State === 'running') {
        for (const p of c.Ports ?? []) {
          if (p.PublicPort) out.push({ name, state: c.State, ip: p.IP ?? '', port: p.PublicPort, protocol: p.Type });
        }
        return;
      }
      // Stopped containers keep their port bindings: starting them later would fail
      try {
        const inspect = await docker.getContainer(c.Id).inspect();
        for (const [key, bindings] of Object.entries(inspect.HostConfig?.PortBindings ?? {})) {
          const protocol = key.split('/')[1] ?? 'tcp';
          for (const b of bindings ?? []) {
            const port = Number(b.HostPort);
            if (port) out.push({ name, state: c.State, ip: b.HostIp ?? '', port, protocol });
          }
        }
      } catch {
        // removed meanwhile
      }
    }),
  );
  return out;
}

/** Addresses that reach services listening on the Docker host. */
async function hostAddresses() {
  const addresses = new Set([hostIp()]);
  try {
    // From a container on a bridge network, the bridge gateway is the host
    const bridge = await docker.getNetwork('bridge').inspect();
    const gateway = bridge.IPAM?.Config?.find((c) => c.Gateway)?.Gateway;
    if (gateway) addresses.add(gateway);
  } catch {
    // no default bridge
  }
  // Inside a container (not on the host network) its own addresses are not the host's:
  // probing them would only find DockerUpdates itself.
  const self = await selfId();
  if (self) {
    try {
      const mode = (await docker.getContainer(self).inspect()).HostConfig?.NetworkMode;
      if (mode !== 'host') {
        for (const list of Object.values(os.networkInterfaces())) {
          for (const i of list ?? []) addresses.delete(i.address);
        }
      }
    } catch {
      // keep the list as is
    }
  }
  return [...addresses].filter((a) => net.isIP(a));
}

/** true = something accepted the connection, false = refused / no answer. */
function tcpListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: PROBE_TIMEOUT_MS });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

/**
 * ports: [{ host, protocol }] from the form. Returns { results: [{ index, inUse, reason? }] }.
 * `ignoreContainer`: the container being edited (its own ports are fine).
 */
export async function checkPorts(ports, ignoreContainer) {
  const rows = (Array.isArray(ports) ? ports : []).slice(0, 100).map((p, index) => ({
    index,
    host: parseHost(p?.host),
    protocol: p?.protocol === 'udp' ? 'udp' : 'tcp',
  }));
  const [all, addresses] = await Promise.all([containerBindings(), hostAddresses()]);
  const bindings = all.filter((b) => b.name !== ignoreContainer);
  // Ports the edited container publishes right now answer on the host too: they are its own
  const own = all.filter((b) => b.name === ignoreContainer);
  const results = [];

  for (const row of rows) {
    if (!row.host) {
      results.push({ index: row.index, inUse: false });
      continue;
    }
    const { ip, port } = row.host;
    const label = `${port}/${row.protocol.toUpperCase()}`;

    const dup = rows.find(
      (o) => o.index < row.index && o.host && o.host.port === port && o.protocol === row.protocol && sameAddress(o.host.ip, ip),
    );
    if (dup) {
      results.push({ index: row.index, inUse: true, reason: `Port ${label} is mapped twice in this form` });
      continue;
    }

    const owner = bindings.find((b) => b.port === port && b.protocol === row.protocol && sameAddress(b.ip, ip));
    if (owner) {
      const stopped = owner.state !== 'running' ? ' (stopped, but the port is reserved: only one of them can run)' : '';
      results.push({ index: row.index, inUse: true, reason: `Port ${label} is already in use by container "${owner.name}"${stopped}` });
      continue;
    }

    // Services on the server itself (TCP only: UDP cannot be probed reliably)
    if (row.protocol === 'tcp' && !own.some((b) => b.port === port && b.protocol === 'tcp')) {
      const open = await Promise.all(addresses.map((a) => tcpListening(a, port)));
      if (open.some(Boolean)) {
        results.push({ index: row.index, inUse: true, reason: `Port ${label} is already in use on the server` });
        continue;
      }
    }
    results.push({ index: row.index, inUse: false });
  }
  return { results };
}

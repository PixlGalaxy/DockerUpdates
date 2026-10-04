// Fixed IP validation for user-defined networks (macvlan / ipvlan / custom bridge):
// checks the subnet, Docker's own allocations and whether something on the LAN answers.
import { execFile } from 'node:child_process';
import net from 'node:net';
import { docker } from './docker.js';

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const DEFAULT_NETWORKS = ['bridge', 'host', 'none', 'default'];

const toInt = (ip) => ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;

function inSubnet(ip, cidr) {
  const [base, bits] = cidr.split('/');
  if (!net.isIPv4(base)) return null; // IPv6 subnet: not checked here
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return { inside: (toInt(ip) & mask) === (toInt(base) & mask), mask, base: toInt(base) & mask };
}

function firstHost(cidr) {
  if (!cidr || !net.isIPv4(cidr.split('/')[0])) return null;
  const s = inSubnet(cidr.split('/')[0], cidr);
  const n = (s.base + 1) >>> 0;
  return [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.');
}

/** Networks for the form, with driver and subnet (fixed IPs only work on user-defined ones). */
export async function listNetworkInfo() {
  const nets = await docker.listNetworks();
  return nets
    .map((n) => ({
      name: n.Name,
      driver: n.Driver,
      subnet: n.IPAM?.Config?.find((c) => c.Subnet && net.isIPv4(c.Subnet.split('/')[0]))?.Subnet ?? null,
      // Docker uses the first host of the subnet when no gateway was given
      gateway: n.IPAM?.Config?.find((c) => c.Gateway)?.Gateway ?? firstHost(n.IPAM?.Config?.find((c) => c.Subnet)?.Subnet),
      fixedIp: !DEFAULT_NETWORKS.includes(n.Name) && n.Driver !== 'null' && n.Driver !== 'host',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Static validation used when creating / editing a container. */
export async function validateFixedIp(network, ip) {
  if (!ip) return;
  if (!net.isIPv4(ip)) throw bad(`"${ip}" is not a valid IPv4 address`);
  if (DEFAULT_NETWORKS.includes(network) || network.startsWith('container:')) {
    throw bad(`A fixed IP is not possible on the "${network}" network. Use a user-defined network (e.g. macvlan / br0).`);
  }
  const info = (await listNetworkInfo()).find((n) => n.name === network);
  if (!info) throw bad(`Network "${network}" not found`);
  if (info.subnet) {
    const s = inSubnet(ip, info.subnet);
    if (s && !s.inside) throw bad(`${ip} is outside the network subnet ${info.subnet}`);
  }
}

function ping(ip) {
  const args = process.platform === 'win32' ? ['-n', '1', '-w', '1000', ip] : ['-c', '1', '-W', '1', ip];
  return new Promise((resolve) => {
    // execFile (no shell) + validated IPv4 argument: no command injection possible
    execFile('ping', args, { timeout: 3000 }, (err, stdout) => {
      resolve(!err && /ttl=/i.test(stdout));
    });
  });
}

function tcpProbe(ip, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port, timeout: 800 });
    const done = (alive) => {
      socket.destroy();
      resolve(alive);
    };
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    // "Connection refused" means a host answered: the IP is taken
    socket.on('error', (e) => done(e.code === 'ECONNREFUSED'));
  });
}

/**
 * Is `ip` free on `network`? Returns { available, reason }.
 * `ignoreContainer`: the container being edited (its own current IP is fine).
 */
export async function checkIp(network, ip, ignoreContainer) {
  await validateFixedIp(network, ip);
  const info = (await listNetworkInfo()).find((n) => n.name === network);

  if (info?.gateway === ip) return { available: false, reason: `${ip} is the gateway of ${network}` };
  if (info?.subnet) {
    const s = inSubnet(ip, info.subnet);
    const bits = Number(info.subnet.split('/')[1]);
    if (s && bits < 31) {
      const host = toInt(ip);
      if (host === s.base) return { available: false, reason: `${ip} is the network address of ${info.subnet}` };
      if (host === (s.base | (~s.mask >>> 0)) >>> 0) return { available: false, reason: `${ip} is the broadcast address of ${info.subnet}` };
    }
  }

  // Containers using it: running ones (current IP) and stopped ones with that fixed IP reserved
  for (const c of await docker.listContainers({ all: true })) {
    const name = c.Names?.[0]?.replace(/^\//, '');
    if (name === ignoreContainer) continue;
    for (const ep of Object.values(c.NetworkSettings?.Networks ?? {})) {
      const fixed = ep.IPAMConfig?.IPv4Address;
      if (fixed === ip || (c.State === 'running' && ep.IPAddress === ip)) {
        return { available: false, reason: `${ip} is used by container "${name}"${c.State === 'running' ? '' : ' (stopped, IP reserved)'}` };
      }
    }
  }

  // Anything on the LAN answering? (ping, or a TCP answer / refusal on common ports)
  if (await ping(ip)) return { available: false, reason: `${ip} answers to ping: another device is using it` };
  const answers = await Promise.all([80, 443, 22].map((p) => tcpProbe(ip, p)));
  if (answers.some(Boolean)) return { available: false, reason: `${ip} answered on the network: another device is using it` };

  return { available: true, reason: `${ip} is available on ${network}` };
}

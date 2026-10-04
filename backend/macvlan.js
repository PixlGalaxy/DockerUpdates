// LAN network for dedicated container IPs (macvlan / ipvlan), like Unraid's br0.
// Detection runs a short-lived helper container with --network host to read the server's
// real interface, subnet and gateway (DockerUpdates itself only sees its own bridge network).
// Once enabled it cannot be disabled from the app: containers depend on that network.
import net from 'node:net';
import { docker, selfId } from './docker.js';
import { getSettings, setNetworkSettings } from './settings.js';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const MANAGED_LABEL = 'dockerupdates.lan-network';
const HELPER_LABEL = 'dockerupdates.updater'; // hidden from the container list
const FALLBACK_IMAGE = 'alpine:latest';

const toInt = (ip) => ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
const toIp = (n) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.');

function parseCidr(cidr) {
  const m = String(cidr ?? '').match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/);
  if (!m || !net.isIPv4(m[1]) || Number(m[2]) > 30 || Number(m[2]) < 8) return null;
  const bits = Number(m[2]);
  const mask = (~0 << (32 - bits)) >>> 0;
  return { base: (toInt(m[1]) & mask) >>> 0, mask, bits };
}

const inside = (ip, c) => ((toInt(ip) & c.mask) >>> 0) === c.base;

async function isDockerDesktop() {
  const info = await docker.info();
  return /docker desktop/i.test(info.OperatingSystem ?? '') || info.Name === 'docker-desktop';
}

/** Runs a command in a helper container that shares the host network. */
async function runOnHostNetwork(cmd) {
  let image = FALLBACK_IMAGE;
  const self = await selfId();
  if (self) image = (await docker.getContainer(self).inspect()).Config.Image;
  else {
    await new Promise((resolve, reject) => {
      docker.pull(image, (err, stream) => (err ? reject(err) : docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()))));
    });
  }
  const helper = await docker.createContainer({
    Image: image,
    Entrypoint: ['/bin/sh', '-c'],
    Cmd: [cmd],
    Labels: { [HELPER_LABEL]: 'true' },
    HostConfig: { NetworkMode: 'host' },
  });
  try {
    await helper.start();
    await helper.wait();
    const raw = await helper.logs({ stdout: true, stderr: true });
    // Non-TTY logs carry an 8-byte header per frame
    const chunks = [];
    for (let i = 0; i + 8 <= raw.length; ) {
      const size = raw.readUInt32BE(i + 4);
      chunks.push(raw.subarray(i + 8, i + 8 + size));
      i += 8 + size;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await helper.remove({ force: true }).catch(() => {});
  }
}

/** Suggested LAN network settings for this server. */
export async function detectLan() {
  if (await isDockerDesktop()) {
    throw bad('Docker Desktop (Windows / macOS) runs Docker inside a VM: macvlan cannot reach your LAN there. This works on a Linux server.');
  }
  return parseDetection(await runOnHostNetwork('ip -4 route show default; echo ---; ip -4 -o addr show'));
}

/** Parses `ip -4 route show default` + `ip -4 -o addr show` (busybox or iproute2 format). */
export function parseDetection(out) {
  const [routes = '', addrs = ''] = out.split('---');
  const def = routes.match(/default via (\d+\.\d+\.\d+\.\d+) dev (\S+)/);
  if (!def) throw bad('Could not find the default route of the server.');
  const [, gateway, parent] = def;
  const addr = addrs.split('\n').find((l) => new RegExp(`\\s${parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+inet\\s`).test(l));
  const cidr = addr?.match(/inet (\d+\.\d+\.\d+\.\d+\/\d+)/)?.[1];
  if (!cidr) throw bad(`Could not read the IP address of ${parent}.`);
  const [hostIp, bits] = cidr.split('/');
  const c = parseCidr(`${hostIp}/${bits}`);
  const wifi = /^(wl|wlan)/.test(parent);
  return {
    parent,
    hostIp,
    subnet: `${toIp(c.base)}/${c.bits}`,
    gateway,
    wifi,
    // WiFi access points usually reject extra MAC addresses: ipvlan shares the host MAC
    driver: wifi ? 'ipvlan' : 'macvlan',
    name: 'lan',
  };
}

export async function lanStatus() {
  const cfg = getSettings().network;
  let network = null;
  if (cfg.lanNetwork) {
    const n = await docker.getNetwork(cfg.lanNetwork).inspect().catch(() => null);
    if (n) {
      network = {
        name: n.Name,
        driver: n.Driver,
        parent: n.Options?.parent ?? null,
        subnet: n.IPAM?.Config?.[0]?.Subnet ?? null,
        gateway: n.IPAM?.Config?.[0]?.Gateway ?? null,
        ipRange: n.IPAM?.Config?.[0]?.IPRange ?? null,
        containers: Object.keys(n.Containers ?? {}).length,
      };
    }
  }
  return { enabled: Boolean(cfg.lanNetwork), network, missing: Boolean(cfg.lanNetwork && !network), dockerDesktop: await isDockerDesktop().catch(() => false) };
}

/** Creates the LAN network. Permanent: there is no "disable". */
export async function enableLan({ name, driver, parent, subnet, gateway, ipRange }) {
  if (getSettings().network.lanNetwork) throw bad('The LAN network is already enabled.');
  if (await isDockerDesktop()) throw bad('macvlan is not supported on Docker Desktop.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name ?? '')) throw bad('Invalid network name');
  if (!['macvlan', 'ipvlan'].includes(driver)) throw bad('Driver must be macvlan or ipvlan');
  if (!/^[a-zA-Z0-9_.:-]{1,15}$/.test(parent ?? '')) throw bad('Invalid parent interface');
  const c = parseCidr(subnet);
  if (!c) throw bad('Subnet must look like 192.168.0.0/24');
  if (!net.isIPv4(gateway ?? '') || !inside(gateway, c)) throw bad('The gateway must be an IP inside the subnet');
  let range = null;
  if (ipRange) {
    range = parseCidr(ipRange);
    if (!range || !inside(toIp(range.base), c) || range.bits < c.bits) throw bad('The IP range must be a smaller block inside the subnet (e.g. 192.168.0.192/27)');
  }
  if (await docker.getNetwork(name).inspect().then(() => true, () => false)) {
    throw bad(`A network named "${name}" already exists`);
  }

  await docker.createNetwork({
    Name: name,
    Driver: driver,
    Options: driver === 'ipvlan' ? { parent, ipvlan_mode: 'l2' } : { parent },
    IPAM: { Config: [{ Subnet: `${toIp(c.base)}/${c.bits}`, Gateway: gateway, ...(range ? { IPRange: `${toIp(range.base)}/${range.bits}` } : {}) }] },
    Labels: { [MANAGED_LABEL]: 'true' },
  }).catch((err) => {
    throw bad(`Docker could not create the network: ${err.json?.message ?? err.message}`);
  });
  await setNetworkSettings({ lanNetwork: name });
  return lanStatus();
}

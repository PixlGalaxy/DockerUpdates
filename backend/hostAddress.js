// Detects the Docker host's real LAN IP (shown in the header, used for the LAN IP:Port links,
// favicon discovery and the port check). Inside a bridge container DockerUpdates only sees its
// own 172.x address, so the server's interfaces are read from a short-lived helper container
// on the host network, at startup and then every 30 minutes (the IP can change with DHCP).
import os from 'node:os';
import { selfId, docker, setDetectedHost } from './docker.js';
import { isDockerDesktop, parseDetection, runOnHostNetwork } from './macvlan.js';
import { hostIpOverride, hostIpSource } from './runtimeConfig.js';

const REFRESH_MS = 30 * 60_000;
let warned = '';

/** All IPv4 addresses of the host from `ip -4 -o addr show` (loopback excluded). */
export function parseAddresses(out) {
  return [...out.matchAll(/inet (\d+\.\d+\.\d+\.\d+)\//g)].map((m) => m[1]).filter((ip) => !ip.startsWith('127.'));
}

/** 'local' = this process sees the host's interfaces, 'helper' = read them from a helper, null = skip. */
async function detectionMode() {
  const self = await selfId();
  if (!self) return 'local'; // not in a container
  const mode = (await docker.getContainer(self).inspect()).HostConfig?.NetworkMode;
  if (mode === 'host') return 'local';
  // Docker Desktop: the "host" is a VM, its addresses mean nothing on the LAN
  return (await isDockerDesktop()) ? null : 'helper';
}

/** IPv4 addresses of this machine, Docker's own bridges last (they are never the LAN IP). */
function localAddresses() {
  const virtual = /^(docker|br-|veth|virbr|cni|flannel|tailscale|zt)/;
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).map((i) => ({ ...i, name })))
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .sort((a, b) => Number(virtual.test(a.name)) - Number(virtual.test(b.name)))
    .map((i) => i.address);
}

export async function detectHostAddress() {
  try {
    const mode = await detectionMode();
    if (!mode) return;
    if (mode === 'local') {
      const addresses = localAddresses();
      if (addresses.length) setDetectedHost({ ip: addresses[0], addresses });
      return;
    }
    const out = await runOnHostNetwork('ip -4 route show default; echo ---; ip -4 -o addr show');
    const { hostIp } = parseDetection(out);
    const addresses = parseAddresses(out.split('---')[1] ?? '');
    setDetectedHost({ ip: hostIp, addresses });

    const configured = hostIpOverride();
    if (configured && !addresses.includes(configured) && warned !== `${configured}>${hostIp}`) {
      warned = `${configured}>${hostIp}`;
      console.warn(
        hostIpSource() === 'settings'
          ? `Host IP ${configured} (set in Settings) is not an address of this server, whose LAN IP is ${hostIp}. Change it in Settings → Server & access.`
          : `HOST_IP=${configured} is not an address of this server (its LAN IP is ${hostIp}): using ${hostIp}. ` +
              'Update or remove HOST_IP in your .env, or set the IP in Settings → Server & access.',
      );
    }
  } catch (err) {
    console.warn(`Could not detect the server's LAN IP (${err.message}). Set HOST_IP to choose it.`);
  }
}

export function startHostAddressDetection() {
  void detectHostAddress();
  setInterval(() => void detectHostAddress(), REFRESH_MS).unref();
}

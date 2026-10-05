// Detects the Docker host's real LAN IP (shown in the header, used for the LAN IP:Port links,
// favicon discovery and the port check). Inside a bridge container DockerUpdates only sees its
// own 172.x address, so the server's interfaces are read from a short-lived helper container
// on the host network, at startup and then every 30 minutes (the IP can change with DHCP).
import { selfId, docker, setDetectedHost } from './docker.js';
import { isDockerDesktop, parseDetection, runOnHostNetwork } from './macvlan.js';

const REFRESH_MS = 30 * 60_000;
let warned = '';

/** All IPv4 addresses of the host from `ip -4 -o addr show` (loopback excluded). */
export function parseAddresses(out) {
  return [...out.matchAll(/inet (\d+\.\d+\.\d+\.\d+)\//g)].map((m) => m[1]).filter((ip) => !ip.startsWith('127.'));
}

async function needsHelper() {
  const self = await selfId();
  if (!self) return false; // not in a container: os.networkInterfaces() is the host
  const mode = (await docker.getContainer(self).inspect()).HostConfig?.NetworkMode;
  if (mode === 'host') return false;
  // Docker Desktop: the "host" is a VM, its addresses mean nothing on the LAN
  return !(await isDockerDesktop());
}

export async function detectHostAddress() {
  try {
    if (!(await needsHelper())) return;
    const out = await runOnHostNetwork('ip -4 route show default; echo ---; ip -4 -o addr show');
    const { hostIp } = parseDetection(out);
    const addresses = parseAddresses(out.split('---')[1] ?? '');
    setDetectedHost({ ip: hostIp, addresses });

    const configured = process.env.HOST_IP?.trim();
    if (configured && !addresses.includes(configured) && warned !== `${configured}>${hostIp}`) {
      warned = `${configured}>${hostIp}`;
      console.warn(
        `HOST_IP=${configured} is not an address of this server (its LAN IP is ${hostIp}): using ${hostIp}. ` +
          'Update or remove HOST_IP in your .env / container settings.',
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

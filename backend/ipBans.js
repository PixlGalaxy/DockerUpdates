// Admin-curated IP block list (DATA_DIR/ip-bans.json). Banned addresses get a 403 on every
// request, including static files and the console WebSocket. Entries are single IPs or CIDR ranges.
import net from 'node:net';
import { readJson, writeJson } from './store.js';

const FILE = 'ip-bans.json';
const MAX_BANS = 1000;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

/** "::ffff:1.2.3.4" -> "1.2.3.4" */
export const normalizeIp = (ip) => String(ip ?? '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

/** { address, prefix?, family } or null */
function parse(value) {
  const [address, prefix, extra] = String(value ?? '').trim().split('/');
  if (extra !== undefined) return null;
  const ip = normalizeIp(address);
  const version = net.isIP(ip);
  if (!version) return null;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  if (prefix === undefined) return { address: ip, family };
  const bits = Number(prefix);
  // Very wide ranges are almost always a typo that would lock out a huge part of the internet
  if (!/^\d{1,3}$/.test(prefix) || bits < (version === 4 ? 8 : 16) || bits > (version === 4 ? 32 : 128)) return null;
  return { address: ip, prefix: bits, family };
}

function addTo(blockList, value) {
  const p = parse(value);
  if (!p) return;
  if (p.prefix === undefined) blockList.addAddress(p.address, p.family);
  else blockList.addSubnet(p.address, p.prefix, p.family);
}

function build(entries) {
  const blockList = new net.BlockList();
  for (const e of entries) addTo(blockList, e.ip);
  return blockList;
}

function matches(blockList, ip) {
  const addr = normalizeIp(ip);
  const version = net.isIP(addr);
  return version ? blockList.check(addr, version === 4 ? 'ipv4' : 'ipv6') : false;
}

let bans = (await readJson(FILE, [])).filter((b) => b && parse(b.ip)); // [{ ip, reason, createdAt, createdBy }]
let list = build(bans);

export const isBanned = (ip) => bans.length > 0 && matches(list, ip);

export const listBans = () => bans;

/** `protect`: addresses that must stay reachable (the admin's own IP, the reverse proxy...). */
export async function addBan(value, reason, createdBy, protect = []) {
  const p = parse(value);
  if (!p) throw bad('Enter an IP address (e.g. 203.0.113.7) or a range (e.g. 203.0.113.0/24; at least /8 for IPv4, /16 for IPv6)');
  const ip = p.prefix === undefined ? p.address : `${p.address}/${p.prefix}`;
  if (bans.some((b) => b.ip === ip)) throw bad(`${ip} is already banned`, 409);
  if (bans.length >= MAX_BANS) throw bad(`At most ${MAX_BANS} bans`);

  const probe = new net.BlockList();
  addTo(probe, ip);
  // Loopback: the container healthcheck and local tools use it
  if (matches(probe, '127.0.0.1') || matches(probe, '::1')) throw bad('Loopback addresses cannot be banned');
  for (const own of protect.filter(Boolean)) {
    if (matches(probe, own)) throw bad(`This would block ${normalizeIp(own)}, which your own connection uses`);
  }

  const text = String(reason ?? '').trim().slice(0, 200);
  bans = [{ ip, reason: text || null, createdAt: new Date().toISOString(), createdBy }, ...bans];
  list = build(bans);
  await writeJson(FILE, bans);
  return ip;
}

export async function removeBan(ip) {
  const before = bans.length;
  bans = bans.filter((b) => b.ip !== ip);
  if (bans.length === before) throw bad('Ban not found', 404);
  list = build(bans);
  await writeJson(FILE, bans);
}

// Host CPU and memory usage for the header. Inside a container, /proc/stat and /proc/meminfo
// (and Node's os module) report the whole host, so this shows the server's load, not ours.
import fs from 'node:fs/promises';
import os from 'node:os';

let previous = null; // { idle, total }
let cpuPercent = 0;
let lastSample = 0;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function sampleCpu() {
  const now = cpuTimes();
  if (previous) {
    const total = now.total - previous.total;
    const idle = now.idle - previous.idle;
    if (total > 0) cpuPercent = Math.min(100, Math.max(0, (1 - idle / total) * 100));
  }
  previous = now;
  lastSample = Date.now();
}

async function memory() {
  if (process.platform === 'linux') {
    try {
      const info = await fs.readFile('/proc/meminfo', 'utf8');
      const kb = (key) => Number(info.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024;
      const total = kb('MemTotal');
      const available = kb('MemAvailable');
      if (total) return { used: total - available, total };
    } catch {
      // fall back to os module
    }
  }
  return { used: os.totalmem() - os.freemem(), total: os.totalmem() };
}

sampleCpu();

/** { cpu: percent, memUsed, memTotal } */
export async function hostUsage() {
  // Sample on demand; the first call after a pause measures since the previous call
  if (Date.now() - lastSample > 500) sampleCpu();
  const mem = await memory();
  return { cpu: Math.round(cpuPercent * 10) / 10, memUsed: mem.used, memTotal: mem.total };
}

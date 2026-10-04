// In-memory copy of the server log (console output) for the Admin panel "Server logs" view.
// Imported first by server.js so it also captures messages printed while other modules load.
import util from 'node:util';

/** Bounds memory and how far back the admin can page. */
const CAPACITY = 5000;

const entries = []; // { id, time, channel: 'AUDIT' | 'APP', level: 'INFO' | 'WARN' | 'ERROR', message }
const listeners = new Set();
let nextId = 1;

const AUDIT_RE = /^\[audit\] \S+ /;

function push(level, args) {
  const text = util.format(...args);
  const audit = AUDIT_RE.test(text);
  const entry = {
    id: nextId++,
    time: new Date().toISOString(),
    channel: audit ? 'AUDIT' : 'APP',
    level,
    // Audit lines already carry a timestamp: keep only the useful part
    message: audit ? text.replace(AUDIT_RE, '') : text,
  };
  entries.push(entry);
  if (entries.length > CAPACITY) entries.shift();
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // a broken listener must never break logging
    }
  }
}

for (const [method, level] of [['log', 'INFO'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    original(...args);
    push(level, args);
  };
}

export const LOG_CHANNELS = ['AUDIT', 'APP'];
export const LOG_LEVELS = ['INFO', 'WARN', 'ERROR'];

/** Newest first; page 1 holds the most recent `limit` entries. Optional channel / level filter. */
export function logPage(limit, page, { channel, level } = {}) {
  const list = channel || level
    ? entries.filter((e) => (!channel || e.channel === channel) && (!level || e.level === level))
    : entries;
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const end = total - (page - 1) * limit;
  const slice = end <= 0 ? [] : list.slice(Math.max(0, end - limit), end);
  return { entries: slice.reverse(), total, pages, capacity: CAPACITY };
}

/** Entries newer than `id`, oldest first. */
export const logsSince = (id) => entries.filter((e) => e.id > id);

export function subscribeLogs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Number of entries per level within the last `ms` milliseconds. */
export function recentLevels(ms) {
  const since = Date.now() - ms;
  const counts = { INFO: 0, WARN: 0, ERROR: 0 };
  for (let i = entries.length - 1; i >= 0 && Date.parse(entries[i].time) >= since; i--) counts[entries[i].level]++;
  return counts;
}

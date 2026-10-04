// Update history (DATA_DIR/history.json): what was updated, when, from which version to which.
import crypto from 'node:crypto';
import { readJson, writeJson } from './store.js';

const FILE = 'history.json';
const MAX_ENTRIES = 2000;

let entries = null;

async function load() {
  entries ??= await readJson(FILE, []);
  return entries;
}

/**
 * entry: { container, image, from, to, kind, trigger: 'manual'|'auto', result: 'success'|'failed'|'scheduled',
 *          error?, durationMs?, type?: 'update'|'edit' }
 */
export async function addHistory(entry) {
  await load();
  entries.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), type: 'update', ...entry });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  await writeJson(FILE, entries);
}

export async function listHistory({ container, limit = 200 } = {}) {
  await load();
  const filtered = container ? entries.filter((e) => e.container === container) : entries;
  return filtered.slice(0, Math.min(Number(limit) || 200, MAX_ENTRIES));
}

/** Containers renamed in the editor keep their history. */
export async function renameInHistory(from, to) {
  await load();
  let changed = false;
  for (const e of entries) {
    if (e.container === from) {
      e.container = to;
      changed = true;
    }
  }
  if (changed) await writeJson(FILE, entries);
}

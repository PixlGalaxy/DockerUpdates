// Folders of containers on the home page (created by dropping a container on another while the
// order is unlocked), persisted in DATA_DIR/folders.json. Stored by container name, like the order.
import { readJson, writeJson } from './store.js';
import { STACK_COLORS } from './stackColors.js';

const FILE = 'folders.json';
const ID_RE = /^[a-z0-9]{1,32}$/;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const MAX = 200;

let folders = null;
const bad = (message) => Object.assign(new Error(message), { status: 400 });

/** Only valid fields; a container can be in one folder only (the first one keeps it). */
function clean(list) {
  if (!Array.isArray(list) || list.length > MAX) throw bad('Invalid folders');
  const used = new Set();
  const ids = new Set();
  return list.map((f) => {
    const name = String(f?.name ?? '').trim();
    if (!ID_RE.test(String(f?.id)) || ids.has(f.id)) throw bad('Invalid folder id');
    if (!name || name.length > 40) throw bad('Folder names: 1 to 40 characters');
    if (f.color !== undefined && f.color !== null && !STACK_COLORS.includes(f.color)) throw bad('Invalid color');
    if (!Array.isArray(f.containers) || f.containers.some((n) => typeof n !== 'string' || !NAME_RE.test(n))) {
      throw bad('Invalid folder containers');
    }
    ids.add(f.id);
    const containers = [...new Set(f.containers)].filter((n) => !used.has(n));
    for (const n of containers) used.add(n);
    return { id: f.id, name, ...(f.color ? { color: f.color } : {}), containers };
  }).filter((f) => f.containers.length > 0);
}

export async function getFolders() {
  if (!folders) {
    try {
      folders = clean(await readJson(FILE, []));
    } catch {
      folders = [];
    }
  }
  return folders;
}

/** Replaces every folder (the UI sends the whole list); folders left empty are dropped. */
export async function saveFolders(list) {
  folders = clean(list);
  await writeJson(FILE, folders);
  return folders;
}

/** Keeps a renamed container (Edit) in its folder. */
export async function renameInFolders(oldName, newName) {
  const current = await getFolders();
  if (oldName === newName || !current.some((f) => f.containers.includes(oldName))) return;
  folders = current.map((f) => ({ ...f, containers: f.containers.map((n) => (n === oldName ? newName : n)) }));
  await writeJson(FILE, folders);
}

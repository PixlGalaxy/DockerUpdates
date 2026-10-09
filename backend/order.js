// Custom order of the containers on the home page (set with the lock button), persisted in
// DATA_DIR/container-order.json. Stored by name: container IDs change on every update.
import { readJson, writeJson } from './store.js';

const FILE = 'container-order.json';
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const MAX = 2000;

let order = null;

export async function getOrder() {
  if (!order) {
    const saved = await readJson(FILE, []);
    order = Array.isArray(saved) ? saved.filter((n) => typeof n === 'string' && NAME_RE.test(n)) : [];
  }
  return order;
}

/** Replaces the saved order. `names`: container names, first one shown first. */
export async function saveOrder(names) {
  if (!Array.isArray(names) || names.length > MAX || names.some((n) => typeof n !== 'string' || !NAME_RE.test(n))) {
    throw Object.assign(new Error('Invalid container order'), { status: 400 });
  }
  order = [...new Set(names)];
  await writeJson(FILE, order);
  return order;
}

/** Keeps a renamed container (Edit) in its place. */
export async function renameInOrder(oldName, newName) {
  const current = await getOrder();
  const i = current.indexOf(oldName);
  if (i === -1 || oldName === newName) return;
  order = current.filter((n) => n !== newName);
  order.splice(order.indexOf(oldName), 1, newName);
  await writeJson(FILE, order);
}

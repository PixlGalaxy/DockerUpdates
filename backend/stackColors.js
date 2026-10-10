// Color chosen for each compose stack in the list (DATA_DIR/stack-colors.json: { project: color }).
// Stacks without one get a color from their name in the UI.
import { readJson, writeJson } from './store.js';
import { safeStackName } from './stacks.js';

const FILE = 'stack-colors.json';
// Same ids as the frontend palette (stackColors.ts)
export const STACK_COLORS = ['violet', 'sky', 'emerald', 'amber', 'rose', 'indigo', 'teal', 'orange', 'fuchsia', 'lime'];

let colors = null;

export async function getStackColors() {
  if (!colors) {
    const saved = await readJson(FILE, {});
    colors = Object.fromEntries(
      Object.entries(saved && typeof saved === 'object' ? saved : {}).filter(([, c]) => STACK_COLORS.includes(c)),
    );
  }
  return colors;
}

/** Sets the color of a stack; null goes back to the automatic one. */
export async function setStackColor(name, color) {
  safeStackName(name);
  if (color !== null && !STACK_COLORS.includes(color)) {
    throw Object.assign(new Error('Invalid color'), { status: 400 });
  }
  const current = await getStackColors();
  const { [name]: _old, ...rest } = current;
  colors = color ? { ...rest, [name]: color } : rest;
  await writeJson(FILE, colors);
  return colors;
}

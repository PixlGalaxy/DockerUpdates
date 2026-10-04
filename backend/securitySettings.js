// Login and session limits editable from the Admin panel (DATA_DIR/security.json).
// Environment variables only provide the initial defaults.
import { readJson, writeJson } from './store.js';

const FILE = 'security.json';
const bad = (message) => Object.assign(new Error(message), { status: 400 });

export const SECURITY_FIELDS = {
  sessionHours: { min: 1, max: 720, def: Number(process.env.SESSION_HOURS) || 12 },
  idleMinutes: { min: 5, max: 10080, def: Number(process.env.SESSION_IDLE_MINUTES) || 120 },
  ipMaxFailures: { min: 3, max: 100, def: 5 },
  globalMaxFailures: { min: 10, max: 1000, def: 30 },
  lockoutMinutes: { min: 1, max: 1440, def: 15 },
};

const defaults = () => Object.fromEntries(Object.entries(SECURITY_FIELDS).map(([k, f]) => [k, f.def]));

/** Only known keys with in-range integers survive (the file may be edited by hand). */
function pick(raw) {
  const out = {};
  for (const [k, f] of Object.entries(SECURITY_FIELDS)) {
    const v = Number(raw?.[k]);
    if (Number.isInteger(v) && v >= f.min && v <= f.max) out[k] = v;
  }
  return out;
}

let current = { ...defaults(), ...pick(await readJson(FILE, {})) };

export const getSecurity = () => current;

export function securityInfo() {
  return { values: { ...current }, defaults: defaults(), limits: SECURITY_FIELDS };
}

export async function updateSecurity(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad('Invalid settings');
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(SECURITY_FIELDS, k)) throw bad(`Unknown setting "${k}"`);
    const f = SECURITY_FIELDS[k];
    const n = Number(v);
    if (!Number.isInteger(n) || n < f.min || n > f.max) throw bad(`${k} must be a whole number between ${f.min} and ${f.max}`);
    next[k] = n;
  }
  if (next.globalMaxFailures < next.ipMaxFailures) throw bad('The global limit cannot be lower than the per-IP limit');
  current = next;
  await writeJson(FILE, current);
  return securityInfo();
}

// App settings (auto-update, notifications, cleanup) persisted in DATA_DIR/settings.json.
import { isValidTimeZone, parseCron, scheduleToCron } from './cron.js';
import { readJson, writeJson } from './store.js';

const FILE = 'settings.json';
const MASK = '********';
const bad = (message) => Object.assign(new Error(message), { status: 400 });

const defaultSchedule = (frequency = 'daily') => ({
  frequency, minute: 0, hour: 4, dayOfWeek: 0, dayOfMonth: 1, cron: '',
});

export const DEFAULTS = {
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  autoUpdate: {
    enabled: false,
    // 'update' = check and update, 'notify' = only check and notify
    action: 'update',
    schedule: defaultSchedule('daily'),
    // true: every container follows the global schedule unless configured otherwise
    applyToAll: true,
    stopTimeout: 15,
    // Only auto-update images published at least this many days ago (0 = no delay)
    cooldownDays: 0,
    // name -> { mode: 'global' | 'custom' | 'off', action, schedule }
    containers: {},
  },
  notifications: {
    events: { updateAvailable: true, updated: true, updateFailed: true, cleanup: false, health: true },
    includeManual: true,
    discord: { enabled: false, webhookUrl: '', mention: '' },
    telegram: { enabled: false, botToken: '', chatId: '' },
    ntfy: { enabled: false, url: '', token: '' },
    webhook: { enabled: false, url: '', secret: '' },
  },
  network: {
    // Name of the macvlan / ipvlan network created from Settings ('' = not enabled).
    // Only set by enableLan(); cannot be changed or removed from the UI.
    lanNetwork: '',
  },
  health: {
    // Stop a container that crashes and restarts this many times in a row
    stopRestartLoops: true,
    maxRestarts: 5,
  },
  cleanup: {
    removeOldImageAfterUpdate: true,
    scheduled: false,
    schedule: defaultSchedule('weekly'),
    // 'dangling' = untagged images only, 'unused' = every image not used by a container
    mode: 'dangling',
  },
};

// Secret fields: never sent back to the browser in clear text
const SECRETS = [
  ['notifications', 'discord', 'webhookUrl'],
  ['notifications', 'telegram', 'botToken'],
  ['notifications', 'ntfy', 'token'],
  ['notifications', 'webhook', 'url'],
  ['notifications', 'webhook', 'secret'],
];

let settings = null;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function merge(base, value) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return value ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(value ?? {})) {
    // JSON.parse keeps "__proto__" as an own key: never let it reach an assignment
    if (FORBIDDEN_KEYS.has(k)) continue;
    out[k] = k in base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]) && k !== 'containers'
      ? merge(base[k], v)
      : v;
  }
  return out;
}

const get = (obj, keys) => keys.reduce((o, k) => o?.[k], obj);
const set = (obj, keys, v) => {
  const last = keys.at(-1);
  keys.slice(0, -1).reduce((o, k) => o[k], obj)[last] = v;
};

export async function loadSettings() {
  if (!settings) settings = merge(structuredClone(DEFAULTS), await readJson(FILE, {}));
  return settings;
}

export function getSettings() {
  if (!settings) throw new Error('Settings not loaded');
  return settings;
}

/** Settings for the browser: secrets replaced by a mask. */
export function publicSettings() {
  const copy = structuredClone(getSettings());
  for (const keys of SECRETS) if (get(copy, keys)) set(copy, keys, MASK);
  return copy;
}

function validateSchedule(s, label) {
  if (!['hourly', 'daily', 'weekly', 'monthly', 'custom'].includes(s.frequency)) throw bad(`${label}: invalid frequency`);
  const int = (v, min, max, name) => {
    if (!Number.isInteger(Number(v)) || Number(v) < min || Number(v) > max) throw bad(`${label}: invalid ${name}`);
  };
  int(s.minute, 0, 59, 'minute');
  int(s.hour, 0, 23, 'hour');
  int(s.dayOfWeek, 0, 6, 'day of week');
  int(s.dayOfMonth, 1, 31, 'day of month');
  parseCron(scheduleToCron(s));
}

function validateUrl(value, label, { pattern } = {}) {
  if (!value) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw bad(`${label} is not a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw bad(`${label} must use http(s)`);
  if (pattern && !pattern.test(value)) throw bad(`${label} does not look right`);
}

function validate(s) {
  if (!isValidTimeZone(s.timezone)) throw bad(`Unknown time zone "${s.timezone}"`);
  const au = s.autoUpdate;
  if (!['update', 'notify'].includes(au.action)) throw bad('Invalid auto-update action');
  validateSchedule(au.schedule, 'Auto-update schedule');
  if (!Number.isInteger(Number(au.stopTimeout)) || au.stopTimeout < 0 || au.stopTimeout > 600) {
    throw bad('Stop timeout must be between 0 and 600 seconds');
  }
  const days = (v) => Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 365;
  if (!days(au.cooldownDays)) throw bad('Cooldown must be between 0 and 365 days');
  for (const [name, c] of Object.entries(au.containers ?? {})) {
    if (c.cooldownDays != null && !days(c.cooldownDays)) throw bad(`${name}: cooldown must be between 0 and 365 days`);
    if (!['global', 'custom', 'off'].includes(c.mode)) throw bad(`${name}: invalid auto-update mode`);
    if (c.mode === 'custom') {
      if (!['update', 'notify'].includes(c.action)) throw bad(`${name}: invalid action`);
      validateSchedule(c.schedule ?? {}, name);
    }
  }
  const n = s.notifications;
  validateUrl(n.discord.webhookUrl, 'Discord webhook URL', {
    pattern: /^https:\/\/(?:\w+\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+/,
  });
  if (n.telegram.botToken && !/^\d+:[\w-]{30,}$/.test(n.telegram.botToken)) throw bad('Telegram bot token does not look right');
  if (n.telegram.chatId && !/^(-?\d+|@\w{4,})$/.test(String(n.telegram.chatId))) throw bad('Telegram chat ID must be a number or @channel');
  validateUrl(n.ntfy.url, 'ntfy URL');
  validateUrl(n.webhook.url, 'Webhook URL');
  if (!['dangling', 'unused'].includes(s.cleanup.mode)) throw bad('Invalid cleanup mode');
  const max = Number(s.health.maxRestarts);
  if (!Number.isInteger(max) || max < 2 || max > 50) throw bad('Max restarts must be between 2 and 50');
  s.health.maxRestarts = max;
  validateSchedule(s.cleanup.schedule, 'Cleanup schedule');
}

/** Internal update of the network section (used by macvlan.js only). */
export async function setNetworkSettings(network) {
  settings = { ...getSettings(), network: { ...getSettings().network, ...network } };
  await writeJson(FILE, settings);
}

/** Applies a (partial) settings object from the browser. Masked secrets keep their value. */
export async function updateSettings(patch) {
  const current = getSettings();
  const next = merge(structuredClone(current), patch);
  // The LAN network is permanent once enabled: ignore any change sent by the browser
  next.network = structuredClone(current.network);
  for (const keys of SECRETS) {
    if (get(next, keys) === MASK) set(next, keys, get(current, keys));
  }
  next.autoUpdate.stopTimeout = Number(next.autoUpdate.stopTimeout);
  next.autoUpdate.cooldownDays = Number(next.autoUpdate.cooldownDays ?? 0);
  validate(next);
  settings = next;
  await writeJson(FILE, settings);
  return publicSettings();
}

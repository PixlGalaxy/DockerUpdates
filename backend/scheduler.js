// Scheduler: runs automatic update checks / updates and image cleanups on their cron schedules.
// Ticks once per minute; jobs never overlap (a job due while another runs is queued).
import { cronMatches, nextRuns, scheduleToCron } from './cron.js';
import * as dk from './docker.js';
import { notify } from './notify.js';
import { getSettings } from './settings.js';
import { readJson, writeJson } from './store.js';

const STATE_FILE = 'scheduler-state.json';

// { lastRun: { at, trigger, checked, available, updated, failed }, lastCleanup, notified: { name: version } }
let state = null;
let running = null; // description of the job in progress
const queue = [];
let lastTickMinute = null;

async function loadState() {
  state ??= await readJson(STATE_FILE, { lastRun: null, lastCleanup: null, notified: {} });
  return state;
}

const saveState = () => writeJson(STATE_FILE, state);

/** Effective auto-update config of a container: { mode, action, cron } */
export function containerPlan(name, s = getSettings()) {
  const au = s.autoUpdate;
  const own = au.containers[name];
  const mode = own?.mode ?? (au.applyToAll ? 'global' : 'off');
  if (mode === 'custom') {
    return { mode, action: own.action, cron: scheduleToCron(own.schedule), cooldownDays: own.cooldownDays ?? au.cooldownDays };
  }
  if (mode === 'global') return { mode, action: au.action, cron: scheduleToCron(au.schedule), cooldownDays: au.cooldownDays };
  return { mode: 'off' };
}

/**
 * Checks the given containers and, depending on `action`, updates them or only notifies.
 * targets: [{ id, name, action }]
 */
async function runAutoUpdate(targets, trigger = 'auto') {
  await loadState();
  const host = await dk.hostName().catch(() => '');
  const result = { at: new Date().toISOString(), trigger, checked: 0, available: 0, updated: 0, failed: 0, deferred: 0 };
  const toUpdate = [];
  const availableItems = [];
  const failedItems = [];

  for (const t of targets) {
    const r = await dk.checkUpdate(t.id).catch((err) => ({ status: 'error', message: err.message }));
    result.checked++;
    if (r.status === 'update-available') {
      result.available++;
      // Cooldown: wait until the new image is old enough (avoids broken day-one releases)
      const readyAt = r.published && t.cooldownDays ? Date.parse(r.published) + t.cooldownDays * 86_400_000 : 0;
      const waiting = t.action === 'update' && trigger === 'auto' && readyAt > Date.now();
      if (waiting) {
        result.deferred++;
        if (state.notified[t.name] !== r.to) {
          availableItems.push({
            name: t.name, image: r.image, from: r.from, to: r.to,
            note: `auto-update after ${new Date(readyAt).toISOString().slice(0, 10)} (${t.cooldownDays}-day cooldown)`,
          });
          state.notified[t.name] = r.to;
        }
      } else if (t.action === 'update') toUpdate.push(t.id);
      else if (state.notified[t.name] !== r.to) {
        // Notify each new version only once
        availableItems.push({ name: t.name, image: r.image, from: r.from, to: r.to });
        state.notified[t.name] = r.to;
      }
    } else if (r.status === 'auth-required' || r.status === 'error') {
      failedItems.push({ name: t.name, error: r.message ?? 'Check failed' });
    }
  }

  if (availableItems.length) await notify('update-available', { items: availableItems, trigger, host });

  if (toUpdate.length) {
    const summary = await dk.updateMany({ ids: toUpdate, trigger });
    result.updated = summary.updated + (summary.selfUpdate ? 1 : 0);
    result.failed = summary.failed.length;
    for (const item of summary.items) delete state.notified[item.name];
    if (summary.items.length) await notify('updated', { items: summary.items, trigger, host });
    failedItems.push(...summary.failed);
  }
  if (failedItems.length) await notify('update-failed', { items: failedItems, trigger, host });

  result.failed = Math.max(result.failed, failedItems.length);
  state.lastRun = result;
  await saveState();
  return result;
}

async function runCleanupJob(trigger = 'auto') {
  await loadState();
  const r = await dk.runCleanup();
  state.lastCleanup = { at: new Date().toISOString(), trigger, ...r };
  await saveState();
  if (r.count) await notify('cleanup', { count: r.count, freed: r.freed, trigger, host: await dk.hostName().catch(() => '') });
  return r;
}

// ---------- Queue ----------

function enqueue(label, fn) {
  return new Promise((resolve, reject) => {
    queue.push({ label, fn, resolve, reject });
    void drain();
  });
}

async function drain() {
  if (running || !queue.length) return;
  const job = queue.shift();
  running = { label: job.label, since: new Date().toISOString() };
  try {
    job.resolve(await job.fn());
  } catch (err) {
    console.error(`Scheduled job "${job.label}" failed:`, err);
    job.reject(err);
  } finally {
    running = null;
    void drain();
  }
}

// ---------- Tick ----------

async function tick() {
  const now = new Date();
  const minuteKey = Math.floor(now.getTime() / 60_000);
  if (minuteKey === lastTickMinute) return;
  lastTickMinute = minuteKey;

  let s;
  try {
    s = getSettings();
  } catch {
    return;
  }
  const tz = s.timezone;

  if (s.autoUpdate.enabled) {
    try {
      const containers = await dk.listContainers();
      const due = [];
      for (const c of containers) {
        const plan = containerPlan(c.name, s);
        if (plan.mode === 'off' || c.updateStatus === 'local') continue;
        if (cronMatches(plan.cron, now, tz)) due.push({ id: c.id, name: c.name, action: plan.action, cooldownDays: plan.cooldownDays });
      }
      if (due.length) {
        enqueue(`auto-update (${due.length})`, () => runAutoUpdate(due)).catch(() => {});
      }
    } catch (err) {
      console.error('Auto-update tick failed:', err.message);
    }
  }

  if (s.cleanup.scheduled) {
    try {
      if (cronMatches(scheduleToCron(s.cleanup.schedule), now, tz)) {
        enqueue('cleanup', () => runCleanupJob()).catch(() => {});
      }
    } catch (err) {
      console.error('Cleanup tick failed:', err.message);
    }
  }
}

export async function startScheduler() {
  await loadState();
  // Check a few times per minute so a slow tick never skips a minute
  setInterval(() => void tick(), 15_000).unref();
}

// ---------- API helpers ----------

export async function status() {
  await loadState();
  const s = getSettings();
  const tz = s.timezone;
  const safeNext = (cron) => {
    try {
      return nextRuns(cron, tz, 1)[0]?.toISOString() ?? null;
    } catch {
      return null;
    }
  };
  const containers = await dk.listContainers().catch(() => []);
  return {
    timezone: tz,
    running,
    queued: queue.length,
    lastRun: state.lastRun,
    lastCleanup: state.lastCleanup,
    nextRun: s.autoUpdate.enabled ? safeNext(scheduleToCron(s.autoUpdate.schedule)) : null,
    nextCleanup: s.cleanup.scheduled ? safeNext(scheduleToCron(s.cleanup.schedule)) : null,
    containers: containers.map((c) => {
      const plan = containerPlan(c.name, s);
      return {
        id: c.id,
        name: c.name,
        image: c.image,
        icon: c.icon,
        isSelf: c.isSelf,
        local: c.updateStatus === 'local',
        mode: plan.mode,
        action: plan.action ?? null,
        cooldownDays: plan.cooldownDays ?? 0,
        health: c.health,
        nextRun: s.autoUpdate.enabled && plan.mode !== 'off' && c.updateStatus !== 'local' ? safeNext(plan.cron) : null,
      };
    }),
  };
}

/** "Run now" from the Auto-Update page: every container that is not off. */
export async function runNow() {
  const s = getSettings();
  const targets = (await dk.listContainers())
    .map((c) => ({ c, plan: containerPlan(c.name, s) }))
    .filter(({ c, plan }) => plan.mode !== 'off' && c.updateStatus !== 'local')
    .map(({ c, plan }) => ({ id: c.id, name: c.name, action: plan.action, cooldownDays: plan.cooldownDays }));
  return enqueue(`manual run (${targets.length})`, () => runAutoUpdate(targets, 'manual'));
}

export const cleanupNow = () => enqueue('cleanup', () => runCleanupJob('manual'));

export function previewSchedule(schedule, count = 3) {
  const s = getSettings();
  const cron = scheduleToCron(schedule);
  return { cron, timezone: s.timezone, next: nextRuns(cron, s.timezone, count).map((d) => d.toISOString()) };
}

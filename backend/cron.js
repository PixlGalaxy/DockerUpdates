// Minimal 5-field cron engine (minute hour day-of-month month day-of-week) with time zones.
// Supports "*", lists "1,15", ranges "1-5", steps "*/10" and "0-30/5". Day of week 0-7 (0/7 = Sunday).

const bad = (message) => Object.assign(new Error(message), { status: 400 });

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

function parseField(expr, { name, min, max }) {
  const values = new Set();
  for (const part of expr.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw bad(`Invalid ${name} "${part}" in cron expression`);
    let [lo, hi] = m[1] === '*' ? [min, max] : m[1].split('-').map(Number);
    if (hi === undefined) hi = m[2] ? max : lo;
    const step = m[2] ? Number(m[2]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) throw bad(`Out of range ${name} "${part}" (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expression) {
  const parts = String(expression ?? '').trim().split(/\s+/);
  if (parts.length !== 5) throw bad('Cron expression must have 5 fields: minute hour day month weekday');
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (dow.has(7)) dow.add(0);
  return { minute, hour, dom, month, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

/** Converts the UI schedule ({ frequency, minute, hour, dayOfWeek, dayOfMonth, cron }) to cron. */
export function scheduleToCron(s = {}) {
  const m = Number(s.minute ?? 0);
  const h = Number(s.hour ?? 4);
  switch (s.frequency) {
    case 'hourly':
      return `${m} * * * *`;
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekly':
      return `${m} ${h} * * ${Number(s.dayOfWeek ?? 0)}`;
    case 'monthly':
      return `${m} ${h} ${Number(s.dayOfMonth ?? 1)} * *`;
    case 'custom':
      return String(s.cron ?? '').trim();
    default:
      throw bad(`Unknown frequency "${s.frequency}"`);
  }
}

function matches(c, { minute, hour, day, month, weekday }) {
  if (!c.minute.has(minute) || !c.hour.has(hour) || !c.month.has(month)) return false;
  // Standard cron: if both day fields are restricted, either one matching is enough
  if (!c.domAny && !c.dowAny) return c.dom.has(day) || c.dow.has(weekday);
  return c.dom.has(day) && c.dow.has(weekday);
}

const formatters = new Map();
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', weekday: 'short',
    }));
  }
  return formatters.get(timeZone);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of a date in a time zone. */
export function zonedParts(date, timeZone) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAYS[p.weekday],
  };
}

export function isValidTimeZone(tz) {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** True if the cron expression fires at the minute of `date` in `timeZone`. */
export function cronMatches(expression, date, timeZone) {
  return matches(parseCron(expression), zonedParts(date, timeZone));
}

/** Next `count` run times (Date) after `from`. Fast: walks wall-clock minutes with a fixed offset. */
export function nextRuns(expression, timeZone, count = 3, from = new Date()) {
  const c = parseCron(expression);
  const p = zonedParts(from, timeZone);
  const wallNow = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const offset = wallNow - Math.floor(from.getTime() / 60_000) * 60_000; // wall - real
  const runs = [];
  const limit = 366 * 24 * 60;
  for (let i = 1; i <= limit && runs.length < count; i++) {
    const wall = new Date(wallNow + i * 60_000);
    const parts = {
      minute: wall.getUTCMinutes(),
      hour: wall.getUTCHours(),
      day: wall.getUTCDate(),
      month: wall.getUTCMonth() + 1,
      weekday: wall.getUTCDay(),
    };
    if (matches(c, parts)) runs.push(new Date(wall.getTime() - offset));
  }
  return runs;
}

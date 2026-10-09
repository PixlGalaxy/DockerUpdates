// Notifications: Discord (rich embeds), Telegram, ntfy and a generic JSON webhook.
import crypto from 'node:crypto';
import { getSettings } from './settings.js';

const TIMEOUT_MS = 10_000;
// Bot avatar and footer icon of the Discord messages: the logo centered on a white square
const AVATAR = 'https://raw.githubusercontent.com/PixlGalaxy/DockerUpdates/main/docs/assets/webhook-avatar.png';

// event -> look & wording
const EVENTS = {
  'update-available': { title: 'Updates available', color: 0xf59e0b, emoji: '🔔', tag: 'bell', setting: 'updateAvailable' },
  updated: { title: 'Containers updated', color: 0x22c55e, emoji: '✅', tag: 'white_check_mark', setting: 'updated' },
  'update-failed': { title: 'Update failed', color: 0xef4444, emoji: '❌', tag: 'x', setting: 'updateFailed' },
  cleanup: { title: 'Image cleanup', color: 0x0ea5e9, emoji: '🧹', tag: 'broom', setting: 'cleanup' },
  unhealthy: { title: 'Container unhealthy', color: 0xef4444, emoji: '🩺', tag: 'warning', setting: 'health' },
  recovered: { title: 'Container healthy again', color: 0x22c55e, emoji: '💚', tag: 'green_heart', setting: 'health' },
  crashed: { title: 'Container crashed', color: 0xdc2626, emoji: '💥', tag: 'boom', setting: 'health' },
  test: { title: 'Test notification', color: 0x2496ed, emoji: '🐳', tag: 'whale', setting: null },
};

const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmtBytes = (b) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

/** One line per item: "name: from -> to" / error. */
function itemLine(item) {
  if (item.error) return `${item.name}: ${item.error}`;
  if (item.from && item.to) return `${item.name}: ${item.from} → ${item.to}${item.note ? ` (${item.note})` : ''}`;
  return item.name;
}

function summaryText(event, p) {
  if (event === 'cleanup') return `Removed ${p.count ?? 0} image(s), freed ${fmtBytes(p.freed ?? 0)}.`;
  if (event === 'test') return 'DockerUpdates notifications are working.';
  const n = p.items?.length ?? 0;
  if (event === 'update-available') return `${n} container${n === 1 ? ' has' : 's have'} a new image available.`;
  if (event === 'unhealthy') return `${p.items?.[0]?.name} is failing its health check.`;
  if (event === 'recovered') return `${p.items?.[0]?.name} is passing its health check again.`;
  if (event === 'crashed') return `${p.items?.[0]?.name} stopped unexpectedly.`;
  if (event === 'updated') return `${n} container${n === 1 ? ' was' : 's were'} updated${p.trigger === 'auto' ? ' automatically' : ''}.`;
  return `${n} update${n === 1 ? '' : 's'} failed.`;
}

// ---------- Channels ----------

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
}

async function sendDiscord(cfg, event, p) {
  const meta = EVENTS[event];
  const items = p.items ?? [];
  const embed = {
    // The test message has no emoji in Discord (no whale): the avatar already shows the logo
    title: event === 'test' ? meta.title : `${meta.emoji}  ${meta.title}`,
    description: summaryText(event, p),
    color: meta.color,
    fields: items.slice(0, 24).map((item) => ({
      name: item.name,
      value: item.error
        ? `\`\`\`${item.error.slice(0, 900)}\`\`\``
        : [
            item.image && `\`${item.image}\``,
            item.from && item.to && `**${item.from}** → **${item.to}**`,
            item.note && `_${item.note}_`,
          ].filter(Boolean).join('\n') || '​',
      inline: !item.error && items.length > 1,
    })),
    footer: { text: `DockerUpdates · ${p.host ?? ''}`.trim(), icon_url: AVATAR },
    timestamp: new Date().toISOString(),
  };
  if (items.length > 24) embed.fields.push({ name: '…', value: `and ${items.length - 24} more`, inline: false });
  if (event === 'cleanup') {
    embed.fields = [
      { name: 'Images removed', value: String(p.count ?? 0), inline: true },
      { name: 'Space freed', value: fmtBytes(p.freed ?? 0), inline: true },
    ];
  }
  await post(cfg.webhookUrl, {
    username: 'DockerUpdates',
    avatar_url: AVATAR,
    content: cfg.mention && event !== 'test' ? cfg.mention : undefined,
    embeds: [embed],
    allowed_mentions: { parse: ['roles', 'users', 'everyone'] },
  });
}

async function sendTelegram(cfg, event, p) {
  const meta = EVENTS[event];
  const lines = [`${meta.emoji} <b>${escapeHtml(meta.title)}</b>`, escapeHtml(summaryText(event, p))];
  const items = p.items ?? [];
  if (items.length) {
    lines.push('');
    for (const item of items.slice(0, 40)) {
      lines.push(item.error
        ? `• <b>${escapeHtml(item.name)}</b>: <code>${escapeHtml(item.error.slice(0, 300))}</code>`
        : `• <b>${escapeHtml(item.name)}</b>${item.from && item.to ? `  <code>${escapeHtml(item.from)}</code> → <code>${escapeHtml(item.to)}</code>` : ''}${item.note ? ` <i>(${escapeHtml(item.note)})</i>` : ''}`);
    }
  }
  if (p.host) lines.push('', `<i>${escapeHtml(p.host)}</i>`);
  await post(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

async function sendNtfy(cfg, event, p) {
  const meta = EVENTS[event];
  const body = [summaryText(event, p), ...(p.items ?? []).map(itemLine)].join('\n');
  await post(cfg.url, body, {
    'Content-Type': 'text/plain; charset=utf-8',
    Title: `DockerUpdates: ${meta.title}${p.host ? ` (${p.host})` : ''}`,
    Tags: meta.tag,
    Priority: event === 'update-failed' ? 'high' : 'default',
    ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
  });
}

async function sendWebhook(cfg, event, p) {
  const body = JSON.stringify({ event, title: EVENTS[event].title, message: summaryText(event, p), ...p, timestamp: new Date().toISOString() });
  const headers = {};
  if (cfg.secret) {
    headers['X-DockerUpdates-Signature'] = `sha256=${crypto.createHmac('sha256', cfg.secret).update(body).digest('hex')}`;
  }
  await post(cfg.url, body, headers);
}

const CHANNELS = {
  discord: { send: sendDiscord, ready: (c) => c.webhookUrl },
  telegram: { send: sendTelegram, ready: (c) => c.botToken && c.chatId },
  ntfy: { send: sendNtfy, ready: (c) => c.url },
  webhook: { send: sendWebhook, ready: (c) => c.url },
};

/**
 * Sends an event to every enabled channel. Never throws (failures are logged).
 * payload: { items?: [{ name, image, from, to, error }], trigger?: 'auto'|'manual', host, count, freed }
 */
export async function notify(event, payload = {}) {
  const n = getSettings().notifications;
  const meta = EVENTS[event];
  if (meta.setting && !n.events[meta.setting]) return;
  if (payload.trigger === 'manual' && !n.includeManual) return;
  if (meta.setting && event !== 'cleanup' && !payload.items?.length) return;
  if (['unhealthy', 'recovered', 'crashed'].includes(event)) payload = { ...payload, trigger: 'auto' };

  await Promise.all(Object.entries(CHANNELS).map(async ([name, ch]) => {
    const cfg = n[name];
    if (!cfg.enabled || !ch.ready(cfg)) return;
    try {
      await ch.send(cfg, event, payload);
    } catch (err) {
      console.error(`Notification via ${name} failed:`, err.message);
    }
  }));
}

/** Sends a test message to one channel and reports the result (used by the Settings page). */
export async function testChannel(name, host) {
  const ch = Object.hasOwn(CHANNELS, name) ? CHANNELS[name] : null;
  if (!ch) throw Object.assign(new Error('Unknown channel'), { status: 400 });
  const cfg = getSettings().notifications[name];
  if (!ch.ready(cfg)) throw Object.assign(new Error('Fill in and save this channel first'), { status: 400 });
  try {
    await ch.send(cfg, 'test', {
      host,
      items: [{ name: 'example-app', image: 'ghcr.io/owner/example-app:latest', from: '4bbda4e', to: '9f3c2d1' }],
    });
  } catch (err) {
    throw Object.assign(new Error(`${name} rejected the message: ${err.message}`), { status: 502 });
  }
}

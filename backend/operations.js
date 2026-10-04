// Long-running operations (e.g. updates) whose progress the UI follows live over SSE.
// Events: { t: 'section', title } | { t: 'line', text } | { t: 'layer', id, text } | { t: 'done', ok, result?, error? }
import crypto from 'node:crypto';

const KEEP_MS = 15 * 60_000;
const operations = new Map();

/** A reporter that does nothing (updates run without a UI, e.g. scheduled ones). */
export const silent = { section() {}, line() {}, layer() {} };

/**
 * Starts `fn(reporter)` in the background and returns the operation id immediately.
 * `onDone(result)` runs after success (notifications, etc.).
 */
export function startOperation(title, fn) {
  const id = crypto.randomUUID();
  const op = { id, title, events: [], listeners: new Set(), done: false };
  operations.set(id, op);

  const emit = (e) => {
    op.events.push(e);
    for (const l of op.listeners) l(e);
  };
  const reporter = {
    section: (title_) => emit({ t: 'section', title: title_ }),
    line: (text) => emit({ t: 'line', text }),
    layer: (layerId, text) => emit({ t: 'layer', id: layerId, text }),
  };

  Promise.resolve()
    .then(() => fn(reporter))
    .then(
      (result) => emit({ t: 'done', ok: true, result }),
      (err) => emit({ t: 'done', ok: false, error: err.message }),
    )
    .finally(() => {
      op.done = true;
      setTimeout(() => operations.delete(id), KEEP_MS).unref();
    });
  return id;
}

/** GET /api/operations/:id/stream — replays past events, then streams new ones. */
export function streamOperation(req, res) {
  const op = operations.get(req.params.opId);
  if (!op) return res.status(404).json({ error: 'Operation not found (it may have expired)' });

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.write(`event: title\ndata: ${JSON.stringify(op.title)}\n\n`);
  for (const e of op.events) send(e);
  if (op.done) return res.end();

  const listener = (e) => {
    send(e);
    if (e.t === 'done') {
      op.listeners.delete(listener);
      res.end();
    }
  };
  op.listeners.add(listener);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    op.listeners.delete(listener);
  });
}

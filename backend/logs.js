// Live container logs over Server-Sent Events: GET /api/containers/:id/logs/stream?tail=500
import { PassThrough } from 'node:stream';
import { docker } from './docker.js';

const FLUSH_MS = 100;
const HEARTBEAT_MS = 20_000;

export async function streamLogs(req, res) {
  const container = docker.getContainer(req.params.id);
  let info;
  try {
    info = await container.inspect();
  } catch (err) {
    return res.status(err.statusCode === 404 ? 404 : 500).json({ error: err.json?.message ?? err.message });
  }

  const tail = Math.min(Math.max(Number(req.query.tail) || 500, 10), 10_000);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx / NPM)
  });
  res.flushHeaders();

  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    res.write(`event: lines\ndata: ${JSON.stringify(pending)}\n\n`);
    pending = [];
  };
  const flushTimer = setInterval(flush, FLUSH_MS);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  // Splits a byte stream into lines, keeping partial lines between chunks
  const lineReader = (stream) => {
    let buffer = '';
    return (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) pending.push({ s: stream, t: line });
      if (pending.length > 2000) flush();
    };
  };

  let logStream;
  const cleanup = () => {
    clearInterval(flushTimer);
    clearInterval(heartbeat);
    logStream?.destroy?.();
  };
  req.on('close', cleanup);

  try {
    logStream = await container.logs({ follow: true, stdout: true, stderr: true, tail, timestamps: true });
    if (info.Config.Tty) {
      logStream.on('data', lineReader('out'));
    } else {
      // Non-TTY logs are multiplexed (8-byte header per frame): split stdout / stderr
      const out = new PassThrough();
      const err = new PassThrough();
      out.on('data', lineReader('out'));
      err.on('data', lineReader('err'));
      docker.modem.demuxStream(logStream, out, err);
    }
    logStream.on('end', () => {
      flush();
      res.write(`event: end\ndata: {}\n\n`);
      cleanup();
      res.end();
    });
    logStream.on('error', (e) => {
      flush();
      res.write(`event: failure\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
      cleanup();
      res.end();
    });
  } catch (e) {
    res.write(`event: failure\ndata: ${JSON.stringify({ message: e.json?.message ?? e.message })}\n\n`);
    cleanup();
    res.end();
  }
}

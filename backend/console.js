// Interactive shell inside a container (docker exec) over a WebSocket:
//   ws(s)://<host>/api/containers/:id/console
// Client -> server: text JSON { type: 'input', data } | { type: 'resize', cols, rows }
// Server -> client: binary terminal output, text JSON { type: 'error' | 'exit', message? }
import { WebSocketServer } from 'ws';
import { audit, auditThrottled } from './auth.js';
import { docker } from './docker.js';
import { consoleKeepalive } from './runtimeConfig.js';

const PATH_RE = /^\/api\/containers\/([a-zA-Z0-9][a-zA-Z0-9_.-]{0,127})\/console(?:\?.*)?$/;
// Prefer bash, fall back to sh (alpine, busybox...)
const SHELL = ['/bin/sh', '-c', 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'];

function reject(socket, code, text) {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

// Close codes the browser can read (a rejected HTTP upgrade only shows up as 1006)
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_FORBIDDEN_ORIGIN = 4403;

/**
 * auth: { userFor(req) -> username | null, sameOrigin(req) -> boolean, clientIp(req) -> string,
 *         banned(req) -> boolean }
 */
export function attachConsole(server, auth) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const match = req.url?.match(PATH_RE);
    if (auth.banned?.(req)) return reject(socket, 403, 'Forbidden');
    if (!match) return reject(socket, 404, 'Not Found');
    // Browsers always send Origin on WebSockets: blocks cross-site WebSocket hijacking.
    // Refused connections are accepted only to tell the browser why, then closed right away:
    // nothing runs and no data is sent.
    const refuse = (code, message, logLine) => {
      // Reachable without a session: logged at most once per address per minute
      const origin = String(req.headers.origin ?? '-').slice(0, 200);
      auditThrottled({ ip: auth.clientIp(req) }, `console refused: ${logLine} (origin=${origin} host=${req.headers.host ?? '-'})`);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(JSON.stringify({ type: 'error', message }));
        ws.close(code, message.slice(0, 120));
      });
    };
    if (!auth.sameOrigin(req)) {
      return refuse(
        CLOSE_FORBIDDEN_ORIGIN,
        'Origin not allowed: the address in the browser does not match the Host header the server received. If a reverse proxy changes the Host header, add this address to Allowed origins in Settings > Server & access.',
        'origin not allowed',
      );
    }
    const user = auth.userFor(req);
    if (!user) return refuse(CLOSE_UNAUTHORIZED, 'Your session expired: sign in again.', 'no valid session');

    wss.handleUpgrade(req, socket, head, (ws) => {
      void session(ws, match[1], { user, ip: auth.clientIp(req) });
    });
  });
}

async function session(ws, id, who) {
  const sendControl = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  let stream;
  try {
    const container = docker.getContainer(id);
    const info = await container.inspect();
    if (!info.State.Running) {
      sendControl({ type: 'error', message: 'The container is not running.' });
      return ws.close();
    }
    const exec = await container.exec({
      Cmd: SHELL,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Env: ['TERM=xterm-256color', 'COLORTERM=truecolor'],
    });
    stream = await exec.start({ hijack: true, stdin: true, Tty: true });
    // Keep-alive (Settings > Server & access): a ping frame counts as traffic for the reverse
    // proxy, so an idle console is not cut. Browsers answer pings on their own.
    const every = consoleKeepalive();
    const keepalive = every > 0 ? setInterval(() => ws.readyState === ws.OPEN && ws.ping(), every * 1000) : null;
    ws.on('close', () => clearInterval(keepalive));
    audit({ ip: who.ip }, `user="${who.user}" console opened in ${info.Name.replace(/^\//, '')}`);

    stream.on('data', (chunk) => ws.readyState === ws.OPEN && ws.send(chunk, { binary: true }));
    stream.on('end', () => {
      sendControl({ type: 'exit' });
      ws.close();
    });
    stream.on('error', (e) => {
      sendControl({ type: 'error', message: e.message });
      ws.close();
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return stream.write(data);
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'input' && typeof msg.data === 'string') stream.write(msg.data);
      else if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
        exec.resize({ w: Math.min(Math.max(msg.cols, 10), 500), h: Math.min(Math.max(msg.rows, 5), 200) }).catch(() => {});
      }
    });
    ws.on('close', () => {
      stream.end();
      audit({ ip: who.ip }, `user="${who.user}" console closed in ${info.Name.replace(/^\//, '')}`);
    });
  } catch (err) {
    const message = err.json?.message ?? err.message;
    sendControl({
      type: 'error',
      message: /executable file not found|no such file/i.test(message)
        ? 'This container has no shell (/bin/sh), so a console cannot be opened.'
        : message,
    });
    ws.close();
    stream?.end?.();
  }
}

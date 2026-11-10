// MCP server (Model Context Protocol, Streamable HTTP transport, stateless JSON responses) so AI
// assistants such as Claude or ChatGPT can manage the containers. Off by default; enabled and
// limited in Settings → AI assistants. The endpoint and the OAuth URLs are built from the
// address the request came in on, so the same app works on the LAN and behind a reverse proxy.
//
//   POST /mcp                                     JSON-RPC (Bearer token)
//   /.well-known/oauth-protected-resource[/mcp]   which server issues tokens (RFC 9728)
//   /.well-known/oauth-authorization-server       OAuth metadata (RFC 8414)
//   POST /oauth/register | /oauth/token           client registration, tokens
//   GET  /oauth/authorize                         consent page (React app, signed-in admin)
import express from 'express';
import { audit, auditThrottled } from './auth.js';
import * as mcpAuth from './mcpAuth.js';
import { detectBasePath } from './mcpStorage.js';
import { LEVEL_RANK, toolsFor, TOOLS } from './mcpTools.js';
import { getSettings } from './settings.js';

const VERSION = process.env.APP_VERSION || 'dev';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const enabled = () => Boolean(getSettings().mcp?.enabled);
const level = () => getSettings().mcp?.level ?? 'read';
/** Address the client used (Host + X-Forwarded-Proto from a trusted proxy). */
const originOf = (req) => `${req.protocol}://${req.get('host')}`;

const INSTRUCTIONS = [
  'DockerUpdates manages the Docker containers and compose stacks of one server.',
  'Before creating or changing containers or stacks, call get_storage_conventions and keep data in host folders',
  'with the same layout as the existing containers. Docker volumes (named, or image VOLUMEs left unmapped) are rejected.',
  'Tools that edit or remove something, or run commands inside a container, need the user\'s approval: explain what',
  'will happen first. DockerUpdates cannot stop, edit, remove or run commands in its own container.',
].join(' ');

// ---------- Public router (no session): metadata, OAuth, /mcp ----------

export const mcpRouter = express.Router();

// Everything 404s while MCP is disabled
mcpRouter.use(['/mcp', '/oauth', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'], (req, res, next) => {
  if (req.method === 'GET' && req.path === '/authorize' && req.baseUrl === '/oauth') return next(); // React page, shows the reason
  if (!enabled()) return res.status(404).json({ error: 'Not found' });
  next();
});

const resourceMetadata = (req, res) => {
  const origin = originOf(req);
  res.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [mcpAuth.SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'DockerUpdates',
  });
};
mcpRouter.get('/.well-known/oauth-protected-resource', resourceMetadata);
mcpRouter.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata);

const serverMetadata = (req, res) => {
  const origin = originOf(req);
  res.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [mcpAuth.SCOPE],
  });
};
mcpRouter.get('/.well-known/oauth-authorization-server', serverMetadata);
mcpRouter.get('/.well-known/openid-configuration', serverMetadata);

const oauthHandler = (fn, status = 200) => async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  try {
    res.status(status).json(await fn(req));
  } catch (err) {
    if (!err.oauth) console.error(err);
    if (err.oauth) auditThrottled(req, `mcp oauth ${req.path} refused: ${err.oauth}`);
    res.status(err.status ?? 500).json({ error: err.oauth ?? 'server_error', error_description: err.oauth ? err.message : 'Internal server error' });
  }
};
const form = express.urlencoded({ extended: false, limit: '20kb' });
mcpRouter.post('/oauth/register', oauthHandler(async (req) => {
  const client = await mcpAuth.registerClient(req.body);
  audit(req, `mcp app registered: "${client.client_name}"`);
  return client;
}, 201));
mcpRouter.post('/oauth/token', form, oauthHandler((req) => mcpAuth.token(req)));

// ---------- /mcp ----------

function unauthorized(req, res) {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource/mcp"`);
  res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
}

mcpRouter.all('/mcp', async (req, res) => {
  if (req.method !== 'POST') {
    // Stateless server: no SSE stream to open, no session to delete
    res.set('Allow', 'POST');
    return res.status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } });
  }
  const who = mcpAuth.verifyBearer(req.get('authorization'));
  if (!who) {
    if (req.get('authorization')) auditThrottled(req, 'mcp request with an invalid token');
    return unauthorized(req, res);
  }

  const batch = Array.isArray(req.body);
  const messages = batch ? req.body : [req.body];
  if (!messages.length || messages.some((m) => !m || typeof m !== 'object' || m.jsonrpc !== '2.0')) {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
  }
  const replies = [];
  for (const msg of messages) {
    if (msg.method === undefined || msg.id === undefined || msg.id === null) continue; // notifications, responses
    replies.push(await answer(msg, req, who));
  }
  if (!replies.length) return res.status(202).end();
  res.json(batch ? replies : replies[0]);
});

async function answer(msg, req, who) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  const params = msg.params ?? {};

  switch (msg.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      audit(req, `mcp session started by ${who.kind} "${who.name}" (${params.clientInfo?.name ?? 'unknown client'})`);
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dockerupdates', title: 'DockerUpdates', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: toolsFor(level()).map(({ name, title, description, inputSchema, annotations }) => ({
          name, title, description, inputSchema, annotations: { title, ...annotations },
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(params.name).slice(0, 80)}`);
      if (LEVEL_RANK[tool.level] > LEVEL_RANK[level()]) {
        return reply(toolError(`"${tool.name}" needs the "${tool.level}" access level; it is "${level()}" (Settings → AI assistants).`));
      }
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      try {
        const result = await tool.run(args, { req, who });
        if (tool.annotations.readOnlyHint !== true) audit(req, `mcp ${who.kind}="${who.name}" ${tool.name} ${describeArgs(args)} -> ok`);
        return reply({ content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }, null, 2) }] });
      } catch (err) {
        const message = err.json?.message ?? err.message ?? 'Failed';
        if (!err.status && !err.statusCode) console.error(err);
        audit(req, `mcp ${who.kind}="${who.name}" ${tool.name} ${describeArgs(args)} -> failed: ${String(message).slice(0, 200)}`);
        return reply(toolError(message));
      }
    }
    default:
      return fail(-32601, `Method not found: ${String(msg.method).slice(0, 80)}`);
  }
}

const toolError = (text) => ({ content: [{ type: 'text', text: String(text) }], isError: true });

/** Arguments for the audit log, without file contents or secrets. */
function describeArgs(args) {
  const shown = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'spec') shown.spec = { name: v?.name, image: v?.image };
    else if (k === 'yaml' || k === 'env') shown[k] = `(${String(v ?? '').length} chars)`;
    else shown[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return JSON.stringify(shown);
}

// ---------- Session API for the UI (/api/mcp, behind requireAuth and sameOriginOnly) ----------

export const mcpApi = express.Router();

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  }
};

mcpApi.get('/', wrap(async () => ({
  ...mcpAuth.listAccess(),
  detectedDataPath: await detectBasePath().catch(() => null),
})));
mcpApi.post('/tokens', wrap(async (req) => {
  const t = await mcpAuth.createToken(req.body?.name);
  audit(req, `user="${req.user}" created MCP access token "${t.name}"`);
  return t;
}));
mcpApi.delete('/tokens/:tokenId', wrap(async (req) => {
  if (!(await mcpAuth.revokeToken(req.params.tokenId))) throw Object.assign(new Error('Token not found'), { status: 404 });
  audit(req, `user="${req.user}" revoked an MCP access token`);
  return { ok: true };
}));
mcpApi.delete('/connections/:connectionId', wrap(async (req) => {
  if (!(await mcpAuth.revokeConnection(req.params.connectionId))) throw Object.assign(new Error('Connection not found'), { status: 404 });
  audit(req, `user="${req.user}" disconnected an MCP app`);
  return { ok: true };
}));

const AUTHORIZE_KEYS = ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'];
const pickQuery = (q) => Object.fromEntries(AUTHORIZE_KEYS.filter((k) => typeof q?.[k] === 'string').map((k) => [k, q[k]]));

function assertEnabled() {
  if (!enabled()) throw Object.assign(new Error('AI assistant access (MCP) is turned off in Settings.'), { status: 400 });
}

// What the consent page shows
mcpApi.get('/authorize', wrap(async (req) => {
  assertEnabled();
  const { client, redirectUri } = mcpAuth.checkAuthorizeRequest(pickQuery(req.query));
  return { clientName: client.name, redirectHost: new URL(redirectUri).host || redirectUri, level: level() };
}));
// Approve / deny: the page sends the browser to the returned URL
mcpApi.post('/authorize', wrap(async (req) => {
  assertEnabled();
  const approve = req.body?.approve === true;
  const { redirect, client } = mcpAuth.decide(pickQuery(req.body?.query), approve, { issuer: originOf(req), ip: req.ip });
  audit(req, `user="${req.user}" ${approve ? 'approved' : 'denied'} MCP access for "${client.name}"`);
  return { redirect };
}));

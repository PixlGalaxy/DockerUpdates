// Authentication for the MCP endpoint (AI assistants such as Claude or ChatGPT).
//
// Two ways in, both sent as "Authorization: Bearer <token>" to /mcp:
//   - OAuth 2.1 (what claude.ai and ChatGPT use): the app registers itself (dynamic client
//     registration), opens /oauth/authorize in the browser, the admin signs in and approves,
//     and the app gets an access token (1 h) plus a refresh token. Each approval is a
//     "connection" that can be revoked from Settings.
//   - Access tokens created in Settings (for clients configured by hand, e.g. Claude Code).
// Only SHA-256 hashes of tokens and client secrets are stored (DATA_DIR/mcp-auth.json).
import crypto from 'node:crypto';
import { readJson, writeJson } from './store.js';

const FILE = 'mcp-auth.json';
const ACCESS_TTL_MS = 3600_000;
const REFRESH_TTL_MS = 30 * 24 * 3600_000; // since the connection was last used
const CODE_TTL_MS = 60_000;
const MAX_CLIENTS = 100;
const UNUSED_CLIENT_TTL_MS = 24 * 3600_000;
export const SCOPE = 'mcp';

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const random = (prefix) => `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
const newId = () => crypto.randomBytes(8).toString('hex');
const oauthError = (status, error, description) => Object.assign(new Error(description ?? error), { status, oauth: error });

// clients: id -> { name, redirectUris, secretHash?, authMethod, created }
// grants: id -> { clientId, clientName, created, lastUsed, refreshHash, ip }
// tokens: id -> { name, hash, created, lastUsed }
const state = await readJson(FILE, { clients: {}, grants: {}, tokens: {} });
for (const k of ['clients', 'grants', 'tokens']) state[k] ??= {};

const codes = new Map(); // code -> { clientId, redirectUri, challenge, expires, ip }
const accessTokens = new Map(); // hash -> { grantId, expires }
let dirty = false;

const save = () => {
  dirty = false;
  return writeJson(FILE, state);
};
// lastUsed is flushed once per minute
setInterval(() => dirty && void save(), 60_000).unref();

setInterval(() => {
  const now = Date.now();
  for (const [k, c] of codes) if (c.expires < now) codes.delete(k);
  for (const [k, t] of accessTokens) if (t.expires < now) accessTokens.delete(k);
  let changed = false;
  for (const [id, g] of Object.entries(state.grants)) {
    if (now - g.lastUsed > REFRESH_TTL_MS) {
      delete state.grants[id];
      changed = true;
    }
  }
  if (pruneClients()) changed = true;
  if (changed) void save();
}, 10 * 60_000).unref();

/** Drops registered clients that were never approved (registration needs no login). */
function pruneClients() {
  const used = new Set(Object.values(state.grants).map((g) => g.clientId));
  const now = Date.now();
  let changed = false;
  const unused = Object.entries(state.clients)
    .filter(([id]) => !used.has(id))
    .sort((a, b) => a[1].created - b[1].created);
  for (const [id, c] of unused) {
    if (now - c.created > UNUSED_CLIENT_TTL_MS || Object.keys(state.clients).length > MAX_CLIENTS) {
      delete state.clients[id];
      changed = true;
    }
  }
  return changed;
}

// ---------- Dynamic client registration (RFC 7591) ----------

/** https anywhere, http only on loopback, or an app scheme (claude://, cursor://...). */
function validRedirectUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !['javascript:', 'data:', 'file:', 'blob:', 'vbscript:'].includes(url.protocol);
}

export async function registerClient(body) {
  const redirectUris = body?.redirect_uris;
  if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.length > 10) {
    throw oauthError(400, 'invalid_redirect_uri', 'redirect_uris is required');
  }
  for (const uri of redirectUris) {
    if (typeof uri !== 'string' || uri.length > 2000 || !validRedirectUri(uri)) {
      throw oauthError(400, 'invalid_redirect_uri', `Redirect URI not allowed: ${String(uri).slice(0, 200)}`);
    }
  }
  const authMethod = body.token_endpoint_auth_method ?? 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod)) {
    throw oauthError(400, 'invalid_client_metadata', 'Unsupported token_endpoint_auth_method');
  }
  const name = String(body.client_name ?? '').replace(/[^\p{L}\p{N} ._()@+-]/gu, '').trim().slice(0, 80) || 'Unnamed app';
  const id = `du-${crypto.randomBytes(16).toString('hex')}`;
  const secret = authMethod === 'none' ? null : random('');
  state.clients[id] = { name, redirectUris, authMethod, secretHash: secret ? hash(secret) : undefined, created: Date.now() };
  pruneClients();
  await save();
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
    scope: SCOPE,
  };
}

// ---------- Authorization (consent page in the app, signed-in admin) ----------

/**
 * Checks an authorization request (the query of /oauth/authorize). Problems with the client or
 * the redirect URI cannot be sent back to the app, so they throw; others go to the redirect.
 */
export function checkAuthorizeRequest(q) {
  const client = state.clients[String(q.client_id ?? '')];
  if (!client) throw oauthError(400, 'invalid_client', 'This app is not registered (or its registration expired). Connect it again from the app.');
  const redirectUri = String(q.redirect_uri ?? '');
  if (!client.redirectUris.includes(redirectUri)) throw oauthError(400, 'invalid_request', 'The redirect URI does not match the registered app.');
  let problem = null;
  if (q.response_type !== 'code') problem = 'unsupported_response_type';
  else if (!q.code_challenge || q.code_challenge_method !== 'S256') problem = 'invalid_request';
  return { client, redirectUri, problem };
}

function redirectWith(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  return url.toString();
}

/** Approve or deny: returns the URL the browser must go to. */
export function decide(q, approve, { issuer, ip }) {
  const { client, redirectUri, problem } = checkAuthorizeRequest(q);
  const base = { state: q.state, iss: issuer };
  if (problem) return { redirect: redirectWith(redirectUri, { ...base, error: problem }), client };
  if (!approve) return { redirect: redirectWith(redirectUri, { ...base, error: 'access_denied' }), client };
  const code = random('');
  codes.set(hash(code), {
    clientId: String(q.client_id),
    redirectUri,
    challenge: String(q.code_challenge),
    expires: Date.now() + CODE_TTL_MS,
    ip,
  });
  return { redirect: redirectWith(redirectUri, { ...base, code }), client };
}

// ---------- Token endpoint ----------

function clientCredentials(req) {
  const body = req.body ?? {};
  const basic = /^Basic\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1];
  if (basic) {
    const [id, secret] = Buffer.from(basic, 'base64').toString('utf8').split(':').map((s) => decodeURIComponent(s ?? ''));
    return { id, secret };
  }
  return { id: String(body.client_id ?? ''), secret: body.client_secret };
}

function authenticateClient(req) {
  const { id, secret } = clientCredentials(req);
  const client = state.clients[id];
  if (!client) throw oauthError(401, 'invalid_client', 'Unknown client');
  if (client.secretHash) {
    const ok = typeof secret === 'string' && crypto.timingSafeEqual(Buffer.from(hash(secret)), Buffer.from(client.secretHash));
    if (!ok) throw oauthError(401, 'invalid_client', 'Wrong client secret');
  }
  return { id, client };
}

function issueTokens(grantId) {
  const grant = state.grants[grantId];
  const access = random('dua_');
  const refresh = random('dur_');
  accessTokens.set(hash(access), { grantId, expires: Date.now() + ACCESS_TTL_MS });
  grant.refreshHash = hash(refresh);
  grant.lastUsed = Date.now();
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    scope: SCOPE,
  };
}

export async function token(req) {
  const body = req.body ?? {};
  const { id, client } = authenticateClient(req);

  if (body.grant_type === 'authorization_code') {
    const key = hash(String(body.code ?? ''));
    const code = codes.get(key);
    codes.delete(key); // single use
    if (!code || code.expires < Date.now() || code.clientId !== id) throw oauthError(400, 'invalid_grant', 'Invalid or expired code');
    if (String(body.redirect_uri ?? code.redirectUri) !== code.redirectUri) throw oauthError(400, 'invalid_grant', 'redirect_uri mismatch');
    const verifier = String(body.code_verifier ?? '');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    if (!verifier || challenge !== code.challenge) throw oauthError(400, 'invalid_grant', 'PKCE verification failed');
    const grantId = newId();
    state.grants[grantId] = { clientId: id, clientName: client.name, created: Date.now(), lastUsed: Date.now(), ip: code.ip };
    const tokens = issueTokens(grantId);
    await save();
    return tokens;
  }

  if (body.grant_type === 'refresh_token') {
    const h = hash(String(body.refresh_token ?? ''));
    const grantId = Object.keys(state.grants).find((g) => state.grants[g].refreshHash === h);
    const grant = grantId && state.grants[grantId];
    if (!grant || grant.clientId !== id || Date.now() - grant.lastUsed > REFRESH_TTL_MS) {
      throw oauthError(400, 'invalid_grant', 'Invalid refresh token');
    }
    // Rotation: the previous refresh token stops working
    const tokens = issueTokens(grantId);
    await save();
    return tokens;
  }

  throw oauthError(400, 'unsupported_grant_type', 'Unsupported grant_type');
}

// ---------- Bearer check on /mcp ----------

/** Who a bearer token belongs to: { kind, id, name } or null. */
export function verifyBearer(header) {
  const value = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
  if (!value) return null;
  const h = hash(value);
  const now = Date.now();
  const access = accessTokens.get(h);
  if (access) {
    const grant = state.grants[access.grantId];
    if (access.expires < now || !grant) {
      accessTokens.delete(h);
      return null;
    }
    grant.lastUsed = now;
    dirty = true;
    return { kind: 'connection', id: access.grantId, name: grant.clientName };
  }
  for (const [id, t] of Object.entries(state.tokens)) {
    if (t.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(t.hash), Buffer.from(h))) {
      t.lastUsed = now;
      dirty = true;
      return { kind: 'token', id, name: t.name };
    }
  }
  return null;
}

// ---------- Settings: connections and access tokens ----------

const iso = (t) => (t ? new Date(t).toISOString() : null);

export function listAccess() {
  return {
    connections: Object.entries(state.grants)
      .map(([id, g]) => ({ id, name: g.clientName, created: iso(g.created), lastUsed: iso(g.lastUsed), ip: g.ip ?? null }))
      .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)),
    tokens: Object.entries(state.tokens)
      .map(([id, t]) => ({ id, name: t.name, created: iso(t.created), lastUsed: iso(t.lastUsed) }))
      .sort((a, b) => b.created.localeCompare(a.created)),
  };
}

export async function revokeConnection(id) {
  if (!Object.hasOwn(state.grants, id)) return false;
  delete state.grants[id];
  for (const [k, t] of accessTokens) if (t.grantId === id) accessTokens.delete(k);
  await save();
  return true;
}

/** Signs out every OAuth connection (after a password change). Access tokens are kept. */
export async function revokeAllConnections() {
  const count = Object.keys(state.grants).length;
  state.grants = {};
  accessTokens.clear();
  if (count) await save();
  return count;
}

export async function createToken(name) {
  const label = String(name ?? '').trim().slice(0, 60);
  if (!label) throw Object.assign(new Error('Give the token a name'), { status: 400 });
  if (Object.keys(state.tokens).length >= 20) throw Object.assign(new Error('Too many tokens: revoke one first'), { status: 400 });
  const value = random('dut_');
  const id = newId();
  state.tokens[id] = { name: label, hash: hash(value), created: Date.now(), lastUsed: null };
  await save();
  return { id, name: label, token: value };
}

export async function revokeToken(id) {
  if (!Object.hasOwn(state.tokens, id)) return false;
  delete state.tokens[id];
  await save();
  return true;
}

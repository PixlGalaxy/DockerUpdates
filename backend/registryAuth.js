import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registryAuth } from './runtimeConfig.js';

const DOCKER_HUB = 'docker.io';
const HUB_ALIASES = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io', 'registry.hub.docker.com']);

/** "ghcr.io/owner/app:tag" -> "ghcr.io", "nginx" / "owner/app" -> "docker.io" */
export function registryOf(image) {
  const slash = image.indexOf('/');
  if (slash === -1) return DOCKER_HUB;
  const first = image.slice(0, slash);
  const isHost = first.includes('.') || first.includes(':') || first === 'localhost';
  return isHost ? normalizeRegistry(first) : DOCKER_HUB;
}

/** "https://index.docker.io/v1/" -> "docker.io", "https://ghcr.io" -> "ghcr.io" */
function normalizeRegistry(key) {
  const host = key.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  return HUB_ALIASES.has(host) ? DOCKER_HUB : host;
}

/** Credentials from Settings → Registry credentials (or REGISTRY_AUTH in .env). */
function fromEnv(registry) {
  const entry = registryAuth().find((e) => normalizeRegistry(e.registry) === registry);
  return entry ? { username: entry.username, password: entry.password } : null;
}

function configPath() {
  const dir = process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker');
  return path.join(dir, 'config.json');
}

/** Credentials saved by `docker login` (read on every call so a new login is picked up). */
async function fromDockerConfig(registry) {
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath(), 'utf8'));
  } catch {
    return { auth: null, helper: false };
  }
  for (const [key, entry] of Object.entries(config.auths ?? {})) {
    if (normalizeRegistry(key) !== registry) continue;
    if (entry.identitytoken) return { auth: { identitytoken: entry.identitytoken }, helper: false };
    if (entry.username && entry.password) {
      return { auth: { username: entry.username, password: entry.password }, helper: false };
    }
    if (entry.auth) {
      const decoded = Buffer.from(entry.auth, 'base64').toString();
      const colon = decoded.indexOf(':');
      if (colon !== -1) {
        return { auth: { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }, helper: false };
      }
    }
  }
  // Credentials kept in an external helper (credsStore / credHelpers) cannot be read from here.
  const helper = Boolean(config.credsStore || config.credHelpers?.[registry]);
  return { auth: null, helper };
}

/** Returns a dockerode `authconfig` for the image's registry, or null for anonymous pulls. */
export async function authFor(image) {
  const registry = registryOf(image);
  const serveraddress = registry === DOCKER_HUB ? 'https://index.docker.io/v1/' : registry;

  const env = fromEnv(registry);
  if (env) return { ...env, serveraddress };

  const { auth } = await fromDockerConfig(registry);
  return auth ? { ...auth, serveraddress } : null;
}

/** Human-readable hint on how to give DockerUpdates access to a private registry. */
export async function authHint(image) {
  const registry = registryOf(image);
  const { helper } = await fromDockerConfig(registry);
  if (helper) {
    return `${registry} requires authentication. Your docker login uses a credential helper (credsStore), `
      + `which DockerUpdates cannot read: add ${registry} in Settings → Registry credentials instead.`;
  }
  return `${registry} requires authentication. Run "docker login ${registry}" on the host and mount `
    + `~/.docker/config.json into the container (read-only), or add ${registry} in Settings → Registry credentials.`;
}

export function isAuthError(err) {
  const msg = String(err?.json?.message ?? err?.message ?? err);
  return /unauthorized|authentication required|denied|no basic auth credentials|may require 'docker login'/i.test(msg);
}

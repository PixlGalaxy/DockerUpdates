// Small JSON persistence helpers for the data volume (DATA_DIR, mounted at /app/backend/data).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

export const dataPath = (...parts) => path.join(DATA_DIR, ...parts);

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(dataPath(file), 'utf8'));
  } catch {
    return typeof fallback === 'function' ? fallback() : structuredClone(fallback);
  }
}

// Writes are serialized per file and atomic (tmp file + rename) so a crash never leaves
// a half-written JSON file behind.
const chains = new Map();

export function writeJson(file, data) {
  const target = dataPath(file);
  const run = async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, target);
  };
  const next = (chains.get(target) ?? Promise.resolve()).then(run, run);
  chains.set(target, next.catch((err) => console.error(`Could not write ${file}:`, err.message)));
  return next;
}

export async function removeFile(file) {
  await fs.rm(dataPath(file), { force: true });
}

export async function listDir(dir) {
  try {
    return await fs.readdir(dataPath(dir));
  } catch {
    return [];
  }
}

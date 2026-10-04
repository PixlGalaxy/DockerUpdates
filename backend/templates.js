// Container templates (DATA_DIR/templates/<name>.json): saved automatically when a container
// is created or edited, so it can be re-created later from "Add container" -> Templates.
import { listDir, readJson, removeFile, writeJson } from './store.js';

const DIR = 'templates';
const bad = (status, message) => Object.assign(new Error(message), { status });
const safeName = (name) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(String(name ?? ''))) throw bad(400, 'Invalid template name');
  return name;
};

const FIELDS = ['name', 'image', 'network', 'restart', 'ports', 'volumes', 'env', 'extraParams', 'iconUrl', 'memory'];

/** Keeps only known spec fields (templates can be imported from files). */
export function cleanSpec(spec) {
  return Object.fromEntries(FIELDS.filter((f) => spec?.[f] !== undefined).map((f) => [f, spec[f]]));
}

export async function saveTemplate(spec) {
  const name = safeName(spec.name);
  await writeJson(`${DIR}/${name}.json`, { ...cleanSpec(spec), savedAt: new Date().toISOString() });
}

export async function listTemplates() {
  const files = (await listDir(DIR)).filter((f) => f.endsWith('.json'));
  const all = await Promise.all(files.map((f) => readJson(`${DIR}/${f}`, null)));
  return all
    .filter(Boolean)
    .map((t) => ({ name: t.name, image: t.image, savedAt: t.savedAt }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTemplate(name) {
  const t = await readJson(`${DIR}/${safeName(name)}.json`, null);
  if (!t) throw bad(404, 'Template not found');
  return t;
}

export async function deleteTemplate(name) {
  await removeFile(`${DIR}/${safeName(name)}.json`);
}

import { mkdir, readdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { newProject, normalizeProject, totalDuration } from '../shared/project';
import type { Project, ProjectSummary } from '../shared/types';

export const ROOT = resolve(import.meta.dir, '..');
export const PROJECTS_DIR = resolve(process.env.EDITTOR_PROJECTS ?? join(homedir(), 'EdittorProjects'));

export const projectDir = (id: string) => join(PROJECTS_DIR, safeId(id));
export const cacheDir = (id: string, assetId: string) => join(projectDir(id), '.cache', safeId(assetId));

function safeId(id: string) {
  if (!/^[\w.-]+$/.test(id)) throw new Error('Invalid id: ' + id);
  return id;
}

const revs = new Map<string, number>();
export const getRev = (id: string) => revs.get(id) ?? 0;

type Listener = (msg: unknown) => void;
const listeners = new Set<Listener>();
export const subscribe = (l: Listener) => (listeners.add(l), () => listeners.delete(l));
export const broadcast = (msg: unknown) => listeners.forEach((l) => l(msg));

export async function listProjects(): Promise<ProjectSummary[]> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const out: ProjectSummary[] = [];
  for (const d of await readdir(PROJECTS_DIR)) {
    const f = join(PROJECTS_DIR, d, 'project.json');
    if (!existsSync(f)) continue;
    try {
      const p = normalizeProject(JSON.parse(await readFile(f, 'utf8')));
      const first = p.scenes[0]?.cells.find((c) => c.assetId)?.assetId ?? p.pool[0]?.id ?? null;
      out.push({ id: d, name: p.name, updatedAt: p.updatedAt, scenes: p.scenes.length, duration: totalDuration(p), cover: first });
    } catch { /* skip broken projects */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function slug(s: string) {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  return s.toLowerCase().replace(/[çğıöşü]/g, (c) => map[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
}

export async function createProject(name: string): Promise<Project> {
  let id = slug(name);
  while (existsSync(projectDir(id))) id = slug(name) + '-' + Math.random().toString(36).slice(2, 5);
  const p = newProject(name, id);
  for (const sub of ['media', 'luts', 'exports', '.cache']) await mkdir(join(projectDir(id), sub), { recursive: true });
  await saveProject(p, 'server');
  return p;
}

export async function loadProject(id: string): Promise<Project> {
  const raw = JSON.parse(await readFile(join(projectDir(id), 'project.json'), 'utf8'));
  const p = normalizeProject(raw);
  p.id = id;
  return p;
}

// Serializes concurrent writes to the same project
const chains = new Map<string, Promise<unknown>>();
export function withProject<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(id, next.catch(() => {}));
  return next;
}

export async function saveProject(p: Project, origin: string): Promise<number> {
  const dir = projectDir(p.id);
  await mkdir(dir, { recursive: true });
  p.updatedAt = Date.now();
  const f = join(dir, 'project.json');
  const tmp = f + '.tmp';
  await writeFile(tmp, JSON.stringify(p, null, 2));
  await rename(tmp, f);
  const rev = getRev(p.id) + 1;
  revs.set(p.id, rev);
  broadcast({ type: 'project', id: p.id, rev, origin });
  return rev;
}

/** Server-side change: load → mutate → save (serialized). */
export function mutateProject(id: string, origin: string, fn: (p: Project) => Project | void | Promise<Project | void>) {
  return withProject(id, async () => {
    const p = await loadProject(id);
    const res = (await fn(p)) ?? p;
    const rev = await saveProject(res, origin);
    return { project: res, rev };
  });
}

export async function fileExists(path: string) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

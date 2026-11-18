import { create } from 'zustand';
import { normalizeProject, sceneStarts, totalDuration } from '../../../shared/project';
import type { Asset, FormatId, Project, Scene, TextLayer } from '../../../shared/types';

export const clientId = 'c' + Math.random().toString(36).slice(2, 8);

export type Selection = { sceneId?: string; cellId?: string; textId?: string };
export type RightTab = 'inspect' | 'color' | 'project' | 'claude';
export type LeftTab = 'media' | 'audio' | 'text' | 'lut';

interface State {
  project: Project | null;
  rev: number;
  save: 'saved' | 'dirty' | 'saving' | 'error';
  past: Project[];
  future: Project[];
  sel: Selection;
  poolSel: string[];
  time: number;
  playing: boolean;
  zoom: number; // px per second
  mediaVer: Record<string, number>;
  pending: number;
  rightTab: RightTab;
  leftTab: LeftTab | null;
  theme: 'dark' | 'light';
  guides: { safe: boolean; grid: boolean };
  picker: null | { sceneId: string; cellId: string };
  browser: boolean;
  exporting: boolean;
  remoteFlash: number;
}

export const useEditor = create<State>(() => ({
  project: null, rev: 0, save: 'saved', past: [], future: [],
  sel: {}, poolSel: [], time: 0, playing: false, zoom: 60,
  mediaVer: {}, pending: 0, rightTab: 'inspect', leftTab: 'media',
  theme: (localStorageGet('edittor.theme') as 'dark' | 'light') ?? 'dark',
  guides: { safe: false, grid: false }, picker: null, browser: false, exporting: false, remoteFlash: 0,
}));

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
export function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* unavailable */ } }

const set = useEditor.setState;
const get = useEditor.getState;

// ---------- editing + undo ----------

let lastKey = '';
let lastAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Changes the project. Consecutive changes with the same `key` (e.g. dragging a slider) merge into one undo step.
 */
export function update(fn: (p: Project) => void | Project, key?: string) {
  const cur = get().project;
  if (!cur) return;
  const draft = structuredClone(cur);
  const res = fn(draft) ?? draft;
  const now = performance.now();
  const merge = key && key === lastKey && now - lastAt < 800;
  lastKey = key ?? '';
  lastAt = now;
  set((s) => ({
    project: res,
    past: merge ? s.past : [...s.past.slice(-150), cur],
    future: [],
    save: 'dirty',
  }));
  scheduleSave();
}

export function undo() {
  const { past, project, future } = get();
  if (!past.length || !project) return;
  set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], save: 'dirty' });
  lastKey = '';
  scheduleSave();
}

export function redo() {
  const { past, project, future } = get();
  if (!future.length || !project) return;
  set({ project: future[0], future: future.slice(1), past: [...past, project], save: 'dirty' });
  lastKey = '';
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 450);
}

export async function saveNow() {
  clearTimeout(saveTimer);
  const p = get().project;
  if (!p) return;
  set({ save: 'saving' });
  try {
    const r = await fetch(`/api/projects/${p.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: p, origin: clientId }),
    });
    if (!r.ok) throw new Error(await r.text());
    const { rev } = await r.json();
    set((s) => ({ rev, save: s.project === p ? 'saved' : 'dirty' }));
  } catch (e) {
    console.error(e);
    set({ save: 'error' });
  }
}

// ---------- loading and live sync ----------

let ws: WebSocket | null = null;

export async function loadProject(id: string) {
  const r = await fetch(`/api/projects/${id}`);
  if (!r.ok) throw new Error('Could not open the project');
  const { project, rev, pending } = await r.json();
  set({ project: normalizeProject(project), rev, pending, past: [], future: [], sel: {}, time: 0, save: 'saved' });
  connect(id);
}

async function reloadRemote(id: string, rev: number) {
  const r = await fetch(`/api/projects/${id}`);
  const data = await r.json();
  const cur = get().project;
  clearTimeout(saveTimer);
  set((s) => ({
    project: normalizeProject(data.project),
    rev: Math.max(rev, data.rev),
    past: cur ? [...s.past.slice(-150), cur] : s.past,
    future: [],
    save: 'saved',
    remoteFlash: Date.now(),
  }));
}

function connect(id: string) {
  ws?.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // In development, Vite's proxy (running under Bun) can't forward WebSockets, so connect to the API server directly.
  const host = import.meta.env.DEV ? `127.0.0.1:${import.meta.env.VITE_API_PORT ?? 5174}` : location.host;
  const sock = new WebSocket(`${proto}://${host}/ws`);
  ws = sock;
  sock.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id !== get().project?.id) return;
    if (msg.type === 'project' && msg.origin !== clientId && msg.rev > get().rev) reloadRemote(id, msg.rev);
    if (msg.type === 'asset-ready') {
      set((s) => ({ mediaVer: { ...s.mediaVer, [msg.assetId]: Date.now() }, pending: msg.pending ?? s.pending }));
    }
  };
  sock.onclose = () => { if (ws === sock) setTimeout(() => get().project?.id === id && connect(id), 1500); };
}

// ---------- helpers ----------

export const mediaUrl = (pid: string, a: Pick<Asset, 'id'>, kind: 'thumb' | 'proxy' | 'strip' | 'orig', ver?: number) =>
  `/media/${pid}/${a.id}/${kind}${ver ? `?v=${ver}` : ''}`;

export const fileUrl = (path: string) => `/api/file?path=${encodeURIComponent(path)}`;

export function useProject() { return useEditor((s) => s.project); }

export function selectedScene(p: Project | null, sel: Selection): Scene | undefined {
  return p?.scenes.find((s) => s.id === sel.sceneId);
}
export function selectedText(p: Project | null, sel: Selection): TextLayer | undefined {
  return p?.texts.find((t) => t.id === sel.textId);
}

export function setTime(t: number) {
  const p = get().project;
  const max = p ? Math.max(0, totalDuration(p) - 1 / (p.fps || 30)) : 0;
  set({ time: Math.max(0, Math.min(max, t)) });
}

export function seekScene(id: string) {
  const p = get().project;
  if (!p) return;
  const i = p.scenes.findIndex((s) => s.id === id);
  if (i >= 0) setTime(sceneStarts(p)[i]);
}

export function setFormat(f: FormatId) {
  update((p) => { p.activeFormat = f; }, 'format');
}

export const select = (sel: Selection) => set({ sel });

import { defaultLayout, defaultWeights, LAYOUT_PRESETS } from './layouts';
import {
  DEFAULT_GRADE, FORMATS,
  type Cell, type FormatId, type Framing, type Project, type Scene, type SceneLayout, type TextBox, type TextLayer,
} from './types';

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

export const aspectOf = (f: FormatId) => FORMATS[f].w / FORMATS[f].h;

export function newProject(name: string, id = uid('p_')): Project {
  return {
    version: 1, id, name,
    formats: ['9:16'], activeFormat: '9:16', fps: 30,
    background: '#000000', fadeIn: 0, fadeOut: 2,
    pool: [], luts: [], music: null,
    tempo: { bpm: 0, offset: 0, snap: true },
    scenes: [], texts: [], updatedAt: Date.now(),
  };
}

export function newCell(assetId: string | null = null): Cell {
  return {
    id: uid('c_'), assetId, fit: 'cover', in: 0, speed: 1, volume: 0,
    enterDelay: 0, enter: 'cut', motion: 'none', motionAmount: 0.3, framing: {},
  };
}

export function newScene(project: Project, count = 1, assetIds: (string | null)[] = [], duration?: number): Scene {
  const layouts: Scene['layouts'] = {};
  for (const f of project.formats) layouts[f] = defaultLayout(count, aspectOf(f));
  return {
    id: uid('s_'),
    duration: duration ?? defaultDuration(project),
    cellCount: count,
    cells: Array.from({ length: count }, (_, i) => newCell(assetIds[i] ?? null)),
    layouts,
    transition: { kind: 'cut', duration: 0.4 },
  };
}

export function defaultDuration(p: Project) {
  const beat = beatLength(p);
  return beat ? Math.max(1, Math.round(3 / beat)) * beat : 3;
}

export function beatLength(p: Project) {
  return p.tempo.bpm > 0 ? 60 / p.tempo.bpm : 0;
}

export function defaultTextBox(f: FormatId): TextBox {
  return { x: 0.5, y: aspectOf(f) < 1 ? 0.78 : 0.82, width: 0.84, size: 72, align: 'center' };
}

export function newText(p: Project, start: number, text = 'Başlık'): TextLayer {
  const layouts: TextLayer['layouts'] = {};
  for (const f of p.formats) layouts[f] = defaultTextBox(f);
  return {
    id: uid('t_'), text, start, duration: 3, track: 0,
    font: 'Inter Tight', weight: 700, italic: false, uppercase: false,
    color: '#ffffff', opacity: 1, letterSpacing: -0.02, lineHeight: 1.05, shadow: 0.25, background: null,
    animIn: 'rise', animOut: 'fade', animDuration: 0.6, stagger: 0.03, layouts,
  };
}

export const DEFAULT_FRAMING: Framing = { x: 0, y: 0, zoom: 1 };

// ---------- timeline ----------

export function sceneStarts(p: Project): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of p.scenes) { out.push(t); t += s.duration; }
  return out;
}

export function totalDuration(p: Project) {
  return p.scenes.reduce((a, s) => a + s.duration, 0);
}

export function sceneAt(p: Project, t: number): { index: number; start: number } | null {
  let acc = 0;
  for (let i = 0; i < p.scenes.length; i++) {
    const d = p.scenes[i].duration;
    if (t < acc + d || i === p.scenes.length - 1) return { index: i, start: acc };
    acc += d;
  }
  return null;
}

export function snapToBeat(p: Project, t: number) {
  const b = beatLength(p);
  if (!b || !p.tempo.snap) return t;
  return p.tempo.offset + Math.round((t - p.tempo.offset) / b) * b;
}

// ---------- normalization ----------

/** Fills missing fields and makes sure every format has a layout. */
export function normalizeProject(raw: any): Project {
  const p: Project = { ...newProject(raw?.name ?? 'Untitled', raw?.id), ...raw };
  p.tempo = { bpm: 0, offset: 0, snap: true, ...(raw?.tempo ?? {}) };
  if (!p.formats?.length) p.formats = ['9:16'];
  if (!p.formats.includes(p.activeFormat)) p.activeFormat = p.formats[0];
  p.pool = (p.pool ?? []).map((a) => ({ ...a, grade: { ...DEFAULT_GRADE, ...(a.grade ?? {}) } }));
  p.luts = p.luts ?? [];
  p.texts = (p.texts ?? []).map((t) => {
    const base = newText(p, t.start ?? 0);
    const layouts = { ...(t.layouts ?? {}) };
    for (const f of p.formats) if (!layouts[f]) layouts[f] = fallbackTextBox(layouts, f);
    return { ...base, ...t, id: t.id ?? base.id, layouts };
  });
  p.scenes = (p.scenes ?? []).map((s) => normalizeScene(p, s));
  return p;
}

function fallbackTextBox(layouts: TextLayer['layouts'], f: FormatId): TextBox {
  const any = Object.values(layouts)[0];
  return any ? { ...any } : defaultTextBox(f);
}

export function normalizeScene(p: Project, s: Partial<Scene>): Scene {
  const count = Math.min(4, Math.max(1, s.cellCount ?? s.cells?.length ?? 1));
  const cells = (s.cells ?? []).slice(0, count).map((c) => ({ ...newCell(), ...c, framing: c.framing ?? {} }));
  while (cells.length < count) cells.push(newCell());
  const layouts: Scene['layouts'] = { ...(s.layouts ?? {}) };
  for (const f of p.formats) {
    const l = layouts[f];
    if (!l || !LAYOUT_PRESETS.some((x) => x.id === l.preset && x.count === count)) {
      layouts[f] = defaultLayout(count, aspectOf(f));
    } else {
      layouts[f] = { gap: 0, padding: 0, radius: 0, ...(l as Partial<SceneLayout>), preset: l.preset, weights: l.weights?.length >= count ? l.weights : defaultWeights(l.preset, count) };
    }
  }
  return {
    id: s.id ?? uid('s_'),
    name: s.name,
    duration: Math.max(0.1, s.duration ?? 3),
    cellCount: count,
    cells,
    layouts,
    transition: { kind: 'cut', duration: 0.4, ...(s.transition ?? {}) },
    background: s.background,
  };
}

/** Changes a scene's panel count (existing cells are kept). */
export function setCellCount(p: Project, s: Scene, count: number): Scene {
  const cells = s.cells.slice(0, count);
  while (cells.length < count) cells.push(newCell(s.cells[0]?.assetId ?? null));
  const layouts: Scene['layouts'] = {};
  for (const f of p.formats) layouts[f] = defaultLayout(count, aspectOf(f));
  return { ...s, cellCount: count, cells, layouts };
}

/** When a format is added, copies layouts from the closest existing format. */
export function addFormat(p: Project, f: FormatId): Project {
  if (p.formats.includes(f)) return p;
  const near = [...p.formats].sort((a, b) => Math.abs(Math.log(aspectOf(a) / aspectOf(f))) - Math.abs(Math.log(aspectOf(b) / aspectOf(f))))[0];
  const sameOrientation = near && (aspectOf(near) < 1) === (aspectOf(f) < 1);
  const scenes = p.scenes.map((s) => {
    const src = near ? s.layouts[near] : undefined;
    const layout: SceneLayout = src && sameOrientation ? structuredClone(src) : defaultLayout(s.cellCount, aspectOf(f));
    const cells = s.cells.map((c) => ({ ...c, framing: { ...c.framing, [f]: near && c.framing[near] ? { ...c.framing[near]! } : undefined } }));
    return { ...s, cells, layouts: { ...s.layouts, [f]: layout } };
  });
  const texts = p.texts.map((t) => ({ ...t, layouts: { ...t.layouts, [f]: near && t.layouts[near] ? { ...t.layouts[near]! } : defaultTextBox(f) } }));
  return { ...p, formats: [...p.formats, f], scenes, texts };
}

export function removeFormat(p: Project, f: FormatId): Project {
  if (p.formats.length <= 1) return p;
  const formats = p.formats.filter((x) => x !== f);
  return { ...p, formats, activeFormat: p.activeFormat === f ? formats[0] : p.activeFormat };
}

export function getFraming(c: Cell, f: FormatId): Framing {
  return c.framing[f] ?? DEFAULT_FRAMING;
}

/** Compact human / LLM-readable summary (for MCP and chat context). */
export function describeProject(p: Project) {
  const starts = sceneStarts(p);
  return {
    id: p.id, name: p.name, formats: p.formats, activeFormat: p.activeFormat, fps: p.fps,
    duration: +totalDuration(p).toFixed(3),
    tempo: p.tempo, beat: beatLength(p) ? +beatLength(p).toFixed(4) : null,
    music: p.music ? { name: p.music.name, offset: p.music.offset, duration: p.music.duration, fadeOut: p.music.fadeOut } : null,
    pool: p.pool.map((a) => ({ id: a.id, kind: a.kind, name: a.name, w: a.width, h: a.height, duration: +a.duration.toFixed(2), orientation: a.width >= a.height ? 'landscape' : 'portrait' })),
    luts: p.luts.map((l) => ({ id: l.id, name: l.name })),
    scenes: p.scenes.map((s, i) => ({
      id: s.id, index: i, start: +starts[i].toFixed(3), duration: +s.duration.toFixed(3), cellCount: s.cellCount,
      transition: s.transition,
      layouts: Object.fromEntries(Object.entries(s.layouts).map(([f, l]) => [f, { preset: l!.preset, weights: l!.weights, gap: l!.gap, padding: l!.padding, radius: l!.radius }])),
      cells: s.cells.map((c) => ({ id: c.id, assetId: c.assetId, fit: c.fit, in: c.in, speed: c.speed, volume: c.volume, enterDelay: c.enterDelay, enter: c.enter, motion: c.motion, framing: c.framing })),
    })),
    texts: p.texts.map((t) => ({ id: t.id, text: t.text, start: t.start, duration: t.duration, track: t.track, font: t.font, weight: t.weight, animIn: t.animIn, animOut: t.animOut, layouts: t.layouts })),
  };
}

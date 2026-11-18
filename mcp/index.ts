#!/usr/bin/env bun
// Edittor MCP server (stdio). Talks to the running Edittor server over HTTP, so every
// change shows up instantly in any open editor.
//   claude mcp add edittor -- bun /path/to/edittor/mcp/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LAYOUT_PRESETS, defaultWeights } from '../shared/layouts';
import {
  addFormat, beatLength, describeProject, newCell, newScene, newText, normalizeProject, normalizeScene, removeFormat, setCellCount, uid,
} from '../shared/project';
import { FORMATS, type FormatId, type Project, type Scene } from '../shared/types';

const BASE = process.env.EDITTOR_URL ?? 'http://127.0.0.1:5174';
const DEFAULT_PROJECT = process.env.EDITTOR_PROJECT;

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function resolveId(id?: string) {
  if (id) return id;
  if (DEFAULT_PROJECT) return DEFAULT_PROJECT;
  const list = await api<any[]>('/api/projects');
  if (!list.length) throw new Error('No projects yet. Create one with create_project.');
  return list[0].id as string;
}

const load = async (id: string) => normalizeProject((await api(`/api/projects/${id}`)).project);
const save = (p: Project) => api(`/api/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ project: p, origin: 'mcp' }) });

async function edit(id: string | undefined, fn: (p: Project) => Project | void | string) {
  const p = await load(await resolveId(id));
  const r = fn(p);
  const next = typeof r === 'object' && r ? r : p;
  await save(normalizeProject(next));
  return typeof r === 'string' ? r : 'ok';
}

const text = (t: unknown) => ({ content: [{ type: 'text' as const, text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });

const formatEnum = z.enum(Object.keys(FORMATS) as [FormatId, ...FormatId[]]);
const presetEnum = z.enum(LAYOUT_PRESETS.map((p) => p.id) as [string, ...string[]]);
const transitionEnum = z.enum(['cut', 'fade', 'black', 'white', 'slide-left', 'slide-up', 'zoom', 'blur']);
const enterEnum = z.enum(['cut', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'wipe', 'zoom']);
const motionEnum = z.enum(['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']);
const pid = z.string().optional().describe('Project id; defaults to the active / most recent project');

const cellSchema = z.object({
  asset_id: z.string().nullable().optional(),
  fit: z.enum(['cover', 'contain']).optional(),
  in: z.number().optional().describe('Source in-point of the video in seconds (slip)'),
  enter_delay: z.number().optional().describe('Delay before the panel appears within the scene (s)'),
  enter_beat: z.number().optional().describe('Same delay expressed in beats (requires tempo)'),
  enter: enterEnum.optional(),
  motion: motionEnum.optional().describe('Ken Burns motion for photos'),
  motion_amount: z.number().min(0).max(1).optional(),
  speed: z.number().optional(),
  volume: z.number().min(0).max(1).optional(),
  framing: z.object({ format: formatEnum, x: z.number().min(-1).max(1), y: z.number().min(-1).max(1), zoom: z.number().min(1).max(4) }).optional(),
});

function applyCell(p: Project, s: Scene, i: number, c: z.infer<typeof cellSchema>) {
  const cell = s.cells[i];
  if (!cell) throw new Error(`Scene has no cell ${i} (cell count ${s.cellCount})`);
  if (c.asset_id !== undefined) {
    if (c.asset_id && !p.pool.some((a) => a.id === c.asset_id)) throw new Error('Not in pool: ' + c.asset_id);
    cell.assetId = c.asset_id;
  }
  if (c.fit) cell.fit = c.fit;
  if (c.in != null) cell.in = Math.max(0, c.in);
  if (c.enter_delay != null) cell.enterDelay = Math.max(0, c.enter_delay);
  if (c.enter_beat != null) cell.enterDelay = c.enter_beat * beatLength(p);
  if (c.enter) cell.enter = c.enter;
  if (c.motion) cell.motion = c.motion;
  if (c.motion_amount != null) cell.motionAmount = c.motion_amount;
  if (c.speed != null) cell.speed = c.speed;
  if (c.volume != null) cell.volume = c.volume;
  if (c.framing) cell.framing[c.framing.format] = { x: c.framing.x, y: c.framing.y, zoom: c.framing.zoom };
}

function durationOf(p: Project, d?: number, beats?: number) {
  if (beats != null) {
    const b = beatLength(p);
    if (!b) throw new Error('Set a tempo (bpm) before using beats');
    return beats * b;
  }
  return d;
}

function findScene(p: Project, id: string) {
  const s = p.scenes.find((x) => x.id === id) ?? p.scenes[Number(id)];
  if (!s) throw new Error('Scene not found: ' + id);
  return s;
}

const server = new McpServer({ name: 'edittor', version: '1.0.0' });

server.registerTool('list_projects', { description: 'Lists Edittor projects' }, async () => text(await api('/api/projects')));

server.registerTool('create_project', {
  description: 'Creates a new project',
  inputSchema: { name: z.string() },
}, async ({ name }) => text(await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) })));

server.registerTool('get_project', {
  description: 'Project summary: pool (id, kind, size, duration), music, tempo, scenes (id, start, duration, cells, per-format layout) and text layers. Call before editing.',
  inputSchema: { project_id: pid },
}, async ({ project_id }) => text(describeProject(await load(await resolveId(project_id)))));

server.registerTool('get_layout_presets', { description: 'Collage layout presets (by panel count)' }, async () => text(LAYOUT_PRESETS));

server.registerTool('look_at_assets', {
  description: 'Look at thumbnails of pool items (max 16). With strip=true, videos return a 12-frame filmstrip.',
  inputSchema: { project_id: pid, asset_ids: z.array(z.string()).max(16), strip: z.boolean().optional() },
}, async ({ project_id, asset_ids, strip }) => {
  const id = await resolveId(project_id);
  const p = await load(id);
  const content: any[] = [];
  for (const aid of asset_ids) {
    const a = p.pool.find((x) => x.id === aid);
    if (!a) { content.push({ type: 'text', text: `${aid}: not found` }); continue; }
    const kind = strip && a.kind === 'video' ? 'strip' : 'thumb';
    const r = await fetch(`${BASE}/media/${id}/${aid}/${kind}`);
    content.push({ type: 'text', text: `${aid} · ${a.name} · ${a.kind} ${a.width}×${a.height}${a.duration ? ' · ' + a.duration.toFixed(1) + 's' : ''}` });
    if (r.ok) content.push({ type: 'image', data: Buffer.from(await r.arrayBuffer()).toString('base64'), mimeType: 'image/jpeg' });
    else content.push({ type: 'text', text: '(thumbnail is being generated)' });
  }
  return { content };
});

server.registerTool('import_media', {
  description: 'Adds file or folder paths to the pool (video, photo, audio). Proxies and thumbnails are generated in the background.',
  inputSchema: { project_id: pid, paths: z.array(z.string()) },
}, async ({ project_id, paths }) => {
  const id = await resolveId(project_id);
  return text(await api(`/api/projects/${id}/import`, { method: 'POST', body: JSON.stringify({ paths, origin: 'mcp' }) }));
});

server.registerTool('set_project', {
  description: 'Project settings: name, fps, background, fade in/out, formats (aspect ratios; each keeps its own layout)',
  inputSchema: {
    project_id: pid, name: z.string().optional(), fps: z.number().optional(), background: z.string().optional(),
    fade_in: z.number().optional(), fade_out: z.number().optional(),
    formats: z.array(formatEnum).optional(), active_format: formatEnum.optional(),
  },
}, async (a) => text(await edit(a.project_id, (p) => {
  if (a.name) p.name = a.name;
  if (a.fps) p.fps = a.fps;
  if (a.background) p.background = a.background;
  if (a.fade_in != null) p.fadeIn = a.fade_in;
  if (a.fade_out != null) p.fadeOut = a.fade_out;
  let q = p;
  if (a.formats) {
    for (const f of a.formats) q = addFormat(q, f);
    for (const f of [...q.formats]) if (!a.formats.includes(f)) q = removeFormat(q, f);
  }
  if (a.active_format && q.formats.includes(a.active_format)) q.activeFormat = a.active_format;
  return q;
})));

server.registerTool('set_music', {
  description: 'Sets the music (an audio pool item id or a file path). With detect_tempo=true, BPM and beat phase are detected automatically.',
  inputSchema: {
    project_id: pid, asset_id: z.string().optional(), path: z.string().optional(),
    offset: z.number().optional().describe('Start position within the music file (s)'),
    volume: z.number().optional(), fade_in: z.number().optional(), fade_out: z.number().optional(),
    detect_tempo: z.boolean().optional(), remove: z.boolean().optional(),
  },
}, async (a) => {
  const id = await resolveId(a.project_id);
  const p = await load(id);
  if (a.remove) { p.music = null; await save(p); return text('music removed'); }
  let path = a.path ?? p.music?.path;
  if (a.asset_id) path = p.pool.find((x) => x.id === a.asset_id)?.path;
  if (!path) throw new Error('No music path');
  if (!p.music || p.music.path !== path) {
    const info = await api(`/api/projects/${id}/probe`, { method: 'POST', body: JSON.stringify({ path }) });
    p.music = { path, name: info.name, offset: 0, volume: 1, fadeIn: 0, fadeOut: 3, duration: info.duration };
  }
  if (a.offset != null) p.music.offset = a.offset;
  if (a.volume != null) p.music.volume = a.volume;
  if (a.fade_in != null) p.music.fadeIn = a.fade_in;
  if (a.fade_out != null) p.music.fadeOut = a.fade_out;
  let tempo = '';
  if (a.detect_tempo) {
    const t = await api(`/api/projects/${id}/tempo?path=${encodeURIComponent(path)}&from=${p.music.offset}`);
    const beat = 60 / t.bpm;
    p.tempo.bpm = t.bpm;
    p.tempo.offset = (((t.firstBeat - p.music.offset) % beat) + beat) % beat;
    tempo = ` · tempo ${t.bpm} BPM, beat ${beat.toFixed(3)} s, first beat ${p.tempo.offset.toFixed(3)} s`;
  }
  await save(p);
  return text(`music: ${p.music.name}, starts at ${p.music.offset}s${tempo}`);
});

server.registerTool('set_tempo', {
  description: 'Beat grid: bpm, timeline time of the first beat, snapping',
  inputSchema: { project_id: pid, bpm: z.number(), offset: z.number().optional(), snap: z.boolean().optional() },
}, async (a) => text(await edit(a.project_id, (p) => {
  p.tempo.bpm = a.bpm;
  if (a.offset != null) p.tempo.offset = a.offset;
  if (a.snap != null) p.tempo.snap = a.snap;
})));

const sceneInput = z.object({
  cells: z.array(cellSchema).min(1).max(4).describe('1 cell = single scene, 2-4 = collage'),
  duration: z.number().optional(),
  beats: z.number().optional().describe('Duration in beats'),
  name: z.string().optional(),
  transition: z.object({ kind: transitionEnum, duration: z.number().optional() }).optional(),
  layouts: z.array(z.object({ format: formatEnum, preset: presetEnum, weights: z.array(z.number()).optional(), gap: z.number().optional(), padding: z.number().optional() })).optional(),
});

server.registerTool('add_scenes', {
  description: 'Adds one or more scenes. The number of cells sets the panel count. Without layouts, a sensible default is chosen for each format.',
  inputSchema: { project_id: pid, scenes: z.array(sceneInput).min(1), index: z.number().optional().describe('Insert position; appends when omitted') },
}, async ({ project_id, scenes, index }) => text(await edit(project_id, (p) => {
  const made = scenes.map((sc) => {
    const s = newScene(p, sc.cells.length, [], durationOf(p, sc.duration, sc.beats));
    if (sc.name) s.name = sc.name;
    sc.cells.forEach((c, i) => applyCell(p, s, i, c));
    if (sc.transition) s.transition = { kind: sc.transition.kind, duration: sc.transition.duration ?? 0.4 };
    for (const l of sc.layouts ?? []) {
      const preset = LAYOUT_PRESETS.find((x) => x.id === l.preset);
      if (!preset || preset.count !== s.cellCount) throw new Error(`${l.preset} does not fit a ${s.cellCount}-panel scene`);
      s.layouts[l.format] = { preset: l.preset, weights: l.weights ?? defaultWeights(l.preset, s.cellCount), gap: l.gap ?? 0, padding: l.padding ?? 0, radius: 0 };
    }
    return s;
  });
  p.scenes.splice(index ?? p.scenes.length, 0, ...made);
  return `added ${made.length} scenes: ${made.map((s) => s.id).join(', ')}`;
})));

server.registerTool('update_scene', {
  description: 'Changes a scene\'s duration, name, transition, panel count or cells',
  inputSchema: {
    project_id: pid, scene_id: z.string().describe('Scene id or index'),
    duration: z.number().optional(), beats: z.number().optional(), name: z.string().optional(),
    transition: z.object({ kind: transitionEnum, duration: z.number().optional() }).optional(),
    cell_count: z.number().min(1).max(4).optional(),
    cells: z.array(z.object({ index: z.number() }).extend(cellSchema.shape)).optional(),
  },
}, async (a) => text(await edit(a.project_id, (p) => {
  let s = findScene(p, a.scene_id);
  const idx = p.scenes.indexOf(s);
  if (a.cell_count && a.cell_count !== s.cellCount) { s = setCellCount(p, s, a.cell_count); p.scenes[idx] = s; }
  const d = durationOf(p, a.duration, a.beats);
  if (d) s.duration = d;
  if (a.name != null) s.name = a.name;
  if (a.transition) s.transition = { kind: a.transition.kind, duration: a.transition.duration ?? s.transition.duration };
  for (const c of a.cells ?? []) applyCell(p, s, c.index, c);
})));

server.registerTool('set_layout', {
  description: 'Sets a scene\'s collage layout for one format (other formats are unaffected). weights = relative panel sizes.',
  inputSchema: {
    project_id: pid, scene_id: z.string(), format: formatEnum, preset: presetEnum.optional(),
    weights: z.array(z.number()).optional(), gap: z.number().optional(), padding: z.number().optional(), radius: z.number().optional(),
  },
}, async (a) => text(await edit(a.project_id, (p) => {
  const s = findScene(p, a.scene_id);
  const l = s.layouts[a.format];
  if (!l) throw new Error('Format not in project: ' + a.format);
  if (a.preset) {
    const pr = LAYOUT_PRESETS.find((x) => x.id === a.preset)!;
    if (pr.count !== s.cellCount) throw new Error(`${a.preset} has ${pr.count} panels; the scene has ${s.cellCount}`);
    l.preset = a.preset;
    l.weights = defaultWeights(a.preset, s.cellCount);
  }
  if (a.weights) l.weights = a.weights;
  if (a.gap != null) l.gap = a.gap;
  if (a.padding != null) l.padding = a.padding;
  if (a.radius != null) l.radius = a.radius;
})));

server.registerTool('remove_scenes', {
  description: 'Deletes scenes (all=true deletes every scene)',
  inputSchema: { project_id: pid, scene_ids: z.array(z.string()).optional(), all: z.boolean().optional() },
}, async (a) => text(await edit(a.project_id, (p) => {
  if (a.all) p.scenes = [];
  else { const del = new Set(a.scene_ids ?? []); p.scenes = p.scenes.filter((s) => !del.has(s.id)); }
})));

server.registerTool('move_scene', {
  description: 'Moves a scene to a new index',
  inputSchema: { project_id: pid, scene_id: z.string(), to_index: z.number() },
}, async (a) => text(await edit(a.project_id, (p) => {
  const s = findScene(p, a.scene_id);
  p.scenes.splice(p.scenes.indexOf(s), 1);
  p.scenes.splice(Math.max(0, Math.min(p.scenes.length, a.to_index)), 0, s);
})));

const textInput = {
  text: z.string().optional(), start: z.number().optional(), duration: z.number().optional(),
  font: z.string().optional().describe('e.g. Inter Tight, Instrument Serif, Playfair Display, Cormorant Garamond, Archivo, Space Grotesk, IBM Plex Mono'),
  weight: z.number().optional(), italic: z.boolean().optional(), uppercase: z.boolean().optional(),
  color: z.string().optional(), letter_spacing: z.number().optional(), line_height: z.number().optional(), shadow: z.number().optional(),
  anim_in: z.enum(['none', 'fade', 'rise', 'drop', 'mask-up', 'letters', 'words', 'typewriter', 'blur', 'scale', 'tracking']).optional(),
  anim_out: z.enum(['none', 'fade', 'rise', 'drop', 'mask-down', 'blur', 'scale']).optional(),
  anim_duration: z.number().optional(), track: z.number().optional(),
  box: z.object({ format: formatEnum, x: z.number(), y: z.number(), width: z.number().optional(), size: z.number().optional(), align: z.enum(['left', 'center', 'right']).optional() }).optional()
    .describe('Position for one format: x,y = center in 0..1; size in px (short side = 1080 reference)'),
};

function applyText(t: any, a: any) {
  const map: Record<string, string> = { letter_spacing: 'letterSpacing', line_height: 'lineHeight', anim_in: 'animIn', anim_out: 'animOut', anim_duration: 'animDuration' };
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || k === 'box' || k === 'project_id' || k === 'text_id') continue;
    t[map[k] ?? k] = v;
  }
  if (a.box) t.layouts[a.box.format] = { ...t.layouts[a.box.format], ...Object.fromEntries(Object.entries(a.box).filter(([k, v]) => k !== 'format' && v !== undefined)) };
}

server.registerTool('add_text', {
  description: 'Adds a text layer',
  inputSchema: { project_id: pid, ...textInput, text: z.string(), start: z.number() },
}, async (a) => text(await edit(a.project_id, (p) => {
  const t = newText(p, a.start, a.text);
  applyText(t, a);
  if (a.track == null) {
    let tr = 0;
    while (p.texts.some((o) => o.track === tr && o.start < t.start + t.duration && o.start + o.duration > t.start)) tr++;
    t.track = tr;
  }
  p.texts.push(t);
  return 'text added: ' + t.id;
})));

server.registerTool('update_text', {
  description: 'Updates a text layer',
  inputSchema: { project_id: pid, text_id: z.string(), ...textInput },
}, async (a) => text(await edit(a.project_id, (p) => {
  const t = p.texts.find((x) => x.id === a.text_id);
  if (!t) throw new Error('Text not found');
  applyText(t, a);
})));

server.registerTool('remove_texts', {
  description: 'Deletes text layers',
  inputSchema: { project_id: pid, text_ids: z.array(z.string()) },
}, async (a) => text(await edit(a.project_id, (p) => { p.texts = p.texts.filter((t) => !a.text_ids.includes(t.id)); })));

server.registerTool('set_grade', {
  description: 'Color grade for pool items (applies to every use). Ranges: exposure -2..2, others -1..1, vignette/grain 0..1, lut = id from the luts list.',
  inputSchema: {
    project_id: pid, asset_ids: z.array(z.string()).describe('"*" for all'),
    exposure: z.number().optional(), contrast: z.number().optional(), saturation: z.number().optional(),
    temperature: z.number().optional(), tint: z.number().optional(), highlights: z.number().optional(), shadows: z.number().optional(),
    vignette: z.number().optional(), grain: z.number().optional(), lut: z.string().nullable().optional(), lut_mix: z.number().optional(),
  },
}, async (a) => text(await edit(a.project_id, (p) => {
  const all = a.asset_ids.includes('*');
  for (const as of p.pool) {
    if (!all && !a.asset_ids.includes(as.id)) continue;
    const g = as.grade;
    for (const k of ['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows', 'vignette', 'grain'] as const) if (a[k] != null) g[k] = a[k]!;
    if (a.lut !== undefined) g.lut = a.lut;
    if (a.lut_mix != null) g.lutMix = a.lut_mix;
  }
})));

server.registerTool('replace_edit', {
  description: 'Rebuilds all scenes in one call (fast first cut). Existing scenes are replaced.',
  inputSchema: { project_id: pid, scenes: z.array(sceneInput).min(1) },
}, async ({ project_id, scenes }) => text(await edit(project_id, (p) => {
  p.scenes = [];
  for (const sc of scenes) {
    const s = newScene(p, sc.cells.length, [], durationOf(p, sc.duration, sc.beats));
    if (sc.name) s.name = sc.name;
    sc.cells.forEach((c, i) => applyCell(p, s, i, c));
    if (sc.transition) s.transition = { kind: sc.transition.kind, duration: sc.transition.duration ?? 0.4 };
    for (const l of sc.layouts ?? []) {
      s.layouts[l.format] = normalizeScene(p, { ...s, layouts: { [l.format]: { preset: l.preset, weights: l.weights ?? defaultWeights(l.preset, s.cellCount), gap: l.gap ?? 0, padding: l.padding ?? 0, radius: 0 } } }).layouts[l.format];
    }
    p.scenes.push(s);
  }
  const total = p.scenes.reduce((x, s) => x + s.duration, 0);
  return `${p.scenes.length} scenes, total ${total.toFixed(2)} s`;
})));

void newCell; void uid;
await server.connect(new StdioServerTransport());

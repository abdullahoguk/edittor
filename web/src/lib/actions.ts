import { newScene, newText, sceneStarts, snapToBeat, totalDuration, uid, beatLength } from '../../../shared/project';
import type { Project } from '../../../shared/types';
import { saveNow, select, setTime, update, useEditor } from '../store/editor';
import type { TextPreset } from './fonts';
import { tx } from './i18n';

const st = () => useEditor.getState();

export function insertIndex(p: Project) {
  const i = p.scenes.findIndex((s) => s.id === st().sel.sceneId);
  return i >= 0 ? i + 1 : p.scenes.length;
}

export function addScene(count: number, assetIds: (string | null)[] = [], index?: number) {
  let id = '';
  update((p) => {
    const s = newScene(p, count, assetIds);
    // for single video scenes, cap the duration at the source length
    const a = assetIds[0] ? p.pool.find((x) => x.id === assetIds[0]) : undefined;
    if (count === 1 && a?.kind === 'video' && a.duration < s.duration) s.duration = a.duration;
    p.scenes.splice(index ?? insertIndex(p), 0, s);
    id = s.id;
  });
  select({ sceneId: id });
  return id;
}

export function addScenesFromAssets(ids: string[], index?: number) {
  let first = '';
  update((p) => {
    let at = index ?? insertIndex(p);
    for (const aid of ids) {
      const s = newScene(p, 1, [aid]);
      const a = p.pool.find((x) => x.id === aid);
      if (a?.kind === 'video' && a.duration < s.duration) s.duration = a.duration;
      if (a?.kind === 'image') s.cells[0].motion = 'zoom-in';
      p.scenes.splice(at++, 0, s);
      first ||= s.id;
    }
  });
  if (first) select({ sceneId: first });
}

export function duplicateScene(id: string) {
  let nid = '';
  update((p) => {
    const i = p.scenes.findIndex((s) => s.id === id);
    if (i < 0) return;
    const c = structuredClone(p.scenes[i]);
    c.id = uid('s_');
    c.cells.forEach((x) => (x.id = uid('c_')));
    p.scenes.splice(i + 1, 0, c);
    nid = c.id;
  });
  if (nid) select({ sceneId: nid });
}

export function deleteSelection() {
  const { sel } = st();
  if (sel.textId) {
    update((p) => { p.texts = p.texts.filter((t) => t.id !== sel.textId); });
    select({});
  } else if (sel.sceneId) {
    let next: string | undefined;
    update((p) => {
      const i = p.scenes.findIndex((s) => s.id === sel.sceneId);
      p.scenes.splice(i, 1);
      next = p.scenes[Math.min(i, p.scenes.length - 1)]?.id;
    });
    select(next ? { sceneId: next } : {});
  }
}

/** Splits the scene at the playhead. */
export function splitAtPlayhead() {
  const { project: p, time } = st();
  if (!p) return;
  const starts = sceneStarts(p);
  const i = p.scenes.findIndex((s, k) => time > starts[k] + 0.05 && time < starts[k] + s.duration - 0.05);
  if (i < 0) return;
  let nid = '';
  update((q) => {
    const s = q.scenes[i];
    const cut = time - starts[i];
    const b = structuredClone(s);
    b.id = uid('s_');
    b.duration = s.duration - cut;
    b.transition = { kind: 'cut', duration: 0.4 };
    b.cells.forEach((c) => {
      c.id = uid('c_');
      const a = q.pool.find((x) => x.id === c.assetId);
      if (a?.kind === 'video') c.in += Math.max(0, cut - c.enterDelay) * c.speed;
      c.enterDelay = Math.max(0, c.enterDelay - cut);
    });
    s.duration = cut;
    q.scenes.splice(i + 1, 0, b);
    nid = b.id;
  });
  select({ sceneId: nid });
}

export function addTextAt(preset?: TextPreset, start?: number) {
  let id = '';
  update((p) => {
    const t = newText(p, snapToBeat(p, start ?? st().time), tx(preset?.sample ?? 'Başlık'));
    if (preset) {
      Object.assign(t, preset.style);
      for (const f of p.formats) t.layouts[f] = { ...t.layouts[f]!, size: preset.size, align: preset.align, x: preset.align === 'left' ? 0.5 : 0.5 };
    }
    const end = Math.max(totalDuration(p), t.start + t.duration);
    // find a free track
    let track = 0;
    while (p.texts.some((o) => o.track === track && o.start < t.start + t.duration && o.start + o.duration > t.start)) track++;
    t.track = track;
    void end;
    p.texts.push(t);
    id = t.id;
  });
  select({ textId: id });
  useEditor.setState({ rightTab: 'inspect' });
}

export function assignCell(sceneId: string, cellId: string, assetId: string) {
  update((p) => {
    const c = p.scenes.find((s) => s.id === sceneId)?.cells.find((x) => x.id === cellId);
    if (!c) return;
    c.assetId = assetId;
    c.in = 0;
    c.framing = {};
    const a = p.pool.find((x) => x.id === assetId);
    if (a?.kind === 'image' && c.motion === 'none') c.motion = 'none';
  });
}

export async function importPaths(paths: string[]) {
  const p = st().project;
  if (!p) return;
  await saveNow();
  await fetch(`/api/projects/${p.id}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths, origin: 'server' }) });
}

export async function uploadFiles(files: FileList | File[], kind: 'media' | 'lut' = 'media') {
  const p = st().project;
  if (!p) return;
  await saveNow();
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append('files', f);
  await fetch(`/api/projects/${p.id}/${kind === 'lut' ? 'luts' : 'upload'}`, { method: 'POST', body: fd });
}

export async function detectTempo() {
  const p = st().project;
  if (!p?.music) return;
  const r = await fetch(`/api/projects/${p.id}/tempo?path=${encodeURIComponent(p.music.path)}&from=${p.music.offset}`);
  const t = await r.json();
  const beat = 60 / t.bpm;
  update((q) => {
    q.tempo.bpm = t.bpm;
    q.tempo.offset = (((t.firstBeat - q.music!.offset) % beat) + beat) % beat;
  });
}

/** Lengthens / shortens the selected scene by one beat (or 0.1 s without a tempo). */
export function nudgeDuration(dir: 1 | -1) {
  const { sel, project } = st();
  if (!project || !sel.sceneId) return;
  const step = beatLength(project) || 0.1;
  update((p) => {
    const s = p.scenes.find((x) => x.id === sel.sceneId);
    if (s) s.duration = Math.max(step, +(s.duration + dir * step).toFixed(4));
  }, 'dur:' + sel.sceneId);
}

export function moveScene(dir: 1 | -1) {
  const { sel } = st();
  if (!sel.sceneId) return;
  update((p) => {
    const i = p.scenes.findIndex((s) => s.id === sel.sceneId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.scenes.length) return;
    [p.scenes[i], p.scenes[j]] = [p.scenes[j], p.scenes[i]];
  });
}

export function selectAdjacentScene(dir: 1 | -1) {
  const { project: p, sel, time } = st();
  if (!p?.scenes.length) return;
  let i = p.scenes.findIndex((s) => s.id === sel.sceneId);
  if (i < 0) {
    const starts = sceneStarts(p);
    i = Math.max(0, starts.findIndex((s0, k) => time < s0 + p.scenes[k].duration));
  } else i = Math.max(0, Math.min(p.scenes.length - 1, i + dir));
  select({ sceneId: p.scenes[i].id });
  setTime(sceneStarts(p)[i]);
}

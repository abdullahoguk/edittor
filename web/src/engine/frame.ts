// Computes what is drawn where at a given time. Preview and export both use this function.
import { layoutPixelRects, type Rect } from '../../../shared/layouts';
import { defaultLayout } from '../../../shared/layouts';
import { aspectOf, getFraming, sceneStarts, totalDuration } from '../../../shared/project';
import type { Asset, Cell, FormatId, Grade, Project, Scene, TextLayer } from '../../../shared/types';

export interface CellDraw {
  key: string; // scene + cell (video source key)
  sceneId: string;
  cell: Cell;
  asset: Asset;
  rect: Rect; // cell area (px)
  clip: Rect; // visible area (after the entrance animation)
  dx: number; dy: number; // offset
  scale: number; // extra scale (zoom entrances, transitions)
  alpha: number;
  srcTime: number; // source time for videos
  framing: { x: number; y: number; zoom: number };
  radius: number;
  grade: Grade;
  background: string;
}

export interface Overlay { color: string; alpha: number }

export interface FrameDesc {
  W: number; H: number;
  background: string;
  draws: CellDraw[];
  overlays: Overlay[];
  texts: { layer: TextLayer; local: number }[];
  sceneIndex: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOut = (x: number) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

const ENTER_DUR = 0.4;

function sceneDraws(p: Project, f: FormatId, s: Scene, local: number, W: number, H: number, assets: Map<string, Asset>, extra: { dx: number; dy: number; scale: number; alpha: number }): CellDraw[] {
  const layout = s.layouts[f] ?? defaultLayout(s.cellCount, aspectOf(f));
  const rects = layoutPixelRects(layout, s.cellCount, W, H);
  const out: CellDraw[] = [];
  s.cells.forEach((cell, i) => {
    const asset = cell.assetId ? assets.get(cell.assetId) : undefined;
    if (!asset) return;
    const rect = rects[i];
    const since = local - cell.enterDelay;
    if (since < 0) return;
    const e = cell.enter === 'cut' ? 1 : easeOut(since / ENTER_DUR);
    let alpha = extra.alpha, dx = extra.dx, dy = extra.dy, scale = extra.scale;
    let clip = { ...rect };
    switch (cell.enter) {
      case 'fade': alpha *= e; break;
      case 'slide-up': dy += (1 - e) * rect.h; break;
      case 'slide-down': dy -= (1 - e) * rect.h; break;
      case 'slide-left': dx += (1 - e) * rect.w; break;
      case 'slide-right': dx -= (1 - e) * rect.w; break;
      case 'wipe': clip = { ...rect, w: rect.w * e }; break;
      case 'zoom': scale *= 1 + 0.15 * (1 - e); alpha *= e; break;
    }
    // Ken Burns motion
    const fr = { ...getFraming(cell, f) };
    const m = clamp01(local / Math.max(0.1, s.duration));
    const amt = cell.motionAmount;
    switch (cell.motion) {
      case 'zoom-in': fr.zoom *= 1 + 0.25 * amt * m; break;
      case 'zoom-out': fr.zoom *= 1 + 0.25 * amt * (1 - m); break;
      case 'pan-left': fr.zoom *= 1 + 0.15 * amt; fr.x = Math.max(-1, Math.min(1, fr.x + amt * (1 - 2 * m))); break;
      case 'pan-right': fr.zoom *= 1 + 0.15 * amt; fr.x = Math.max(-1, Math.min(1, fr.x - amt * (1 - 2 * m))); break;
      case 'pan-up': fr.zoom *= 1 + 0.15 * amt; fr.y = Math.max(-1, Math.min(1, fr.y + amt * (1 - 2 * m))); break;
      case 'pan-down': fr.zoom *= 1 + 0.15 * amt; fr.y = Math.max(-1, Math.min(1, fr.y - amt * (1 - 2 * m))); break;
    }
    const srcTime = asset.kind === 'video' ? cell.in + Math.max(0, since) * cell.speed : 0;
    out.push({
      key: `${s.id}:${cell.id}`, sceneId: s.id, cell, asset, rect, clip, dx, dy, scale, alpha,
      srcTime: asset.duration ? Math.min(srcTime, Math.max(0, asset.duration - 0.04)) : srcTime,
      framing: fr, radius: layout.radius * (Math.min(W, H) / 1080), grade: asset.grade,
      background: s.background ?? p.background,
    });
  });
  return out;
}

export function evaluateFrame(p: Project, f: FormatId, t: number, W: number, H: number): FrameDesc {
  const assets = new Map(p.pool.map((a) => [a.id, a]));
  const starts = sceneStarts(p);
  const total = totalDuration(p);
  const out: FrameDesc = { W, H, background: p.background, draws: [], overlays: [], texts: [], sceneIndex: -1 };
  if (!p.scenes.length) return out;
  let i = p.scenes.findIndex((s, k) => t < starts[k] + s.duration);
  if (i < 0) i = p.scenes.length - 1;
  out.sceneIndex = i;
  const s = p.scenes[i];
  const local = t - starts[i];
  const tr = s.transition;
  const none = { dx: 0, dy: 0, scale: 1, alpha: 1 };
  if (i > 0 && tr.kind !== 'cut' && local < tr.duration) {
    const prev = p.scenes[i - 1];
    const pl = t - starts[i - 1];
    const e = easeInOut(local / tr.duration);
    switch (tr.kind) {
      case 'fade': case 'blur':
        out.draws.push(...sceneDraws(p, f, prev, pl, W, H, assets, none));
        out.draws.push(...sceneDraws(p, f, s, local, W, H, assets, { ...none, alpha: e }));
        break;
      case 'black': case 'white': {
        const color = tr.kind === 'black' ? '#000000' : '#ffffff';
        if (e < 0.5) { out.draws.push(...sceneDraws(p, f, prev, pl, W, H, assets, none)); out.overlays.push({ color, alpha: e * 2 }); }
        else { out.draws.push(...sceneDraws(p, f, s, local, W, H, assets, none)); out.overlays.push({ color, alpha: (1 - e) * 2 }); }
        break;
      }
      case 'slide-left':
        out.draws.push(...sceneDraws(p, f, prev, pl, W, H, assets, { ...none, dx: -W * e }));
        out.draws.push(...sceneDraws(p, f, s, local, W, H, assets, { ...none, dx: W * (1 - e) }));
        break;
      case 'slide-up':
        out.draws.push(...sceneDraws(p, f, prev, pl, W, H, assets, { ...none, dy: -H * e }));
        out.draws.push(...sceneDraws(p, f, s, local, W, H, assets, { ...none, dy: H * (1 - e) }));
        break;
      case 'zoom':
        out.draws.push(...sceneDraws(p, f, prev, pl, W, H, assets, { ...none, scale: 1 + 0.2 * e }));
        out.draws.push(...sceneDraws(p, f, s, local, W, H, assets, { ...none, scale: 1.2 - 0.2 * e, alpha: e }));
        break;
    }
  } else {
    out.draws.push(...sceneDraws(p, f, s, local, W, H, assets, none));
  }
  if (p.fadeIn > 0 && t < p.fadeIn) out.overlays.push({ color: '#000000', alpha: 1 - t / p.fadeIn });
  if (p.fadeOut > 0 && t > total - p.fadeOut) out.overlays.push({ color: '#000000', alpha: clamp01((t - (total - p.fadeOut)) / p.fadeOut) });
  for (const layer of p.texts) {
    if (t >= layer.start && t < layer.start + layer.duration) out.texts.push({ layer, local: t - layer.start });
  }
  out.texts.sort((a, b) => a.layer.track - b.layer.track);
  return out;
}

/** Video sources needed now (and shortly after), for preloading. */
export function upcomingVideoKeys(p: Project, t: number, ahead = 1.5) {
  const starts = sceneStarts(p);
  const keys: { key: string; cell: Cell; asset: Asset; startT: number; sceneStart: number }[] = [];
  const assets = new Map(p.pool.map((a) => [a.id, a]));
  p.scenes.forEach((s, i) => {
    const s0 = starts[i], s1 = s0 + s.duration;
    const nextTr = p.scenes[i + 1]?.transition;
    const tail = nextTr && nextTr.kind !== 'cut' ? nextTr.duration : 0;
    if (s1 + tail < t || s0 > t + ahead) return;
    for (const c of s.cells) {
      const a = c.assetId ? assets.get(c.assetId) : undefined;
      if (a?.kind === 'video') keys.push({ key: `${s.id}:${c.id}`, cell: c, asset: a, startT: s0 + c.enterDelay, sceneStart: s0 });
    }
  });
  return keys;
}

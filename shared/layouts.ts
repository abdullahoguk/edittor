import type { SceneLayout } from './types';

export interface Rect { x: number; y: number; w: number; h: number }

export interface LayoutPreset {
  id: string;
  count: number;
  label: string;
  // what the cell weights mean (shown in the inspector; also an i18n key)
  hint: string;
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'single', count: 1, label: 'Tek', hint: '' },
  { id: 'stack-2', count: 2, label: 'Üst-alt', hint: 'Yükseklik oranı' },
  { id: 'row-2', count: 2, label: 'Yan yana', hint: 'Genişlik oranı' },
  { id: 'stack-3', count: 3, label: '3 satır', hint: 'Yükseklik oranı' },
  { id: 'row-3', count: 3, label: '3 sütun', hint: 'Genişlik oranı' },
  { id: 'big-top-2', count: 3, label: 'Büyük üst', hint: '1. panel: üst blok oranı' },
  { id: 'big-bottom-2', count: 3, label: 'Büyük alt', hint: '1. panel: alt blok oranı' },
  { id: 'big-left-2', count: 3, label: 'Büyük sol', hint: '1. panel: sol blok oranı' },
  { id: 'big-center-2', count: 3, label: 'Orta büyük', hint: 'Yükseklik oranı (orta = 1. panel)' },
  { id: 'grid-4', count: 4, label: '2×2', hint: 'Satır içi oran' },
  { id: 'stack-4', count: 4, label: '4 satır', hint: 'Yükseklik oranı' },
  { id: 'row-4', count: 4, label: '4 sütun', hint: 'Genişlik oranı' },
  { id: 'big-top-3', count: 4, label: 'Büyük üst + 3', hint: '1. panel: üst blok oranı' },
  { id: 'big-left-3', count: 4, label: 'Büyük sol + 3', hint: '1. panel: sol blok oranı' },
];

export function presetsFor(count: number) {
  return LAYOUT_PRESETS.filter((p) => p.count === count);
}

export function defaultPreset(count: number, aspect: number): string {
  const portrait = aspect < 1;
  if (count === 1) return 'single';
  if (count === 2) return portrait ? 'stack-2' : 'row-2';
  if (count === 3) return portrait ? 'stack-3' : 'row-3';
  return 'grid-4';
}

export function defaultLayout(count: number, aspect: number): SceneLayout {
  const preset = defaultPreset(count, aspect);
  return { preset, weights: defaultWeights(preset, count), gap: 0, padding: 0, radius: 0 };
}

export function defaultWeights(preset: string, count: number): number[] {
  if (preset.startsWith('big-') && preset !== 'big-center-2') return [1.5, ...Array(count - 1).fill(1)];
  if (preset === 'big-center-2') return [2, 1, 1];
  return Array(count).fill(1);
}

function split(r: Rect, weights: number[], dir: 'h' | 'v'): Rect[] {
  const ws = weights.map((w) => Math.max(0.05, w || 0));
  const total = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  return ws.map((w) => {
    const f0 = acc / total;
    acc += w;
    const f1 = acc / total;
    return dir === 'v'
      ? { x: r.x, y: r.y + r.h * f0, w: r.w, h: r.h * (f1 - f0) }
      : { x: r.x + r.w * f0, y: r.y, w: r.w * (f1 - f0), h: r.h };
  });
}

/** Normalized (0..1) cell rectangles, in cell order. */
export function layoutRects(layout: SceneLayout, count: number): Rect[] {
  const full: Rect = { x: 0, y: 0, w: 1, h: 1 };
  const w = layout.weights.length >= count ? layout.weights : defaultWeights(layout.preset, count);
  switch (layout.preset) {
    case 'single': return [full];
    case 'stack-2': case 'stack-3': case 'stack-4': return split(full, w.slice(0, count), 'v');
    case 'row-2': case 'row-3': case 'row-4': return split(full, w.slice(0, count), 'h');
    case 'big-top-2': case 'big-top-3': {
      const [a, b] = split(full, [w[0], 1], 'v');
      return [a, ...split(b, w.slice(1, count), 'h')];
    }
    case 'big-bottom-2': {
      const [b, a] = split(full, [1, w[0]], 'v');
      return [a, ...split(b, w.slice(1, count), 'h')];
    }
    case 'big-left-2': case 'big-left-3': {
      const [a, b] = split(full, [w[0], 1], 'h');
      return [a, ...split(b, w.slice(1, count), 'v')];
    }
    case 'big-center-2': {
      const [top, mid, bot] = split(full, [w[1], w[0], w[2]], 'v');
      return [mid, top, bot];
    }
    case 'grid-4': {
      const [top, bot] = split(full, [1, 1], 'v');
      return [...split(top, [w[0], w[1]], 'h'), ...split(bot, [w[2], w[3]], 'h')];
    }
    default: return split(full, w.slice(0, count), 'v');
  }
}

/** Rectangles in pixels, with gap and padding applied. */
export function layoutPixelRects(layout: SceneLayout, count: number, W: number, H: number): Rect[] {
  const s = Math.min(W, H) / 1080;
  const pad = layout.padding * s;
  const gap = layout.gap * s;
  return layoutRects(layout, count).map((r) => {
    const x0 = pad + r.x * (W - 2 * pad);
    const y0 = pad + r.y * (H - 2 * pad);
    const x1 = pad + (r.x + r.w) * (W - 2 * pad);
    const y1 = pad + (r.y + r.h) * (H - 2 * pad);
    const gl = r.x > 0.0001 ? gap / 2 : 0;
    const gr = r.x + r.w < 0.9999 ? gap / 2 : 0;
    const gt = r.y > 0.0001 ? gap / 2 : 0;
    const gb = r.y + r.h < 0.9999 ? gap / 2 : 0;
    return { x: x0 + gl, y: y0 + gt, w: x1 - x0 - gl - gr, h: y1 - y0 - gt - gb };
  });
}

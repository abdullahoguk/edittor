// Draws animated text layers with Canvas2D (shared by preview and export).
import type { FormatId, TextBox, TextLayer } from '../../../shared/types';
import { defaultTextBox } from '../../../shared/project';
import { easeOut } from './frame';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Unit { text: string; x: number; line: number; index: number; word: number }
interface Layout { lines: { text: string; width: number }[]; units: Unit[]; lineH: number; size: number; blockW: number; blockH: number }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function fontStr(l: TextLayer, size: number) {
  return `${l.italic ? 'italic ' : ''}${l.weight} ${size}px "${l.font}", "Inter", sans-serif`;
}

const layoutCache = new Map<string, Layout>();

function layoutText(ctx: Ctx, l: TextLayer, box: TextBox, W: number, H: number): Layout {
  const scale = Math.min(W, H) / 1080;
  const size = box.size * scale;
  const maxW = box.width * W;
  const key = [l.text, l.font, l.weight, l.italic, l.uppercase, l.letterSpacing, l.lineHeight, size.toFixed(2), maxW.toFixed(1)].join('|');
  const hit = layoutCache.get(key);
  if (hit) return hit;
  ctx.font = fontStr(l, size);
  (ctx as any).letterSpacing = `${l.letterSpacing * size}px`;
  const text = l.uppercase ? l.text.toLocaleUpperCase('tr') : l.text;
  const lines: { text: string; width: number }[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (cur.trim() && ctx.measureText(test.trimEnd()).width > maxW) { lines.push({ text: cur.trimEnd(), width: 0 }); cur = w.trimStart(); }
      else cur = test;
    }
    lines.push({ text: cur.trimEnd(), width: 0 });
  }
  const units: Unit[] = [];
  let idx = 0, word = 0;
  lines.forEach((ln, li) => {
    ln.width = ctx.measureText(ln.text).width;
    for (let i = 0; i < ln.text.length; i++) {
      const ch = ln.text[i];
      if (ch === ' ') { word++; continue; }
      units.push({ text: ch, x: ctx.measureText(ln.text.slice(0, i)).width, line: li, index: idx++, word });
    }
    word++;
  });
  const lineH = size * l.lineHeight;
  const out = { lines, units, lineH, size, blockW: Math.max(...lines.map((x) => x.width), 1), blockH: lineH * lines.length };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

export function textBox(l: TextLayer, f: FormatId): TextBox {
  return l.layouts[f] ?? Object.values(l.layouts)[0] ?? defaultTextBox(f);
}

/** Pixel bounds of a text block (for the selection box in the preview). */
export function textBounds(ctx: Ctx, l: TextLayer, f: FormatId, W: number, H: number) {
  const box = textBox(l, f);
  const lay = layoutText(ctx, l, box, W, H);
  const cx = box.x * W, cy = box.y * H;
  const x = box.align === 'left' ? cx - (box.width * W) / 2 : box.align === 'right' ? cx + (box.width * W) / 2 - lay.blockW : cx - lay.blockW / 2;
  return { x, y: cy - lay.blockH / 2, w: lay.blockW, h: lay.blockH };
}

export function drawText(ctx: Ctx, l: TextLayer, local: number, f: FormatId, W: number, H: number) {
  const box = textBox(l, f);
  const lay = layoutText(ctx, l, box, W, H);
  const { size, lineH } = lay;
  const cx = box.x * W, cy = box.y * H;
  const top = cy - lay.blockH / 2;
  const lineX = (w: number) => box.align === 'left' ? cx - (box.width * W) / 2 : box.align === 'right' ? cx + (box.width * W) / 2 - w : cx - w / 2;

  const inD = Math.max(0.05, l.animDuration);
  const outD = Math.min(0.6, inD, l.duration / 3);
  const outP = l.animOut === 'none' ? 0 : clamp01((local - (l.duration - outD)) / outD);
  const outE = easeOut(outP);

  ctx.save();
  ctx.font = fontStr(l, size);
  (ctx as any).letterSpacing = `${l.letterSpacing * size}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = l.color;
  let alpha = l.opacity;
  let dy = 0, sc = 1, blur = 0;
  switch (l.animOut) {
    case 'fade': alpha *= 1 - outE; break;
    case 'rise': alpha *= 1 - outE; dy -= outE * size * 0.5; break;
    case 'drop': alpha *= 1 - outE; dy += outE * size * 0.5; break;
    case 'blur': alpha *= 1 - outE; blur += outE * size * 0.25; break;
    case 'scale': alpha *= 1 - outE; sc *= 1 - 0.1 * outE; break;
    case 'mask-down': break;
  }

  if (l.background) {
    const pad = size * 0.3;
    const bx = Math.min(...lay.lines.map((ln) => lineX(ln.width)));
    const inE = easeOut(local / inD);
    ctx.save();
    ctx.globalAlpha = alpha * (l.animIn === 'none' ? 1 : inE);
    ctx.fillStyle = l.background;
    ctx.fillRect(bx - pad, top - pad * 0.6, lay.blockW + pad * 2, lay.blockH + pad * 1.2);
    ctx.restore();
  }

  if (l.shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${0.55 * l.shadow})`;
    ctx.shadowBlur = size * 0.35 * l.shadow;
    ctx.shadowOffsetY = size * 0.04 * l.shadow;
  }
  if (sc !== 1) { ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy); }

  const baseline = (li: number) => top + li * lineH + lineH * 0.5 + size * 0.35;
  const mode = l.animIn;

  if (mode === 'letters' || mode === 'words' || mode === 'typewriter') {
    for (const u of lay.units) {
      const ln = lay.lines[u.line];
      const order = mode === 'words' ? u.word : u.index;
      const p = (local - order * l.stagger) / inD;
      let a = alpha, ox = 0, oy = dy;
      if (mode === 'typewriter') { if (local < u.index * l.stagger) continue; }
      else { const e = easeOut(p); if (e <= 0) continue; a *= e; oy += (1 - e) * size * 0.35; }
      ctx.globalAlpha = Math.max(0, a);
      if (blur > 0) ctx.filter = `blur(${blur}px)`;
      ctx.fillText(u.text, lineX(ln.width) + u.x + ox, baseline(u.line) + oy);
    }
  } else {
    lay.lines.forEach((ln, li) => {
      const p = (local - li * (mode === 'mask-up' ? l.stagger : 0)) / inD;
      const e = mode === 'none' ? 1 : easeOut(p);
      let a = alpha, oy = dy, b = blur, ls: number | null = null, s2 = 1;
      switch (mode) {
        case 'fade': a *= e; break;
        case 'rise': a *= e; oy += (1 - e) * size * 0.6; break;
        case 'drop': a *= e; oy -= (1 - e) * size * 0.6; break;
        case 'blur': a *= e; b += (1 - e) * size * 0.3; break;
        case 'scale': a *= e; s2 = 0.85 + 0.15 * e; break;
        case 'tracking': a *= e; ls = (l.letterSpacing + 0.35 * (1 - e)) * size; break;
      }
      const x = lineX(ln.width), y = baseline(li);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      if (b > 0.2) ctx.filter = `blur(${b}px)`;
      if (ls != null) {
        (ctx as any).letterSpacing = `${ls}px`;
        const w = ctx.measureText(ln.text).width;
        ctx.fillText(ln.text, lineX(w), y + oy);
      } else if (mode === 'mask-up' || l.animOut === 'mask-down') {
        const lt = top + li * lineH;
        ctx.beginPath();
        ctx.rect(x - size, lt - size * 0.1, ln.width + size * 2, lineH + size * 0.2);
        ctx.clip();
        const off = mode === 'mask-up' ? (1 - e) * lineH * 1.1 : 0;
        const outOff = l.animOut === 'mask-down' ? outE * lineH * 1.1 : 0;
        ctx.fillText(ln.text, x, y + off + outOff + (l.animOut === 'mask-down' ? 0 : oy));
      } else {
        if (s2 !== 1) { ctx.translate(cx, y); ctx.scale(s2, s2); ctx.translate(-cx, -y); }
        ctx.fillText(ln.text, x, y + oy);
      }
      ctx.restore();
    });
  }
  ctx.restore();
}

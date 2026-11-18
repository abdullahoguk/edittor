import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tx } from '../lib/i18n';
import { Play, Pause, SkipBack, SkipForward, Plus, X, Grid3x3, Smartphone, Sparkles, ImagePlus } from 'lucide-react';
import { layoutPixelRects, defaultLayout } from '../../../shared/layouts';
import { addFormat, aspectOf, getFraming, removeFormat, sceneAt, totalDuration } from '../../../shared/project';
import { FORMATS, type FormatId } from '../../../shared/types';
import { select, setFormat, setTime, undo, update, useEditor } from '../store/editor';
import { Player } from '../engine/player';
import { textBounds } from '../engine/text';
import { assignCell, selectAdjacentScene } from '../lib/actions';
import { fmtTime, useDrag } from './ui';

export function Stage() {
  const p = useEditor((s) => s.project)!;
  const [addOpen, setAddOpen] = useState(false);
  const guides = useEditor((s) => s.guides);
  return (
    <main className="stage">
      <div className="stage-top">
        <div className="seg">
          {p.formats.map((f) => (
            <button key={f} className={p.activeFormat === f ? 'on' : ''} onClick={() => setFormat(f)} title={tx(FORMATS[f].label)}>
              <FormatGlyph f={f} /> {f}
              {p.formats.length > 1 && p.activeFormat === f && (
                <X size={11} style={{ marginLeft: 2, opacity: 0.6 }} onClick={(e) => { e.stopPropagation(); update((q) => removeFormat(q, f)); }} />
              )}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <button className="ib sm" title={tx("Format ekle")} onClick={() => setAddOpen(!addOpen)}><Plus size={14} /></button>
          {addOpen && (
            <div className="menu" style={{ top: 28, left: 0 }} onMouseLeave={() => setAddOpen(false)}>
              {(Object.keys(FORMATS) as FormatId[]).filter((f) => !p.formats.includes(f)).map((f) => (
                <button key={f} onClick={() => { update((q) => { const r = addFormat(q, f); r.activeFormat = f; return r; }); setAddOpen(false); }}>
                  <FormatGlyph f={f} /> <b>{f}</b> <span className="hint">{tx(FORMATS[f].label)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="hint">{tx("Yerleşim, çerçeveleme ve yazı konumu her format için ayrı saklanır.")}</span>
        <div className="grow" />
        <button className={'ib sm' + (guides.safe ? ' on' : '')} title={tx("Reels güvenli alanı")} onClick={() => useEditor.setState({ guides: { ...guides, safe: !guides.safe } })}><Smartphone size={14} /></button>
        <button className={'ib sm' + (guides.grid ? ' on' : '')} title={tx("Üçler kuralı")} onClick={() => useEditor.setState({ guides: { ...guides, grid: !guides.grid } })}><Grid3x3 size={14} /></button>
      </div>
      <Viewport />
      <Transport />
    </main>
  );
}

function FormatGlyph({ f }: { f: FormatId }) {
  const a = aspectOf(f);
  const h = 11, w = Math.max(5, Math.min(18, h * a));
  return <span style={{ display: 'inline-block', width: w, height: a >= 1 ? h / Math.max(1, a / 1.6) : h, border: '1.5px solid currentColor', borderRadius: 1.5 }} />;
}

function Viewport() {
  const p = useEditor((s) => s.project)!;
  const time = useEditor((s) => s.time);
  const sel = useEditor((s) => s.sel);
  const guides = useEditor((s) => s.guides);
  const remoteFlash = useEditor((s) => s.remoteFlash);
  const box = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const txRef = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const f = p.activeFormat;
  const { w: FW, h: FH } = FORMATS[f];

  useEffect(() => {
    player.current = new Player(glRef.current!, txRef.current!);
    return () => player.current?.dispose();
  }, []);

  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => {
      const bw = el.clientWidth - 36, bh = el.clientHeight - 36;
      const a = FW / FH;
      const w = Math.max(10, Math.min(bw, bh * a));
      setDisp({ w: Math.round(w), h: Math.round(w / a) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [FW, FH]);

  useEffect(() => {
    if (!disp.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.min(FW, Math.round(disp.w * dpr));
    player.current?.setSize(w, Math.round((w * FH) / FW));
  }, [disp.w, disp.h, FW, FH]);

  const k = disp.w / FW;
  const at = sceneAt(p, time);
  const scene = at ? p.scenes[at.index] : undefined;
  const rects = useMemo(() => {
    if (!scene) return [];
    return layoutPixelRects(scene.layouts[f] ?? defaultLayout(scene.cellCount, aspectOf(f)), scene.cellCount, FW, FH);
  }, [scene, f, FW, FH]);

  const drag = useDrag();
  const [dropCell, setDropCell] = useState<string | null>(null);

  const panCell = (e: React.PointerEvent, cellIdx: number) => {
    if (!scene) return;
    const cell = scene.cells[cellIdx];
    const asset = p.pool.find((a) => a.id === cell.assetId);
    const r = rects[cellIdx];
    if (!asset) return;
    const fr0 = getFraming(cell, f);
    const base = cell.fit === 'cover' ? Math.max(r.w / asset.width, r.h / asset.height) : Math.min(r.w / asset.width, r.h / asset.height);
    const s = base * fr0.zoom;
    const ox = Math.abs(asset.width * s - r.w) / 2 * k, oy = Math.abs(asset.height * s - r.h) / 2 * k;
    const sx = Math.sign(asset.width * s - r.w) || 1, sy = Math.sign(asset.height * s - r.h) || 1;
    const key = 'frame:' + cell.id + f;
    drag(e, (dx, dy) => {
      update((q) => {
        const c = q.scenes.find((x) => x.id === scene.id)!.cells[cellIdx];
        c.framing[f] = {
          zoom: fr0.zoom,
          x: ox > 0.5 ? Math.max(-1, Math.min(1, fr0.x - (dx / ox) * sx)) : fr0.x,
          y: oy > 0.5 ? Math.max(-1, Math.min(1, fr0.y - (dy / oy) * sy)) : fr0.y,
        };
      }, key);
    });
  };

  const zoomCell = (e: React.WheelEvent, cellIdx: number) => {
    if (!scene || !(sel.cellId === scene.cells[cellIdx].id)) return;
    const cell = scene.cells[cellIdx];
    const fr = getFraming(cell, f);
    update((q) => {
      const c = q.scenes.find((x) => x.id === scene.id)!.cells[cellIdx];
      c.framing[f] = { ...fr, zoom: Math.max(1, Math.min(4, fr.zoom * (e.deltaY < 0 ? 1.05 : 1 / 1.05))) };
    }, 'frame:' + cell.id + f);
  };

  // text boxes
  const measure = useMemo(() => document.createElement('canvas').getContext('2d')!, []);
  const texts = p.texts.filter((t) => time >= t.start && time < t.start + t.duration);

  const dragText = (e: React.PointerEvent, id: string, mode: 'move' | 'size') => {
    const t = p.texts.find((x) => x.id === id)!;
    const b0 = { ...(t.layouts[f] ?? Object.values(t.layouts)[0]!) };
    select({ textId: id });
    drag(e, (dx, dy) => {
      update((q) => {
        const tt = q.texts.find((x) => x.id === id)!;
        const b = { ...b0 };
        if (mode === 'move') {
          b.x = Math.max(0, Math.min(1, b0.x + dx / disp.w));
          b.y = Math.max(0, Math.min(1, b0.y + dy / disp.h));
          // snap to the center lines
          if (Math.abs(b.x - 0.5) < 0.012) b.x = 0.5;
          if (Math.abs(b.y - 0.5) < 0.012) b.y = 0.5;
        } else b.size = Math.max(8, Math.round(b0.size * (1 + (dx + dy) / 200)));
        tt.layouts[f] = b;
      }, 'textbox:' + id + f + mode);
    });
  };

  const flash = Date.now() - remoteFlash < 6000;
  const [, force] = useState(0);
  useEffect(() => { if (flash) { const t = setTimeout(() => force((x) => x + 1), 6000); return () => clearTimeout(t); } }, [remoteFlash]);

  return (
    <div className="viewport" ref={box} onPointerDown={(e) => e.target === e.currentTarget && select({})}>
      {flash && (
        <div className="flash"><Sparkles size={13} color="var(--accent)" /> {tx('Proje dışarıdan güncellendi (Claude / MCP)')}
          <button className="btn sm ghost" onClick={() => { undo(); useEditor.setState({ remoteFlash: 0 }); }}>{tx("Geri al")}</button></div>
      )}
      <div className="canvas-wrap" style={{ width: disp.w, height: disp.h }}>
        <canvas ref={glRef} />
        <canvas ref={txRef} />
        {guides.grid && <div className="grid3" />}
        {guides.safe && f === '9:16' && (
          <div className="safe" style={{ inset: 0 }}>
            <div className="zone" style={{ left: 0, right: 0, top: 0, height: `${(220 / 1920) * 100}%` }} />
            <div className="zone" style={{ left: 0, right: 0, bottom: 0, height: `${(420 / 1920) * 100}%` }} />
            <div className="zone" style={{ right: 0, width: `${(130 / 1080) * 100}%`, top: `${(220 / 1920) * 100}%`, bottom: `${(420 / 1920) * 100}%` }} />
          </div>
        )}
        <div className="overlay">
          {scene && rects.map((r, i) => {
            const c = scene.cells[i];
            const isSel = sel.sceneId === scene.id && sel.cellId === c.id;
            const asset = p.pool.find((a) => a.id === c.assetId);
            return (
              <div key={c.id}
                className={'ov-cell' + (isSel ? ' sel' : '') + (dropCell === c.id ? ' drop' : '')}
                style={{ left: r.x * k, top: r.y * k, width: r.w * k, height: r.h * k }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  if (isSel) panCell(e, i); else select({ sceneId: scene.id, cellId: c.id });
                }}
                onDoubleClick={() => useEditor.setState({ picker: { sceneId: scene.id, cellId: c.id } })}
                onWheel={(e) => zoomCell(e, i)}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-edittor-assets')) { e.preventDefault(); setDropCell(c.id); } }}
                onDragLeave={() => setDropCell(null)}
                onDrop={(e) => {
                  e.preventDefault(); setDropCell(null);
                  const ids = JSON.parse(e.dataTransfer.getData('application/x-edittor-assets') || '[]');
                  if (ids[0]) { assignCell(scene.id, c.id, ids[0]); select({ sceneId: scene.id, cellId: c.id }); }
                }}
                title={tx(isSel ? 'Sürükle: kadrajı kaydır · Tekerlek: yakınlaştır · Çift tık: medya seç' : 'Seç · Çift tık: medya seç')}
              >
                <span className="ov-label">{tx('Panel {n}', { n: i + 1 })}{asset ? ` · ${asset.name}` : ''}</span>
                {!asset && <div className="ov-empty"><div><ImagePlus size={18} /><br />{tx("Medya seç ya da sürükle")}</div></div>}
              </div>
            );
          })}
          {texts.map((t) => {
            const b = textBounds(measure, t, f, FW, FH);
            const isSel = sel.textId === t.id;
            return (
              <div key={t.id} className={'ov-text' + (isSel ? ' sel' : '')}
                style={{ left: b.x * k - 4, top: b.y * k - 4, width: b.w * k + 8, height: b.h * k + 8 }}
                onPointerDown={(e) => { e.stopPropagation(); dragText(e, t.id, 'move'); }}>
                {isSel && <div className="h" onPointerDown={(e) => { e.stopPropagation(); dragText(e, t.id, 'size'); }} />}
              </div>
            );
          })}
        </div>
      </div>
      {!p.scenes.length && (
        <div className="empty-stage" style={{ position: 'absolute' }}>
          <div style={{ font: '600 15px var(--font-display)', color: 'var(--text)' }}>{tx("Henüz sahne yok")}</div>
          <div>{tx("Havuzdan bir öğeyi timeline'a sürükle ya da aşağıdan sahne ekle.")}</div>
        </div>
      )}
    </div>
  );
}

function Transport() {
  const p = useEditor((s) => s.project)!;
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const total = totalDuration(p);
  return (
    <div className="transport">
      <button className="ib" title={tx("Önceki sahne (↑)")} onClick={() => selectAdjacentScene(-1)}><SkipBack size={15} /></button>
      <button className="play" title={tx("Oynat / durdur (Boşluk)")} onClick={() => useEditor.setState({ playing: !playing })}>
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <button className="ib" title={tx("Sonraki sahne (↓)")} onClick={() => selectAdjacentScene(1)}><SkipForward size={15} /></button>
      <div className="tc" style={{ marginLeft: 8 }}>{fmtTime(time)} <span>/ {fmtTime(total)}</span></div>
      <input type="range" min={0} max={Math.max(0.01, total)} step={0.001} value={Math.min(time, total)} onChange={(e) => setTime(+e.target.value)} style={{ flex: 1, marginLeft: 8 }} />
      <span className="hint" style={{ marginLeft: 8 }}>{FORMATS[p.activeFormat].w}×{FORMATS[p.activeFormat].h} · {p.fps} fps</span>
    </div>
  );
}

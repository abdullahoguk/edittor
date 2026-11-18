import { useEffect, useMemo, useRef, useState } from 'react';
import { tx } from '../lib/i18n';
import { Square, Rows2, Rows3, LayoutGrid, Type, Scissors, Copy, Trash2, Magnet, ZoomIn, Maximize2, Film, Music2, Video } from 'lucide-react';
import { beatLength, sceneStarts, totalDuration } from '../../../shared/project';
import type { Project } from '../../../shared/types';
import { mediaUrl, select, setTime, update, useEditor } from '../store/editor';
import { addScene, addScenesFromAssets, addTextAt, deleteSelection, duplicateScene, splitAtPlayhead } from '../lib/actions';
import { fmtTime, useDrag } from './ui';

const PAD = 12;
const H_RULER = 26, H_TEXT = 28, H_AUDIO = 46;

const TR_ICON: Record<string, string> = { fade: '◐', black: '●', white: '○', 'slide-left': '←', 'slide-up': '↑', zoom: '⤢', blur: '≈' };

export function Timeline() {
  const p = useEditor((s) => s.project)!;
  const zoom = useEditor((s) => s.zoom);
  const time = useEditor((s) => s.time);
  const sel = useEditor((s) => s.sel);
  const playing = useEditor((s) => s.playing);
  const mediaVer = useEditor((s) => s.mediaVer);
  const scroller = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyH, setBodyH] = useState(200);
  const drag = useDrag();
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [reorder, setReorder] = useState<{ id: string; x: number; index: number } | null>(null);

  const total = totalDuration(p);
  const starts = useMemo(() => sceneStarts(p), [p.scenes]);
  const beat = beatLength(p);
  const textTracks = Math.max(1, ...p.texts.map((t) => t.track + 1)) + 0;
  const hVideo = Math.max(56, bodyH - H_RULER - textTracks * H_TEXT - H_AUDIO - 2);
  const X = (t: number) => PAD + t * zoom;
  const T = (x: number) => (x - PAD) / zoom;
  const width = X(Math.max(total, p.music ? Math.min(p.music.duration - p.music.offset, total + 30) : 0) + 12);

  useEffect(() => {
    const el = bodyRef.current!;
    const ro = new ResizeObserver(() => setBodyH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // keep the playhead in view while playing
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = X(time);
    if (x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = x - 80;
  }, [time, playing]);

  const snap = (t: number, e?: PointerEvent | React.PointerEvent) => {
    if (e?.shiftKey) return t;
    const cands: number[] = [];
    if (beat && p.tempo.snap) cands.push(p.tempo.offset + Math.round((t - p.tempo.offset) / beat) * beat);
    for (const s of starts) cands.push(s);
    cands.push(total, time);
    let best = t, bd = 8 / zoom;
    for (const c of cands) if (Math.abs(c - t) < bd) { bd = Math.abs(c - t); best = c; }
    if (beat && p.tempo.snap && best === t) best = cands[0];
    return best;
  };

  const timeFromEvent = (e: { clientX: number }) => {
    const el = scroller.current!;
    return T(e.clientX - el.getBoundingClientRect().left + el.scrollLeft);
  };

  const scrub = (e: React.PointerEvent) => {
    useEditor.setState({ playing: false });
    setTime(timeFromEvent(e));
    drag(e, (_dx, _dy, ev) => setTime(timeFromEvent(ev)));
  };

  const indexAt = (t: number) => {
    for (let i = 0; i < p.scenes.length; i++) if (t < starts[i] + p.scenes[i].duration / 2) return i;
    return p.scenes.length;
  };

  const sceneDown = (e: React.PointerEvent, id: string, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ sceneId: id });
    if (!playing) setTime(Math.max(starts[i], Math.min(starts[i] + p.scenes[i].duration - 0.001, timeFromEvent(e))));
    drag(e, (_dx, _dy, ev) => {
      const t = timeFromEvent(ev);
      setReorder({ id, x: X(t), index: indexAt(t) });
    }, (moved, ev) => {
      setReorder(null);
      if (!moved) return;
      const to = indexAt(timeFromEvent(ev));
      update((q) => {
        const from = q.scenes.findIndex((s) => s.id === id);
        const [s] = q.scenes.splice(from, 1);
        q.scenes.splice(to > from ? to - 1 : to, 0, s);
      });
    });
  };

  const trimScene = (e: React.PointerEvent, id: string, i: number) => {
    e.stopPropagation();
    select({ sceneId: id });
    const s0 = starts[i], d0 = p.scenes[i].duration;
    drag(e, (dx, _dy, ev) => {
      const end = snap(s0 + d0 + dx / zoom, ev);
      update((q) => { const s = q.scenes.find((x) => x.id === id)!; s.duration = Math.max(0.1, +(end - s0).toFixed(4)); }, 'trim:' + id);
    });
  };

  const textDown = (e: React.PointerEvent, id: string, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation();
    select({ textId: id });
    const t0 = p.texts.find((t) => t.id === id)!;
    const { start, duration, track } = t0;
    drag(e, (dx, dy, ev) => {
      update((q) => {
        const t = q.texts.find((x) => x.id === id)!;
        if (mode === 'move') {
          t.start = Math.max(0, snap(start + dx / zoom, ev));
          t.track = Math.max(0, Math.min(7, track + Math.round(dy / H_TEXT)));
        } else if (mode === 'r') {
          t.duration = Math.max(0.2, snap(start + duration + dx / zoom, ev) - start);
        } else {
          const ns = Math.max(0, Math.min(start + duration - 0.2, snap(start + dx / zoom, ev)));
          t.duration = start + duration - ns;
          t.start = ns;
        }
      }, 'text:' + id + mode);
    });
  };

  const musicDown = (e: React.PointerEvent) => {
    if (!p.music) return;
    const off0 = p.music.offset;
    drag(e, (dx) => {
      update((q) => { if (q.music) q.music.offset = Math.max(0, Math.min(q.music.duration - 1, +(off0 - dx / zoom).toFixed(3))); }, 'music-offset');
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const el = scroller.current!;
    const t = timeFromEvent(e);
    const z = Math.max(8, Math.min(600, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    useEditor.setState({ zoom: z });
    requestAnimationFrame(() => { el.scrollLeft = PAD + t * z - (e.clientX - el.getBoundingClientRect().left); });
  };

  const fit = () => {
    const el = scroller.current;
    if (el && total > 0) useEditor.setState({ zoom: Math.max(8, (el.clientWidth - PAD * 3) / total) });
  };

  // ruler
  const ticks = useMemo(() => {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const major = steps.find((s) => s * zoom >= 70) ?? 60;
    const minor = steps.find((s) => s * zoom >= 10) ?? major;
    const out: { t: number; major: boolean }[] = [];
    const end = width / zoom;
    for (let t = 0; t <= end; t = +(t + minor).toFixed(4)) out.push({ t, major: Math.abs(t / major - Math.round(t / major)) < 1e-6 });
    return out;
  }, [zoom, width]);

  const beats = useMemo(() => {
    if (!beat || beat * zoom < 5) return [];
    const out: { t: number; bar: boolean }[] = [];
    for (let k = 0, t = p.tempo.offset; t < width / zoom; k++, t = p.tempo.offset + k * beat) out.push({ t, bar: k % 4 === 0 });
    return out;
  }, [beat, zoom, width, p.tempo.offset]);

  return (
    <section className="tl">
      <div className="tl-bar">
        <span className="label" style={{ marginRight: 6 }}>{tx("Sahne ekle")}</span>
        <button className="btn sm" onClick={() => addScene(1)} title={tx("Tek panel")}><Square size={13} />{' '}{tx("Tek")}</button>
        <button className="btn sm" onClick={() => addScene(2)} title={tx("2'li kolaj")}><Rows2 size={13} />{' '}{tx("2'li")}</button>
        <button className="btn sm" onClick={() => addScene(3)} title={tx("3'lü kolaj")}><Rows3 size={13} />{' '}{tx("3'lü")}</button>
        <button className="btn sm" onClick={() => addScene(4)} title={tx("4'lü kolaj")}><LayoutGrid size={13} />{' '}{tx("4'lü")}</button>
        <div className="vsep" />
        <button className="btn sm" onClick={() => addTextAt()} title={tx("Yazı ekle (T)")}><Type size={13} />{' '}{tx("Yazı")}</button>
        <div className="vsep" />
        <button className="ib sm" onClick={splitAtPlayhead} title={tx("Oynatma kafasında böl (S)")}><Scissors size={14} /></button>
        <button className="ib sm" onClick={() => sel.sceneId && duplicateScene(sel.sceneId)} disabled={!sel.sceneId} title={tx("Çoğalt (Ctrl+D)")}><Copy size={14} /></button>
        <button className="ib sm" onClick={deleteSelection} disabled={!sel.sceneId && !sel.textId} title={tx("Sil (Del)")}><Trash2 size={14} /></button>
        <div className="vsep" />
        <button className={'ib sm' + (p.tempo.snap ? ' on' : '')} title={tx("Vuruşa / kenarlara yapış (Shift ile geçici kapat)")}
          onClick={() => update((q) => { q.tempo.snap = !q.tempo.snap; })}><Magnet size={14} /></button>
        {beat > 0 ? <span className="hint">{p.tempo.bpm} BPM</span> : <span className="hint">{tx("Vuruş ızgarası için Proje → Tempo")}</span>}
        <div className="grow" />
        <span className="hint" style={{ marginRight: 10 }}>
          <span className="kbd">{tx("Boşluk")}</span>{' '}{tx("oynat ·")}{' '}<span className="kbd">{tx("S")}</span>{' '}{tx("böl ·")}{' '}<span className="kbd">+</span><span className="kbd">−</span>{' '}{tx("süre ·")}{' '}<span className="kbd">{tx("Alt")}</span>+<span className="kbd">←</span>{' '}{tx("taşı")}{' '}</span>
        <ZoomIn size={14} color="var(--muted)" />
        <input type="range" min={8} max={400} value={zoom} onChange={(e) => useEditor.setState({ zoom: +e.target.value })} style={{ width: 110 }} />
        <button className="ib sm" title={tx("Sığdır")} onClick={fit}><Maximize2 size={13} /></button>
      </div>
      <div className="tl-body" ref={bodyRef}>
        <div className="tl-heads">
          <div className="ruler-h" />
          <div className="tl-head" style={{ height: hVideo }}><Video size={13} />{' '}{tx("V")}</div>
          {Array.from({ length: textTracks }, (_, i) => <div key={i} className="tl-head" style={{ height: H_TEXT }}><Type size={12} /> T{i + 1}</div>)}
          <div className="tl-head" style={{ height: H_AUDIO }}><Music2 size={13} /> ♪</div>
        </div>
        <div className="tl-scroll" ref={scroller} onWheel={onWheel}>
          <div className="tl-inner" style={{ width }}>
            <div className="ruler" onPointerDown={scrub}>
              {ticks.map((t) => <div key={t.t} className={'tick ' + (t.major ? 'major' : 'minor')} style={{ left: X(t.t) }} />)}
              {ticks.filter((t) => t.major).map((t) => <div key={'l' + t.t} className="tlab" style={{ left: X(t.t) }}>{t.t < 60 ? `${+t.t.toFixed(2)}s` : fmtTime(t.t, 0)}</div>)}
            </div>
            {beats.map((b) => <div key={b.t} className={'beat' + (b.bar ? ' bar' : '')} style={{ left: X(b.t) }} />)}

            {/* video track */}
            <div className="track" style={{ height: hVideo }}
              onPointerDown={(e) => e.target === e.currentTarget && select({})}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-edittor-assets')) { e.preventDefault(); const i = indexAt(timeFromEvent(e)); setDropAt(i < p.scenes.length ? starts[i] : total); } }}
              onDragLeave={() => setDropAt(null)}
              onDrop={(e) => {
                e.preventDefault(); setDropAt(null);
                const ids = JSON.parse(e.dataTransfer.getData('application/x-edittor-assets') || '[]');
                if (ids.length) addScenesFromAssets(ids, indexAt(timeFromEvent(e)));
              }}>
              {p.scenes.length === 0 && <div className="tl-empty"><Film size={14} />{' '}{tx("Havuzdan medya sürükle ya da yukarıdan sahne ekle")}</div>}
              {p.scenes.map((s, i) => (
                <SceneClip key={s.id} p={p} i={i} x={X(starts[i])} w={s.duration * zoom} selected={sel.sceneId === s.id}
                  mediaVer={mediaVer} dragging={reorder?.id === s.id}
                  onDown={(e) => sceneDown(e, s.id, i)} onTrim={(e) => trimScene(e, s.id, i)} />
              ))}
            </div>

            {/* text tracks */}
            {Array.from({ length: textTracks }, (_, tr) => (
              <div key={tr} className="track" style={{ height: H_TEXT }}
                onDoubleClick={(e) => { if (e.target === e.currentTarget) addTextAt(undefined, timeFromEvent(e)); }}
                onPointerDown={(e) => e.target === e.currentTarget && select({})}>
                {p.texts.filter((t) => t.track === tr).map((t) => (
                  <div key={t.id} className={'clip text' + (sel.textId === t.id ? ' sel' : '')}
                    style={{ left: X(t.start), width: Math.max(6, t.duration * zoom), top: 3, bottom: 3 }}
                    onPointerDown={(e) => textDown(e, t.id, 'move')} title={t.text}>
                    <div className="trim l" onPointerDown={(e) => textDown(e, t.id, 'l')} />
                    <Type size={11} style={{ flex: 'none' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.text.replace(/\n/g, ' ')}</span>
                    <div className="trim r" onPointerDown={(e) => textDown(e, t.id, 'r')} />
                  </div>
                ))}
              </div>
            ))}

            {/* music */}
            <div className="track" style={{ height: H_AUDIO }}>
              {p.music ? (
                <div className="clip audio" style={{ left: X(0), width: Math.max(10, Math.min(p.music.duration - p.music.offset, width / zoom) * zoom), top: 4, bottom: 4 }}
                  onPointerDown={musicDown} title={tx("Sürükle: müziğin başlangıç noktasını kaydır")}>
                  <div className="cap"><Music2 size={11} /> {p.music.name} <span style={{ opacity: 0.7, fontWeight: 400 }}>· {tx('başlangıç')} {p.music.offset.toFixed(2)} s</span></div>
                  <Waveform p={p} zoom={zoom} />
                  {total > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, left: total * zoom, right: 0, background: 'rgba(0,0,0,0.35)' }} />}
                </div>
              ) : <div className="tl-empty" style={{ top: 14 }}><Music2 size={13} />{' '}{tx("Müzik yok, sol panelden Müzik sekmesini kullan")}</div>}
            </div>

            {dropAt != null && <div className="drop-mark" style={{ left: X(dropAt) - 1 }} />}
            {reorder && <div className="drop-mark" style={{ left: X(reorder.index < p.scenes.length ? starts[reorder.index] : total) - 1 }} />}
            <div className="playhead" style={{ left: X(time) }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function SceneClip({ p, i, x, w, selected, onDown, onTrim, mediaVer, dragging }: {
  p: Project; i: number; x: number; w: number; selected: boolean; dragging: boolean; mediaVer: Record<string, number>;
  onDown: (e: React.PointerEvent) => void; onTrim: (e: React.PointerEvent) => void;
}) {
  const s = p.scenes[i];
  const beat = beatLength(p);
  const kind = s.cellCount === 1 ? tx(p.pool.find((a) => a.id === s.cells[0].assetId)?.kind === 'video' ? 'Video' : 'Foto') : `${tx('Kolaj')} ${s.cellCount}`;
  return (
    <div className={'clip scene' + (selected ? ' sel' : '')} style={{ left: x + 1, width: Math.max(4, w - 2), opacity: dragging ? 0.5 : 1 }} onPointerDown={onDown}
      title={`${String(i + 1).padStart(2, '0')} · ${kind} · ${s.duration.toFixed(2)} s`}>
      <div className="cells">
        {s.cells.map((c) => {
          const a = p.pool.find((x) => x.id === c.assetId);
          return <div key={c.id} style={a ? { backgroundImage: `url(${mediaUrl(p.id, a, 'thumb', mediaVer[a.id])})` } : { background: 'var(--panel-3)' }} />;
        })}
      </div>
      {w > 28 && (
        <div className="cap">{String(i + 1).padStart(2, '0')} {w > 70 && <>{kind} <span>{s.duration.toFixed(1)}s{beat ? ` · ${+(s.duration / beat).toFixed(1)}♪` : ''}</span></>}</div>
      )}
      {s.transition.kind !== 'cut' && i > 0 && <div className="tr-badge" title={tx('Geçiş') + ': ' + s.transition.kind} style={{ fontSize: 9 }}>{TR_ICON[s.transition.kind]}</div>}
      <div className="trim r" onPointerDown={onTrim} />
    </div>
  );
}

const waveCache = new Map<string, Promise<{ perSec: number; peaks: number[] }>>();

function Waveform({ p, zoom }: { p: Project; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<{ perSec: number; peaks: number[] } | null>(null);
  const m = p.music!;
  useEffect(() => {
    let pr = waveCache.get(m.path);
    if (!pr) { pr = fetch(`/api/projects/${p.id}/waveform?path=${encodeURIComponent(m.path)}`).then((r) => r.json()); waveCache.set(m.path, pr); }
    pr.then(setData).catch(() => {});
  }, [m.path, p.id]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !data) return;
    const w = c.clientWidth, h = c.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = getComputedStyle(c).getPropertyValue('--audio') || '#7fd6b0';
    ctx.globalAlpha = 0.7;
    const mid = h / 2 + 5;
    for (let x = 0; x < w; x++) {
      const t0 = m.offset + x / zoom, t1 = m.offset + (x + 1) / zoom;
      let pk = 0;
      for (let i = Math.floor(t0 * data.perSec); i < Math.ceil(t1 * data.perSec); i++) pk = Math.max(pk, data.peaks[i] ?? 0);
      const bh = Math.max(1, pk * (h - 16) * 0.5);
      ctx.fillRect(x, mid - bh, 1, bh * 2);
    }
  }, [data, zoom, m.offset]);
  return <canvas ref={ref} />;
}

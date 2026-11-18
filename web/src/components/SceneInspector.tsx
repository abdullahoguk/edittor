import { Copy, Trash2, ImagePlus, ChevronDown, ChevronRight, RotateCcw, Minus, Plus, Shrink, Expand } from 'lucide-react';
import { tx } from '../lib/i18n';
import { LAYOUT_PRESETS, defaultWeights, layoutRects, presetsFor } from '../../../shared/layouts';
import { aspectOf, beatLength, getFraming, sceneStarts, setCellCount } from '../../../shared/project';
import type { Cell, Scene, TransitionKind, CellEnter, MotionKind, FormatId } from '../../../shared/types';
import { mediaUrl, select, update, useEditor } from '../store/editor';
import { deleteSelection, duplicateScene } from '../lib/actions';
import { Group, LayoutIcon, Num, Row, Seg, Slider, useDrag } from './ui';

const TRANSITIONS: { v: TransitionKind; label: string }[] = [
  { v: 'cut', label: 'Kesme' }, { v: 'fade', label: 'Çapraz geçiş' }, { v: 'black', label: 'Siyaha' }, { v: 'white', label: 'Beyaza' },
  { v: 'slide-left', label: 'Sola kay' }, { v: 'slide-up', label: 'Yukarı kay' }, { v: 'zoom', label: 'Yakınlaş' },
];
const ENTERS: { v: CellEnter; label: string }[] = [
  { v: 'cut', label: 'Direkt' }, { v: 'fade', label: 'Belir' }, { v: 'slide-up', label: 'Aşağıdan' }, { v: 'slide-down', label: 'Yukarıdan' },
  { v: 'slide-left', label: 'Sağdan' }, { v: 'slide-right', label: 'Soldan' }, { v: 'wipe', label: 'Silme' }, { v: 'zoom', label: 'Yakınlaş' },
];
const MOTIONS: { v: MotionKind; label: string }[] = [
  { v: 'none', label: 'Sabit' }, { v: 'zoom-in', label: 'Yakınlaş' }, { v: 'zoom-out', label: 'Uzaklaş' },
  { v: 'pan-left', label: 'Sola kaydır' }, { v: 'pan-right', label: 'Sağa kaydır' }, { v: 'pan-up', label: 'Yukarı' }, { v: 'pan-down', label: 'Aşağı' },
];

export function SceneInspector({ s }: { s: Scene }) {
  const p = useEditor((st) => st.project)!;
  const sel = useEditor((st) => st.sel);
  const f = p.activeFormat;
  const i = p.scenes.findIndex((x) => x.id === s.id);
  const start = sceneStarts(p)[i];
  const beat = beatLength(p);
  const layout = s.layouts[f]!;
  const kind = s.cellCount === 1 ? tx('Tek') : `${tx('Kolaj')} · ${s.cellCount}`;
  const mut = (fn: (sc: Scene) => void, key?: string) => update((q) => { const sc = q.scenes.find((x) => x.id === s.id); if (sc) fn(sc); }, key);
  const portraitFormats = p.formats.filter((x) => (aspectOf(x) < 1) === (aspectOf(f) < 1) && x !== f);

  return (
    <>
      <div className="ph">
        <h3>{tx('Sahne')} {String(i + 1).padStart(2, '0')}</h3><span className="sub">{kind}</span>
        <div className="grow" />
        <button className="ib sm" title={tx("Çoğalt")} onClick={() => duplicateScene(s.id)}><Copy size={14} /></button>
        <button className="ib sm" title={tx("Sil")} onClick={deleteSelection}><Trash2 size={14} /></button>
      </div>

      <Group title={tx("Zamanlama")}>
        <Row label={tx("Süre")}>
          <Num value={s.duration} step={0.1} min={0.1} onChange={(v) => mut((sc) => { sc.duration = v; })} suffix="sn" />
          {beat > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <button className="ib sm" onClick={() => mut((sc) => { sc.duration = Math.max(beat, Math.round(sc.duration / beat - 1) * beat); }, 'dur')}><Minus size={12} /></button>
              <span style={{ minWidth: 56, textAlign: 'center', fontSize: 12 }}>{+(s.duration / beat).toFixed(2)} {tx('vuruş')}</span>
              <button className="ib sm" onClick={() => mut((sc) => { sc.duration = Math.round(sc.duration / beat + 1) * beat; }, 'dur')}><Plus size={12} /></button>
            </span>
          )}
        </Row>
        <Row label={tx("Zaman")}><span style={{ fontSize: 12 }}>{start.toFixed(2)} → {(start + s.duration).toFixed(2)} {tx('sn')}</span></Row>
        <Row label={tx("Giriş geçişi")}>
          <select className="input" value={s.transition.kind} disabled={i === 0} onChange={(e) => mut((sc) => { sc.transition.kind = e.target.value as TransitionKind; })}>
            {TRANSITIONS.map((t) => <option key={t.v} value={t.v}>{tx(t.label)}</option>)}
          </select>
          {s.transition.kind !== 'cut' && <Num value={s.transition.duration} step={0.05} min={0.05} max={s.duration} width={56} onChange={(v) => mut((sc) => { sc.transition.duration = v; })} />}
        </Row>
      </Group>

      <Group title={tx("Yerleşim")} tag={f}>
        <Row label={tx("Panel sayısı")}>
          <Seg full value={s.cellCount} onChange={(n) => update((q) => { const k = q.scenes.findIndex((x) => x.id === s.id); q.scenes[k] = setCellCount(q, q.scenes[k], n); })}
            options={[1, 2, 3, 4].map((n) => ({ v: n, label: String(n) }))} />
        </Row>
        <div className="layout-grid">
          {presetsFor(s.cellCount).map((pr) => (
            <button key={pr.id} className={'layout-btn' + (layout.preset === pr.id ? ' on' : '')} title={tx(pr.label)}
              onClick={() => mut((sc) => { sc.layouts[f] = { ...sc.layouts[f]!, preset: pr.id, weights: defaultWeights(pr.id, sc.cellCount) }; })}>
              <LayoutIcon rects={layoutRects({ ...layout, preset: pr.id, weights: defaultWeights(pr.id, s.cellCount) }, s.cellCount)} aspect={aspectOf(f)} size={34} />
            </button>
          ))}
        </div>
        {s.cellCount > 1 && (
          <>
            <div className="hint">{tx(LAYOUT_PRESETS.find((x) => x.id === layout.preset)?.hint ?? '')} — {tx('panellerin ne kadar yer kaplayacağı')}</div>
            {layout.weights.slice(0, s.cellCount).map((w, k) => (
              <Slider key={k} label={tx('Panel {n}', { n: k + 1 })} value={w} min={0.2} max={4} step={0.05} def={defaultWeights(layout.preset, s.cellCount)[k]}
                onChange={(v) => mut((sc) => { sc.layouts[f]!.weights[k] = v; }, `w:${s.id}:${f}:${k}`)} />
            ))}
          </>
        )}
        <Slider label={tx("Boşluk")} value={layout.gap} min={0} max={80} step={1} def={0} unit="px" onChange={(v) => mut((sc) => { sc.layouts[f]!.gap = v; }, 'gap' + s.id)} />
        <Slider label={tx("Kenar payı")} value={layout.padding} min={0} max={160} step={1} def={0} unit="px" onChange={(v) => mut((sc) => { sc.layouts[f]!.padding = v; }, 'pad' + s.id)} />
        <Slider label={tx("Köşe")} value={layout.radius} min={0} max={80} step={1} def={0} unit="px" onChange={(v) => mut((sc) => { sc.layouts[f]!.radius = v; }, 'rad' + s.id)} />
        <Row label={tx("Arka plan")}>
          <input type="color" value={s.background ?? p.background} onChange={(e) => mut((sc) => { sc.background = e.target.value; }, 'bg' + s.id)} />
          {s.background && <button className="btn sm ghost" onClick={() => mut((sc) => { delete sc.background; })}>{tx("Proje rengi")}</button>}
        </Row>
        {portraitFormats.length > 0 && (
          <button className="btn sm" onClick={() => mut((sc) => { for (const g of portraitFormats) sc.layouts[g] = structuredClone(sc.layouts[f]!); })}>
            {tx('Bu yerleşimi {f} formatına kopyala', { f: portraitFormats.join(', ') })}
          </button>
        )}
      </Group>

      <Group title={tx("Paneller")}>
        {s.cells.map((c, k) => (
          <CellCard key={c.id} s={s} c={c} index={k} open={sel.cellId === c.id || s.cellCount === 1} format={f} />
        ))}
      </Group>
    </>
  );
}

function CellCard({ s, c, index, open, format: f }: { s: Scene; c: Cell; index: number; open: boolean; format: FormatId }) {
  const p = useEditor((st) => st.project)!;
  const ver = useEditor((st) => (c.assetId ? st.mediaVer[c.assetId] : undefined));
  const a = p.pool.find((x) => x.id === c.assetId);
  const beat = beatLength(p);
  const fr = getFraming(c, f);
  const mut = (fn: (cell: Cell) => void, key?: string) =>
    update((q) => { const cell = q.scenes.find((x) => x.id === s.id)?.cells.find((x) => x.id === c.id); if (cell) fn(cell); }, key);
  const pick = (e: React.MouseEvent) => { e.stopPropagation(); useEditor.setState({ picker: { sceneId: s.id, cellId: c.id } }); };

  return (
    <div className={'cell-card' + (open && s.cellCount > 1 ? ' on' : '')}>
      <div className="cc-h" onClick={() => select({ sceneId: s.id, cellId: open && s.cellCount > 1 ? undefined : c.id })}>
        <button className="cc-thumb" onClick={pick} title={tx("Havuzdan seç")}>
          {a ? <img src={mediaUrl(p.id, a, 'thumb', ver)} alt="" /> : <ImagePlus size={18} />}
        </button>
        <div className="cc-meta">
          <div className="n">{s.cellCount > 1 && <b>{tx('Panel {n}', { n: index + 1 })} · </b>}{a ? a.name : tx('Boş panel')}</div>
          <div className="s">
            {a ? (a.kind === 'video' ? `${tx('Video')} · ${a.duration.toFixed(1)} s · ${a.width}×${a.height}` : `${tx('Foto')} · ${a.width}×${a.height}`) : tx('Tıkla ve medya seç')}
            {c.enterDelay > 0 && ` · +${c.enterDelay.toFixed(2)} s`}
          </div>
        </div>
        {s.cellCount > 1 && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </div>
      {open && a && (
        <div className="cc-b">
          <Row label={tx("Sığdırma")}>
            <Seg full value={c.fit} onChange={(v) => mut((x) => { x.fit = v; })}
              options={[{ v: 'cover', label: 'Doldur', icon: <Expand size={12} /> }, { v: 'contain', label: 'Sığdır', icon: <Shrink size={12} /> }]} />
          </Row>
          <Row label={tx("Görünme")}>
            <Num value={c.enterDelay} step={beat || 0.1} min={0} max={s.duration} width={58} onChange={(v) => mut((x) => { x.enterDelay = v; })} suffix="sn" />
            {beat > 0 && <span className="hint">= {+(c.enterDelay / beat).toFixed(2)} {tx('vuruş')}</span>}
          </Row>
          {(c.enterDelay > 0 || c.enter !== 'cut' || s.cellCount > 1) && (
            <Row label={tx("Giriş")}>
              <select className="input" value={c.enter} onChange={(e) => mut((x) => { x.enter = e.target.value as CellEnter; })}>
                {ENTERS.map((t) => <option key={t.v} value={t.v}>{tx(t.label)}</option>)}
              </select>
            </Row>
          )}
          {a.kind === 'video' && (
            <>
              <SlipControl s={s} c={c} />
              <Row label={tx("Hız")}>
                <Seg full value={c.speed} onChange={(v) => mut((x) => { x.speed = v; })}
                  options={[0.5, 0.75, 1, 1.5, 2].map((v) => ({ v, label: v + '×' }))} />
              </Row>
              {a.hasAudio && <Slider label={tx("Video sesi")} value={c.volume} min={0} max={1} step={0.01} def={0} format={(v) => Math.round(v * 100) + '%'} onChange={(v) => mut((x) => { x.volume = v; }, 'vol' + c.id)} />}
            </>
          )}
          <Row label={tx("Hareket")}>
            <select className="input" value={c.motion} onChange={(e) => mut((x) => { x.motion = e.target.value as MotionKind; })}>
              {MOTIONS.map((t) => <option key={t.v} value={t.v}>{tx(t.label)}</option>)}
            </select>
          </Row>
          {c.motion !== 'none' && <Slider label={tx("Hareket miktarı")} value={c.motionAmount} min={0.05} max={1} step={0.01} def={0.3} onChange={(v) => mut((x) => { x.motionAmount = v; }, 'ma' + c.id)} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span className="label" style={{ flex: 1 }}>{tx("Kadraj")}{' '}<span className="tag" style={{ marginLeft: 4 }}>{f}</span></span>
            <button className="ib sm" title={tx("Kadrajı sıfırla")} onClick={() => mut((x) => { delete x.framing[f]; })}><RotateCcw size={13} /></button>
          </div>
          <Slider label={tx("Yatay")} value={fr.x} min={-1} max={1} step={0.01} def={0} onChange={(v) => mut((x) => { x.framing[f] = { ...fr, x: v }; }, 'fx' + c.id + f)} />
          <Slider label={tx("Dikey")} value={fr.y} min={-1} max={1} step={0.01} def={0} onChange={(v) => mut((x) => { x.framing[f] = { ...fr, y: v }; }, 'fy' + c.id + f)} />
          <Slider label={tx("Yakınlık")} value={fr.zoom} min={1} max={4} step={0.01} def={1} format={(v) => v.toFixed(2) + '×'} onChange={(v) => mut((x) => { x.framing[f] = { ...fr, zoom: v }; }, 'fz' + c.id + f)} />
          <div className="hint">{tx("Önizlemede paneli seçip sürükleyerek de kadrajlayabilirsin (tekerlek = yakınlık).")}</div>
        </div>
      )}
    </div>
  );
}

/** Video slip: which part of the source video is shown. The window is draggable. */
function SlipControl({ s, c }: { s: Scene; c: Cell }) {
  const p = useEditor((st) => st.project)!;
  const a = p.pool.find((x) => x.id === c.assetId)!;
  const ver = useEditor((st) => st.mediaVer[a.id]);
  const drag = useDrag();
  const vis = Math.max(0.05, (s.duration - c.enterDelay) * c.speed);
  const dur = Math.max(0.1, a.duration);
  const maxIn = Math.max(0, dur - vis);
  const left = (c.in / dur) * 100, w = Math.min(100, (vis / dur) * 100);
  const over = vis > dur + 0.01;
  const strip = mediaUrl(p.id, a, 'strip', ver);

  const down = (e: React.PointerEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const in0 = c.in;
    // center the window on the clicked point
    const clicked = ((e.clientX - box.left) / box.width) * dur;
    const startIn = e.target === e.currentTarget ? Math.max(0, Math.min(maxIn, clicked - vis / 2)) : in0;
    if (startIn !== in0) update((q) => { q.scenes.find((x) => x.id === s.id)!.cells.find((x) => x.id === c.id)!.in = +startIn.toFixed(3); }, 'slip' + c.id);
    drag(e, (dx) => {
      const v = Math.max(0, Math.min(maxIn, startIn + (dx / box.width) * dur));
      update((q) => { q.scenes.find((x) => x.id === s.id)!.cells.find((x) => x.id === c.id)!.in = +v.toFixed(3); }, 'slip' + c.id);
    });
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="label" style={{ flex: 1 }}>{tx("Kullanılan kısım (slip)")}</span>
        <Num value={c.in} step={0.1} min={0} max={maxIn} width={58} onChange={(v) => update((q) => { q.scenes.find((x) => x.id === s.id)!.cells.find((x) => x.id === c.id)!.in = v; })} suffix="sn" />
      </div>
      <div className="slip" onPointerDown={down} title={tx("Sürükle: videonun hangi kısmı görünsün")}>
        <div className="strip" style={{ backgroundImage: `url(${strip})` }} />
        <div className="win" style={{ left: `${left}%`, width: `${w}%`, backgroundImage: `url(${strip})`, backgroundSize: `${(100 / Math.max(1, w)) * 100}% 100%`, backgroundPosition: `${maxIn > 0 ? (c.in / maxIn) * 100 : 0}% 0` }} />
        <div className="lab">{c.in.toFixed(2)}–{Math.min(dur, c.in + vis).toFixed(2)} / {dur.toFixed(1)} s</div>
      </div>
      {over && <div className="hint" style={{ color: '#e3b341' }}>{tx("Sahne, videonun kullanılabilir süresinden uzun: son kare donar.")}</div>}
    </>
  );
}

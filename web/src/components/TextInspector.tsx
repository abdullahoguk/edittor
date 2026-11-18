import { useEffect, useState } from 'react';
import { tx } from '../lib/i18n';
import { Trash2, Copy, AlignLeft, AlignCenter, AlignRight, Italic, CaseUpper } from 'lucide-react';
import { uid } from '../../../shared/project';
import type { TextAnimIn, TextAnimOut, TextLayer } from '../../../shared/types';
import { select, update, useEditor } from '../store/editor';
import { deleteSelection } from '../lib/actions';
import { FONT_GROUPS, TEXT_PRESETS } from '../lib/fonts';
import { Group, Num, Row, Seg, Slider } from './ui';
import { textBox } from '../engine/text';

const ANIM_IN: { v: TextAnimIn; label: string }[] = [
  { v: 'none', label: 'Yok' }, { v: 'fade', label: 'Belir' }, { v: 'rise', label: 'Yüksel' }, { v: 'drop', label: 'Düş' },
  { v: 'mask-up', label: 'Maske (satır satır)' }, { v: 'letters', label: 'Harf harf' }, { v: 'words', label: 'Kelime kelime' },
  { v: 'typewriter', label: 'Daktilo' }, { v: 'blur', label: 'Bulanıktan' }, { v: 'scale', label: 'Ölçek' }, { v: 'tracking', label: 'Harf aralığı açılır' },
];
const ANIM_OUT: { v: TextAnimOut; label: string }[] = [
  { v: 'none', label: 'Yok' }, { v: 'fade', label: 'Kaybol' }, { v: 'rise', label: 'Yukarı' }, { v: 'drop', label: 'Aşağı' },
  { v: 'mask-down', label: 'Maske' }, { v: 'blur', label: 'Bulanıklaş' }, { v: 'scale', label: 'Küçül' },
];

let systemFonts: Promise<string[]> | null = null;

export function TextInspector({ t }: { t: TextLayer }) {
  const p = useEditor((s) => s.project)!;
  const f = p.activeFormat;
  const box = textBox(t, f);
  const [sys, setSys] = useState<string[]>([]);
  useEffect(() => { (systemFonts ??= fetch('/api/fonts').then((r) => r.json()).catch(() => [])).then(setSys); }, []);
  const mut = (fn: (x: TextLayer) => void, key?: string) => update((q) => { const x = q.texts.find((y) => y.id === t.id); if (x) fn(x); }, key);
  const mutBox = (patch: Partial<typeof box>, key?: string) => mut((x) => { x.layouts[f] = { ...textBox(x, f), ...patch }; }, key);
  const known = FONT_GROUPS.flatMap((g) => g.fonts);

  return (
    <>
      <div className="ph">
        <h3>{tx("Yazı")}</h3><span className="sub">{t.start.toFixed(2)}–{(t.start + t.duration).toFixed(2)} s</span>
        <div className="grow" />
        <button className="ib sm" title={tx("Çoğalt")} onClick={() => { const id = uid('t_'); update((q) => { q.texts.push({ ...structuredClone(t), id, start: t.start + t.duration }); }); select({ textId: id }); }}><Copy size={14} /></button>
        <button className="ib sm" title={tx("Sil")} onClick={deleteSelection}><Trash2 size={14} /></button>
      </div>
      <Group title={tx("Metin")}>
        <textarea className="input" rows={3} value={t.text} onChange={(e) => mut((x) => { x.text = e.target.value; }, 'txt' + t.id)} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TEXT_PRESETS.map((pr) => (
            <button key={pr.id} className="btn sm" style={{ fontFamily: `"${pr.style.font}"`, fontStyle: pr.style.italic ? 'italic' : undefined, fontWeight: pr.style.weight }}
              onClick={() => mut((x) => { Object.assign(x, pr.style); x.layouts[f] = { ...textBox(x, f), size: pr.size, align: pr.align }; })}>{tx(pr.name)}</button>
          ))}
        </div>
      </Group>
      <Group title={tx("Tipografi")}>
        <Row label={tx("Font")}>
          <select className="input" value={t.font} onChange={(e) => mut((x) => { x.font = e.target.value; })} style={{ fontFamily: `"${t.font}"` }}>
            {FONT_GROUPS.map((g) => <optgroup key={g.label} label={tx(g.label)}>{g.fonts.map((ff) => <option key={ff} value={ff}>{ff}</option>)}</optgroup>)}
            {sys.length > 0 && <optgroup label={tx("Sistem fontları")}>{sys.filter((x) => !known.includes(x)).map((ff) => <option key={ff} value={ff}>{ff}</option>)}</optgroup>}
          </select>
        </Row>
        <Row label={tx("Kalınlık")}>
          <select className="input" value={t.weight} onChange={(e) => mut((x) => { x.weight = +e.target.value; })}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <button className={'ib sm' + (t.italic ? ' on' : '')} title={tx("İtalik")} onClick={() => mut((x) => { x.italic = !x.italic; })}><Italic size={14} /></button>
          <button className={'ib sm' + (t.uppercase ? ' on' : '')} title={tx("Büyük harf")} onClick={() => mut((x) => { x.uppercase = !x.uppercase; })}><CaseUpper size={14} /></button>
        </Row>
        <Slider label={tx("Boyut")} value={box.size} min={10} max={400} step={1} unit="px" onChange={(v) => mutBox({ size: v }, 'size' + t.id + f)} />
        <Slider label={tx("Harf aralığı")} value={t.letterSpacing} min={-0.1} max={0.5} step={0.005} def={0} format={(v) => v.toFixed(3) + 'em'} onChange={(v) => mut((x) => { x.letterSpacing = v; }, 'ls' + t.id)} />
        <Slider label={tx("Satır aralığı")} value={t.lineHeight} min={0.7} max={2} step={0.01} def={1.05} onChange={(v) => mut((x) => { x.lineHeight = v; }, 'lh' + t.id)} />
        <Row label={tx("Renk")}>
          <input type="color" value={t.color} onChange={(e) => mut((x) => { x.color = e.target.value; }, 'col' + t.id)} />
          <span className="hint">{tx("Kutu")}</span>
          <input type="color" value={t.background ?? '#000000'} onChange={(e) => mut((x) => { x.background = e.target.value; }, 'bgc' + t.id)} style={{ opacity: t.background ? 1 : 0.35 }} />
          {t.background && <button className="btn sm ghost" onClick={() => mut((x) => { x.background = null; })}>{tx("Kutusuz")}</button>}
        </Row>
        <Slider label={tx("Opaklık")} value={t.opacity} min={0} max={1} step={0.01} def={1} format={(v) => Math.round(v * 100) + '%'} onChange={(v) => mut((x) => { x.opacity = v; }, 'op' + t.id)} />
        <Slider label={tx("Gölge")} value={t.shadow} min={0} max={1} step={0.01} def={0} onChange={(v) => mut((x) => { x.shadow = v; }, 'sh' + t.id)} />
      </Group>
      <Group title={tx("Animasyon")}>
        <Row label={tx("Giriş")}>
          <select className="input" value={t.animIn} onChange={(e) => mut((x) => { x.animIn = e.target.value as TextAnimIn; })}>
            {ANIM_IN.map((a) => <option key={a.v} value={a.v}>{tx(a.label)}</option>)}
          </select>
        </Row>
        <Row label={tx("Çıkış")}>
          <select className="input" value={t.animOut} onChange={(e) => mut((x) => { x.animOut = e.target.value as TextAnimOut; })}>
            {ANIM_OUT.map((a) => <option key={a.v} value={a.v}>{tx(a.label)}</option>)}
          </select>
        </Row>
        <Slider label={tx("Süre")} value={t.animDuration} min={0.1} max={3} step={0.05} def={0.6} unit="s" onChange={(v) => mut((x) => { x.animDuration = v; }, 'ad' + t.id)} />
        {['letters', 'words', 'typewriter', 'mask-up'].includes(t.animIn) && (
          <Slider label={tx("Gecikme")} value={t.stagger} min={0.005} max={0.3} step={0.005} def={0.03} unit="s" onChange={(v) => mut((x) => { x.stagger = v; }, 'st' + t.id)} />
        )}
      </Group>
      <Group title={tx("Zaman")}>
        <Row label={tx("Başlangıç")}><Num value={t.start} step={0.1} min={0} onChange={(v) => mut((x) => { x.start = v; })} suffix="sn" /></Row>
        <Row label={tx("Süre")}><Num value={t.duration} step={0.1} min={0.2} onChange={(v) => mut((x) => { x.duration = v; })} suffix="sn" /></Row>
      </Group>
      <Group title={tx("Konum")} tag={f}>
        <Row label={tx("Hizalama")}>
          <Seg value={box.align} onChange={(v) => mutBox({ align: v })} options={[
            { v: 'left', icon: <AlignLeft size={13} /> }, { v: 'center', icon: <AlignCenter size={13} /> }, { v: 'right', icon: <AlignRight size={13} /> },
          ]} />
        </Row>
        <Slider label={tx("Yatay")} value={box.x} min={0} max={1} step={0.001} def={0.5} format={(v) => Math.round(v * 100) + '%'} onChange={(v) => mutBox({ x: v }, 'bx' + t.id + f)} />
        <Slider label={tx("Dikey")} value={box.y} min={0} max={1} step={0.001} def={0.5} format={(v) => Math.round(v * 100) + '%'} onChange={(v) => mutBox({ y: v }, 'by' + t.id + f)} />
        <Slider label={tx("Kutu genişliği")} value={box.width} min={0.1} max={1} step={0.01} def={0.84} format={(v) => Math.round(v * 100) + '%'} onChange={(v) => mutBox({ width: v }, 'bw' + t.id + f)} />
        <div className="hint">{tx("Önizlemede yazıyı sürükleyerek de taşıyabilirsin. Konum yalnızca {f} için geçerli.", { f })}</div>
      </Group>
    </>
  );
}

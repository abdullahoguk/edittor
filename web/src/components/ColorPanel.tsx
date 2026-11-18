import { useRef } from 'react';
import { tx } from '../lib/i18n';
import { RotateCcw, Upload, Palette } from 'lucide-react';
import { DEFAULT_GRADE, type Grade } from '../../../shared/types';
import { mediaUrl, selectedScene, update, useEditor } from '../store/editor';
import { uploadFiles } from '../lib/actions';
import { Group, Row, Slider } from './ui';

const LOOKS: { name: string; g: Partial<Grade> }[] = [
  { name: 'Nötr', g: {} },
  { name: 'Sıcak sonbahar', g: { temperature: 0.35, saturation: 0.12, contrast: 0.1, shadows: 0.05, vignette: 0.25 } },
  { name: 'Soluk film', g: { contrast: -0.18, saturation: -0.2, shadows: 0.2, highlights: -0.1, grain: 0.35, temperature: 0.1 } },
  { name: 'Soğuk sabah', g: { temperature: -0.35, tint: 0.05, contrast: 0.05, saturation: -0.08 } },
  { name: 'Canlı', g: { contrast: 0.2, saturation: 0.28, vignette: 0.15 } },
  { name: 'Mat siyah-beyaz', g: { saturation: -1, contrast: 0.15, shadows: 0.12, grain: 0.3 } },
];

export function ColorPanel() {
  const p = useEditor((s) => s.project)!;
  const sel = useEditor((s) => s.sel);
  const poolSel = useEditor((s) => s.poolSel);
  const lutRef = useRef<HTMLInputElement>(null);
  const scene = selectedScene(p, sel);
  const cellAsset = scene?.cells.find((c) => c.id === sel.cellId)?.assetId ?? scene?.cells.find((c) => c.assetId)?.assetId;
  const targetIds = poolSel.length && !sel.cellId ? poolSel : cellAsset ? [cellAsset] : poolSel;
  const targets = p.pool.filter((a) => targetIds.includes(a.id));
  const a = targets[0];

  if (!a) {
    return (
      <div className="scroll" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="hint" style={{ textAlign: 'center', maxWidth: 230, lineHeight: 1.6 }}>
          <Palette size={20} /><br />{tx("Renk ayarı havuzdaki öğeye uygulanır ve o öğenin tüm kullanımlarında geçerli olur.")}<br />{tx("Havuzdan bir öğe ya da sahnede bir panel seç.")}{' '}</div>
      </div>
    );
  }
  const g = a.grade;
  const set = (patch: Partial<Grade>, key?: string) => update((q) => {
    for (const x of q.pool) if (targetIds.includes(x.id)) x.grade = { ...x.grade, ...patch };
  }, key);
  const copyTo = (filter: (k: string) => boolean) => update((q) => {
    for (const x of q.pool) if (x.kind !== 'audio' && filter(x.kind)) x.grade = { ...g };
  });

  const S = (label: string, k: keyof Grade, min: number, max: number) => (
    <Slider label={tx(label)} value={g[k] as number} min={min} max={max} step={0.01} def={DEFAULT_GRADE[k] as number}
      onChange={(v) => set({ [k]: v } as Partial<Grade>, 'grade:' + k + targetIds.join())} />
  );

  return (
    <div className="scroll">
      <div className="ph" style={{ gap: 10, height: 56 }}>
        <img src={mediaUrl(p.id, a, 'thumb')} style={{ width: 54, height: 34, objectFit: 'cover', borderRadius: 2 }} alt="" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{targets.length > 1 ? tx('{n} öğe', { n: targets.length }) : a.name}</div>
          <div className="hint">{tx("Tüm kullanımlarına uygulanır")}</div>
        </div>
        <button className="ib sm" title={tx("Sıfırla")} onClick={() => set({ ...DEFAULT_GRADE })}><RotateCcw size={14} /></button>
      </div>
      <Group title={tx("Hazır görünümler")}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {LOOKS.map((l) => <button key={l.name} className="btn sm" onClick={() => set({ ...DEFAULT_GRADE, lut: g.lut, lutMix: g.lutMix, ...l.g })}>{tx(l.name)}</button>)}
        </div>
      </Group>
      <Group title={tx("Işık")}>
        {S('Pozlama', 'exposure', -2, 2)}
        {S('Kontrast', 'contrast', -1, 1)}
        {S('Parlak alanlar', 'highlights', -1, 1)}
        {S('Gölgeler', 'shadows', -1, 1)}
      </Group>
      <Group title={tx("Renk")}>
        {S('Sıcaklık', 'temperature', -1, 1)}
        {S('Ton', 'tint', -1, 1)}
        {S('Doygunluk', 'saturation', -1, 1)}
      </Group>
      <Group title={tx("LUT")}>
        <Row label={tx("LUT")}>
          <select className="input" value={g.lut ?? ''} onChange={(e) => set({ lut: e.target.value || null })}>
            <option value="">{tx("— yok —")}</option>
            {p.luts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="ib sm" title={tx(".cube yükle")} onClick={() => lutRef.current?.click()}><Upload size={13} /></button>
          <input ref={lutRef} type="file" accept=".cube" hidden multiple onChange={(e) => e.target.files && uploadFiles(e.target.files, 'lut')} />
        </Row>
        {g.lut && S('LUT yoğunluğu', 'lutMix', 0, 1)}
      </Group>
      <Group title={tx("Doku")}>
        {S('Vinyet', 'vignette', 0, 1)}
        {S('Gren', 'grain', 0, 1)}
      </Group>
      <Group title={tx("Kopyala")}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button className="btn sm" onClick={() => copyTo((k) => k === 'video')}>{tx("Tüm videolara")}</button>
          <button className="btn sm" onClick={() => copyTo((k) => k === 'image')}>{tx("Tüm fotolara")}</button>
          <button className="btn sm" onClick={() => copyTo(() => true)}>{tx("Hepsine")}</button>
          {scene && <button className="btn sm" onClick={() => update((q) => {
            const ids = new Set(scene.cells.map((c) => c.assetId));
            for (const x of q.pool) if (ids.has(x.id)) x.grade = { ...g };
          })}>{tx("Bu sahnedekilere")}</button>}
        </div>
      </Group>
    </div>
  );
}

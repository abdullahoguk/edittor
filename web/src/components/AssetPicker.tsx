import { useMemo, useState } from 'react';
import { tx } from '../lib/i18n';
import { Check } from 'lucide-react';
import { mediaUrl, useEditor } from '../store/editor';
import { assignCell } from '../lib/actions';
import { Thumb } from './Thumb';
import { Modal, Seg } from './ui';

/** Pick a panel's media from the pool, with a preview. */
export function AssetPicker() {
  const p = useEditor((s) => s.project)!;
  const picker = useEditor((s) => s.picker)!;
  const scene = p.scenes.find((s) => s.id === picker.sceneId);
  const cell = scene?.cells.find((c) => c.id === picker.cellId);
  const [cur, setCur] = useState<string | null>(cell?.assetId ?? null);
  const [filter, setFilter] = useState<'all' | 'video' | 'image'>('all');
  const [q, setQ] = useState('');
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of p.scenes) for (const c of s.cells) if (c.assetId) m.set(c.assetId, (m.get(c.assetId) ?? 0) + 1);
    return m;
  }, [p.scenes]);
  const items = p.pool.filter((a) => a.kind !== 'audio' && (filter === 'all' || a.kind === filter) && a.name.toLowerCase().includes(q.toLowerCase()));
  const a = p.pool.find((x) => x.id === cur);
  const close = () => useEditor.setState({ picker: null });
  const choose = (id: string | null) => { if (id && scene && cell) assignCell(scene.id, cell.id, id); close(); };
  const idx = scene ? scene.cells.findIndex((c) => c.id === cell?.id) : 0;

  return (
    <Modal title={tx('Medya seç') + (scene && scene.cellCount > 1 ? ' · ' + tx('Panel {n}', { n: idx + 1 }) : '')} onClose={close} className="picker"
      footer={<>
        <span className="hint">{tx("Çift tık: hemen seç · Videoların üzerinde gezinerek karelerine bak")}</span>
        <div className="grow" />
        <button className="btn" onClick={close}>{tx("Vazgeç")}</button>
        <button className="btn primary" disabled={!cur} onClick={() => choose(cur)}><Check size={14} />{' '}{tx("Seç")}</button>
      </>}>
      <div className="picker-body">
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="pool-tools">
            <Seg value={filter} onChange={setFilter} options={[{ v: 'all', label: 'Tümü' }, { v: 'video', label: 'Video' }, { v: 'image', label: 'Foto' }]} />
            <input className="input" style={{ width: 220 }} placeholder={tx("Ara…")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="scroll">
            <div className="pool-grid">
              {items.map((x) => (
                <Thumb key={x.id} asset={x} selected={cur === x.id} used={usage.get(x.id)} draggable={false}
                  onClick={() => setCur(x.id)} onDoubleClick={() => choose(x.id)} />
              ))}
            </div>
          </div>
        </div>
        <div className="picker-prev">
          <div className="pv">
            {a ? (a.kind === 'video'
              ? <video key={a.id} src={mediaUrl(p.id, a, 'proxy')} autoPlay muted loop controls playsInline />
              : <img src={mediaUrl(p.id, a, 'proxy')} alt="" />)
              : <span className="hint">{tx("Bir öğe seç")}</span>}
          </div>
          {a && (
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600 }}>{a.name}</div>
              <div className="hint">{a.kind === 'video' ? `${tx('Video')} · ${a.duration.toFixed(2)} s` : tx('Foto')} · {a.width}×{a.height} · {tx('{n} kez kullanıldı', { n: usage.get(a.id) ?? 0 })}</div>
              <div className="hint" style={{ wordBreak: 'break-all' }}>{a.path.replace(/^\/(home|Users)\/[^/]+/, '~')}</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

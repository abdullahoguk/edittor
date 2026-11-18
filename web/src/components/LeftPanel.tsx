import { useMemo, useRef, useState } from 'react';
import { tx } from '../lib/i18n';
import { Images, Music2, Type, Palette, FolderPlus, Upload, Trash2, Play, Pause, Check, PanelLeftClose, Plus } from 'lucide-react';
import { useEditor, update, fileUrl } from '../store/editor';
import type { LeftTab } from '../store/editor';
import { Thumb } from './Thumb';
import { addScenesFromAssets, addTextAt, uploadFiles } from '../lib/actions';
import { TEXT_PRESETS } from '../lib/fonts';
import { fmtTime, Seg } from './ui';

const TABS: { id: LeftTab; icon: React.ReactNode; label: string }[] = [
  { id: 'media', icon: <Images size={17} />, label: 'Medya' },
  { id: 'audio', icon: <Music2 size={17} />, label: 'Müzik' },
  { id: 'text', icon: <Type size={17} />, label: 'Yazı' },
  { id: 'lut', icon: <Palette size={17} />, label: 'LUT' },
];

export function Rail() {
  const tab = useEditor((s) => s.leftTab);
  return (
    <nav className="rail">
      {TABS.map((t) => (
        <button key={t.id} className={'ib' + (tab === t.id ? ' on' : '')} title={tx(t.label)}
          onClick={() => useEditor.setState({ leftTab: tab === t.id ? null : t.id })}>
          {t.icon}
        </button>
      ))}
    </nav>
  );
}

export function LeftPanel() {
  const tab = useEditor((s) => s.leftTab);
  if (!tab) return <aside className="left" />;
  return (
    <aside className="left">
      {tab === 'media' && <MediaPanel />}
      {tab === 'audio' && <AudioPanel />}
      {tab === 'text' && <TextPanel />}
      {tab === 'lut' && <LutPanel />}
    </aside>
  );
}

function Head({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="ph">
      <h3>{title}</h3>{sub && <span className="sub">{sub}</span>}
      <div className="grow" />
      {children}
      <button className="ib sm" title={tx("Paneli kapat")} onClick={() => useEditor.setState({ leftTab: null })}><PanelLeftClose size={14} /></button>
    </div>
  );
}

function MediaPanel() {
  const p = useEditor((s) => s.project)!;
  const poolSel = useEditor((s) => s.poolSel);
  const [filter, setFilter] = useState<'all' | 'video' | 'image'>('all');
  const [orient, setOrient] = useState<'all' | 'h' | 'v'>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of p.scenes) for (const c of s.cells) if (c.assetId) m.set(c.assetId, (m.get(c.assetId) ?? 0) + 1);
    return m;
  }, [p.scenes]);
  const items = p.pool.filter((a) => a.kind !== 'audio' && (filter === 'all' || a.kind === filter) &&
    (orient === 'all' || (orient === 'h' ? a.width >= a.height : a.width < a.height)));
  const [dragOver, setDragOver] = useState(false);

  const click = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && poolSel.length) {
      const ids = items.map((a) => a.id);
      const a = ids.indexOf(poolSel[poolSel.length - 1]), b = ids.indexOf(id);
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      useEditor.setState({ poolSel: [...new Set([...poolSel, ...range])] });
    } else if (e.ctrlKey || e.metaKey) {
      useEditor.setState({ poolSel: poolSel.includes(id) ? poolSel.filter((x) => x !== id) : [...poolSel, id] });
    } else useEditor.setState({ poolSel: [id], rightTab: useEditor.getState().rightTab });
  };

  const remove = () => {
    const del = new Set(poolSel);
    update((q) => {
      q.pool = q.pool.filter((a) => !del.has(a.id));
      for (const s of q.scenes) for (const c of s.cells) if (c.assetId && del.has(c.assetId)) c.assetId = null;
    });
    useEditor.setState({ poolSel: [] });
  };

  return (
    <>
      <Head title={tx("Havuz")} sub={`${items.length}`} />
      <div className="pool-tools">
        <button className="btn sm" onClick={() => useEditor.setState({ browser: true })}><FolderPlus size={13} />{' '}{tx("Klasörden ekle")}</button>
        <button className="btn sm" onClick={() => fileRef.current?.click()}><Upload size={13} />{' '}{tx("Yükle")}</button>
        <input ref={fileRef} type="file" multiple accept="video/*,image/*,audio/*" hidden onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <Seg value={filter} onChange={setFilter} options={[{ v: 'all', label: 'Tümü' }, { v: 'video', label: 'Video' }, { v: 'image', label: 'Foto' }]} />
          <Seg value={orient} onChange={setOrient} options={[{ v: 'all', label: '◻' , title: 'Tüm yönler'}, { v: 'h', label: '▭', title: 'Yatay' }, { v: 'v', label: '▯', title: 'Dikey' }]} />
        </div>
        {poolSel.length > 0 && (
          <div style={{ display: 'flex', gap: 6, width: '100%', alignItems: 'center' }}>
            <span className="hint" style={{ flex: 1 }}>{tx('{n} seçili', { n: poolSel.length })}</span>
            <button className="btn sm" onClick={() => addScenesFromAssets(poolSel)} title={tx("Her birini tek sahne olarak ekle")}><Plus size={12} />{' '}{tx("Sahne yap")}</button>
            <button className="ib sm" onClick={remove} title={tx("Havuzdan kaldır")}><Trash2 size={13} /></button>
          </div>
        )}
      </div>
      <div className="scroll"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); }}
        style={dragOver ? { outline: '2px dashed var(--accent)', outlineOffset: -6 } : undefined}
        onClick={(e) => e.target === e.currentTarget && useEditor.setState({ poolSel: [] })}
      >
        {items.length === 0 ? (
          <div className="hint" style={{ padding: 20, lineHeight: 1.6 }}>{tx("Havuz boş. Klasörden ekle ile bilgisayarındaki bir klasörü seç ya da dosyaları buraya sürükle.")}<br /><br />{tx("Küçük resimleri sürükleyerek timeline'a ya da önizlemedeki bir panele bırakabilirsin.")}</div>
        ) : (
          <div className="pool-grid">
            {items.map((a) => (
              <Thumb key={a.id} asset={a} selected={poolSel.includes(a.id)} used={usage.get(a.id)}
                onClick={(e) => click(a.id, e)} onDoubleClick={() => addScenesFromAssets([a.id])} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AudioPanel() {
  const p = useEditor((s) => s.project)!;
  const items = p.pool.filter((a) => a.kind === 'audio');
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const toggle = (path: string, id: string) => {
    audio.current?.pause();
    if (playing === id) { setPlaying(null); return; }
    audio.current = new Audio(fileUrl(path));
    audio.current.play();
    audio.current.onended = () => setPlaying(null);
    setPlaying(id);
  };
  const use = (id: string) => {
    const a = p.pool.find((x) => x.id === id)!;
    update((q) => { q.music = { path: a.path, name: a.name, offset: 0, volume: 1, fadeIn: 0, fadeOut: 3, duration: a.duration }; });
    useEditor.setState({ rightTab: 'project' });
  };
  return (
    <>
      <Head title={tx("Müzik")} sub={`${items.length}`}>
        <button className="btn sm" onClick={() => useEditor.setState({ browser: true })}><FolderPlus size={13} />{' '}{tx("Ekle")}</button>
      </Head>
      <div className="scroll">
        {items.length === 0 && <div className="hint" style={{ padding: 20 }}>{tx("Ses dosyası yok. Klasörden ekle ile mp3 / wav / m4a ekleyebilirsin.")}</div>}
        {items.map((a) => {
          const on = p.music?.path === a.path;
          return (
            <div key={a.id} className={'list-item' + (on ? ' on' : '')}>
              <button className="ib sm" onClick={() => toggle(a.path, a.id)}>{playing === a.id ? <Pause size={13} /> : <Play size={13} />}</button>
              <div className="meta"><div>{a.name}</div><div>{fmtTime(a.duration, 0)}</div></div>
              {on ? <span className="hint" style={{ display: 'flex', gap: 4, alignItems: 'center', color: 'var(--accent)' }}><Check size={13} />{' '}{tx("kullanılıyor")}</span>
                : <button className="btn sm" onClick={() => use(a.id)}>{tx("Müzik yap")}</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function TextPanel() {
  return (
    <>
      <Head title={tx("Yazı stilleri")} />
      <div className="scroll">
        <div className="hint" style={{ padding: '10px 14px 0' }}>{tx("Tıkla: oynatma kafasına ekler.")}{' '}<span className="kbd">{tx("T")}</span>{' '}{tx("boş yazı ekler.")}</div>
        {TEXT_PRESETS.map((t) => (
          <div key={t.id} className="preset-card" onClick={() => addTextAt(t)}>
            <div className="s" style={{
              fontFamily: `"${t.style.font}"`, fontWeight: t.style.weight, fontStyle: t.style.italic ? 'italic' : 'normal',
              textTransform: t.style.uppercase ? 'uppercase' : 'none', letterSpacing: `${t.style.letterSpacing}em`,
              fontSize: Math.min(30, Math.max(14, t.size / 4.5)), textAlign: t.align,
            }}>{tx(t.sample)}</div>
            <div className="n"><span>{tx(t.name)}</span><span>{t.style.font} · {t.style.animIn}</span></div>
          </div>
        ))}
      </div>
    </>
  );
}

function LutPanel() {
  const p = useEditor((s) => s.project)!;
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Head title={tx("LUT")} sub={`${p.luts.length}`}>
        <button className="btn sm" onClick={() => ref.current?.click()}><Upload size={13} />{' '}{tx(".cube yükle")}</button>
        <input ref={ref} type="file" accept=".cube" multiple hidden onChange={(e) => e.target.files && uploadFiles(e.target.files, 'lut')} />
      </Head>
      <div className="scroll">
        <div className="hint" style={{ padding: '10px 14px' }}>{tx("3D LUT (.cube) dosyaları projenin luts/ klasörüne kopyalanır. Bir havuz öğesine uygulamak için sağdaki Renk sekmesini kullan.")}</div>
        {p.luts.map((l) => {
          const n = p.pool.filter((a) => a.grade.lut === l.id).length;
          return (
            <div key={l.id} className="list-item">
              <Palette size={15} />
              <div className="meta"><div>{l.name}</div><div>{tx('{n} öğede kullanılıyor', { n })}</div></div>
              <button className="ib sm" title={tx("Kaldır")} onClick={() => update((q) => {
                q.luts = q.luts.filter((x) => x.id !== l.id);
                for (const a of q.pool) if (a.grade.lut === l.id) a.grade.lut = null;
              })}><Trash2 size={13} /></button>
            </div>
          );
        })}
      </div>
    </>
  );
}

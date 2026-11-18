import { useState } from 'react';
import { tx, setLang, useLang } from '../lib/i18n';
import { ArrowLeft, Download, Moon, Redo2, Sun, Undo2, Loader } from 'lucide-react';
import { beatLength, totalDuration } from '../../../shared/project';
import { redo, undo, update, useEditor } from '../store/editor';

export function TopBar({ onHome }: { onHome: () => void }) {
  const p = useEditor((s) => s.project)!;
  const save = useEditor((s) => s.save);
  const theme = useEditor((s) => s.theme);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const pending = useEditor((s) => s.pending);
  const [name, setName] = useState<string | null>(null);
  const lang = useLang((s) => s.lang);
  const total = totalDuration(p);
  const beat = beatLength(p);
  const musicLeft = p.music ? Math.max(0, p.music.duration - p.music.offset - total) : 0;

  return (
    <header className="top">
      <button className="brand" onClick={onHome} title={tx("Projeler")} style={{ border: 0, background: 'transparent', borderRight: '1px solid var(--line)' }}>
        <ArrowLeft size={15} />
      </button>
      <input
        className="title-input"
        value={name ?? p.name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name != null && name.trim()) update((q) => { q.name = name.trim(); }); setName(null); }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="stats">
        <span><b>{total.toFixed(1)}</b>{' '}{tx("sn")}</span>
        <span><b>{p.scenes.length}</b>{' '}{tx("sahne")}</span>
        {beat > 0 && <span><b>{p.tempo.bpm}</b> BPM · {tx('vuruş')} {beat.toFixed(3)} s</span>}
        {p.music && beat > 0 && <span>{tx('müzikte kalan {n} vuruş', { n: Math.floor(musicLeft / beat) })}</span>}
        {pending > 0 && <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Loader size={12} className="spin" /> {tx('{n} proxy hazırlanıyor', { n: pending })}</span>}
      </div>
      <div className="grow" />
      <div className={'save-state ' + save}>
        <span className="dot" />
        {tx(save === 'saved' ? 'Kaydedildi' : save === 'saving' ? 'Kaydediliyor' : save === 'dirty' ? 'Değişti' : 'Kayıt hatası')}
      </div>
      <button className="ib" onClick={undo} disabled={!canUndo} title={tx("Geri al (Ctrl+Z)")}><Undo2 size={16} /></button>
      <button className="ib" onClick={redo} disabled={!canRedo} title={tx("Yinele (Ctrl+Shift+Z)")}><Redo2 size={16} /></button>
      <button className="ib" style={{ width: 'auto', padding: '0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }} title={tx('Dil')} onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}>{lang === 'tr' ? 'EN' : 'TR'}</button>
      <button className="ib" onClick={() => useEditor.setState({ theme: theme === 'dark' ? 'light' : 'dark' })} title={tx("Açık / koyu tema")}>
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button className="btn primary" onClick={() => useEditor.setState({ exporting: true, playing: false })} title={tx("Dışa aktar (Ctrl+E)")}>
        <Download size={14} />{' '}{tx("Dışa aktar")}{' '}</button>
    </header>
  );
}

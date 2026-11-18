import { useEffect, useState } from 'react';
import { tx, setLang, useLang, locale } from '../lib/i18n';
import { Plus, Moon, Sun } from 'lucide-react';
import type { ProjectSummary } from '../../../shared/types';
import { useEditor } from '../store/editor';
import { fmtTime } from './ui';

export function Home({ open }: { open: (id: string) => void }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const theme = useEditor((s) => s.theme);
  const lang = useLang((s) => s.lang);
  useEffect(() => { fetch('/api/projects').then((r) => r.json()).then(setList); }, []);

  const [name, setName] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const p = await r.json();
    open(p.id);
  };

  return (
    <div className="home">
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1>{tx("Edittor")}</h1>
          <div className="lead">{tx("Reel ve kısa kurgu editörü · projeler JSON olarak saklanır · çoklu en-boy oranı")}</div>
        </div>
        <button className="ib" style={{ width: 'auto', padding: '0 8px', fontSize: 11, fontWeight: 600 }} title={tx('Dil')} onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}>{lang === 'tr' ? 'EN' : 'TR'}</button>
        <button className="ib" onClick={() => useEditor.setState({ theme: theme === 'dark' ? 'light' : 'dark' })} title={tx("Tema")}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
      <div className="label" style={{ marginBottom: 12 }}>{tx("Projeler")}</div>
      <div className="home-grid">
        <form className="pcard new" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 10, width: '75%' }}>
            <input className="input" placeholder={tx("Yeni proje adı")} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary block" disabled={!name.trim()}><Plus size={14} />{' '}{tx("Oluştur")}</button>
          </div>
        </form>
        {list?.map((p) => (
          <button key={p.id} className="pcard" onClick={() => open(p.id)}>
            <div className="cv" style={p.cover ? { backgroundImage: `url(/media/${p.id}/${p.cover}/thumb)` } : undefined} />
            <div className="pm">
              <b>{p.name}</b>
              <span>{p.scenes} {tx('sahne')} · {fmtTime(p.duration, 1)} · {new Date(p.updatedAt).toLocaleDateString(locale())}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

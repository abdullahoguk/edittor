import { useEffect, useState } from 'react';
import { tx } from '../lib/i18n';
import { Folder, Home, ArrowUp, Film, Image as ImageIcon, Music2, FolderPlus } from 'lucide-react';
import { useEditor, localStorageSet } from '../store/editor';
import { importPaths } from '../lib/actions';
import { Modal } from './ui';

type Listing = { path: string; parent: string | null; home: string; dirs: string[]; files: { name: string; kind: string; size: number }[] };

const join = (a: string, b: string) => (a.endsWith('/') ? a + b : a + '/' + b);
const size = (n: number) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(0) + ' MB' : (n / 1e3).toFixed(0) + ' KB');

/** Server-side file browser: media is added by absolute path (not copied). */
export function FileBrowser() {
  const [path, setPath] = useState<string>(() => { try { return localStorage.getItem('edittor.lastDir') ?? ''; } catch { return ''; } });
  const [data, setData] = useState<Listing | null>(null);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const close = () => useEditor.setState({ browser: false });

  useEffect(() => {
    fetch(`/api/fs?path=${encodeURIComponent(path)}`).then(async (r) => {
      const d = await r.json();
      if (d.error) { setErr(d.error); return; }
      setErr(''); setData(d); setPicked(new Set());
      localStorageSet('edittor.lastDir', d.path);
    });
  }, [path]);

  const toggle = (name: string, e: React.MouseEvent) => {
    const n = new Set(e.ctrlKey || e.metaKey || e.shiftKey ? picked : []);
    n.has(name) ? n.delete(name) : n.add(name);
    setPicked(n);
  };
  const add = async (paths: string[]) => { setBusy(true); try { await importPaths(paths); close(); } finally { setBusy(false); } };

  return (
    <Modal title={tx("Medya ekle")} onClose={close} className="fb"
      footer={<>
        <span className="hint">{tx("Dosyalar kopyalanmaz, yollarıyla eklenir. Proxy'ler arka planda üretilir.")}</span>
        <div className="grow" />
        <button className="btn" disabled={!data || busy} onClick={() => data && add([data.path])}><FolderPlus size={14} /> {tx('Klasörün tümü')} ({data?.files.length ?? 0})</button>
        <button className="btn primary" disabled={!picked.size || busy} onClick={() => data && add([...picked].map((n) => join(data.path, n)))}>
          {busy ? tx('Ekleniyor…') : `${tx('Seçilenleri ekle')} (${picked.size})`}
        </button>
      </>}>
      <div className="modal-h" style={{ gap: 6 }}>
        <button className="ib sm" title={tx("Ev")} onClick={() => setPath(data?.home ?? '')}><Home size={14} /></button>
        <button className="ib sm" title={tx("Üst klasör")} disabled={!data?.parent} onClick={() => data?.parent && setPath(data.parent)}><ArrowUp size={14} /></button>
        <input className="input fb-path" style={{ direction: 'ltr' }} value={data?.path ?? path} onChange={(e) => setPath(e.target.value)} />
      </div>
      <div className="scroll">
        {err && <div className="hint" style={{ padding: 14, color: '#e5484d' }}>{err}</div>}
        {data?.dirs.map((d) => (
          <div key={d} className="fb-row" onDoubleClick={() => setPath(join(data.path, d))} onClick={() => setPath(join(data.path, d))}>
            <Folder size={15} color="var(--muted)" /> {d}
          </div>
        ))}
        {data?.files.map((f) => (
          <div key={f.name} className={'fb-row' + (picked.has(f.name) ? ' on' : '')} onClick={(e) => toggle(f.name, e)} onDoubleClick={() => add([join(data.path, f.name)])}>
            <input type="checkbox" checked={picked.has(f.name)} readOnly />
            {f.kind === 'video' ? <Film size={14} /> : f.kind === 'image' ? <ImageIcon size={14} /> : <Music2 size={14} />}
            {f.name}
            <span className="sz">{size(f.size)}</span>
          </div>
        ))}
        {data && !data.dirs.length && !data.files.length && <div className="hint" style={{ padding: 14 }}>{tx("Bu klasörde medya yok.")}</div>}
      </div>
    </Modal>
  );
}

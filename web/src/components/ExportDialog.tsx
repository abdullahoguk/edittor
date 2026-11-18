import { useRef, useState } from 'react';
import { tx } from '../lib/i18n';
import { Download, Square } from 'lucide-react';
import { totalDuration } from '../../../shared/project';
import { FORMATS, type FormatId } from '../../../shared/types';
import { saveNow, useEditor } from '../store/editor';
import { exportVideo, type ExportProgress } from '../engine/export';
import { Modal, Row, Seg } from './ui';

type Result = { format: FormatId; url: string; path?: string; size: number; secs: number };

export function ExportDialog() {
  const p = useEditor((s) => s.project)!;
  const [formats, setFormats] = useState<FormatId[]>([p.activeFormat]);
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState<'std' | 'high' | 'max'>('high');
  const [source, setSource] = useState<'orig' | 'proxy'>('orig');
  const [prog, setProg] = useState<(ExportProgress & { format: FormatId }) | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const close = () => { abort.current?.abort(); useEditor.setState({ exporting: false }); };
  const total = totalDuration(p);

  const run = async () => {
    setError(''); setResults([]);
    await saveNow();
    const ac = new AbortController();
    abort.current = ac;
    try {
      for (const f of formats) {
        const t0 = performance.now();
        const px = FORMATS[f].w * FORMATS[f].h * scale * scale;
        const bitrate = Math.round(px * p.fps * ({ std: 0.07, high: 0.12, max: 0.2 }[quality]));
        const res = await exportVideo(p, { format: f, scale, fps: p.fps, bitrate, source }, (x) => setProg({ ...x, format: f }), ac.signal);
        setProg((x) => x && { ...x, phase: 'ses birleştiriliyor (ffmpeg)' });
        const name = `${p.name} ${f.replace(':', 'x')} ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;
        const fd = new FormData();
        fd.append('video', res.video);
        fd.append('codec', res.codec);
        if (res.audio) fd.append('audio', res.audio);
        const r = await fetch(`/api/projects/${p.id}/exports?name=${encodeURIComponent(name)}`, { method: 'POST', body: fd });
        const out = await r.json();
        if (out.error) throw new Error(out.error);
        setResults((x) => [...x, { format: f, url: `/api/file?path=${encodeURIComponent(out.path)}`, path: out.path, size: out.size, secs: (performance.now() - t0) / 1000 }]);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { console.error(e); setError((e as Error).message); }
    } finally {
      setProg(null);
      abort.current = null;
    }
  };

  const pct = prog ? Math.round((prog.frame / prog.frames) * 100) : 0;
  return (
    <Modal title={tx("Dışa aktar")} onClose={close} className="export"
      footer={<>
        <div className="grow" />
        {prog ? <button className="btn" onClick={() => abort.current?.abort()}><Square size={12} />{' '}{tx("İptal")}</button>
          : <button className="btn primary" disabled={!formats.length || !p.scenes.length} onClick={run}><Download size={14} />{' '}{tx("MP4 oluştur")}</button>}
      </>}>
      <div className="group-b" style={{ padding: 16, gap: 12 }}>
        <Row label={tx("Formatlar")}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {p.formats.map((f) => (
              <label key={f} className="btn sm" style={{ borderColor: formats.includes(f) ? 'var(--accent)' : undefined }}>
                <input type="checkbox" checked={formats.includes(f)} onChange={(e) => setFormats(e.target.checked ? [...formats, f] : formats.filter((x) => x !== f))} />
                {f} <span className="hint">{Math.round(FORMATS[f].w * scale)}×{Math.round(FORMATS[f].h * scale)}</span>
              </label>
            ))}
          </div>
        </Row>
        <Row label={tx("Çözünürlük")}><Seg value={scale} onChange={setScale} options={[{ v: 0.5, label: '½' }, { v: 1, label: '1080p' }, { v: 2, label: '2× (4K)' }]} /></Row>
        <Row label={tx("Kalite")}><Seg value={quality} onChange={setQuality} options={[{ v: 'std', label: 'Standart' }, { v: 'high', label: 'Yüksek' }, { v: 'max', label: 'En yüksek' }]} /></Row>
        <Row label={tx("Kaynak")}><Seg value={source} onChange={setSource} options={[{ v: 'orig', label: 'Orijinal dosyalar' }, { v: 'proxy', label: 'Proxy (hızlı taslak)' }]} /></Row>
        <div className="hint">{total.toFixed(1)} s · {p.fps} fps · H.264 + AAC · {tx("Önizlemedeki aynı motorla kare kare işlenir (WebCodecs). Dosya projenin exports/ klasörüne kaydedilir.")}</div>
        {prog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', fontSize: 12 }}><span>{prog.format} · {tx(prog.phase)}</span><div className="grow" /><span>{tx('{a}/{b} kare', { a: prog.frame, b: prog.frames })} · {pct}%</span></div>
            <div className="progress"><div style={{ width: pct + '%' }} /></div>
          </div>
        )}
        {error && <div className="hint" style={{ color: '#e5484d' }}>{tx('Hata')}: {error}</div>}
        {results.map((r) => (
          <div key={r.format} className="list-item" style={{ padding: '8px 0' }}>
            <div className="meta">
              <div>{r.format} · {(r.size / 1e6).toFixed(1)} MB · {tx('{s} sn sürdü', { s: r.secs.toFixed(0) })}</div>
              <div style={{ userSelect: 'text', wordBreak: 'break-all' }}>{r.path}</div>
            </div>
            <a className="btn sm" href={r.url} download={`${p.name}-${r.format.replace(':', 'x')}.mp4`}><Download size={12} />{' '}{tx("İndir")}</a>
          </div>
        ))}
      </div>
    </Modal>
  );
}

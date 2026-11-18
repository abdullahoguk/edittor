import { useRef, useState } from 'react';
import { tx } from '../lib/i18n';
import { Wand2, Trash2, Hand } from 'lucide-react';
import { addFormat, removeFormat } from '../../../shared/project';
import { FORMATS, type FormatId } from '../../../shared/types';
import { update, useEditor } from '../store/editor';
import { detectTempo } from '../lib/actions';
import { Group, Num, Row, Slider } from './ui';

export function ProjectPanel() {
  const p = useEditor((s) => s.project)!;
  const audio = p.pool.filter((a) => a.kind === 'audio');
  const [busy, setBusy] = useState(false);
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 4) {
      const d = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const bpm = 60000 / (d.reduce((a, b) => a + b, 0) / d.length);
      update((q) => { q.tempo.bpm = +bpm.toFixed(1); }, 'tap');
    }
  };

  return (
    <div className="scroll">
      <Group title={tx("Formatlar")}>
        <div className="hint">{tx("Her format kendi yerleşimini, kadrajını ve yazı konumlarını saklar. İçerik ve zamanlama ortaktır.")}</div>
        {(Object.keys(FORMATS) as FormatId[]).map((f) => (
          <label key={f} className="row" style={{ gridTemplateColumns: '20px 1fr auto' }}>
            <input type="checkbox" checked={p.formats.includes(f)} disabled={p.formats.length === 1 && p.formats.includes(f)}
              onChange={(e) => update((q) => (e.target.checked ? addFormat(q, f) : removeFormat(q, f)))} />
            <span style={{ fontSize: 12 }}><b>{f}</b> <span className="hint">{tx(FORMATS[f].label)}</span></span>
            <span className="hint">{FORMATS[f].w}×{FORMATS[f].h}</span>
          </label>
        ))}
      </Group>
      <Group title={tx("Çıktı")}>
        <Row label={tx("FPS")}>
          <select className="input" value={p.fps} onChange={(e) => update((q) => { q.fps = +e.target.value; })}>
            {[24, 25, 30, 50, 60].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Row>
        <Row label={tx("Arka plan")}><input type="color" value={p.background} onChange={(e) => update((q) => { q.background = e.target.value; }, 'pbg')} /></Row>
        <Row label={tx("Başta açılma")}><Num value={p.fadeIn} step={0.1} min={0} onChange={(v) => update((q) => { q.fadeIn = v; })} suffix="sn" /></Row>
        <Row label={tx("Sonda kararma")}><Num value={p.fadeOut} step={0.1} min={0} onChange={(v) => update((q) => { q.fadeOut = v; })} suffix="sn" /></Row>
      </Group>
      <Group title={tx("Müzik")}>
        <Row label={tx("Parça")}>
          <select className="input" value={p.music?.path ?? ''} onChange={(e) => {
            const a = audio.find((x) => x.path === e.target.value);
            update((q) => { q.music = a ? { path: a.path, name: a.name, offset: 0, volume: 1, fadeIn: 0, fadeOut: 3, duration: a.duration } : null; });
          }}>
            <option value="">{tx("— yok —")}</option>
            {audio.map((a) => <option key={a.id} value={a.path}>{a.name}</option>)}
          </select>
          {p.music && <button className="ib sm" title={tx("Kaldır")} onClick={() => update((q) => { q.music = null; })}><Trash2 size={13} /></button>}
        </Row>
        {p.music && (
          <>
            <Row label={tx("Başlangıç")}><Num value={p.music.offset} step={0.05} min={0} max={p.music.duration} onChange={(v) => update((q) => { q.music!.offset = v; })} suffix="sn (parçada)" /></Row>
            <Slider label={tx("Ses")} value={p.music.volume} min={0} max={1} step={0.01} def={1} format={(v) => Math.round(v * 100) + '%'} onChange={(v) => update((q) => { q.music!.volume = v; }, 'mvol')} />
            <Row label={tx("Açılış")}><Num value={p.music.fadeIn} step={0.1} min={0} onChange={(v) => update((q) => { q.music!.fadeIn = v; })} suffix="sn" /></Row>
            <Row label={tx("Kapanış")}><Num value={p.music.fadeOut} step={0.1} min={0} onChange={(v) => update((q) => { q.music!.fadeOut = v; })} suffix="sn" /></Row>
            <div className="hint">{tx("Timeline'daki müzik bandını sürükleyerek de başlangıç noktasını kaydırabilirsin.")}</div>
          </>
        )}
      </Group>
      <Group title={tx("Tempo · vuruş ızgarası")}>
        <Row label={tx("BPM")}>
          <Num value={p.tempo.bpm} step={0.1} min={0} max={300} onChange={(v) => update((q) => { q.tempo.bpm = v; })} />
          <button className="btn sm" onClick={tap} title={tx("Ritme göre 4+ kez tıkla")}><Hand size={12} />{' '}{tx("Tap")}</button>
          {p.music && (
            <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); try { await detectTempo(); } finally { setBusy(false); } }}>
              <Wand2 size={12} /> {busy ? 'Analiz…' : 'Bul'}
            </button>
          )}
        </Row>
        <Row label={tx("İlk vuruş")}><Num value={p.tempo.offset} step={0.01} min={0} onChange={(v) => update((q) => { q.tempo.offset = v; })} suffix="sn (timeline)" /></Row>
        <label className="row"><span>{tx("Yapışma")}</span><div className="ctl"><input type="checkbox" checked={p.tempo.snap} onChange={(e) => update((q) => { q.tempo.snap = e.target.checked; })} /> <span className="hint">{tx("Kenarlar vuruşlara yapışır")}</span></div></label>
        {p.tempo.bpm > 0 && <div className="hint">{tx('1 vuruş = {a} s · 1 ölçü (4 vuruş) = {b} s', { a: (60 / p.tempo.bpm).toFixed(3), b: (240 / p.tempo.bpm).toFixed(2) })}</div>}
      </Group>
      <Group title={tx("Dosya")} collapsible defaultOpen={false}>
        <div className="hint" style={{ userSelect: 'text' }}>{' '}{tx("Proje:")}{' '}<code>~/EdittorProjects/{p.id}/project.json</code><br />{' '}{tx("Claude Code'dan yönetmek için:")}{' '}<code>claude mcp add edittor -- bun {'<edittor>'}/mcp/index.ts</code>
        </div>
      </Group>
    </div>
  );
}

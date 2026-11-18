import { useEffect, useRef, useState } from 'react';
import { tx, useLang } from '../lib/i18n';
import { Send, Square, RotateCcw, Wrench, Sparkles } from 'lucide-react';
import { sceneStarts } from '../../../shared/project';
import { saveNow, useEditor } from '../store/editor';

/** Tiny markdown for chat: **bold**, `code`, - bullets, headings. */
function Md({ text }: { text: string }) {
  const inline = (line: string, k: number) => line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={k + '-' + i}>{part.slice(2, -2)}</b>
      : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={k + '-' + i} className="md-code">{part.slice(1, -1)}</code>
      : part);
  return <>{text.split('\n').map((line, k) => {
    const h = /^#{1,4}\s+(.*)/.exec(line);
    if (h) return <div key={k} className="md-h">{inline(h[1], k)}</div>;
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)/.exec(line);
    if (li) return <div key={k} className="md-li">{inline(li[1], k)}</div>;
    return line.trim() ? <div key={k}>{inline(line, k)}</div> : <div key={k} className="md-gap" />;
  })}</>;
}

type Msg = { role: 'user' | 'assistant' | 'error'; text: string; tools: string[] };

const SUGGEST = [
  'Havuzdaki medyayla müziğin vuruşlarına oturan 45 saniyelik bir ilk kurgu kur',
  'Seçili sahneyi 3\'lü kolaja çevir, ortada video olsun',
  'Açılışa Swiss tarzı bir başlık ve konum yazısı ekle',
  'Tüm videolara sıcak, hafif soluk bir sonbahar görünümü ver',
  '16:9 formatını ekle ve kolajları yatay yerleşime uyarla',
];

function context() {
  const s = useEditor.getState();
  const p = s.project!;
  const i = p.scenes.findIndex((x) => x.id === s.sel.sceneId);
  const lines = [
    `active format: ${p.activeFormat}`,
    `playhead: ${s.time.toFixed(2)} s`,
    i >= 0 ? `selected scene: #${i + 1} (id ${p.scenes[i].id}, starts at ${sceneStarts(p)[i].toFixed(2)} s)` : 'selected scene: none',
  ];
  if (s.sel.cellId) lines.push(`selected panel: ${s.sel.cellId}`);
  if (s.sel.textId) lines.push(`selected text: ${s.sel.textId}`);
  if (s.poolSel.length) lines.push(`selected in pool: ${s.poolSel.join(', ')}`);
  return lines.join('\n');
}

export function ChatPanel() {
  const pid = useEditor((s) => s.project!.id);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState('');
  const [fresh, setFresh] = useState(true);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo(0, log.current.scrollHeight); }, [msgs]);
  useEffect(() => { setMsgs([]); setFresh(true); }, [pid]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput('');
    setBusy(true);
    await saveNow();
    setMsgs((m) => [...m, { role: 'user', text, tools: [] }, { role: 'assistant', text: '', tools: [] }]);
    const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => { const c = [...all]; c[c.length - 1] = fn(c[c.length - 1]); return c; });
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: pid, message: text, context: context(), model: model || undefined, reset: fresh, lang: useLang.getState().lang }),
      });
      setFresh(false);
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (!chunk.startsWith('data: ')) continue;
          const ev = JSON.parse(chunk.slice(6));
          if (ev.t === 'delta') patch((m) => ({ ...m, text: m.text + ev.text }));
          else if (ev.t === 'message') patch((m) => (m.text && !m.text.endsWith('\n\n') ? { ...m, text: m.text + '\n\n' } : m));
          else if (ev.t === 'tool') patch((m) => ({ ...m, tools: [...m.tools, ev.name] }));
          else if (ev.t === 'tool-error') patch((m) => ({ ...m, tools: [...m.tools, '⚠ ' + ev.text.slice(0, 80)] }));
          else if (ev.t === 'error' || (ev.t === 'done' && ev.error)) setMsgs((m) => [...m, { role: 'error', text: ev.text ?? ev.error, tools: [] }]);
        }
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: 'error', text: (e as Error).message, tools: [] }]);
    } finally {
      setBusy(false);
    }
  };

  const stop = () => fetch('/api/chat/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: pid }) });

  return (
    <div className="chat">
      <div className="ph">
        <Sparkles size={14} color="var(--accent)" /><h3>{tx("Claude")}</h3><span className="sub">{tx("cihazdaki claude CLI")}</span>
        <div className="grow" />
        <select className="input" style={{ width: 96, height: 24 }} value={model} onChange={(e) => setModel(e.target.value)} title={tx("Model")}>
          <option value="">{tx("varsayılan")}</option>
          <option value="sonnet">{tx("Sonnet")}</option>
          <option value="opus">{tx("Opus")}</option>
          <option value="haiku">{tx("Haiku")}</option>
        </select>
        <button className="ib sm" title={tx("Yeni sohbet")} onClick={() => { setMsgs([]); setFresh(true); }}><RotateCcw size={13} /></button>
      </div>
      <div className="chat-log" ref={log}>
        {msgs.length === 0 && (
          <>
            <div className="hint" style={{ lineHeight: 1.6 }}>{tx("Claude projeyi MCP araçlarıyla okur ve düzenler. Yaptığı her değişiklik editörde anında görünür, Ctrl+Z ile geri alabilirsin. Seçili sahne, aktif format ve oynatma kafası otomatik olarak bağlama eklenir.")}</div>
            <div className="suggest">{SUGGEST.map((s) => <button key={s} onClick={() => send(tx(s))}>{tx(s)}</button>)}</div>
          </>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'msg ' + (m.role === 'error' ? 'err' : m.role)}>
            {m.tools.length > 0 && <div>{m.tools.map((t, k) => <span key={k} className="tool-chip"><Wrench size={10} />{t}</span>)}</div>}
            {(m.role === 'assistant' && m.text.trim() ? <Md text={m.text.trim()} /> : m.text.trim()) || (m.role === 'assistant' && busy && i === msgs.length - 1 ? <span className="hint">{tx("düşünüyor…")}</span> : null)}
          </div>
        ))}
      </div>
      <div className="chat-in">
        <textarea className="input" placeholder={tx("Kurguyla ilgili bir şey iste…  (Enter gönder, Shift+Enter satır)")} value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <div className="grow" />
          {busy ? <button className="btn sm" onClick={stop}><Square size={11} />{' '}{tx("Durdur")}</button>
            : <button className="btn sm primary" onClick={() => send(input)} disabled={!input.trim()}><Send size={12} />{' '}{tx("Gönder")}</button>}
        </div>
      </div>
    </div>
  );
}

import { SlidersHorizontal, Palette, Settings2, Sparkles, MousePointerClick } from 'lucide-react';
import { tx } from '../lib/i18n';
import { useEditor, selectedScene, selectedText } from '../store/editor';
import type { RightTab } from '../store/editor';
import { SceneInspector } from './SceneInspector';
import { TextInspector } from './TextInspector';
import { ColorPanel } from './ColorPanel';
import { ProjectPanel } from './ProjectPanel';
import { ChatPanel } from './ChatPanel';

const TABS: { id: RightTab; icon: React.ReactNode; label: string }[] = [
  { id: 'inspect', icon: <SlidersHorizontal size={14} />, label: 'Özellikler' },
  { id: 'color', icon: <Palette size={14} />, label: 'Renk' },
  { id: 'project', icon: <Settings2 size={14} />, label: 'Proje' },
  { id: 'claude', icon: <Sparkles size={14} />, label: 'Claude' },
];

export function RightPanel() {
  const tab = useEditor((s) => s.rightTab);
  return (
    <aside className="right">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => useEditor.setState({ rightTab: t.id })}>{t.icon}{tx(t.label)}</button>
        ))}
      </div>
      {tab === 'inspect' && <Inspect />}
      {tab === 'color' && <ColorPanel />}
      {tab === 'project' && <ProjectPanel />}
      {/* keep the chat history when switching tabs */}
      <div style={{ display: tab === 'claude' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><ChatPanel /></div>
    </aside>
  );
}

function Inspect() {
  const p = useEditor((s) => s.project);
  const sel = useEditor((s) => s.sel);
  const text = selectedText(p, sel);
  const scene = selectedScene(p, sel);
  if (text) return <div className="scroll"><TextInspector t={text} /></div>;
  if (scene) return <div className="scroll"><SceneInspector s={scene} /></div>;
  return (
    <div className="scroll" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="hint" style={{ textAlign: 'center', maxWidth: 220, lineHeight: 1.6 }}>
        <MousePointerClick size={20} style={{ marginBottom: 8 }} /><br />{' '}{tx("Timeline'da bir sahne ya da yazı seç.")}<br />{tx("Önizlemede bir panele tıklayınca kadrajını sürükleyerek ayarlayabilirsin.")}{' '}</div>
    </div>
  );
}

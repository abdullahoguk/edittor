import { Fragment, useEffect, useState } from 'react';
import { useLang } from '../lib/i18n';
import { tx } from '../lib/i18n';
import { loadProject, localStorageSet, redo, saveNow, setTime, undo, useEditor } from '../store/editor';
import { Home } from './Home';
import { TopBar } from './TopBar';
import { Rail, LeftPanel } from './LeftPanel';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { RightPanel } from './RightPanel';
import { AssetPicker } from './AssetPicker';
import { FileBrowser } from './FileBrowser';
import { ExportDialog } from './ExportDialog';
import { addTextAt, deleteSelection, duplicateScene, moveScene, nudgeDuration, selectAdjacentScene, splitAtPlayhead } from '../lib/actions';

function useRoute() {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get('p'));
  useEffect(() => {
    const f = () => setId(new URLSearchParams(location.search).get('p'));
    window.addEventListener('popstate', f);
    return () => window.removeEventListener('popstate', f);
  }, []);
  return [id, (v: string | null) => { history.pushState(null, '', v ? `?p=${v}` : location.pathname); setId(v); }] as const;
}

export function App() {
  const [id, go] = useRoute();
  const theme = useEditor((s) => s.theme);
  const project = useEditor((s) => s.project);
  const [error, setError] = useState('');
  const lang = useLang((s) => s.lang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorageSet('edittor.theme', theme); }, [theme]);
  useEffect(() => {
    if (!id) { useEditor.setState({ project: null }); return; }
    loadProject(id).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { document.title = project ? `${project.name} — Edittor` : 'Edittor'; }, [project?.name]);
  useKeys();

  if (!id) return <Fragment key={lang}><Home open={go} /></Fragment>;
  if (error) return <div className="home"><h1>{tx("Hata")}</h1><p className="lead">{error}</p><button className="btn" onClick={() => go(null)}>{tx("Projeler")}</button></div>;
  if (!project) return null;
  return <Fragment key={lang}><Editor onHome={() => go(null)} /></Fragment>;
}

function Editor({ onHome }: { onHome: () => void }) {
  const leftOpen = useEditor((s) => s.leftTab !== null);
  const picker = useEditor((s) => s.picker);
  const browser = useEditor((s) => s.browser);
  const exporting = useEditor((s) => s.exporting);
  const [tl, setTl] = useState(() => Number(localStorage.getItem('edittor.tl')) || 300);

  const startSplit = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = tl;
    const mv = (ev: PointerEvent) => setTl(Math.max(170, Math.min(window.innerHeight - 260, h0 - (ev.clientY - y0))));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => { localStorageSet('edittor.tl', String(tl)); }, [tl]);

  return (
    <div className={'app' + (leftOpen ? '' : ' no-left')} style={{ ['--tl' as string]: tl + 'px' }}>
      <TopBar onHome={onHome} />
      <Rail />
      <LeftPanel />
      <Stage />
      <RightPanel />
      <div className="split" onPointerDown={startSplit} />
      <Timeline />
      {picker && <AssetPicker />}
      {browser && <FileBrowser />}
      {exporting && <ExportDialog />}
    </div>
  );
}

function useKeys() {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      const s = useEditor.getState();
      if (!s.project) return;
      const mod = e.ctrlKey || e.metaKey;
      const fps = s.project.fps || 30;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (s.sel.sceneId) duplicateScene(s.sel.sceneId); return; }
      if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); useEditor.setState({ exporting: true, playing: false }); return; }
      if (mod) return;
      switch (e.key) {
        case ' ': e.preventDefault(); useEditor.setState({ playing: !s.playing }); break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.altKey) moveScene(-1);
          else setTime(s.time - (e.shiftKey ? 1 : 1 / fps));
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.altKey) moveScene(1);
          else setTime(s.time + (e.shiftKey ? 1 : 1 / fps));
          break;
        case 'ArrowUp': e.preventDefault(); selectAdjacentScene(-1); break;
        case 'ArrowDown': e.preventDefault(); selectAdjacentScene(1); break;
        case 'Home': setTime(0); break;
        case 'Delete': case 'Backspace': deleteSelection(); break;
        case 's': case 'S': splitAtPlayhead(); break;
        case 't': case 'T': addTextAt(); break;
        case '+': case '=': nudgeDuration(1); break;
        case '-': case '_': nudgeDuration(-1); break;
        case 'Escape': useEditor.setState({ sel: {} }); break;
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
}

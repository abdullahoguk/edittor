import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './components/App';
import { useEditor } from './store/editor';

(window as any).edittor = useEditor; // for debugging / automation

createRoot(document.getElementById('root')!).render(<App />);

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { tx } from '../lib/i18n';

export function fmtTime(t: number, frac = 2) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(frac).padStart(frac ? 3 + frac : 2, '0')}`;
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format, def, unit = '' }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; format?: (v: number) => string; def?: number; unit?: string;
}) {
  const [txt, setTxt] = useState<string | null>(null);
  const show = format ? format(value) : (Math.abs(step) >= 1 ? value.toFixed(0) : value.toFixed(2)) + unit;
  const modified = def != null && Math.abs(value - def) > 1e-6;
  return (
    <label className="slider" onDoubleClick={() => def != null && onChange(def)} title={def != null ? tx('Çift tık: sıfırla') : undefined}>
      <span className={modified ? 'mod' : ''}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <input
        className="val"
        value={txt ?? show}
        onFocus={(e) => { setTxt(String(+value.toFixed(3))); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { if (txt != null && !isNaN(parseFloat(txt))) onChange(parseFloat(txt)); setTxt(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(null); (e.target as HTMLInputElement).blur(); } }}
      />
    </label>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="row"><span>{label}</span><div className="ctl">{children}</div></div>;
}

export function Num({ value, onChange, step = 0.1, min, max, width = 64, suffix }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; width?: number; suffix?: string;
}) {
  const [txt, setTxt] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        className="input num"
        style={{ width }}
        value={txt ?? String(+value.toFixed(3))}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { if (txt != null && !isNaN(parseFloat(txt))) onChange(clamp(parseFloat(txt))); setTxt(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(clamp(+(value + d).toFixed(4)));
            setTxt(null);
          }
          e.stopPropagation();
        }}
      />
      {suffix && <span className="hint">{tx(suffix)}</span>}
    </span>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, full }: {
  value: T; options: { v: T; label?: ReactNode; icon?: ReactNode; title?: string }[]; onChange: (v: T) => void; full?: boolean;
}) {
  return (
    <div className={'seg' + (full ? ' full' : '')}>
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)} title={o.title && tx(o.title)}>
          {o.icon}{typeof o.label === 'string' ? tx(o.label) : o.label}
        </button>
      ))}
    </div>
  );
}

export function Group({ title, tag, actions, children, collapsible = false, defaultOpen = true }: {
  title: ReactNode; tag?: ReactNode; actions?: ReactNode; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="group">
      <div className="group-h" onClick={() => collapsible && setOpen(!open)} style={{ cursor: collapsible ? 'pointer' : undefined }}>
        <div className="label">{title}{tag && <span className="tag">{tag}</span>}</div>
        {actions}
      </div>
      {open && <div className="group-b">{children}</div>}
    </section>
  );
}

export function Modal({ title, onClose, children, footer, className }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; className?: string;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal ' + (className ?? '')}>
        <div className="modal-h"><h2>{title}</h2><button className="ib sm" onClick={onClose}>✕</button></div>
        {children}
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/** Pointer drag helper. */
export function useDrag() {
  const ref = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null>(null);
  return (e: React.PointerEvent, move: (dx: number, dy: number, ev: PointerEvent) => void, up?: (moved: boolean, ev: PointerEvent) => void) => {
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      move(dx, dy, ev);
    };
    const u = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', u);
      ref.current = null;
      up?.(moved, ev);
    };
    ref.current = { move: mv, up: u };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', u);
  };
}

/** Small diagram for a panel count / layout preset. */
export function LayoutIcon({ rects, size = 30, aspect = 9 / 16 }: { rects: { x: number; y: number; w: number; h: number }[]; size?: number; aspect?: number }) {
  const W = aspect >= 1 ? size : size * aspect;
  const H = aspect >= 1 ? size / aspect : size;
  const g = 1.2;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {rects.map((r, i) => (
        <rect key={i} x={r.x * W + g / 2} y={r.y * H + g / 2} width={Math.max(0, r.w * W - g)} height={Math.max(0, r.h * H - g)} rx={1} opacity={i === 0 ? 1 : 0.6} />
      ))}
    </svg>
  );
}

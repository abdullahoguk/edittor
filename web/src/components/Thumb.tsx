import { useState } from 'react';
import { tx } from '../lib/i18n';
import { Film, Image as ImageIcon } from 'lucide-react';
import type { Asset } from '../../../shared/types';
import { mediaUrl, useEditor } from '../store/editor';
import { fmtTime } from './ui';

/** Pool thumbnail. For videos, hovering scrubs frames from the filmstrip. */
export function Thumb({ asset, selected, used, onClick, onDoubleClick, draggable = true, showName = true }: {
  asset: Asset; selected?: boolean; used?: number; onClick?: (e: React.MouseEvent) => void; onDoubleClick?: () => void; draggable?: boolean; showName?: boolean;
}) {
  const pid = useEditor((s) => s.project!.id);
  const ver = useEditor((s) => s.mediaVer[asset.id]);
  const [hover, setHover] = useState<number | null>(null);
  const [err, setErr] = useState(false);
  const N = 12;
  return (
    <div
      className={'thumb' + (selected ? ' sel' : '')}
      draggable={draggable}
      onDragStart={(e) => {
        const sel = useEditor.getState().poolSel;
        const ids = sel.includes(asset.id) ? sel : [asset.id];
        e.dataTransfer.setData('application/x-edittor-assets', JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseMove={(e) => {
        if (asset.kind !== 'video') return;
        const r = e.currentTarget.getBoundingClientRect();
        setHover(Math.max(0, Math.min(N - 1, Math.floor(((e.clientX - r.left) / r.width) * N))));
      }}
      onMouseLeave={() => setHover(null)}
      title={asset.name}
    >
      {!err ? (
        hover != null ? (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${mediaUrl(pid, asset, 'strip', ver)})`, backgroundSize: `${N * 100}% 100%`, backgroundPosition: `${(hover / (N - 1)) * 100}% 0`, backgroundColor: '#000' }} />
        ) : (
          <img src={mediaUrl(pid, asset, 'thumb', ver)} loading="lazy" onError={() => setErr(true)} onLoad={() => setErr(false)} alt="" />
        )
      ) : (
        <div className="loading">{tx("hazırlanıyor…")}</div>
      )}
      {err && ver && <img src={mediaUrl(pid, asset, 'thumb', ver)} style={{ display: 'none' }} onLoad={() => setErr(false)} alt="" />}
      {hover != null && <div className="scrub-line" style={{ left: `${((hover + 0.5) / N) * 100}%` }} />}
      <div className="badge">
        {asset.kind === 'video' ? <><Film size={10} /> {fmtTime(asset.duration, 1)}</> : <><ImageIcon size={10} /> {tx(asset.width > asset.height ? 'yatay' : asset.width < asset.height ? 'dikey' : 'kare')}</>}
      </div>
      {!!used && <div className="used" title={tx('{n} sahnede kullanılıyor', { n: used })}>{used}</div>}
      {showName && <div className="name">{asset.name}</div>}
    </div>
  );
}

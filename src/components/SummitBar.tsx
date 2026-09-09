import { useEffect } from 'react';
import type { SelectedPeak } from '../types';

interface SummitBarProps {
  peak: SelectedPeak;
  onExit: () => void;
}

/** Top bar shown while standing on a summit: where you are, and the way out
 *  (button + Esc). */
export default function SummitBar({ peak, onExit }: SummitBarProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <div className="card summit-bar">
      <button className="summit-bar__back" onClick={onExit}>
        ← Back to map
      </button>
      <div className="summit-bar__where">
        <span className="summit-bar__name">On {peak.name}</span>
        {peak.displayEle != null && (
          <span className="summit-bar__ele">
            {peak.displayEle.toLocaleString()} m
            {peak.eleSource === 'terrain' ? ' est.' : ''}
          </span>
        )}
      </div>
      <span className="summit-bar__hint">Drag to look around</span>
    </div>
  );
}

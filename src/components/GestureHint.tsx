import { useState } from 'react';

const KEY = 'kanda:hint-dismissed';

// Rotation is the primary gesture but nobody discovers right-drag on their
// own. A one-line pill, dismissible and remembered.
export default function GestureHint() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode — the hint just reappears next visit */
    }
  };

  return (
    <div className="panel hint" role="status">
      <span>Drag to pan · right-drag to look around · scroll to zoom</span>
      <button className="hint__x" onClick={close} aria-label="Dismiss hint">
        ×
      </button>
    </div>
  );
}

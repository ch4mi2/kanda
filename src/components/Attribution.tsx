import { useState } from 'react';
import { LANDCOVER_ATTRIBUTION, PEAKS_ATTRIBUTION, TERRAIN } from '../config/tiles';

export default function Attribution() {
  const [open, setOpen] = useState(false);

  return (
    <div className="panel attribution">
      <button
        className="attribution__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? 'Data sources ×' : 'ⓘ Data sources'}
      </button>
      {open && (
        <div className="attribution__body">
          <p dangerouslySetInnerHTML={{ __html: TERRAIN.attribution }} />
          <p dangerouslySetInnerHTML={{ __html: LANDCOVER_ATTRIBUTION }} />
          <p dangerouslySetInnerHTML={{ __html: PEAKS_ATTRIBUTION }} />
          <p>
            Rendered with{' '}
            <a href="https://threejs.org/" target="_blank" rel="noopener noreferrer">
              three.js
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { PEAKS_ATTRIBUTION, TERRAIN, TEXTURE } from '../config/tiles';

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
          <p dangerouslySetInnerHTML={{ __html: PEAKS_ATTRIBUTION }} />
          {TEXTURE.mode !== 'off' && (
            <p dangerouslySetInnerHTML={{ __html: TEXTURE.attribution }} />
          )}
          <p>
            Rendered with{' '}
            <a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">
              MapLibre GL JS
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}

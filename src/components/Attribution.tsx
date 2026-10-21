import { useState } from 'react';
import { PEAKS_ATTRIBUTION, TERRAIN, TEXTURE } from '../config/tiles';

interface AttributionProps {
  renderer?: 'maplibre' | 'three';
}

export default function Attribution({ renderer = 'maplibre' }: AttributionProps) {
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
            {renderer === 'three' ? (
              <a href="https://threejs.org/" target="_blank" rel="noopener noreferrer">
                three.js
              </a>
            ) : (
              <a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">
                MapLibre GL JS
              </a>
            )}
            .
          </p>
        </div>
      )}
    </div>
  );
}

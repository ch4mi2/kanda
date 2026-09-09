import type { Map as MLMap } from 'maplibre-gl';
import type { SelectedPeak } from '../types';

interface PeakCardProps {
  peak: SelectedPeak;
  map: MLMap | null;
  onClose: () => void;
  /** Enter summit view standing on this peak. */
  onStand: () => void;
}

function wikipediaUrl(wikipedia: string): string | null {
  // OSM's wikipedia tag is "lang:Title", e.g. "en:Pidurutalagala".
  const [lang, ...rest] = wikipedia.split(':');
  const title = rest.join(':').trim();
  if (!lang || !title) return null;
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export default function PeakCard({ peak, map, onClose, onStand }: PeakCardProps) {
  const wikiUrl = peak.wikipedia ? wikipediaUrl(peak.wikipedia) : null;

  const flyHere = () => {
    if (!map) return;
    map.flyTo({
      center: [peak.lng, peak.lat],
      zoom: 13,
      pitch: 72,
      bearing: map.getBearing(),
      duration: 1800,
      curve: 1.4,
    });
  };

  return (
    <div className="card peak-card">
      <button className="peak-card__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2 className="peak-card__name">{peak.name}</h2>
      {(peak.name_si || peak.name_ta) && (
        <p className="peak-card__local">
          {[peak.name_si, peak.name_ta].filter(Boolean).join(' · ')}
        </p>
      )}

      <div className="peak-card__stats">
        <div className="stat">
          <span className="stat__k">Elevation</span>
          <span className="stat__v">
            {peak.displayEle != null ? (
              <>
                {peak.displayEle.toLocaleString()}
                <small> m{peak.eleSource === 'terrain' ? ' est.' : ''}</small>
              </>
            ) : (
              'Unknown'
            )}
          </span>
        </div>
        <div className="stat">
          <span className="stat__k">Position</span>
          <span className="stat__v">
            {peak.lat.toFixed(3)}
            <small>, {peak.lng.toFixed(3)}</small>
          </span>
        </div>
      </div>

      <div className="peak-card__actions">
        <button className="btn btn--primary" onClick={onStand}>
          Stand here
        </button>
        <button className="btn btn--ghost" onClick={flyHere}>
          Fly here
        </button>
        {wikiUrl && (
          <a
            className="btn btn--ghost"
            href={wikiUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Wikipedia ↗
          </a>
        )}
      </div>
    </div>
  );
}

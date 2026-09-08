import type { Map as MLMap } from 'maplibre-gl';
import type { SelectedPeak } from '../types';

interface PeakCardProps {
  peak: SelectedPeak;
  map: MLMap | null;
  onClose: () => void;
}

function wikipediaUrl(wikipedia: string): string | null {
  // OSM's wikipedia tag is "lang:Title", e.g. "en:Pidurutalagala".
  const [lang, ...rest] = wikipedia.split(':');
  const title = rest.join(':').trim();
  if (!lang || !title) return null;
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export default function PeakCard({ peak, map, onClose }: PeakCardProps) {
  const wikiUrl = peak.wikipedia ? wikipediaUrl(peak.wikipedia) : null;

  const flyHere = () => {
    if (!map) return;
    map.flyTo({
      center: [peak.lng, peak.lat],
      zoom: 13.5,
      pitch: 72,
      bearing: map.getBearing(),
      duration: 1800,
      curve: 1.4,
    });
  };

  return (
    <div className="peak-card">
      <button className="peak-card__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2 className="peak-card__name">{peak.name}</h2>
      {(peak.name_si || peak.name_ta) && (
        <p className="peak-card__local-names">
          {[peak.name_si, peak.name_ta].filter(Boolean).join(' · ')}
        </p>
      )}
      <dl className="peak-card__facts">
        <dt>Elevation</dt>
        <dd>
          {peak.displayEle != null ? (
            <>
              {peak.displayEle.toLocaleString()} m
              {peak.eleSource === 'terrain' && (
                <span className="peak-card__est"> (estimated from terrain)</span>
              )}
            </>
          ) : (
            'Unknown'
          )}
        </dd>
        <dt>Coordinates</dt>
        <dd>
          {peak.lat.toFixed(4)}, {peak.lng.toFixed(4)}
        </dd>
      </dl>
      <div className="peak-card__actions">
        <button className="peak-card__fly" onClick={flyHere}>
          Fly here
        </button>
        {wikiUrl && (
          <a className="peak-card__wiki" href={wikiUrl} target="_blank" rel="noopener noreferrer">
            Wikipedia ↗
          </a>
        )}
      </div>
    </div>
  );
}

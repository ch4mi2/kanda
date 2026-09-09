import { useMemo } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import {
  initialBearingDeg,
  nearbyPeaks,
  type NearbyPeak,
  type PeakFeature,
} from '../map/nearbyPeaks';
import type { SelectedPeak } from '../types';

interface NearbyPeaksProps {
  origin: SelectedPeak;
  peaks: PeakFeature[];
  /** Active filter-chip floor — hide summits below it from the list too. */
  elevationFloor: number;
  map: MLMap | null;
  /** Make the tapped peak the new origin (its own nearby list, etc.). */
  onPick: (peak: NearbyPeak) => void;
}

export default function NearbyPeaks({
  origin,
  peaks,
  elevationFloor,
  map,
  onPick,
}: NearbyPeaksProps) {
  const list = useMemo(
    () =>
      nearbyPeaks([origin.lng, origin.lat], peaks, origin.id).filter(
        (np) => (np.peak.ele ?? 0) >= elevationFloor,
      ),
    [origin.lng, origin.lat, origin.id, peaks, elevationFloor],
  );

  if (peaks.length === 0) return null;

  const handleClick = (np: NearbyPeak) => {
    if (map) {
      // Turn the camera to look from the current viewpoint towards the peak.
      const c = map.getCenter();
      map.easeTo({
        bearing: initialBearingDeg([c.lng, c.lat], [np.lng, np.lat]),
        duration: 700,
      });
    }
    onPick(np);
  };

  return (
    <div className="panel nearby">
      <h3 className="nearby__title">
        {list.length ? `Around ${origin.name}` : 'Nothing named within 25 km'}
      </h3>
      <ul className="nearby__list">
        {list.map((np) => (
          <li key={np.peak.id}>
            <button className="nearby__item" onClick={() => handleClick(np)}>
              <span className="nearby__name">{np.peak.name}</span>
              {np.peak.ele != null && (
                <span className="nearby__ele">{np.peak.ele.toLocaleString()} m</span>
              )}
              <span className="nearby__meta">
                <span className="nearby__dir">{np.compass}</span> ·{' '}
                {np.distanceKm.toFixed(1)} km
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

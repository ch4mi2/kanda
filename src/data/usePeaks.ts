import { useEffect, useState } from 'react';
import peaksUrl from './peaks.geojson?url';
import type { PeakFeature } from '../map/nearbyPeaks';

/**
 * Loads the committed peaks GeoJSON once. It's the same file the map layer
 * uses; here we need the parsed features for the nearby-peaks maths.
 */
export function usePeaks(): PeakFeature[] {
  const [features, setFeatures] = useState<PeakFeature[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(peaksUrl)
      .then((r) => r.json())
      .then((data: { features: PeakFeature[] }) => {
        if (!cancelled) setFeatures(data.features);
      })
      .catch(() => {
        /* offline-first: the map still works without the nearby list */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return features;
}

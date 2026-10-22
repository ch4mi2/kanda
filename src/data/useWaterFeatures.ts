import { useEffect, useState } from 'react';
import waterUrl from './water.geojson?url';
import riversUrl from './rivers.geojson?url';
import type { RiverFeature, WaterFeature } from '../map/water';

/**
 * Loads the committed water + river GeoJSON once (src/data/water.geojson,
 * src/data/rivers.geojson) - same offline-first pattern as usePeaks.ts.
 */
export function useWaterFeatures(): { water: WaterFeature[]; rivers: RiverFeature[] } {
  const [water, setWater] = useState<WaterFeature[]>([]);
  const [rivers, setRivers] = useState<RiverFeature[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(waterUrl).then((r) => r.json() as Promise<{ features: WaterFeature[] }>),
      fetch(riversUrl).then((r) => r.json() as Promise<{ features: RiverFeature[] }>),
    ])
      .then(([w, r]) => {
        if (cancelled) return;
        setWater(w.features);
        setRivers(r.features);
      })
      .catch(() => {
        /* offline-first: the map still works without the water overlay */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { water, rivers };
}

import { useEffect, useState } from 'react';
import waterUrl from './water.geojson?url';
import riversUrl from './rivers.geojson?url';
import waterfallsUrl from './waterfalls.geojson?url';
import parksUrl from './parks.geojson?url';
import type { RiverFeature, WaterFeature } from '../map/water';
import type { WaterfallFeature } from '../map/waterfalls';
import type { ParkFeature } from '../map/parks';

interface WaterFeatures {
  water: WaterFeature[];
  rivers: RiverFeature[];
  waterfalls: WaterfallFeature[];
  parks: ParkFeature[];
}

/**
 * Loads the committed water + river + waterfall + park GeoJSON once
 * (src/data/water.geojson, rivers.geojson, waterfalls.geojson, parks.geojson)
 * - same offline-first pattern as usePeaks.ts.
 */
export function useWaterFeatures(): WaterFeatures {
  const [water, setWater] = useState<WaterFeature[]>([]);
  const [rivers, setRivers] = useState<RiverFeature[]>([]);
  const [waterfalls, setWaterfalls] = useState<WaterfallFeature[]>([]);
  const [parks, setParks] = useState<ParkFeature[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(waterUrl).then((r) => r.json() as Promise<{ features: WaterFeature[] }>),
      fetch(riversUrl).then((r) => r.json() as Promise<{ features: RiverFeature[] }>),
      fetch(waterfallsUrl).then((r) => r.json() as Promise<{ features: WaterfallFeature[] }>),
      fetch(parksUrl).then((r) => r.json() as Promise<{ features: ParkFeature[] }>),
    ])
      .then(([w, r, wf, p]) => {
        if (cancelled) return;
        setWater(w.features);
        setRivers(r.features);
        setWaterfalls(wf.features);
        setParks(p.features);
      })
      .catch(() => {
        /* offline-first: the map still works without these overlays */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { water, rivers, waterfalls, parks };
}

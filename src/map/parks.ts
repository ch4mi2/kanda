// Pure helpers over the committed park/protected-area GeoJSON
// (src/data/parks.geojson). Outline geometry projection lives in
// engine/props/parks.ts; this file is the CPU point-in-polygon test the peak
// card uses to show "in X National Park".

export interface ParkFeature {
  properties: { name: string | null; kind: string; ha: number };
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
}

/** Ray-casting point-in-polygon test, done directly in lng/lat - a
 *  topological test, so no scene-space projection is needed. */
function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi === yj) continue;
    if (lat < Math.min(yi, yj) || lat >= Math.max(yi, yj)) continue;
    const xCross = xi + ((lat - yi) / (yj - yi)) * (xj - xi);
    if (lng < xCross) inside = !inside;
  }
  return inside;
}

/** The named park/protected area a point falls inside, preferring the
 *  smallest match (e.g. a strict nature reserve nested inside a larger
 *  national park) so the peak card names the most specific place. */
export function findContainingPark(lng: number, lat: number, parks: ParkFeature[]): ParkFeature | null {
  let best: ParkFeature | null = null;
  for (const f of parks) {
    if (!f.properties.name) continue;
    if (!pointInRing(lng, lat, f.geometry.coordinates[0])) continue;
    if (!best || f.properties.ha < best.properties.ha) best = f;
  }
  return best;
}

// Scene space: kilometres, +x east, +z SOUTH (Web-Mercator y grows south, so
// tiles and rasters index the same way), +y up. Origin at DEFAULT_CENTER.
// Mercator is pre-scaled by cos(lat0) so one scene unit is ~1 km on the ground
// anywhere on the island.

import { DEFAULT_CENTER } from '../config/tiles';

const [LNG0, LAT0] = DEFAULT_CENTER;
const EARTH_CIRC_KM = 40075.016686;
export const KM_PER_MERC = EARTH_CIRC_KM * Math.cos((LAT0 * Math.PI) / 180);

const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const MX0 = mercX(LNG0);
const MY0 = mercY(LAT0);

export function lngLatToScene(lng: number, lat: number): { x: number; z: number } {
  return { x: (mercX(lng) - MX0) * KM_PER_MERC, z: (mercY(lat) - MY0) * KM_PER_MERC };
}

export function sceneToLngLat(x: number, z: number): [number, number] {
  const mx = x / KM_PER_MERC + MX0;
  const my = z / KM_PER_MERC + MY0;
  const lng = mx * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
  return [lng, lat];
}

/** Scene-space footprint of XYZ tile (z, x, y): west/north corner + edge length. */
export function tileFootprint(z: number, x: number, y: number) {
  const n = 2 ** z;
  return {
    x0: (x / n - MX0) * KM_PER_MERC,
    z0: (y / n - MY0) * KM_PER_MERC,
    size: KM_PER_MERC / n,
  };
}

/** Fractional XYZ tile coordinate of a scene point at zoom z. */
export function sceneToTileXY(x: number, z: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  return [(x / KM_PER_MERC + MX0) * n, (z / KM_PER_MERC + MY0) * n];
}

/** Compass bearing (deg, clockwise from north, -180..180) of a scene-plane vector. */
export function bearingOf(dx: number, dz: number): number {
  return (Math.atan2(dx, -dz) * 180) / Math.PI;
}

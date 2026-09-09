import type { PeakProperties } from '../types';

export interface PeakFeature {
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: PeakProperties;
}

export interface NearbyPeak {
  peak: PeakProperties;
  lng: number;
  lat: number;
  /** Great-circle distance from the origin, kilometres. */
  distanceKm: number;
  /** Initial compass bearing from the origin, degrees clockwise from north. */
  bearingDeg: number;
  /** 16-point compass label for bearingDeg, e.g. "NNE". */
  compass: string;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(
  [lng1, lat1]: [number, number],
  [lng2, lat2]: [number, number],
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (forward azimuth) from point 1 to point 2, in degrees
 *  clockwise from true north, normalised to [0, 360). */
export function initialBearingDeg(
  [lng1, lat1]: [number, number],
  [lng2, lat2]: [number, number],
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * The point `distanceKm` away from `origin` along the great circle heading
 * `bearingDeg` (clockwise from north). Used by summit view to place the
 * camera's look-at target ~40 km out along the current heading.
 */
export function destinationPoint(
  [lng, lat]: [number, number],
  distanceKm: number,
  bearingDeg: number,
): [number, number] {
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);
  const sinφ2 =
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return [((toDeg(λ2) + 540) % 360) - 180, toDeg(φ2)];
}

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

export function compassLabel(bearingDeg: number): string {
  return COMPASS_16[Math.round(bearingDeg / 22.5) % 16];
}

export interface NearbyOptions {
  /** Only include peaks within this many km. */
  radiusKm?: number;
  /** Cap the list at this many peaks (nearest first). */
  limit?: number;
}

/**
 * Named peaks around an origin point, nearest first. Pure function of the
 * committed GeoJSON — no network, works offline.
 *
 * The radius/limit defaults keep the list to peaks a person on the summit
 * would plausibly recognise; without them a highland origin returns dozens
 * of unnamed bumps.
 */
export function nearbyPeaks(
  origin: [number, number],
  features: PeakFeature[],
  originId: number | null,
  { radiusKm = 25, limit = 8 }: NearbyOptions = {},
): NearbyPeak[] {
  const out: NearbyPeak[] = [];
  for (const f of features) {
    if (f.properties.id === originId) continue;
    const coords = f.geometry.coordinates;
    const distanceKm = haversineKm(origin, coords);
    if (distanceKm > radiusKm) continue;
    const bearingDeg = initialBearingDeg(origin, coords);
    out.push({
      peak: f.properties,
      lng: coords[0],
      lat: coords[1],
      distanceKm,
      bearingDeg,
      compass: compassLabel(bearingDeg),
    });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out.slice(0, limit);
}

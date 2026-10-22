// Pure helpers over the committed water/river GeoJSON (src/data/water.geojson,
// src/data/rivers.geojson) - label anchor points only. Line geometry for the
// drawn river ribbons lives in engine/props/rivers.ts; this file is the CPU
// maths shared by the labels layer. Name is historical (nearbyPeaks.ts).

import { lngLatToScene, sceneToLngLat } from '../engine/geo';

export interface WaterFeature {
  properties: { name: string | null; kind: string; ha: number };
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
}

export interface RiverFeature {
  properties: { name: string | null };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

/** Area-weighted centroid of a polygon's exterior ring (shoelace formula, in
 *  scene km so it's a proper local projection, not a degree-space average
 *  that would skew for an elongated reservoir). Falls back to the plain
 *  vertex average for a degenerate (near-zero-area) ring. */
export function waterLabelAnchor(feature: WaterFeature): [number, number] {
  const ring = feature.geometry.coordinates[0];
  const pts = ring.map(([lng, lat]) => lngLatToScene(lng, lat));
  let area2 = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const { x: x0, z: z0 } = pts[i];
    const { x: x1, z: z1 } = pts[i + 1];
    const cross = x0 * z1 - x1 * z0;
    area2 += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  if (Math.abs(area2) < 1e-9) {
    const n = pts.length;
    const ax = pts.reduce((s, p) => s + p.x, 0) / n;
    const az = pts.reduce((s, p) => s + p.z, 0) / n;
    return sceneToLngLat(ax, az);
  }
  const k = 3 * area2;
  return sceneToLngLat(cx / k, cz / k);
}

/** One label anchor per river: a point partway along the line (so a short
 *  stub at the very end doesn't get picked) plus a second point nearby for
 *  the on-screen tangent, both in lng/lat. */
export function riverLabelAnchor(feature: RiverFeature): { anchor: [number, number]; tangent: [number, number] } {
  const coords = feature.geometry.coordinates;
  const pts = coords.map(([lng, lat]) => lngLatToScene(lng, lat));
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    segLens.push(d);
    total += d;
  }
  const target = total * 0.5;
  let along = 0;
  let idx = 0;
  for (; idx < segLens.length; idx++) {
    if (along + segLens[idx] >= target || idx === segLens.length - 1) break;
    along += segLens[idx];
  }
  const segLen = segLens[idx] || 1;
  const t = segLens[idx] ? (target - along) / segLen : 0;
  const a = pts[idx];
  const b = pts[Math.min(idx + 1, pts.length - 1)];
  const ax = a.x + (b.x - a.x) * t;
  const az = a.z + (b.z - a.z) * t;
  return { anchor: sceneToLngLat(ax, az), tangent: sceneToLngLat(b.x, b.z) };
}

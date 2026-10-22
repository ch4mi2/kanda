// Shared bbox/path constants and the polygon rasteriser + box blur that
// scripts/generate-masks.mjs and scripts/generate-landcover.mjs both reuse.
//
// This used to also hold the Phase 6 diffuse-texture bake (world-space noise,
// an indexed-PNG palette, a DEM sampler, tile/single-image bakers) — all dead
// since that bake was superseded, and removed here while fixing a dangling
// reference to the forest.geojson path this file no longer needs (forest
// moved to landcover.png, see generate-landcover.mjs and CLAUDE.md).

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
// Reservoirs and tanks — masked OUT of the bake. Their surface sits at ~440 m
// (SRTM captured the drowned valley / water surface as land), so the h<=1 sea
// guard misses them and the compositor would paint grain + canopy across the
// whole reservoir footprint. The `water` fill layer hides most of it in the
// app, but its simplified geometry leaks texture at every shoreline.
export const WATER = path.join(ROOT, 'src/data/water.geojson');

// KEEP IN SYNC with src/config/tiles.ts (SRI_LANKA_BBOX). This is a plain
// .mjs and can't import the TS config — same manual-sync deal as BBOX in
// fetch-terrain.mjs.
export const SRI_LANKA_BBOX = [79.5, 5.7, 82.0, 10.0];

// --- polygon rasteriser (scanline fill; even-odd so holes work) -------
// `toPx(lon)` / `toPy(lat)` project a coordinate into raster pixel space.
// Used for the water (lake edge/depth) raster.
export function rasterizePolygons(features, W, H, toPx, toPy) {
  const mask = new Uint8Array(W * H);
  for (const f of features) {
    const polys =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates
      : [];
    for (const poly of polys) {
      const edges = [];
      let minY = Infinity;
      let maxY = -Infinity;
      let anyInside = false;
      for (const ring of poly) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const x1 = toPx(ring[i][0]);
          const y1 = toPy(ring[i][1]);
          const x2 = toPx(ring[i + 1][0]);
          const y2 = toPy(ring[i + 1][1]);
          if (y1 === y2) continue;
          if (x1 > -W && x1 < 2 * W && y1 > -H && y1 < 2 * H) anyInside = true;
          edges.push([x1, y1, x2, y2]);
          if (y1 < minY) minY = y1;
          if (y2 < minY) minY = y2;
          if (y1 > maxY) maxY = y1;
          if (y2 > maxY) maxY = y2;
        }
      }
      if (!edges.length || !anyInside) continue;
      const yStart = Math.max(0, Math.floor(minY));
      const yEnd = Math.min(H - 1, Math.ceil(maxY));
      for (let py = yStart; py <= yEnd; py++) {
        const yc = py + 0.5;
        const xs = [];
        for (const [ax, ay, bx, by] of edges) {
          if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
            xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
          }
        }
        if (xs.length < 2) continue;
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const px0 = Math.max(0, Math.ceil(xs[k] - 0.5));
          const px1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
          for (let px = px0; px <= px1; px++) mask[py * W + px] = 255;
        }
      }
    }
  }
  return mask;
}

/** Separable box blur — softens a mask edge (lake shoreline, water depth
 *  falloff). Writes into `out` if given (e.g. a SharedArrayBuffer view), else
 *  allocates. */
export function blurMask(mask, W, H, r, out) {
  const tmp = new Uint8Array(W * H);
  out = out || new Uint8Array(W * H);
  const win = r * 2 + 1;
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += mask[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc / win;
      const add = mask[y * W + Math.min(W - 1, x + r + 1)];
      const sub = mask[y * W + Math.max(0, x - r)];
      acc += add - sub;
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / win;
      const add = tmp[Math.min(H - 1, y + r + 1) * W + x];
      const sub = tmp[Math.max(0, y - r) * W + x];
      acc += add - sub;
    }
  }
  return out;
}

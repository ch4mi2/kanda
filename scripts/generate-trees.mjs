#!/usr/bin/env node
// Scatters point "trees" inside the OSM forest blocks and writes a committed
// src/data/trees.geojson. The map draws these as little billboard sprites so
// wooded hillsides read as wooded — decoration over the Phase 5 legibility
// work, same offline-first committed-data pattern as peaks / water / contours.
//
//   node scripts/generate-trees.mjs   (npm run generate:trees)
//
// Deterministic: a fixed PRNG seed so re-runs don't churn the diff.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const FOREST = path.join(HERE, '../src/data/forest.geojson');
const OUT = path.join(HERE, '../src/data/trees.geojson');

// ~500 m grid at this latitude, jittered — dense enough to read as forest from
// a hillside, sparse enough that the whole file stays small and island view
// (where the layer is hidden anyway) wouldn't choke.
// Denser and smaller than the first pass: individually-legible lollipop trees
// read as objects (and MapLibre billboards are constant *screen* size, so
// distant ones looked as big as near ones). A tighter scatter of small sprites
// reads as canopy texture instead, which is what the reference art does.
const GRID_DEG = 0.004;
const JITTER = 0.8; // fraction of a cell
const KEEP = 0.75; // random thin
const MAX_TREES = 11000;

// Mulberry32 — tiny deterministic PRNG.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(0x5f3a21);

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** A polygon is [outerRing, ...holes]. */
function pointInPolygon(x, y, poly) {
  if (!pointInRing(x, y, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) {
    if (pointInRing(x, y, poly[h])) return false;
  }
  return true;
}

function polygonsOf(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

const forest = JSON.parse(await readFile(FOREST, 'utf8'));
const features = [];

for (const f of forest.features) {
  for (const poly of polygonsOf(f.geometry)) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    for (let gx = minX; gx <= maxX; gx += GRID_DEG) {
      for (let gy = minY; gy <= maxY; gy += GRID_DEG) {
        if (rand() > KEEP) continue;
        const x = gx + (rand() - 0.5) * GRID_DEG * JITTER;
        const y = gy + (rand() - 0.5) * GRID_DEG * JITTER;
        if (!pointInPolygon(x, y, poly)) continue;
        features.push({
          type: 'Feature',
          // `s`: per-tree size jitter (0.8–1.2) for a less stamped look.
          properties: { s: Math.round((0.8 + rand() * 0.4) * 100) / 100 },
          geometry: {
            type: 'Point',
            coordinates: [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4],
          },
        });
      }
    }
  }
}

// Even thinning if we overshot the cap.
let kept = features;
if (features.length > MAX_TREES) {
  const step = features.length / MAX_TREES;
  kept = [];
  for (let i = 0; i < features.length; i += step) kept.push(features[Math.floor(i)]);
}

await writeFile(
  OUT,
  JSON.stringify({ type: 'FeatureCollection', features: kept }) + '\n',
);
console.log(`trees.geojson: ${kept.length} points from ${forest.features.length} forest blocks`);

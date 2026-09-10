// Bake worker for scripts/generate-texture.mjs --tiles. The parent builds the
// shared forest + water rasters once (handed over in SharedArrayBuffers) and
// the batch list, then feeds this worker one batch at a time. A batch is every
// tile at one zoom under one ancestor cell, plus that cell's geographic bbox
// for the DEM. The worker owns a small LRU DEM cache and does its own deflate;
// it posts back { x, y, png } (png null = canonical empty tile).
//
// The bake is a pure function of world position + fixed seeds, so the number
// of workers and the batch split must not change a single output byte — the
// driver asserts that against the single-threaded tree.

import { parentPort, workerData } from 'node:worker_threads';
import { bakeTile, buildDem, rasterSamplerFrom } from './lib/texture-core.mjs';

const { forestSab, waterSab, rasterW, rasterH } = workerData;
const forestSample = rasterSamplerFrom({
  W: rasterW,
  H: rasterH,
  data: new Uint8Array(forestSab),
});
const waterSample = rasterSamplerFrom({
  W: rasterW,
  H: rasterH,
  data: new Uint8Array(waterSab),
});

// LRU DEM cache keyed by ancestor cell. Consecutive same-cell batches (e.g.
// z13 then z14 of one highland cell) reuse the ~16-tile decoded DEM.
const DEM_LRU = 8;
const demCache = new Map();
async function demFor(key, bbox) {
  const hit = demCache.get(key);
  if (hit) {
    demCache.delete(key);
    demCache.set(key, hit);
    return hit;
  }
  let dem;
  try {
    dem = await buildDem(bbox, { quiet: true, strict: false });
  } catch {
    dem = null;
  }
  if (!dem || !dem.loaded) {
    dem = { height: () => NaN, slopeAspect: () => ({ slopeDeg: 0, aspect: 0 }) };
  }
  demCache.set(key, dem);
  if (demCache.size > DEM_LRU) demCache.delete(demCache.keys().next().value);
  return dem;
}

parentPort.on('message', async (batch) => {
  if (batch === null) {
    process.exit(0);
    return;
  }
  const { cellKey, cellBbox, z, tiles } = batch;
  const dem = await demFor(cellKey, cellBbox);
  const out = [];
  for (const { x, y } of tiles) {
    const png = bakeTile({ z, x, y }, dem, forestSample, waterSample);
    out.push({ x, y, png });
  }
  // No transfer list: `png` buffers are freshly allocated per tile, but the
  // structured-clone copy of a few thousand ~10 KB buffers is cheap next to
  // the bake, and transferring would be a footgun if a shared buffer ever
  // slipped through.
  parentPort.postMessage({ batchId: batch.batchId, z, tiles: out });
});

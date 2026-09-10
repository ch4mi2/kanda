#!/usr/bin/env node
// Bakes a *diffuse detail texture* for the terrain — canopy mottle, rock
// striation, open-ground grain — that the map drapes over the mesh.
//
//   node scripts/generate-texture.mjs --tiles            (npm run generate:texture)
//   node scripts/generate-texture.mjs --tiles --only-z 10,11,12
//   node scripts/generate-texture.mjs --tiles --only-bbox 80.6,7.2,81.0,7.6
//   node scripts/generate-texture.mjs --single --bbox 80.62,7.24,81.02,7.58 --size 2048
//
// Why this exists
// ---------------
// MapLibre's `color-relief` paints one flat colour per elevation band and
// nothing else — no surface detail. Reference art (Sketchfab terrain renders)
// gets its richness from a diffuse texture map draped on the mesh, which for
// them is satellite/landcover imagery. Kanda can't use imagery (licensed,
// non-redistributable, multi-GB — it would end keyless + offline), so we bake
// our own from data we already have: the local DEM (slope/aspect/elevation),
// forest.geojson, and value-noise fbm.
//
// The output is an *overlay*: alpha is near zero where there's nothing
// interesting to say, so the Skin's elevation ramp still shows through. It
// sits above color-relief and below the hillshade passes.
//
// Phase 6: the noise is a pure function of REF_Z=20 world-mercator pixels with
// band-limited octaves, so tiles at different zooms are low-passes of one
// continuous field and cannot seam. Slope/aspect are central-differenced at a
// fixed ~38 m DEM-texel offset. Output is an indexed PNG against a shared
// 256-entry palette. The pure bake core lives in lib/texture-core.mjs; this
// file is the CLI + the worker-pool driver.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { tileXToLon, tileYToLat, tilesForBbox } from './lib/tilemath.mjs';
import {
  TEXTURE_REGIONS,
  TILE_OUT_DIR,
  bakeSingle,
  buildForestRaster,
  buildWaterRaster,
  emptyTilePng,
  rasterDims,
} from './lib/texture-core.mjs';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const OUT_DIR = path.join(HERE, '../public/textures');
const MANIFEST = path.join(HERE, '../src/data/textures.json');
const WORKER = path.join(HERE, 'texture-worker.mjs');

// Named single-image regions for --single iteration.
const REGIONS = {
  knuckles: { bbox: [80.62, 7.24, 81.02, 7.58], size: 2048 },
  highlands: { bbox: [80.2, 6.45, 81.35, 7.75], size: 4096 },
};

const clampi = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const bboxesIntersect = (a, b) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const tileBbox = (z, x, y) => [
  tileXToLon(x, z),
  tileYToLat(y + 1, z),
  tileXToLon(x + 1, z),
  tileYToLat(y, z),
];

// --- batch planning ----------------------------------------------------
// One batch = every tile at one zoom under one ancestor cell. The ancestor
// level is z-2, clamped to [8, 11]: keeps batches at a few dozen..a few
// hundred tiles across z10-14 so 8 workers stay fed, and keeps each batch's
// DEM footprint to ~16 z12 tiles.
function planBatches(opts) {
  const batches = [];
  for (const region of TEXTURE_REGIONS) {
    for (let z = region.minzoom; z <= region.maxzoom; z++) {
      if (opts.onlyZ && !opts.onlyZ.has(z)) continue;
      if (opts.onlyBbox && !bboxesIntersect(region.bbox, opts.onlyBbox)) continue;

      const Lb = clampi(z - 2, 8, 11);
      const shift = z - Lb;
      const cells = new Map(); // "cx/cy" -> { cellKey, cellBbox, tiles: [] }
      for (const t of tilesForBbox(region.bbox, z)) {
        const tb = tileBbox(z, t.x, t.y);
        if (opts.onlyBbox && !bboxesIntersect(tb, opts.onlyBbox)) continue;
        const cx = t.x >> shift;
        const cy = t.y >> shift;
        const k = `${cx}/${cy}`;
        let cell = cells.get(k);
        if (!cell) {
          cell = {
            cellKey: `${Lb}/${k}`,
            cellBbox: [
              tileXToLon(cx, Lb),
              tileYToLat(cy + 1, Lb),
              tileXToLon(cx + 1, Lb),
              tileYToLat(cy, Lb),
            ],
            tiles: [],
          };
          cells.set(k, cell);
        }
        cell.tiles.push({ x: t.x, y: t.y });
      }
      for (const cell of cells.values()) batches.push({ z, ...cell });
    }
  }
  // Heaviest zooms first — longest-processing-time-first keeps the tail short.
  batches.sort((a, b) => b.z - a.z || b.tiles.length - a.tiles.length);
  batches.forEach((b, i) => (b.batchId = i));
  return batches;
}

// --- worker pool -----------------------------------------------------
function runWorkerPool(batches, workerFile, workerData, n, onResult) {
  return new Promise((resolve, reject) => {
    let next = 0;
    let inFlight = 0;
    let settled = false;
    const workers = [];
    const fail = (err) => {
      if (settled) return;
      settled = true;
      workers.forEach((w) => w.terminate());
      reject(err);
    };
    const pump = (w) => {
      if (settled) return;
      if (next >= batches.length) {
        if (inFlight === 0) {
          settled = true;
          Promise.all(workers.map((x) => x.terminate())).then(() => resolve());
        }
        return;
      }
      inFlight++;
      w.postMessage(batches[next++]);
    };
    for (let i = 0; i < n; i++) {
      const w = new Worker(workerFile, { workerData });
      workers.push(w);
      w.on('message', (msg) => {
        inFlight--;
        Promise.resolve(onResult(msg)).then(
          () => pump(w),
          fail,
        );
      });
      w.on('error', fail);
      pump(w);
    }
  });
}

async function bakeTilesParallel(opts) {
  const start = Date.now();
  const nWorkers = opts.workers ?? Math.max(1, availableParallelism() - 1);

  // Shared forest + water rasters: build once, hand the workers SAB views.
  const { W: rW, H: rH } = rasterDims();
  const forestSab = new SharedArrayBuffer(rW * rH);
  const waterSab = new SharedArrayBuffer(rW * rH);
  console.log(`landcover rasters ${rW}x${rH} x2 (${(2 * rW * rH / 1e6).toFixed(1)} MB shared), rasterising…`);
  await Promise.all([
    buildForestRaster(new Uint8Array(forestSab)),
    buildWaterRaster(new Uint8Array(waterSab)),
  ]);

  const batches = planBatches(opts);
  const totalTiles = batches.reduce((a, b) => a + b.tiles.length, 0);
  console.log(`${batches.length} batches, ${totalTiles} tiles, ${nWorkers} workers`);

  const emptyPng = emptyTilePng();
  const madeDirs = new Set();
  const perZoom = new Map();
  let written = 0;
  let empty = 0;
  let bytes = 0;
  let lastLog = Date.now();

  async function onResult({ z, tiles }) {
    let zs = perZoom.get(z);
    if (!zs) perZoom.set(z, (zs = { n: 0, empty: 0, bytes: 0 }));
    for (const { x, y, png } of tiles) {
      const dir = path.join(TILE_OUT_DIR, String(z), String(x));
      if (!madeDirs.has(dir)) {
        await mkdir(dir, { recursive: true });
        madeDirs.add(dir);
      }
      const buf = png ?? emptyPng;
      await writeFile(path.join(dir, `${y}.png`), buf);
      written++;
      zs.n++;
      zs.bytes += buf.length;
      bytes += buf.length;
      if (!png) {
        empty++;
        zs.empty++;
      }
    }
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log(`  ${written}/${totalTiles} tiles (${(bytes / 1e6).toFixed(1)} MB)`);
    }
  }

  await runWorkerPool(
    batches,
    WORKER,
    { forestSab, waterSab, rasterW: rW, rasterH: rH },
    nWorkers,
    onResult,
  );

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${written} tiles in ${secs}s — ${(bytes / 1e6).toFixed(1)} MB, ${empty} empty`);
  for (const [z, v] of [...perZoom].sort((a, b) => a[0] - b[0])) {
    const ne = v.n - v.empty;
    const neBytes = v.bytes - v.empty * emptyPng.length;
    console.log(
      `  z${z}: ${v.n} tiles (${v.empty} empty), ${(v.bytes / 1e6).toFixed(2)} MB` +
        (ne ? `, ${(neBytes / ne).toFixed(0)} B/non-empty-tile` : ''),
    );
  }
}

// --- CLI ------------------------------------------------------------
function parseArgs(argv) {
  const opts = { flags: new Set(), pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--single' || a === '--tiles') opts.flags.add(a.slice(2));
    else if (a === '--bbox') opts.bbox = argv[++i].split(',').map(Number);
    else if (a === '--size') opts.size = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--workers') opts.workers = Number(argv[++i]);
    else if (a === '--only-z') opts.onlyZ = new Set(argv[++i].split(',').map(Number));
    else if (a === '--only-bbox') opts.onlyBbox = argv[++i].split(',').map(Number);
    else if (!a.startsWith('-')) opts.pos.push(a);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.flags.has('tiles')) {
    await bakeTilesParallel(opts);
    return;
  }

  if (opts.flags.has('single') || opts.bbox) {
    const bbox = opts.bbox ?? REGIONS.knuckles.bbox;
    const size = opts.size ?? 2048;
    const out = opts.out
      ? path.resolve(opts.out)
      : path.join(OUT_DIR, '_single.png'); // gitignored scratch — no manifest
    console.log('\nsingle: baking one image');
    await bakeSingle({ bbox, size }, out, { writeFile, mkdir });
    return;
  }

  // Named region(s): writes public/textures/<id>.png + merges the manifest,
  // matching the historical interface the `image` source in buildStyle.ts
  // still reads. Phase 6 step 6 removes this path with the prototype.
  const ids = opts.pos.length ? opts.pos : ['knuckles'];
  const baked = [];
  for (const id of ids) {
    if (!REGIONS[id]) {
      throw new Error(`Unknown region "${id}". Have: ${Object.keys(REGIONS).join(', ')}`);
    }
    console.log(`\n${id}:`);
    const outPath = path.join(OUT_DIR, `${id}.png`);
    const { corners } = await bakeSingle(REGIONS[id], outPath, { writeFile, mkdir });
    baked.push({ id, image: `textures/${id}.png`, coordinates: corners });
  }

  let existing = { regions: [] };
  try {
    existing = JSON.parse(await readFile(MANIFEST, 'utf8'));
  } catch {
    /* first run */
  }
  const byId = new Map((existing.regions ?? []).map((r) => [r.id, r]));
  for (const r of baked) byId.set(r.id, r);
  await writeFile(MANIFEST, JSON.stringify({ regions: [...byId.values()] }, null, 2) + '\n');
  console.log(`\nmanifest: src/data/textures.json (${byId.size} region(s))`);
}

main().catch((err) => {
  console.error('generate-texture failed:', err);
  process.exitCode = 1;
});

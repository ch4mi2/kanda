#!/usr/bin/env node
// Downloads the full z0-12 Terrarium elevation tile pyramid for Sri Lanka
// from the AWS Open Data bucket (no auth, no key) into public/tiles/terrain/,
// making the app fully self-contained and offline-capable.
//
// Resumable: existing files are skipped, so re-running after an interruption
// only fetches what's missing. Run with:
//   node scripts/fetch-terrain.mjs
// Then set VITE_TILE_MODE=local (see .env.local.example) to use the local
// copy instead of the network.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tilesForBbox } from './lib/tilemath.mjs';

const SOURCE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const MIN_ZOOM = 0;
const MAX_ZOOM = 12; // matches TERRAIN.maxzoom in src/config/tiles.ts
const CONCURRENCY = 8;

// [west, south, east, north] — same bbox as SRI_LANKA_BBOX in
// src/config/tiles.ts, kept in sync manually since this is a plain script.
const BBOX = [79.5, 5.7, 82.0, 10.0];

const OUT_DIR = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../public/tiles/terrain',
);

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchTile({ z, x, y }) {
  const url = SOURCE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const destDir = path.join(OUT_DIR, String(z), String(x));
  const destFile = path.join(destDir, `${y}.png`);

  if (await fileExists(destFile)) {
    return { status: 'skipped' };
  }

  const res = await fetch(url);
  if (res.status === 404) {
    // Some ocean-only tiles genuinely don't exist upstream; not fatal.
    return { status: 'missing' };
  }
  if (!res.ok) {
    return { status: 'error', error: `${res.status} ${res.statusText}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(destDir, { recursive: true });
  await writeFile(destFile, buf);
  return { status: 'downloaded', bytes: buf.length };
}

async function runPool(items, worker, concurrency) {
  const results = { downloaded: 0, skipped: 0, missing: 0, error: 0, bytes: 0 };
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      const r = await worker(items[idx]);
      results[r.status] = (results[r.status] ?? 0) + 1;
      if (r.bytes) results.bytes += r.bytes;
      if (r.status === 'error') {
        console.warn(`  error on tile ${JSON.stringify(items[idx])}: ${r.error}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return results;
}

async function main() {
  let allTiles = [];
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    allTiles = allTiles.concat(tilesForBbox(BBOX, z));
  }
  console.log(`Fetching ${allTiles.length} terrain tiles (z${MIN_ZOOM}-z${MAX_ZOOM}) into ${OUT_DIR}`);
  console.log(`Concurrency: ${CONCURRENCY}. Existing files are skipped (resumable).`);

  const start = Date.now();
  const results = await runPool(allTiles, fetchTile, CONCURRENCY);
  const secs = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\nDone in', secs, 'seconds.');
  console.log(
    `  downloaded: ${results.downloaded} (${(results.bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  console.log(`  already had: ${results.skipped}`);
  console.log(`  missing upstream (ocean/no data): ${results.missing}`);
  console.log(`  errors: ${results.error}`);
  if (results.error > 0) {
    console.log('\nRe-run this script to retry failed tiles.');
  }
  console.log('\nSet VITE_TILE_MODE=local in .env.local and restart the dev server to use these tiles.');
}

main().catch((err) => {
  console.error('fetch-terrain failed:', err);
  process.exitCode = 1;
});

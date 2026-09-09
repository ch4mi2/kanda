#!/usr/bin/env node
// Downloads MapLibre glyph PBF ranges into public/fonts/ so the map's peak
// labels render without a network call to demotiles.maplibre.org (CLAUDE.md
// gotcha #3 — the last hard network dependency breaking offline).
//
// Source: github.com/maplibre/demotiles (gh-pages). These are the exact same
// PBF files the app was streaming from demotiles.maplibre.org/font/, so this
// is a byte-for-byte drop-in — buildStyle.ts just points `glyphs` at the
// local copy instead.
//
// Only Latin + punctuation ranges: the map labels are romanised peak names
// and " m". Sinhala/Tamil names live in the PeakCard (HTML + web font), not
// on the map. If local names are ever added to map labels, add the Sinhala
// (3328-3583) and Tamil (2816-3071) ranges here and a Noto Sans Sinhala/Tamil
// stack alongside.
//
//   node scripts/fetch-glyphs.mjs

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = 'https://raw.githubusercontent.com/maplibre/demotiles/gh-pages/font';
const STACKS = ['Noto Sans Regular', 'Noto Sans Bold'];
const RANGES = ['0-255', '256-511', '7680-7935', '8192-8447'];

const OUT_DIR = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../public/fonts',
);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let downloaded = 0;
  let skipped = 0;
  for (const stack of STACKS) {
    const dir = path.join(OUT_DIR, stack);
    await mkdir(dir, { recursive: true });
    for (const range of RANGES) {
      const dest = path.join(dir, `${range}.pbf`);
      if (await exists(dest)) {
        skipped++;
        continue;
      }
      const url = `${BASE}/${encodeURIComponent(stack)}/${range}.pbf`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`  ${res.status} ${res.statusText} for ${url}`);
        process.exitCode = 1;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      console.log(`  ${stack}/${range}.pbf  (${buf.length} B)`);
      downloaded++;
    }
  }
  console.log(`\nDone. ${downloaded} downloaded, ${skipped} already present.`);
  console.log(`Glyphs in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('fetch-glyphs failed:', err);
  process.exitCode = 1;
});

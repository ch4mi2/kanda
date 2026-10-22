#!/usr/bin/env node
// Aggregates ESA WorldCover 2021 (v200, 10 m) land-cover classes into
// fractional coverage over the same z10 grid as src/data/masks.png, and
// writes src/data/landcover.png (RGBA):
//
//   R  tree-cover fraction   (class 10 tree cover, + 95 mangroves)
//   G  shrub + moss fraction (class 20 shrubland, + 100 moss/lichen)
//   B  built-up fraction     (class 50)
//   A  open-ground fraction  (class 30 grassland, 40 cropland, 60 bare/sparse,
//                             90 herbaceous wetland)
//
// Classes 70 (snow/ice — never occurs here) and 80 (permanent water) count
// toward a cell's total sampled pixels but own no channel: that area reads as
// "none of the above" (tree/shrub/built/open fractions summing to < 1),
// which is correct — water.geojson already owns the water look.
//
// Source: s3://esa-worldcover (eu-central-1, unsigned/anonymous), map version
// v200, 2021 epoch. Tiles are 3x3 degree COGs named
// ESA_WorldCover_10m_2021_v200_<N|S><lat2><E|W><lon3>_Map.tif, lower-left
// corner, single "Map" band, values 0 (nodata) / 10..100 (see above).
//
// The island bbox needs the six 3-degree cells it overlaps (lat 3/6/9 x
// lon 78/81); one (N03E081, open ocean SE of the island) isn't published.
// Streamed in row strips straight off S3 — geotiff.js windowed reads over
// HTTP range requests, so only the island-overlapping slice of each COG is
// ever fetched or decoded. The full 10 m raster over the island is on the
// order of a billion pixels and must never be materialised at once.
//
//   node scripts/generate-landcover.mjs      (npm run generate:landcover)

import { writeFile } from 'node:fs/promises';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fromUrl } from 'geotiff';
import { lonToMercX, latToMercY, TILE_SIZE } from './lib/tilemath.mjs';
import { SRI_LANKA_BBOX } from './lib/texture-core.mjs';

const OUT = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'src/data/landcover.png');
const RASTER_Z = 10; // same grid as generate-masks.mjs (masks.png)

const BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map';
const STRIP_ROWS = 512; // source rows per windowed read (~14 MB/strip at full tile width)

// class code -> output channel; classes with no entry (0 nodata, 70 snow/ice,
// 80 permanent water) are skipped (0) or counted-only (1).
const CHANNEL = { 10: 2, 95: 2, 20: 3, 100: 3, 50: 4, 30: 5, 40: 5, 60: 5, 90: 5 };
const CLASS_LUT = (() => {
  const lut = new Uint8Array(256); // 0 skip, 1 count-only, 2 R, 3 G, 4 B, 5 A
  for (let c = 10; c <= 100; c += 10) lut[c] = CHANNEL[c] ?? 1;
  lut[95] = CHANNEL[95];
  lut[0] = 0;
  return lut;
})();

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Every 3x3 degree WorldCover cell (lower-left corner) that SRI_LANKA_BBOX overlaps.
function tileKeysForBbox([w, s, e, n]) {
  const keys = [];
  for (let lat = Math.floor(s / 3) * 3; lat < n; lat += 3) {
    for (let lon = Math.floor(w / 3) * 3; lon < e; lon += 3) {
      const latTag = (lat >= 0 ? 'N' : 'S') + String(Math.abs(lat)).padStart(2, '0');
      const lonTag = (lon >= 0 ? 'E' : 'W') + String(Math.abs(lon)).padStart(3, '0');
      keys.push(`${latTag}${lonTag}`);
    }
  }
  return keys;
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}
function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  const [bw, bs, be, bn] = SRI_LANKA_BBOX;
  const mx0 = lonToMercX(bw, RASTER_Z);
  const mx1 = lonToMercX(be, RASTER_Z);
  const my0 = latToMercY(bn, RASTER_Z);
  const my1 = latToMercY(bs, RASTER_Z);
  const W = Math.round((mx1 - mx0) * TILE_SIZE);
  const H = Math.round((my1 - my0) * TILE_SIZE);
  const toCol = (lon) => Math.floor(((lonToMercX(lon, RASTER_Z) - mx0) / (mx1 - mx0)) * W);
  const toRow = (lat) => Math.floor(((latToMercY(lat, RASTER_Z) - my0) / (my1 - my0)) * H);
  console.log(`landcover grid ${W}x${H} (z${RASTER_Z}, matches masks.png)`);

  const total = new Uint32Array(W * H);
  const rCount = new Uint32Array(W * H);
  const gCount = new Uint32Array(W * H);
  const bCount = new Uint32Array(W * H);
  const aCount = new Uint32Array(W * H);

  const keys = tileKeysForBbox(SRI_LANKA_BBOX);
  console.log(`candidate WorldCover cells: ${keys.join(', ')}`);

  for (const key of keys) {
    const url = `${BASE}/ESA_WorldCover_10m_2021_v200_${key}_Map.tif`;
    let tiff;
    try {
      tiff = await fromUrl(url);
    } catch (err) {
      console.log(`  ${key}: not reachable (${err.message}), skipping`);
      continue;
    }
    const image = await tiff.getImage();
    const [west, south, east, north] = image.getBoundingBox();
    const width = image.getWidth();
    const height = image.getHeight();
    const resX = (east - west) / width;
    const resY = (north - south) / height;

    const ix0 = Math.max(west, bw);
    const ix1 = Math.min(east, be);
    const iy0 = Math.max(south, bs);
    const iy1 = Math.min(north, bn);
    if (ix0 >= ix1 || iy0 >= iy1) {
      console.log(`  ${key}: no overlap with the island bbox, skipping`);
      continue;
    }

    const px0 = clamp(Math.floor((ix0 - west) / resX), 0, width - 1);
    const px1 = clamp(Math.ceil((ix1 - west) / resX), 1, width);
    const py0 = clamp(Math.floor((north - iy1) / resY), 0, height - 1);
    const py1 = clamp(Math.ceil((north - iy0) / resY), 1, height);
    const stripW = px1 - px0;
    console.log(`  ${key}: streaming ${stripW}x${py1 - py0} px of the ${width}x${height} COG`);

    // Column -> output-grid-column is linear in longitude; precompute once per
    // tile instead of per pixel (row -> output row needs the mercator log/tan,
    // computed once per source row below — still far cheaper than per pixel).
    const colForRx = new Int32Array(stripW);
    for (let rx = 0; rx < stripW; rx++) colForRx[rx] = toCol(west + (px0 + rx + 0.5) * resX);

    for (let y = py0; y < py1; y += STRIP_ROWS) {
      const y1 = Math.min(py1, y + STRIP_ROWS);
      const [band] = await image.readRasters({ window: [px0, y, px1, y1] });
      for (let ry = 0; ry < y1 - y; ry++) {
        const lat = north - (y + ry + 0.5) * resY;
        const row = toRow(lat);
        if (row < 0 || row >= H) continue;
        const rowBase = row * W;
        const srcBase = ry * stripW;
        for (let rx = 0; rx < stripW; rx++) {
          const code = CLASS_LUT[band[srcBase + rx]];
          if (code === 0) continue;
          const col = colForRx[rx];
          if (col < 0 || col >= W) continue;
          const cell = rowBase + col;
          total[cell]++;
          if (code === 2) rCount[cell]++;
          else if (code === 3) gCount[cell]++;
          else if (code === 4) bCount[cell]++;
          else if (code === 5) aCount[cell]++;
        }
      }
      if ((y - py0) % (STRIP_ROWS * 16) === 0) {
        console.log(`    ${key}: ${Math.round((100 * (y - py0)) / (py1 - py0))}%`);
      }
    }
  }

  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const t = total[i];
    if (t === 0) continue; // no coverage (open ocean beyond the data) — stays 0,0,0,0
    rgba[i * 4] = Math.round((rCount[i] / t) * 255);
    rgba[i * 4 + 1] = Math.round((gCount[i] / t) * 255);
    rgba[i * 4 + 2] = Math.round((bCount[i] / t) * 255);
    rgba[i * 4 + 3] = Math.round((aCount[i] / t) * 255);
  }

  const png = encodeRgbaPng(W, H, rgba);
  await writeFile(OUT, png);
  console.log(`wrote src/data/landcover.png (${(png.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error('generate-landcover failed:', err);
  process.exitCode = 1;
});

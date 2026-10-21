#!/usr/bin/env node
// Bakes the landcover masks the three.js terrain shader samples into one RGB
// image over the island bbox (Web-Mercator, z10 ~150 m/px — same grid as
// water-depth.png so the two line up):
//
//   R  forest canopy      (forest.geojson, lightly blurred)
//   G  inland water       (water.geojson, tight edge — the shoreline)
//   B  distance-from-shore proxy for water depth (wide blur of the same mask;
//      SRTM saw the full reservoirs so there is no real bathymetry inland)
//
//   node scripts/generate-masks.mjs      (npm run generate:masks)
//
// Skins own the colours; this file only says *where* things are. Output is
// committed (src/data/masks.png) — pure function of the two geojson files.

import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lonToMercX, latToMercY, TILE_SIZE } from './lib/tilemath.mjs';
import { FOREST, WATER, SRI_LANKA_BBOX, rasterizePolygons, blurMask } from './lib/texture-core.mjs';

const OUT = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'src/data/masks.png');
const RASTER_Z = 10;
const DEPTH_PASSES = 8;
const DEPTH_R = 6;

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}
function encodeRgbPng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  const [w, s, e, n] = SRI_LANKA_BBOX;
  const mx0 = lonToMercX(w, RASTER_Z);
  const mx1 = lonToMercX(e, RASTER_Z);
  const my0 = latToMercY(n, RASTER_Z);
  const my1 = latToMercY(s, RASTER_Z);
  const W = Math.round((mx1 - mx0) * TILE_SIZE);
  const H = Math.round((my1 - my0) * TILE_SIZE);
  const toPx = (lon) => ((lonToMercX(lon, RASTER_Z) - mx0) / (mx1 - mx0)) * W;
  const toPy = (lat) => ((latToMercY(lat, RASTER_Z) - my0) / (my1 - my0)) * H;
  console.log(`masks ${W}x${H} (z${RASTER_Z})`);

  const forest = blurMask(
    rasterizePolygons(JSON.parse(await readFile(FOREST, 'utf8')).features, W, H, toPx, toPy),
    W, H, 2,
  );
  const waterRaw = rasterizePolygons(JSON.parse(await readFile(WATER, 'utf8')).features, W, H, toPx, toPy);
  const edge = blurMask(waterRaw, W, H, 1);
  let depth = waterRaw;
  for (let i = 0; i < DEPTH_PASSES; i++) depth = blurMask(depth, W, H, DEPTH_R);

  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = forest[i];
    rgb[i * 3 + 1] = edge[i];
    rgb[i * 3 + 2] = Math.min(255, depth[i] * 1.8); // 0.55 of the field = "deep"
  }
  const png = encodeRgbPng(W, H, rgb);
  await writeFile(OUT, png);
  console.log(`wrote src/data/masks.png (${(png.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error('generate-masks failed:', err);
  process.exitCode = 1;
});

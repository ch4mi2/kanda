#!/usr/bin/env node
// Pre-renders a depth-shaded surface for every inland water body (reservoirs,
// tanks) into one RGBA image the map drapes over the `water` fill.
//
//   node scripts/generate-water-depth.mjs      (npm run generate:water-depth)
//
// Why this exists
// ---------------
// MapLibre's sea grades by depth (Skin.shore, a `color-relief` ramp on negative
// elevations). Inland water has no such treatment — it's one flat `lake` fill —
// and once the surrounding land carries the Phase-6 texture, a flat reservoir
// reads as a plastic cut-out (the same critique that drove the sea ramp,
// CLAUDE.md gotcha #13).
//
// maplibre-gl 6 has no `raster-color` (value -> colour ramp on a raster), so we
// can't ramp a depth field at runtime — we bake the ramp into pixels here. The
// DEM is no help: SRTM (2000) saw the full reservoirs, so the "depth" under
// them is just the flat water surface. Instead we use distance-from-shore as a
// depth proxy: rasterise water.geojson, then iterate a box blur — the field is
// ~0 at the shoreline and rises toward 1 in open water. That drives a
// turquoise-shallows -> deep-blue ramp plus a gentle large-scale mottle.
//
// Output is committed (src/data/water-depth.png, ~a few hundred KB — water is a
// small fraction of the island and the rest is transparent). Built in mercator
// pixel space so the `image` source corners line up (same projection as the
// forest/water rasters in texture-core).
//
// Deterministic — pure function of the geometry + a fixed noise seed.

import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lonToMercX, latToMercY, TILE_SIZE } from './lib/tilemath.mjs';
import { WATER, SRI_LANKA_BBOX, rasterizePolygons, blurMask } from './lib/texture-core.mjs';

const OUT = path.resolve(
  fileURLToPath(new URL('..', import.meta.url)),
  'src/data/water-depth.png',
);

const RASTER_Z = 10; // ~150 m/px — a depth gradient needs no more
const DEPTH_PASSES = 8;
const DEPTH_R = 6; // per pass; ~8*6 px ≈ 1.5 km reach at z10 -> the ramp
const DEEP_AT = 0.55; // blurred-field value that counts as fully "deep"

// Ramp: bright turquoise at the shore -> deeper, cooler blue in open water.
// Mid-ramp lands near the old flat `lake` (#79c1d3) so a reservoir still reads
// as the same body of water, just with dimension. Not skin-driven (same as the
// texture canopy colours) — tune here.
const SHALLOW = [165, 216, 226];
const DEEP = [72, 138, 166];
const MAX_ALPHA = 235; // near-opaque; the raster layer's opacity finishes it
const MOTTLE = 0.1; // ± fraction of the ramp the coarse noise wanders
const QUANT = 6; // posterise colour + alpha to multiples of this (compression)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep01 = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => Math.round(a + (b - a) * t);

// Tiny value noise for the surface mottle (independent of texture-core's).
function hash2(x, y, seed) {
  let h =
    Math.imul(x | 0, 374761393) +
    Math.imul(y | 0, 668265263) +
    Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smoothstep01(x - xi);
  const v = smoothstep01(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// --- minimal RGBA PNG encoder (filter 0) ------------------------------
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
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
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    PNG_SIG,
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

  console.log(`water-depth ${W}x${H} (z${RASTER_Z}), rasterising water…`);
  const water = JSON.parse(await readFile(WATER, 'utf8'));
  const mask = rasterizePolygons(water.features, W, H, toPx, toPy); // 0 / 255
  // Two fields from the one mask: a tight one drives alpha (so the tint hugs
  // the shoreline and barely spills onto the textured land), a wide one drives
  // the depth ramp (so it keeps deepening toward open water).
  const edge = blurMask(mask, W, H, 1);
  let depth = mask;
  for (let i = 0; i < DEPTH_PASSES; i++) depth = blurMask(depth, W, H, DEPTH_R);

  console.log('  shading…');
  const q = (v) => Math.min(255, Math.round(v / QUANT) * QUANT);
  const rgba = Buffer.alloc(W * H * 4);
  let waterPx = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = edge[i] / 255;
      if (e < 0.03) continue; // land — stays transparent
      waterPx++;
      const d = depth[i] / 255;
      let t = clamp01(Math.pow(clamp01(d / DEEP_AT), 0.7));
      t = clamp01(t + (valueNoise(x / 9, y / 9, 7) - 0.5) * MOTTLE);
      const o = i * 4;
      rgba[o] = q(mix(SHALLOW[0], DEEP[0], t));
      rgba[o + 1] = q(mix(SHALLOW[1], DEEP[1], t));
      rgba[o + 2] = q(mix(SHALLOW[2], DEEP[2], t));
      // opaque just inside the shore, feathered over ~1 blur radius outside it
      rgba[o + 3] = q(clamp01((e - 0.25) / 0.45) * MAX_ALPHA);
    }
  }

  const png = encodeRgbaPng(W, H, rgba);
  await writeFile(OUT, png);
  console.log(
    `  ${(100 * waterPx / (W * H)).toFixed(1)}% water — wrote src/data/water-depth.png (${(png.length / 1024).toFixed(0)} KB)`,
  );
}

main().catch((err) => {
  console.error('generate-water-depth failed:', err);
  process.exitCode = 1;
});

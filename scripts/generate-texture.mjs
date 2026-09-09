#!/usr/bin/env node
// Bakes a *diffuse detail texture* for the terrain and writes it as PNG the
// map drapes over the mesh — canopy mottle, rock striation, open-ground grain.
//
//   node scripts/generate-texture.mjs knuckles      (npm run generate:texture)
//   node scripts/generate-texture.mjs --single --bbox 80.62,7.24,81.02,7.58 --size 2048
//
// Why this exists
// ---------------
// MapLibre's `color-relief` paints one flat colour per elevation band and
// nothing else — no surface detail. Reference art (Sketchfab terrain renders)
// gets its richness from a diffuse texture map draped on the mesh, which for
// them is satellite/landcover imagery. Kanda can't use imagery (licensed,
// non-redistributable, multi-GB — it would end keyless + offline), so we bake
// our own from data we already have:
//
//   * the local DEM   -> slope, aspect, elevation (bilinear, z12)
//   * forest.geojson  -> where canopy texture goes
//   * value-noise fbm -> the high-frequency detail
//
// The output is an *overlay*, not a replacement: alpha is near zero where
// there's nothing interesting to say, so the Skin's elevation ramp still
// shows through. It sits above color-relief and below the hillshade passes.
//
// Phase 6: the noise is now a pure function of REF_Z=20 world-mercator pixels
// (not image/tile pixel coords) with band-limited octaves, so tiles at
// different zooms are low-passes of one continuous field and cannot seam.
// Slope/aspect are central-differenced at a fixed ~38 m DEM-texel offset, not
// from adjacent output pixels, so the 38 m DEM grid can't print through the
// rock mask. Output is an indexed PNG against a shared 256-entry palette —
// 3-5x smaller than RGBA, and identical-looking tiles hash-dedup in PMTiles.
//
// Deterministic — pure function of world position + fixed seeds.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  TILE_SIZE,
  lonToMercX as lonToX,
  latToMercY as latToY,
  lonToRefPx,
  latToRefPy,
  refPxPerScreenPx,
} from './lib/tilemath.mjs';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const TILE_DIR = path.join(HERE, '../public/tiles/terrain');
const FOREST = path.join(HERE, '../src/data/forest.geojson');
const OUT_DIR = path.join(HERE, '../public/textures');
const MANIFEST = path.join(HERE, '../src/data/textures.json');

const SAMPLE_Z = 12; // DEM ceiling — see CLAUDE.md
const DEM_TEXEL_M = 38; // ~1 z12 texel at this latitude; the slope/aspect step

// Named single-image regions. `knuckles` is the prototype window: dramatic
// relief, big forest blocks, the peaks the app's founding story names.
const REGIONS = {
  knuckles: { bbox: [80.62, 7.24, 81.02, 7.58], size: 2048 },
  highlands: { bbox: [80.2, 6.45, 81.35, 7.75], size: 4096 },
};

// ---- texture palette anchors ---------------------------------------------
// Prototype-era values, mirroring Skin.foliage / the upper elevation bands.
// If this graduates they should come from the Skin. Each material is a
// dark->light luminance ramp; the composited alpha says how much shows.
const CANOPY_DARK = [20, 62, 38];
const CANOPY_LIGHT = [96, 158, 92];
const ROCK_DARK = [54, 47, 40];
const ROCK_LIGHT = [156, 145, 128];
// Neutral pair for open-ground grain — only luminance moves, no hue, or the
// Skin's elevation ramp would desaturate across the whole map. Soft, not
// black/white: a hard flip at high frequency reads as TV static once
// composited (CLAUDE.md gotcha #14).
const GRAIN_DARK = [44, 42, 34];
const GRAIN_LIGHT = [232, 226, 208];

// Slope (deg) over which ground grades into bare rock. Rock stays a minority
// material: Sri Lanka's highlands are forest and grassland with crags, not the
// Alps. At 13/31 the Knuckles came out uniformly brown (almost every pixel is
// steep).
const ROCK_SLOPE_LO = 26;
const ROCK_SLOPE_HI = 45;
// Above this the ground goes stony even where it isn't especially steep — a
// light touch; these summits are grassland (Horton Plains), not scree.
const SCREE_ELE = 1900;
// Ceiling on any one pixel's alpha — the ramp underneath must read through.
const MAX_ALPHA = 0.66;

// Per-material alpha envelopes (pre-clamp; the compositor mixes between them).
const GRAIN_ALPHA_MAX = 0.16;
const CANOPY_ALPHA_LO = 0.3;
const CANOPY_ALPHA_HI = 0.56;
const ROCK_ALPHA_LO = 0.14;
const ROCK_ALPHA_HI = 0.42;

// --- PNG codec (same minimal one as repair-dem.mjs / generate-contours.mjs) -
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
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePng(buf) {
  let pos = 8;
  let W = 0;
  let H = 0;
  let ch = 3;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      W = body.readUInt32BE(0);
      H = body.readUInt32BE(4);
      ch = body[9] === 6 ? 4 : body[9] === 2 ? 3 : 1;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = W * ch;
  const data = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? data[dst + x - ch] : 0;
      const b = y > 0 ? data[dst - stride + x] : 0;
      const c = x >= ch && y > 0 ? data[dst - stride + x - ch] : 0;
      const v = raw[src + x];
      data[dst + x] =
        filter === 0 ? v
        : filter === 1 ? (v + a) & 0xff
        : filter === 2 ? (v + b) & 0xff
        : filter === 3 ? (v + ((a + b) >> 1)) & 0xff
        : (v + paeth(a, b, c)) & 0xff;
    }
  }
  return { W, H, ch, data };
}
function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/**
 * Indexed (colour-type 3) PNG. `indices` is one byte per pixel; `palette` is
 * up to 256 `[r,g,b,a]`. Filter type 0 (None) on every row — Sub/Paeth on
 * palette *indices* is meaningless and measurably worse. Chunk order is
 * IHDR -> PLTE -> tRNS -> IDAT -> IEND.
 */
function encodeIndexedPng({ width, height, indices, palette }) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const dst = y * (width + 1);
    raw[dst] = 0;
    indices.copy(raw, dst + 1, y * width, y * width + width);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3; // indexed colour
  const plte = Buffer.alloc(palette.length * 3);
  const trns = Buffer.alloc(palette.length);
  palette.forEach(([r, g, b, a], i) => {
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
    trns[i] = a;
  });
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- shared palette -------------------------------------------------------
// index 0                fully transparent ("nothing here")
// 1..64    grain    8 luminance x 8 alpha
// 65..128  canopy   8 luminance x 8 alpha
// 129..192 rock     8 luminance x 8 alpha
// 193..255 canopy<->rock blend, 9 blend steps x 7 luminance (63 entries)
//
// Identical in every tile, so tiles that composite to the same picture encode
// byte-identically and SHA-1-dedup in the archive. Alpha is quantised to 8
// levels over 0..MAX_ALPHA — the continuous per-pixel alpha is the single
// biggest reason the old RGBA output was incompressible.
const LUM_STEPS = 8;
const ALPHA_STEPS = 8;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mixc = (a, b, t) => a + (b - a) * t;
const mixrgb = (d, l, t) => [
  Math.round(mixc(d[0], l[0], t)),
  Math.round(mixc(d[1], l[1], t)),
  Math.round(mixc(d[2], l[2], t)),
];
const alphaByte = (aIdx) => Math.round(((aIdx + 1) / ALPHA_STEPS) * MAX_ALPHA * 255);

const BLEND_STEPS = 9;
const BLEND_LUM = 7;

function buildPalette() {
  const palette = [[0, 0, 0, 0]];
  for (const [dark, light] of [
    [GRAIN_DARK, GRAIN_LIGHT],
    [CANOPY_DARK, CANOPY_LIGHT],
    [ROCK_DARK, ROCK_LIGHT],
  ]) {
    for (let l = 0; l < LUM_STEPS; l++) {
      const [r, g, b] = mixrgb(dark, light, l / (LUM_STEPS - 1));
      for (let a = 0; a < ALPHA_STEPS; a++) palette.push([r, g, b, alphaByte(a)]);
    }
  }
  // canopy<->rock blend spares
  for (let bl = 0; bl < BLEND_STEPS; bl++) {
    const rockFrac = (bl + 1) / (BLEND_STEPS + 1);
    for (let l = 0; l < BLEND_LUM; l++) {
      const t = l / (BLEND_LUM - 1);
      const canopy = mixrgb(CANOPY_DARK, CANOPY_LIGHT, t);
      const rock = mixrgb(ROCK_DARK, ROCK_LIGHT, t);
      palette.push([
        ...mixrgb(canopy, rock, rockFrac),
        alphaByte(4), // representative mid alpha
      ]);
    }
  }
  while (palette.length < 256) palette.push([0, 0, 0, 0]);
  return palette;
}

const PALETTE = buildPalette();
// Premultiplied palette for nearest-match on blend pixels only.
const PAL_PM = PALETTE.map(([r, g, b, a]) => {
  const af = a / 255;
  return [r * af, g * af, b * af, a];
});

const matBase = (mat) => 1 + mat * LUM_STEPS * ALPHA_STEPS; // grain 0 / canopy 1 / rock 2
// `dither` is a per-pixel [-0.5, 0.5) value applied at ~1 bucket amplitude
// before rounding, so posterised luminance/alpha bands break up into noise
// instead of showing hard block edges — far cheaper than doubling LUM_STEPS.
function quantIdx(mat, lumT, alpha, dither = 0) {
  const aByte = clamp01(alpha / MAX_ALPHA) + dither / ALPHA_STEPS;
  if (aByte < 0.5 / ALPHA_STEPS) return 0; // rounds to transparent
  const aIdx = Math.max(0, Math.min(ALPHA_STEPS - 1, Math.round(aByte * ALPHA_STEPS - 1)));
  const lIdx = Math.max(
    0,
    Math.min(LUM_STEPS - 1, Math.round(clamp01(lumT) * (LUM_STEPS - 1) + dither)),
  );
  return matBase(mat) + lIdx * ALPHA_STEPS + aIdx;
}
/** Nearest palette entry to a composited RGBA (premultiplied distance). Only
 *  used where two materials genuinely overlap — pure pixels hit quantIdx. */
function nearestIdx(r, g, b, a) {
  const af = a / 255;
  const rp = r * af;
  const gp = g * af;
  const bp = b * af;
  let best = 0;
  let bestD = Infinity;
  for (let i = 1; i < 256; i++) {
    const p = PAL_PM[i];
    if (p[3] === 0) continue;
    const dr = p[0] - rp;
    const dg = p[1] - gp;
    const db = p[2] - bp;
    const da = p[3] - a;
    const d = dr * dr + dg * dg + db * db + da * da;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// --- DEM sampling (bilinear height, fixed-metric slope/aspect) -------------
const decodeHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;

async function buildDem(bbox) {
  // One tile of margin so bilinear + the ~38 m slope step never miss a
  // neighbour at the window edge.
  const x0 = Math.floor(lonToX(bbox[0], SAMPLE_Z)) - 1;
  const x1 = Math.floor(lonToX(bbox[2], SAMPLE_Z)) + 1;
  const y0 = Math.floor(latToY(bbox[3], SAMPLE_Z)) - 1;
  const y1 = Math.floor(latToY(bbox[1], SAMPLE_Z)) + 1;
  const tiles = new Map();
  let loaded = 0;
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      try {
        const img = decodePng(
          await readFile(path.join(TILE_DIR, String(SAMPLE_Z), String(tx), `${ty}.png`)),
        );
        tiles.set(`${tx}/${ty}`, img);
        loaded++;
      } catch {
        /* missing tile — sea / no-data */
      }
    }
  }
  if (!loaded) {
    throw new Error(
      `No z${SAMPLE_Z} DEM tiles under ${TILE_DIR}. Run: npm run fetch:terrain && npm run repair:dem`,
    );
  }
  console.log(`  ${loaded} z${SAMPLE_Z} DEM tiles loaded`);

  // Global z12 pixel grid: integer coord = texel edge, texel centres at +0.5.
  function texelH(gx, gy) {
    const tx = Math.floor(gx / 256);
    const ty = Math.floor(gy / 256);
    const img = tiles.get(`${tx}/${ty}`);
    if (!img) return NaN;
    let px = Math.floor(gx) - tx * 256;
    let py = Math.floor(gy) - ty * 256;
    if (px < 0) px = 0;
    else if (px >= img.W) px = img.W - 1;
    if (py < 0) py = 0;
    else if (py >= img.H) py = img.H - 1;
    const i = (py * img.W + px) * img.ch;
    return decodeHeight(img.data[i], img.data[i + 1], img.data[i + 2]);
  }

  function height(lon, lat) {
    const gx = lonToX(lon, SAMPLE_Z) * 256 - 0.5;
    const gy = latToY(lat, SAMPLE_Z) * 256 - 0.5;
    const xi = Math.floor(gx);
    const yi = Math.floor(gy);
    const fx = gx - xi;
    const fy = gy - yi;
    const h00 = texelH(xi, yi);
    const h10 = texelH(xi + 1, yi);
    const h01 = texelH(xi, yi + 1);
    const h11 = texelH(xi + 1, yi + 1);
    if (!(Number.isFinite(h00) && Number.isFinite(h10) && Number.isFinite(h01) && Number.isFinite(h11))) {
      // At least one corner is sea/no-data — nearest finite, or NaN.
      return Number.isFinite(h00) ? h00
        : Number.isFinite(h10) ? h10
        : Number.isFinite(h01) ? h01
        : h11;
    }
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }

  function slopeAspect(lon, lat) {
    const dLat = DEM_TEXEL_M / 110540;
    const dLon = DEM_TEXEL_M / (111320 * Math.cos((lat * Math.PI) / 180));
    const hE = height(lon + dLon, lat);
    const hW = height(lon - dLon, lat);
    const hN = height(lon, lat + dLat);
    const hS = height(lon, lat - dLat);
    const dzdx = (hE - hW) / (2 * DEM_TEXEL_M);
    const dzdy = (hS - hN) / (2 * DEM_TEXEL_M); // +y runs south (down the image)
    const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    const aspect = Math.atan2(dzdy, dzdx);
    return { slopeDeg, aspect };
  }

  return { height, slopeAspect };
}

// --- world-space value noise --------------------------------------------
// Mercator anisotropy over 5.7-10 N varies ~1 %. Ignored — negligible at this
// scale and it keeps the noise a plain function of (U, V).
function hash2(x, y, seed) {
  let h =
    Math.imul(x | 0, 374761393) +
    Math.imul(y | 0, 668265263) +
    Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smoothstep01 = (t) => t * t * (3 - 2 * t);
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

// Octave wavelengths as absolute reference pixels: lambda_k = 256 * 2**k,
// k = 0..5 -> ~38 m .. ~1.2 km. Fixed, not per-tile frequency.
const lambdaK = (k) => TILE_SIZE * 2 ** k;

/** Band-limit weight for an octave of wavelength `lambda` (ref px) at effective
 *  zoom `zEff`: 0 once the octave is finer than ~2 screen px, 1 by ~8, and the
 *  /2 spreads the fade across two zoom levels so detail arrives smoothly. */
function octaveWeight(lambda, zEff) {
  const S = refPxPerScreenPx(zEff); // ref px per screen px
  return smoothstep01(clamp01((Math.log2(lambda) - Math.log2(S) - 1) / 2));
}

/** Zero-mean fbm over world coords, octaves kLo..kHi, each band-limited.
 *  Normalisation is FIXED (all octaves) so a low-zoom evaluation is literally
 *  the low-pass of the high-zoom field — coarse structure identical, only fine
 *  detail missing. Range ~[-0.5, 0.5] when every octave is present. */
function worldFbm(U, V, seed, zEff, kLo, kHi) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let k = kLo; k < kHi; k++) {
    const lam = lambdaK(k);
    norm += amp;
    const w = octaveWeight(lam, zEff);
    if (w > 0.001) sum += amp * w * (valueNoise(U / lam, V / lam, seed + k * 97) - 0.5);
    amp *= 0.5;
  }
  return norm > 0 ? sum / (norm * 0.5) : 0;
}

// Rock striation: squashed across the fall line, stretched along it, rotated
// in *world* space by the aspect so the pattern is stable between zooms.
const STREAK_ACROSS = 350; // ref px (~52 m)
const STREAK_ALONG = 1900; // ref px (~284 m)
function rockStreak(U, V, ca, sa, zEff, seed) {
  const across = U * ca + V * sa;
  const along = -U * sa + V * ca;
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let k = 0; k < 4; k++) {
    const lac = STREAK_ACROSS / 2 ** k;
    const lal = STREAK_ALONG / 2 ** k;
    norm += amp;
    const w = octaveWeight(lac, zEff);
    if (w > 0.001) {
      sum += amp * w * (valueNoise(across / lac, along / lal, seed + k * 131) - 0.5);
    }
    amp *= 0.55;
  }
  return 0.5 + (norm > 0 ? sum / (norm * 0.5) : 0);
}

// --- forest mask (scanline fill; even-odd so holes work) ------------------
function rasterizeForest(features, bbox, W, H) {
  const [w, s, e, n] = bbox;
  const mask = new Uint8Array(W * H);
  const toPx = (lon) => ((lon - w) / (e - w)) * W;
  const toPy = (lat) => ((n - lat) / (n - s)) * H;

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

/** Separable box blur — softens the forest edge so canopy fades in. */
function blurMask(mask, W, H, r) {
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
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

const smoothBand = (lo, hi, v) => smoothstep01(clamp01((v - lo) / (hi - lo)));

// Triangular-PDF dither keyed on world position (~1.2 m cells): deterministic,
// seam-safe (same value either side of a tile edge), and finer than any output
// pixel across z10-14, so it reads as film grain, not structure.
function ditherAt(U, V) {
  const cu = Math.round(U / 8);
  const cv = Math.round(V / 8);
  return (hash2(cu, cv, 24007) + hash2(cu + 1013, cv - 271, 55127) - 1) * 0.5;
}

// --- per-pixel composition ----------------------------------------------
// Returns a palette index. `U`,`V` are world reference-pixel coords; `zEff` is
// the effective zoom of the output being baked (drives band-limiting).
const GRAIN_SEED = 700;
const CLUMP_SEED = 3001;
const ROCK_SEED = 9100;

function composeIndex({ h, slopeDeg, aspect, fm, U, V, zEff, dither = 0 }) {
  if (!Number.isFinite(h) || h <= 1) return 0; // sea / no-data — shore ramp owns it

  // Open ground: continuous light<->dark grain, no hue. Alpha tracks how far
  // this pixel departs from the mean, so flat ground stays ~transparent (no
  // banding where nothing shows) and only textured ground draws.
  const grainField = worldFbm(U, V, GRAIN_SEED, zEff, 0, 5); // ~38 m .. ~600 m
  const grainT = clamp01(0.5 + grainField);
  let mat = 0;
  let lumT = grainT;
  let alpha = clamp01(Math.abs(grainField) * 2.6) * GRAIN_ALPHA_MAX;

  // Canopy inside the forest blocks — clumpy, genuinely green (hue is the point
  // here). Coarse clumps + a mid octave so it isn't piecewise-flat once
  // posterised; alpha rises monotonically with brightness so there are no
  // mottled see-through holes mid-tone.
  let canopyT = 0;
  if (fm > 0.004) {
    const clumpField = worldFbm(U, V, CLUMP_SEED, zEff, 2, 6); // ~150 m .. ~1.2 km
    const midField = worldFbm(U, V, CLUMP_SEED + 17, zEff, 1, 5); // ~76 m .. ~600 m
    canopyT = clamp01(0.5 + clumpField * 0.95 + midField * 0.4);
    const canopyA = CANOPY_ALPHA_LO + (CANOPY_ALPHA_HI - CANOPY_ALPHA_LO) * canopyT;
    if (fm >= 0.5) {
      mat = 1;
      lumT = canopyT;
    }
    alpha = mixc(alpha, canopyA, fm);
  }

  // Rock takes over on steep faces and up high, over whatever was there — a
  // cliff is bare no matter what the landcover says.
  const rockAmt = clamp01(
    smoothBand(ROCK_SLOPE_LO, ROCK_SLOPE_HI, slopeDeg) +
      0.18 * smoothBand(SCREE_ELE, SCREE_ELE + 450, h),
  );
  let rockT = 0;
  if (rockAmt > 0.01) {
    const ca = Math.cos(aspect);
    const sa = Math.sin(aspect);
    const streak = rockStreak(U, V, ca, sa, zEff, ROCK_SEED);
    const speck = worldFbm(U, V, ROCK_SEED + 41, zEff, 0, 4);
    rockT = clamp01(streak * 0.75 + (0.5 + speck) * 0.25);
    const rockA = ROCK_ALPHA_LO + (ROCK_ALPHA_HI - ROCK_ALPHA_LO) * rockT;
    alpha = mixc(alpha, rockA, rockAmt);
    if (rockAmt >= 0.5) {
      mat = 2;
      lumT = rockT;
    }
  }

  alpha = Math.min(alpha, MAX_ALPHA);

  // Genuine canopy<->rock overlap: use a blend spare so the edge doesn't snap
  // between a green and a brown entry.
  const canopyW = fm * (1 - rockAmt);
  if (canopyW > 0.18 && rockAmt > 0.18 && rockAmt < 0.85) {
    const t = clamp01((canopyT + rockT) / 2);
    const canopyRgb = mixrgb(CANOPY_DARK, CANOPY_LIGHT, t);
    const rockRgb = mixrgb(ROCK_DARK, ROCK_LIGHT, t);
    const rockFrac = clamp01(rockAmt / (rockAmt + canopyW));
    const [r, g, b] = mixrgb(canopyRgb, rockRgb, rockFrac);
    return nearestIdx(r, g, b, Math.round(alpha * 255));
  }

  return quantIdx(mat, lumT, alpha, dither);
}

// --- single-image bake -------------------------------------------------
function effectiveZoom(W, mercWidth) {
  // Zoom at which one output pixel equals one screen pixel of this image.
  return Math.log2(W / (mercWidth * TILE_SIZE));
}

async function bakeSingle({ bbox, size }, outPath) {
  const [w, s, e, n] = bbox;
  const W = size;
  const H = Math.round((size * (n - s)) / (e - w));
  const mercWidth = lonToX(e, 0) - lonToX(w, 0);
  const zEff = effectiveZoom(W, mercWidth);
  console.log(`  ${W}x${H} over [${bbox.join(', ')}], effective z${zEff.toFixed(2)}`);

  const dem = await buildDem(bbox);

  const forest = JSON.parse(await readFile(FOREST, 'utf8'));
  console.log('  rasterising forest…');
  // r scaled to this image's resolution for a ~230 m feather.
  const mPerPx = (mercWidth * 40075016) / W;
  const blurR = Math.max(1, Math.round(230 / mPerPx));
  const forestMask = blurMask(rasterizeForest(forest.features, bbox, W, H), W, H, blurR);

  console.log('  composing…');
  const indices = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    const lat = n - ((y + 0.5) / H) * (n - s);
    const V = latToRefPy(lat);
    for (let x = 0; x < W; x++) {
      const lon = w + ((x + 0.5) / W) * (e - w);
      const U = lonToRefPx(lon);
      const h = dem.height(lon, lat);
      const { slopeDeg, aspect } = dem.slopeAspect(lon, lat);
      indices[y * W + x] = composeIndex({
        h,
        slopeDeg,
        aspect,
        fm: forestMask[y * W + x] / 255,
        U,
        V,
        zEff,
        dither: ditherAt(U, V),
      });
    }
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  const png = encodeIndexedPng({ width: W, height: H, indices, palette: PALETTE });
  await writeFile(outPath, png);
  console.log(`  wrote ${path.relative(path.join(HERE, '..'), outPath)} (${(png.length / 1e6).toFixed(2)} MB)`);
  return { W, H, corners: [[w, n], [e, n], [e, s], [w, s]] };
}

// --- CLI --------------------------------------------------------------
function parseArgs(argv) {
  const opts = { flags: new Set(), pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--single' || a === '--tiles') opts.flags.add(a.slice(2));
    else if (a === '--bbox') opts.bbox = argv[++i].split(',').map(Number);
    else if (a === '--size') opts.size = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (!a.startsWith('-')) opts.pos.push(a);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Explicit single window: node generate-texture.mjs --single --bbox a,b,c,d --size N
  if (opts.flags.has('single') || opts.bbox) {
    const bbox = opts.bbox ?? REGIONS.knuckles.bbox;
    const size = opts.size ?? 2048;
    const out = opts.out
      ? path.resolve(opts.out)
      : path.join(OUT_DIR, '_single.png'); // gitignored scratch — no manifest
    console.log(`\nsingle: baking one image`);
    await bakeSingle({ bbox, size }, out);
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
    const { corners } = await bakeSingle(REGIONS[id], outPath);
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

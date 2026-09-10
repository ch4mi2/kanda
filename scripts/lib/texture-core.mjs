// Pure bake core for the diffuse terrain texture — everything that is a
// function of world position and the committed DEM/forest data, with no CLI,
// no orchestration, no worker plumbing. Imported by both
// scripts/generate-texture.mjs (driver) and scripts/texture-worker.mjs.
//
// See scripts/generate-texture.mjs for the "why this exists" preamble and the
// Phase 6 plan for the world-space-noise / indexed-PNG design.

import { readFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  TILE_SIZE,
  lonToMercX as lonToX,
  latToMercY as latToY,
  lonToRefPx,
  latToRefPy,
  refPxX,
  refPxY,
  refPxPerScreenPx,
  tileXToLon,
  tileYToLat,
} from './tilemath.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const TILE_DIR = path.join(ROOT, 'public/tiles/terrain');
export const FOREST = path.join(ROOT, 'src/data/forest.geojson');
// Reservoirs and tanks — masked OUT of the bake. Their surface sits at ~440 m
// (SRTM captured the drowned valley / water surface as land), so the h<=1 sea
// guard misses them and the compositor would paint grain + canopy across the
// whole reservoir footprint. The `water` fill layer hides most of it in the
// app, but its simplified geometry leaks texture at every shoreline.
export const WATER = path.join(ROOT, 'src/data/water.geojson');
export const TILE_OUT_DIR = path.join(ROOT, 'public/tiles/texture');

export const SAMPLE_Z = 12; // DEM ceiling — see CLAUDE.md
const DEM_TEXEL_M = 38; // ~1 z12 texel at this latitude; the slope/aspect step

// ---- tile bake regions -------------------------------------------------
// KEEP IN SYNC with src/config/tiles.ts (SRI_LANKA_BBOX, TEXTURE_HIGHLANDS_BBOX
// and TEXTURE.base/highlands zoom ranges). This is a plain .mjs and can't
// import the TS config — same manual-sync deal as BBOX in fetch-terrain.mjs.
export const SRI_LANKA_BBOX = [79.5, 5.7, 82.0, 10.0];
// Highlands window: contains 68 of the 70 peaks above 1,000 m, the Adam's Peak
// approach and the western escarpment, with margin. The budget knob is the
// size of *this* window, not the texture quality.
export const TEXTURE_HIGHLANDS_BBOX = [80.05, 6.1, 81.45, 7.75];
export const TEXTURE_REGIONS = [
  { minzoom: 10, maxzoom: 12, bbox: SRI_LANKA_BBOX },
  { minzoom: 13, maxzoom: 14, bbox: TEXTURE_HIGHLANDS_BBOX },
];

// Global forest raster zoom. z11 over the island is ~3.6k x 6.3k = ~23 MB and
// gives a ~230 m feather after blurMask(r=3). Built once, shared by every tile.
export const FOREST_RASTER_Z = 11;

// ---- texture palette anchors ------------------------------------------
const CANOPY_DARK = [20, 62, 38];
const CANOPY_LIGHT = [96, 158, 92];
const ROCK_DARK = [54, 47, 40];
const ROCK_LIGHT = [156, 145, 128];
// Neutral pair for open-ground grain — only luminance moves, no hue, or the
// Skin's elevation ramp would desaturate across the whole map.
const GRAIN_DARK = [44, 42, 34];
const GRAIN_LIGHT = [232, 226, 208];

const ROCK_SLOPE_LO = 26;
const ROCK_SLOPE_HI = 45;
const SCREE_ELE = 1900;
const MAX_ALPHA = 0.66; // ceiling on any one pixel — the ramp must read through

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
export function decodePng(buf) {
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
 * palette indices is meaningless and measurably worse. Chunk order is
 * IHDR -> PLTE -> tRNS -> IDAT -> IEND.
 */
export function encodeIndexedPng({ width, height, indices, palette }) {
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

// --- shared palette ----------------------------------------------------
// index 0                fully transparent ("nothing here")
// 1..64    grain    8 luminance x 8 alpha
// 65..128  canopy   8 luminance x 8 alpha
// 129..192 rock     8 luminance x 8 alpha
// 193..255 canopy<->rock blend, 9 blend steps x 7 luminance (63 entries)
//
// Identical in every tile, so tiles that composite to the same picture encode
// byte-identically and SHA-1-dedup in the archive.
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
  for (let bl = 0; bl < BLEND_STEPS; bl++) {
    const rockFrac = (bl + 1) / (BLEND_STEPS + 1);
    for (let l = 0; l < BLEND_LUM; l++) {
      const t = l / (BLEND_LUM - 1);
      const canopy = mixrgb(CANOPY_DARK, CANOPY_LIGHT, t);
      const rock = mixrgb(ROCK_DARK, ROCK_LIGHT, t);
      palette.push([...mixrgb(canopy, rock, rockFrac), alphaByte(4)]);
    }
  }
  while (palette.length < 256) palette.push([0, 0, 0, 0]);
  return palette;
}

export const PALETTE = buildPalette();
const PAL_PM = PALETTE.map(([r, g, b, a]) => {
  const af = a / 255;
  return [r * af, g * af, b * af, a];
});

const matBase = (mat) => 1 + mat * LUM_STEPS * ALPHA_STEPS; // grain 0 / canopy 1 / rock 2
// `dither` is a per-pixel [-0.5, 0.5) value applied at ~1 bucket amplitude
// before rounding, so posterised luminance/alpha bands break up instead of
// showing hard block edges — far cheaper than doubling LUM_STEPS.
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

// --- DEM sampling (bilinear height, fixed-metric slope/aspect) ---------
const decodeHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Load the z12 DEM covering `bbox` (+1 tile margin) and return bilinear
 *  height + fixed ~38 m central-difference slope/aspect samplers. Throws only
 *  if `strict` and no tile at all was found. */
export async function buildDem(bbox, { quiet = false, strict = true } = {}) {
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
  if (!loaded && strict) {
    throw new Error(
      `No z${SAMPLE_Z} DEM tiles under ${TILE_DIR}. Run: npm run fetch:terrain && npm run repair:dem`,
    );
  }
  if (!quiet) console.log(`  ${loaded} z${SAMPLE_Z} DEM tiles loaded`);

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

  return { height, slopeAspect, loaded };
}

// --- world-space value noise -----------------------------------------
// Mercator anisotropy over 5.7-10 N varies ~1 %. Ignored — negligible here.
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

/** Band-limit weight for an octave of wavelength `lambda` (ref px) at zoom
 *  `zEff`: 0 once finer than ~2 screen px, 1 by ~8; the /2 spreads the fade
 *  across two zoom levels so detail arrives smoothly. */
function octaveWeight(lambda, zEff) {
  const S = refPxPerScreenPx(zEff);
  return smoothstep01(clamp01((Math.log2(lambda) - Math.log2(S) - 1) / 2));
}

/** Zero-mean fbm over world coords, octaves kLo..kHi, each band-limited.
 *  Normalisation is FIXED (all octaves) so a low-zoom evaluation is literally
 *  the low-pass of the high-zoom field. Range ~[-0.5, 0.5] fully present. */
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

// --- polygon rasteriser (scanline fill; even-odd so holes work) -------
// `toPx(lon)` / `toPy(lat)` project a coordinate into raster pixel space.
// Used for both the forest (canopy) and water (mask-out) landcover rasters.
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

/** Separable box blur — softens the forest edge so canopy fades in. Writes
 *  into `out` if given (e.g. a SharedArrayBuffer view), else allocates. */
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

const smoothBand = (lo, hi, v) => smoothstep01(clamp01((v - lo) / (hi - lo)));

// Ordered (Bayer 8x8) dither keyed on world position, ~1 cell per output pixel
// at z14. Deterministic and seam-safe. Ordered rather than white-/blue-noise on
// purpose: it breaks posterisation banding just as well on smooth gradients but,
// being periodic, costs the deflate stream a fraction of what incompressible
// white-noise speckle does — and the texture budget lives or dies on bytes/tile.
const BAYER8 = (() => {
  const g = [];
  for (let y = 0; y < 8; y++) {
    g[y] = [];
    for (let x = 0; x < 8; x++) {
      let v = 0;
      for (let i = 0; i < 3; i++) {
        const bx = (x >> i) & 1;
        const by = (y >> i) & 1;
        v = (v << 2) | ((bx ^ by) << 1) | by;
      }
      g[y][x] = (v + 0.5) / 64 - 0.5;
    }
  }
  return g;
})();
const BAYER_STEP = 64; // ref px per cell ~= one z14 output pixel
function ditherAt(U, V) {
  const cu = Math.floor(U / BAYER_STEP) & 7;
  const cv = Math.floor(V / BAYER_STEP) & 7;
  return BAYER8[cv][cu];
}

/** How much dither to apply at zoom `zEff`: full where the ~150 m octave is
 *  band-limited away and open ground is a smooth field that would posterise
 *  (z10-11), fading to zero by ~z13 where the fine octaves break up the bands
 *  on their own — which is also what keeps z13/z14 tiles compressible. */
export function ditherScaleFor(zEff) {
  return clamp01(1 - octaveWeight(lambdaK(2), zEff));
}

// --- per-pixel composition ------------------------------------------
const GRAIN_SEED = 700;
const CLUMP_SEED = 3001;
const ROCK_SEED = 9100;

/** Composite one pixel to a palette index. `U`,`V` are world reference-pixel
 *  coords; `zEff` drives band-limiting; `dither` is the (already scaled)
 *  ordered-dither offset. */
export function composeIndex({ h, slopeDeg, aspect, fm, wm = 0, U, V, zEff, dither = 0 }) {
  if (!Number.isFinite(h) || h <= 1) return 0; // sea / no-data — shore ramp owns it
  // Under a mapped reservoir/tank: the `water` fill layer owns those pixels.
  // `wm` feathers ~90 m at the shore so the texture doesn't stop on a hard edge.
  if (wm > 0.8) return 0;
  const wFade = clamp01(1 - wm / 0.8);

  const grainField = worldFbm(U, V, GRAIN_SEED, zEff, 0, 5); // ~38 m .. ~600 m
  let mat = 0;
  let lumT = clamp01(0.5 + grainField);
  let alpha = clamp01(Math.abs(grainField) * 2.6) * GRAIN_ALPHA_MAX;

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

  alpha = Math.min(alpha, MAX_ALPHA) * wFade;

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

// --- global landcover rasters ---------------------------------------
// Both the forest (canopy) and water (mask-out) rasters are one 8-bit z11
// raster over SRI_LANKA_BBOX, blurred for a soft edge, handed to the workers
// in a SharedArrayBuffer and sampled bilinearly (mercator-linear).
export function rasterDims() {
  const [w, s, e, n] = SRI_LANKA_BBOX;
  const W = Math.round((lonToX(e, FOREST_RASTER_Z) - lonToX(w, FOREST_RASTER_Z)) * TILE_SIZE);
  const H = Math.round((latToY(s, FOREST_RASTER_Z) - latToY(n, FOREST_RASTER_Z)) * TILE_SIZE);
  return { W, H };
}

/** Rasterise a GeoJSON polygon file into the shared z11 raster. `blurR` sets
 *  the edge feather (forest ~230 m, water ~90 m). Pass `sabData` (a
 *  SharedArrayBuffer view of W*H) to blur straight into shared memory. */
export async function buildLandcoverRaster(geojsonPath, blurR, sabData) {
  const [w, s, e, n] = SRI_LANKA_BBOX;
  const mx0 = lonToX(w, FOREST_RASTER_Z);
  const mx1 = lonToX(e, FOREST_RASTER_Z);
  const my0 = latToY(n, FOREST_RASTER_Z);
  const my1 = latToY(s, FOREST_RASTER_Z);
  const W = Math.round((mx1 - mx0) * TILE_SIZE);
  const H = Math.round((my1 - my0) * TILE_SIZE);
  const toPx = (lon) => ((lonToX(lon, FOREST_RASTER_Z) - mx0) / (mx1 - mx0)) * W;
  const toPy = (lat) => ((latToY(lat, FOREST_RASTER_Z) - my0) / (my1 - my0)) * H;

  const gj = JSON.parse(await readFile(geojsonPath, 'utf8'));
  const data = blurMask(
    rasterizePolygons(gj.features, W, H, toPx, toPy),
    W,
    H,
    blurR,
    sabData && sabData.length === W * H ? sabData : undefined,
  );
  return { W, H, data };
}

export const buildForestRaster = (sabData) => buildLandcoverRaster(FOREST, 3, sabData);
export const buildWaterRaster = (sabData) => buildLandcoverRaster(WATER, 2, sabData);

/** Bilinear sampler over a `{ W, H, data }` z11 landcover raster,
 *  mercator-linear like the raster itself. Returns 0..1. */
export function rasterSamplerFrom({ W, H, data }) {
  const [w, s, e, n] = SRI_LANKA_BBOX;
  const mx0 = lonToX(w, FOREST_RASTER_Z);
  const mx1 = lonToX(e, FOREST_RASTER_Z);
  const my0 = latToY(n, FOREST_RASTER_Z);
  const my1 = latToY(s, FOREST_RASTER_Z);
  const toPx = (lon) => ((lonToX(lon, FOREST_RASTER_Z) - mx0) / (mx1 - mx0)) * W;
  const toPy = (lat) => ((latToY(lat, FOREST_RASTER_Z) - my0) / (my1 - my0)) * H;
  const cx = (v) => (v < 0 ? 0 : v > W - 1 ? W - 1 : v);
  const cy = (v) => (v < 0 ? 0 : v > H - 1 ? H - 1 : v);
  return function sample(lon, lat) {
    const fx = toPx(lon) - 0.5;
    const fy = toPy(lat) - 0.5;
    let xi = Math.floor(fx);
    let yi = Math.floor(fy);
    const dx = fx - xi;
    const dy = fy - yi;
    xi = cx(xi);
    yi = cy(yi);
    const x1 = cx(xi + 1);
    const y1 = cy(yi + 1);
    const a = data[yi * W + xi];
    const b = data[yi * W + x1];
    const c = data[y1 * W + xi];
    const d = data[y1 * W + x1];
    return ((a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy) / 255;
  };
}

// --- tile bake ------------------------------------------------------
// One canonical fully-transparent tile — every all-sea / no-data tile is
// written from these exact bytes, so they SHA-1-dedup to a single blob in the
// archive and the loose dev server never falls back to index.html (CLAUDE.md).
let EMPTY_TILE = null;
export function emptyTilePng() {
  if (!EMPTY_TILE) {
    EMPTY_TILE = encodeIndexedPng({
      width: TILE_SIZE,
      height: TILE_SIZE,
      indices: Buffer.alloc(TILE_SIZE * TILE_SIZE),
      palette: PALETTE,
    });
  }
  return EMPTY_TILE;
}

/**
 * One 256x256 texture tile, or `null` if every sampled pixel is sea/no-data
 * (the caller writes the canonical empty tile). No apron: every input is a
 * pure function of world position, so adjacent tiles agree along their edge.
 */
export function bakeTile({ z, x, y }, dem, forestSample, waterSample) {
  const indices = Buffer.alloc(TILE_SIZE * TILE_SIZE);
  const dScale = ditherScaleFor(z);
  let allEmpty = true;
  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = tileYToLat(y + (py + 0.5) / TILE_SIZE, z);
    const V = refPxY(y, py, z);
    for (let px = 0; px < TILE_SIZE; px++) {
      const lon = tileXToLon(x + (px + 0.5) / TILE_SIZE, z);
      const U = refPxX(x, px, z);
      const h = dem.height(lon, lat);
      if (!Number.isFinite(h) || h <= 1) continue;
      const wm = waterSample(lon, lat);
      if (wm > 0.8) continue; // under a reservoir/tank — stays index 0
      const { slopeDeg, aspect } = dem.slopeAspect(lon, lat);
      const idx = composeIndex({
        h,
        slopeDeg,
        aspect,
        fm: forestSample(lon, lat),
        wm,
        U,
        V,
        zEff: z,
        dither: ditherAt(U, V) * dScale,
      });
      indices[py * TILE_SIZE + px] = idx;
      if (idx !== 0) allEmpty = false;
    }
  }
  if (allEmpty) return null;
  return encodeIndexedPng({ width: TILE_SIZE, height: TILE_SIZE, indices, palette: PALETTE });
}

// --- single-image bake (--single / named regions) -----------------
export function effectiveZoom(W, mercWidth) {
  return Math.log2(W / (mercWidth * TILE_SIZE));
}

export async function bakeSingle({ bbox, size }, outPath, { writeFile, mkdir }) {
  const [w, s, e, n] = bbox;
  const W = size;
  const H = Math.round((size * (n - s)) / (e - w));
  const mercWidth = lonToX(e, 0) - lonToX(w, 0);
  const zEff = effectiveZoom(W, mercWidth);
  console.log(`  ${W}x${H} over [${bbox.join(', ')}], effective z${zEff.toFixed(2)}`);

  const dem = await buildDem(bbox);

  const mPerPx = (mercWidth * 40075016) / W;
  const toPx = (lon) => ((lon - w) / (e - w)) * W;
  const toPy = (lat) => ((n - lat) / (n - s)) * H;
  console.log('  rasterising forest + water…');
  const forest = JSON.parse(await readFile(FOREST, 'utf8'));
  const water = JSON.parse(await readFile(WATER, 'utf8'));
  const forestMask = blurMask(
    rasterizePolygons(forest.features, W, H, toPx, toPy),
    W,
    H,
    Math.max(1, Math.round(230 / mPerPx)),
  );
  const waterMask = blurMask(
    rasterizePolygons(water.features, W, H, toPx, toPy),
    W,
    H,
    Math.max(1, Math.round(90 / mPerPx)),
  );

  console.log('  composing…');
  const dScale = ditherScaleFor(zEff);
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
        wm: waterMask[y * W + x] / 255,
        U,
        V,
        zEff,
        dither: ditherAt(U, V) * dScale,
      });
    }
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  const png = encodeIndexedPng({ width: W, height: H, indices, palette: PALETTE });
  await writeFile(outPath, png);
  console.log(`  wrote ${path.relative(ROOT, outPath)} (${(png.length / 1e6).toFixed(2)} MB)`);
  return { W, H, corners: [[w, n], [e, n], [e, s], [w, s]] };
}

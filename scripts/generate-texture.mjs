#!/usr/bin/env node
// Bakes a *diffuse detail texture* for a region and writes it as a PNG that the
// map drapes over the terrain.
//
//   node scripts/generate-texture.mjs knuckles      (npm run generate:texture)
//
// Why this exists
// ---------------
// MapLibre's `color-relief` paints one flat colour per elevation band and
// nothing else — no surface detail at all. Reference art (the Sketchfab
// terrain renders) gets its richness from a diffuse texture map draped on the
// mesh, which for them is satellite/landcover imagery. Kanda can't use imagery
// (licensed, non-redistributable, multi-GB — it would end keyless + offline),
// so we bake our own from data we already have:
//
//   * the local DEM      -> slope, aspect, elevation
//   * forest.geojson     -> where canopy texture goes
//   * value-noise fbm    -> the actual high-frequency detail
//
// The output is deliberately an RGBA *overlay*, not a replacement: alpha is
// near zero where there's nothing interesting to say, so the Skin's elevation
// ramp still shows through and skins still control the palette. It sits above
// color-relief and below the hillshade passes, so the shading lights it.
//
// Deterministic — fixed PRNG seed, so re-running doesn't churn the diff.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const TILE_DIR = path.join(HERE, '../public/tiles/terrain');
const FOREST = path.join(HERE, '../src/data/forest.geojson');
const OUT_DIR = path.join(HERE, '../public/textures');
const MANIFEST = path.join(HERE, '../src/data/textures.json');

const SAMPLE_Z = 12; // DEM ceiling — see CLAUDE.md

// Regions to bake. `knuckles` is the prototype window: dramatic relief, big
// forest blocks, and the peaks the app's founding story names.
const REGIONS = {
  knuckles: { bbox: [80.62, 7.24, 81.02, 7.58], size: 2048 },
  highlands: { bbox: [80.2, 6.45, 81.35, 7.75], size: 4096 },
};

// ---- texture palette -------------------------------------------------------
// Prototype only: these mirror Skin.foliage / the upper elevation bands. If
// this pipeline graduates, they should come from the Skin rather than living
// in a second place. Kept as [r,g,b].
const CANOPY_DARK = [20, 62, 38];
const CANOPY_LIGHT = [96, 158, 92];
const ROCK_LIGHT = [156, 145, 128];
const ROCK_DARK = [54, 47, 40];
// Neutral pair used for pure light/dark grain on open ground. Neutral matters:
// tinting open ground with any hue would desaturate the Skin's elevation ramp
// across the whole region. These only move luminance — a poor man's
// multiply/screen, since MapLibre raster layers have no blend mode.
// Soft, not black-and-white: a hard flip between extremes at high frequency
// reads as television static once it's composited.
const GRAIN_DARK = [44, 42, 34];
const GRAIN_LIGHT = [232, 226, 208];

// Slope (degrees) over which ground grades into bare rock. Rock has to stay a
// *minority* material: Sri Lanka's highlands are forest and grassland with
// crags in them, not the Alps. At 13/31 the Knuckles came out uniformly brown
// because almost every pixel there is steep.
const ROCK_SLOPE_LO = 26;
const ROCK_SLOPE_HI = 45;
// Above this the ground goes stony even where it isn't especially steep — a
// light touch, since the summits here are grassland (Horton Plains) not scree.
const SCREE_ELE = 1900;
// Ceiling on any one pixel — the ramp underneath must still read through.
const MAX_ALPHA = 0.66;

// --- PNG (same minimal codec as repair-dem.mjs / generate-contours.mjs) -----
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
function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  // Filter 1 (Sub) compresses noisy RGBA a lot better than filter 0 here.
  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 1;
    for (let x = 0; x < stride; x++) {
      const prev = x >= 4 ? data[y * stride + x - 4] : 0;
      raw[dst + 1 + x] = (data[y * stride + x] - prev) & 0xff;
    }
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

// --- DEM sampling -----------------------------------------------------------
const decodeHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;
const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

async function buildSampler(bbox) {
  const x0 = Math.floor(lonToX(bbox[0], SAMPLE_Z));
  const x1 = Math.floor(lonToX(bbox[2], SAMPLE_Z));
  const y0 = Math.floor(latToY(bbox[3], SAMPLE_Z));
  const y1 = Math.floor(latToY(bbox[1], SAMPLE_Z));
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
        /* missing tile — sampler returns NaN */
      }
    }
  }
  if (!loaded) {
    throw new Error(
      `No z${SAMPLE_Z} DEM tiles under ${TILE_DIR}. Run: npm run fetch:terrain && npm run repair:dem`,
    );
  }
  console.log(`  ${loaded} z${SAMPLE_Z} DEM tiles loaded`);
  return (lon, lat) => {
    const fx = lonToX(lon, SAMPLE_Z);
    const fy = latToY(lat, SAMPLE_Z);
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    const img = tiles.get(`${tx}/${ty}`);
    if (!img) return NaN;
    const px = Math.min(img.W - 1, Math.floor((fx - tx) * img.W));
    const py = Math.min(img.H - 1, Math.floor((fy - ty) * img.H));
    const i = (py * img.W + px) * img.ch;
    return decodeHeight(img.data[i], img.data[i + 1], img.data[i + 2]);
  };
}

// --- value noise ------------------------------------------------------------
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
function fbm(x, y, seed, octaves) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// --- forest mask (scanline fill; even-odd so holes work) --------------------
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

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothBand = (lo, hi, v) => smoothstep01(clamp01((v - lo) / (hi - lo)));
const mix = (a, b, t) => a + (b - a) * t;

// --- bake -------------------------------------------------------------------
async function bake(id, { bbox, size }) {
  const [w, s, e, n] = bbox;
  const W = size;
  const H = Math.round((size * (n - s)) / (e - w));
  console.log(`\n${id}: ${W}x${H} over [${bbox.join(', ')}]`);

  const sample = await buildSampler(bbox);

  // Elevation grid first — slope/aspect need neighbours.
  const ele = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = n - ((y + 0.5) / H) * (n - s);
    for (let x = 0; x < W; x++) {
      const lon = w + ((x + 0.5) / W) * (e - w);
      ele[y * W + x] = sample(lon, lat);
    }
  }

  const midLat = (n + s) / 2;
  const mPerPxX = (((e - w) / W) * 111320 * Math.cos((midLat * Math.PI) / 180));
  const mPerPxY = ((n - s) / H) * 110540;

  const forest = JSON.parse(await readFile(FOREST, 'utf8'));
  console.log('  rasterising forest…');
  const forestMask = blurMask(rasterizeForest(forest.features, bbox, W, H), W, H, 3);

  console.log('  composing…');
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 4;
      const h = ele[i];
      // Sea and no-data stay untouched — the shore ramp owns them.
      if (!Number.isFinite(h) || h <= 1) continue;

      // Slope + aspect by central difference.
      const xl = x > 0 ? x - 1 : x;
      const xr = x < W - 1 ? x + 1 : x;
      const yu = y > 0 ? y - 1 : y;
      const yd = y < H - 1 ? y + 1 : y;
      const dzdx = (ele[y * W + xr] - ele[y * W + xl]) / (2 * mPerPxX);
      const dzdy = (ele[yd * W + x] - ele[yu * W + x]) / (2 * mPerPxY);
      const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      const aspect = Math.atan2(dzdy, dzdx);

      // Striation: noise squashed across the fall line and stretched along it,
      // so detail runs downhill the way real erosion does.
      const ca = Math.cos(aspect);
      const sa = Math.sin(aspect);
      const u = (x * ca + y * sa) / 5.5;
      const v = (-x * sa + y * ca) / 30;
      const streak = fbm(u, v, 11, 3);

      const clump = fbm(x / 30, y / 30, 3, 4); // canopy clumps
      const mid = fbm(x / 16, y / 16, 5, 3); // mid grain
      const speck = fbm(x / 6, y / 6, 7, 2); // fine grain

      let r;
      let g;
      let b;
      let a;

      // Open ground: pure light/dark grain, no hue. Centred on zero so half the
      // pixels darken and half lighten — net effect is texture, not a wash.
      const grain = clamp01(mid * 0.72 + speck * 0.28) - 0.5;
      const lighten = grain >= 0;
      r = lighten ? GRAIN_LIGHT[0] : GRAIN_DARK[0];
      g = lighten ? GRAIN_LIGHT[1] : GRAIN_DARK[1];
      b = lighten ? GRAIN_LIGHT[2] : GRAIN_DARK[2];
      a = Math.abs(grain) * 2 * 0.15;

      // Canopy inside the forest blocks — clumpy, and genuinely green because
      // here a hue shift is the point.
      const fm = forestMask[i] / 255;
      if (fm > 0.01) {
        const t = clamp01(clump * 0.6 + mid * 0.25 + speck * 0.15);
        const cr = mix(CANOPY_DARK[0], CANOPY_LIGHT[0], t);
        const cg = mix(CANOPY_DARK[1], CANOPY_LIGHT[1], t);
        const cb = mix(CANOPY_DARK[2], CANOPY_LIGHT[2], t);
        const ca = 0.36 + 0.24 * Math.abs(t - 0.5) * 2;
        r = mix(r, cr, fm);
        g = mix(g, cg, fm);
        b = mix(b, cb, fm);
        a = mix(a, ca, fm);
      }

      // Rock takes over on steep faces and up high, over whatever was there —
      // a cliff is bare no matter what the landcover says.
      const rockAmt = clamp01(
        smoothBand(ROCK_SLOPE_LO, ROCK_SLOPE_HI, slopeDeg) +
          0.18 * smoothBand(SCREE_ELE, SCREE_ELE + 450, h),
      );
      if (rockAmt > 0.01) {
        const t = clamp01(streak * 0.7 + speck * 0.3);
        const rr = mix(ROCK_DARK[0], ROCK_LIGHT[0], t);
        const rg = mix(ROCK_DARK[1], ROCK_LIGHT[1], t);
        const rb = mix(ROCK_DARK[2], ROCK_LIGHT[2], t);
        const ra = 0.14 + 0.26 * t;
        r = mix(r, rr, rockAmt);
        g = mix(g, rg, rockAmt);
        b = mix(b, rb, rockAmt);
        a = mix(a, ra, rockAmt);
      }

      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(Math.min(a, MAX_ALPHA) * 255);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  const png = encodePng({ width: W, height: H, data: out });
  await writeFile(path.join(OUT_DIR, `${id}.png`), png);
  console.log(`  wrote public/textures/${id}.png (${(png.length / 1e6).toFixed(1)} MB)`);

  return {
    id,
    image: `textures/${id}.png`,
    // MapLibre `image` source order: TL, TR, BR, BL.
    coordinates: [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ],
  };
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ids = wanted.length ? wanted : ['knuckles'];
const regions = [];
for (const id of ids) {
  if (!REGIONS[id]) throw new Error(`Unknown region "${id}". Have: ${Object.keys(REGIONS).join(', ')}`);
  regions.push(await bake(id, REGIONS[id]));
}

// Merge into the manifest so re-baking one region doesn't drop the others.
let existing = { regions: [] };
try {
  existing = JSON.parse(await readFile(MANIFEST, 'utf8'));
} catch {
  /* first run */
}
const byId = new Map((existing.regions ?? []).map((r) => [r.id, r]));
for (const r of regions) byId.set(r.id, r);
await writeFile(
  MANIFEST,
  JSON.stringify({ regions: [...byId.values()] }, null, 2) + '\n',
);
console.log(`\nmanifest: src/data/textures.json (${byId.size} region(s))`);

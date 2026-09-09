#!/usr/bin/env node
// Pre-generates elevation contour lines for the central highlands from the
// local DEM pyramid and writes a committed src/data/contours.geojson.
//
// Why pre-generate: maplibre-contour does its own raw fetch() of DEM tiles,
// which cannot read the pmtiles:// deployment source. A committed GeoJSON
// works in every tile mode, offline, with zero runtime cost — same pattern
// as peaks / water.
//
// Scope is deliberately just the highlands (where contours help you read a
// summit's height) and a coarse interval, to keep the file small. Runs off
// whatever is in public/tiles/terrain/ — so run it AFTER repair:dem.
//
//   node scripts/generate-contours.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TILE_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../public/tiles/terrain');
const OUT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/data/contours.geojson');

// Central highlands + Knuckles. [west, south, east, north]
const BBOX = [80.2, 6.45, 81.35, 7.75];
const SAMPLE_Z = 12; // DEM zoom to sample
const GRID_DEG = 0.001; // ~110 m grid spacing
const LEVELS = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400];
const INDEX_EVERY = 1000; // levels that are multiples of this are "index" lines
const MIN_LINE_PTS = 6; // drop tiny fragments
const SIMPLIFY_DEG = 0.0006;

// --- PNG + terrarium (same minimal codec as repair-dem.mjs) ----------------
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePng(buf) {
  let off = 8;
  let W = 0;
  let H = 0;
  let ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      W = body.readUInt32BE(0);
      H = body.readUInt32BE(4);
      ct = body[9];
    } else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = W * ch;
  const data = Buffer.alloc(stride * H);
  let pos = 0;
  for (let y = 0; y < H; y++) {
    const f = raw[pos++];
    const rs = y * stride;
    const ps = rs - stride;
    for (let x = 0; x < stride; x++) {
      const rb = raw[pos++];
      const a = x >= ch ? data[rs + x - ch] : 0;
      const b = y > 0 ? data[ps + x] : 0;
      const c = y > 0 && x >= ch ? data[ps + x - ch] : 0;
      let v;
      switch (f) {
        case 0: v = rb; break;
        case 1: v = rb + a; break;
        case 2: v = rb + b; break;
        case 3: v = rb + ((a + b) >> 1); break;
        case 4: v = rb + paeth(a, b, c); break;
        default: throw new Error(`filter ${f}`);
      }
      data[rs + x] = v & 0xff;
    }
  }
  return { W, H, ch, data };
}
const decodeHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;

// --- DEM sampler over the tiles covering BBOX ------------------------------
const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

async function buildSampler() {
  const x0 = Math.floor(lonToX(BBOX[0], SAMPLE_Z));
  const x1 = Math.floor(lonToX(BBOX[2], SAMPLE_Z));
  const y0 = Math.floor(latToY(BBOX[3], SAMPLE_Z));
  const y1 = Math.floor(latToY(BBOX[1], SAMPLE_Z));
  const tiles = new Map();
  let loaded = 0;
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      try {
        const img = decodePng(await readFile(path.join(TILE_DIR, String(SAMPLE_Z), String(tx), `${ty}.png`)));
        tiles.set(`${tx}/${ty}`, img);
        loaded++;
      } catch {
        /* missing tile — sampler returns NaN there */
      }
    }
  }
  console.log(`Loaded ${loaded} z${SAMPLE_Z} tiles for the highland window`);

  return function sample(lon, lat) {
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

// --- marching squares -----------------------------------------------------
/** Linear crossing fraction of level L between heights a and b. */
const frac = (a, b, L) => (L - a) / (b - a);

function contourSegments(grid, cols, rows, xs, ys, L) {
  const segs = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = grid[j * cols + i];
      const tr = grid[j * cols + i + 1];
      const br = grid[(j + 1) * cols + i + 1];
      const bl = grid[(j + 1) * cols + i];
      if (Number.isNaN(tl) || Number.isNaN(tr) || Number.isNaN(br) || Number.isNaN(bl)) continue;
      let idx = 0;
      if (tl > L) idx |= 8;
      if (tr > L) idx |= 4;
      if (br > L) idx |= 2;
      if (bl > L) idx |= 1;
      if (idx === 0 || idx === 15) continue;

      const x0 = xs[i];
      const x1 = xs[i + 1];
      const y0 = ys[j];
      const y1 = ys[j + 1];
      const top = () => [x0 + (x1 - x0) * frac(tl, tr, L), y0];
      const right = () => [x1, y0 + (y1 - y0) * frac(tr, br, L)];
      const bottom = () => [x0 + (x1 - x0) * frac(bl, br, L), y1];
      const left = () => [x0, y0 + (y1 - y0) * frac(tl, bl, L)];

      // 16-case lookup (ambiguous saddles 5 and 10 split into two segments).
      switch (idx) {
        case 1: case 14: segs.push([left(), bottom()]); break;
        case 2: case 13: segs.push([bottom(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([top(), right()]); break;
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([left(), top()]); break;
        case 5: segs.push([left(), top()], [bottom(), right()]); break;
        case 10: segs.push([left(), bottom()], [top(), right()]); break;
      }
    }
  }
  return segs;
}

/** Stitch unordered segments into polylines by matching endpoints. */
function stitch(segs) {
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const ends = new Map(); // point key -> [{seg, atStart}]
  segs.forEach((seg) => {
    for (const [pt, atStart] of [[seg[0], true], [seg[1], false]]) {
      const k = key(pt);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ seg, atStart });
    }
  });

  const used = new Set();
  const lines = [];
  for (const seg of segs) {
    if (used.has(seg)) continue;
    used.add(seg);
    const line = [seg[0], seg[1]];
    // extend forward
    for (let guard = 0; guard < 100000; guard++) {
      const tail = line[line.length - 1];
      const cand = (ends.get(key(tail)) ?? []).find((e) => !used.has(e.seg));
      if (!cand) break;
      used.add(cand.seg);
      line.push(cand.atStart ? cand.seg[1] : cand.seg[0]);
    }
    // extend backward
    for (let guard = 0; guard < 100000; guard++) {
      const head = line[0];
      const cand = (ends.get(key(head)) ?? []).find((e) => !used.has(e.seg));
      if (!cand) break;
      used.add(cand.seg);
      line.unshift(cand.atStart ? cand.seg[1] : cand.seg[0]);
    }
    lines.push(line);
  }
  return lines;
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[lo];
    const [bx, by] = pts[hi];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-12;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = pts[i];
      const t = ((px - ax) * dx + (py - ay) * dy) / l2;
      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const d = Math.hypot(px - cx, py - cy);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

async function main() {
  const sample = await buildSampler();

  const cols = Math.ceil((BBOX[2] - BBOX[0]) / GRID_DEG) + 1;
  const rows = Math.ceil((BBOX[3] - BBOX[1]) / GRID_DEG) + 1;
  const xs = Array.from({ length: cols }, (_, i) => BBOX[0] + i * GRID_DEG);
  const ys = Array.from({ length: rows }, (_, j) => BBOX[3] - j * GRID_DEG); // north-down

  console.log(`Sampling ${cols}x${rows} grid...`);
  const grid = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) grid[j * cols + i] = sample(xs[i], ys[j]);
  }

  const features = [];
  for (const L of LEVELS) {
    const segs = contourSegments(grid, cols, rows, xs, ys, L);
    const lines = stitch(segs)
      .map((line) => simplify(line.map((p) => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))]), SIMPLIFY_DEG))
      .filter((line) => line.length >= MIN_LINE_PTS);
    for (const line of lines) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: line },
        properties: { ele: L, index: L % INDEX_EVERY === 0 ? 1 : 0 },
      });
    }
    console.log(`  ${L} m: ${lines.length} lines`);
  }

  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      source: 'Derived from SRTM/GMTED2010 (AWS Open Data) via scripts/generate-contours.mjs',
      license: 'Public domain (SRTM/GMTED)',
      generated: new Date().toISOString(),
      levels: LEVELS,
      bbox: BBOX,
      count: features.length,
    },
    features,
  };
  await writeFile(OUT, JSON.stringify(geojson) + '\n');
  console.log(`\nWrote ${features.length} contour lines, ${Math.round(JSON.stringify(geojson).length / 1024)} KB -> ${OUT}`);
}

main().catch((err) => {
  console.error('generate-contours failed:', err);
  process.exitCode = 1;
});

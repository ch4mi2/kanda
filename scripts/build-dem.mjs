#!/usr/bin/env node
// Builds a Terrarium z0-12 pyramid for Sri Lanka from the Copernicus GLO-30
// DEM (TanDEM-X radar, ~30 m) into public/tiles/terrain/, the pyramid the app
// serves. The Tilezen Terrarium pyramid from `npm run fetch:terrain`
// (public/tiles/src-terrarium/) is the input for offshore bathymetry and the
// z<=10 base; it is never modified.
//
//   npm run build:dem                 # fetch (resumable) then build
//   node scripts/build-dem.mjs --fetch-only
//
// Then:  npm run check:peaks   and   npm run pack:pmtiles
//
// Why a composite: GLO-30 is land-only (the sea reads 0 m). The shore ramp and
// ocean plane lean on Terrarium's bathymetry, so land pixels come from GLO-30
// and sea pixels keep the Terrarium base value (clamped to <= 0). The land/sea
// split is GLO-30's own water-body mask (WBM class 1 = ocean; lakes and rivers
// are hydro-flattened land), bilinearly feathered so the coast does not step.
//
// z12 is sampled straight from GLO-30. z11..z0 are built by 2x2-averaging the
// four children, so every level agrees with the one below it. Only land comes
// from the children: sea keeps the old tile's value, because z<=11 carry real
// offshore bathymetry that the flat z12 sea would otherwise flatten. Quadrants
// with no child (outside the bbox) keep the old tile entirely.
//
// Sea depth: the old z12 sea is flat 0 m (Terrarium only has bathymetry at
// z<=10), and the shader draws 0 m depth as foam, so zooming in swapped blue
// sea for white. z12 sea pixels therefore get a synthetic depth: the deeper of
// the z10 bathymetry (upsampled) and a gentle shelf ramp from the shore
// (SHORE_SLOPE m per m, topping out at SHORE_MAX_M). Foam then survives only as
// a thin rim at the waterline. z11 and below inherit it via the averaging.
//
// GLO-30 heights are float32; they are rounded to whole metres on encode.

import { mkdir, writeFile, readFile, stat, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fromFile } from 'geotiff';
import { decodePng, encodePng } from './lib/png.mjs';
import { toHeightField, writeHeightField, makeHeightSampler } from './lib/terrarium.mjs';
import { tilesForBbox, tileXToLon, tileYToLat } from './lib/tilemath.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC_DIR = path.join(ROOT, 'public/tiles/src-cop');
const BASE_DIR = path.join(ROOT, 'public/tiles/src-terrarium'); // npm run fetch:terrain
const OUT_DIR = path.join(ROOT, 'public/tiles/terrain'); // what the app serves

const BBOX = [79.5, 5.7, 82.0, 10.0]; // SRI_LANKA_BBOX in src/config/tiles.ts
const MAX_ZOOM = 12;
const BUCKET = 'https://copernicus-dem-30m.s3.amazonaws.com';
const N = 3600; // GLO-30 is 1 arc-second: 3600 px per degree at these latitudes
const WBM_OCEAN = 1; // WBM: 0 none, 1 ocean, 2 lake, 3 river (histogram printed on load)

const exists = (p) => stat(p).then(() => true, () => false);
const cellName = (lat, lon) =>
  `Copernicus_DSM_COG_10_N${String(lat).padStart(2, '0')}_00_E${String(lon).padStart(3, '0')}_00`;

// 1-degree cells (south-west corner) whose extent intersects the bbox.
function cellsForBbox([w, s, e, n]) {
  const cells = [];
  for (let lat = Math.floor(s); lat < Math.ceil(n); lat++) {
    for (let lon = Math.floor(w); lon < Math.ceil(e); lon++) cells.push({ lat, lon });
  }
  return cells;
}

// ---- fetch ----------------------------------------------------------------
async function download(url, dest) {
  const res = await fetch(url);
  if (res.status === 404 || res.status === 403) return 'missing'; // all-ocean cells are not published
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  await rename(part, dest);
  return 'downloaded';
}

async function fetchSources() {
  await mkdir(SRC_DIR, { recursive: true });
  const jobs = [];
  for (const { lat, lon } of cellsForBbox(BBOX)) {
    const n = cellName(lat, lon);
    jobs.push({ url: `${BUCKET}/${n}_DEM/${n}_DEM.tif`, dest: path.join(SRC_DIR, `${n}_DEM.tif`) });
    jobs.push({ url: `${BUCKET}/${n}_DEM/AUXFILES/${n}_WBM.tif`, dest: path.join(SRC_DIR, `${n}_WBM.tif`) });
  }
  let i = 0;
  const tally = { downloaded: 0, skipped: 0, missing: 0 };
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      if (await exists(job.dest)) {
        tally.skipped++;
        continue;
      }
      const r = await download(job.url, job.dest);
      tally[r]++;
      if (r === 'downloaded') console.log(`  fetched ${path.basename(job.dest)}`);
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  console.log(`Sources: ${tally.downloaded} downloaded, ${tally.skipped} already had, ${tally.missing} not published (open ocean)`);
}

// ---- GLO-30 sampler -------------------------------------------------------
async function readBand(file) {
  const tiff = await fromFile(file);
  const img = await tiff.getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  if (img.getWidth() !== N || img.getHeight() !== N || Math.abs(rx - 1 / N) > 1e-9 || Math.abs(ry + 1 / N) > 1e-9 || ox !== Math.round(ox) || oy !== Math.round(oy)) {
    throw new Error(`${path.basename(file)}: expected a ${N}x${N} one-degree cell, got ${img.getWidth()}x${img.getHeight()} origin ${ox},${oy} res ${rx},${ry}`);
  }
  const [band] = await img.readRasters({ interleave: false });
  return { data: band, nodata: img.getGDALNoData() };
}

async function loadCop() {
  const cells = new Map(); // cellKey -> { dem: Float32Array, wbm: Uint8Array, nodata }
  const hist = {};
  for (const { lat, lon } of cellsForBbox(BBOX)) {
    const n = cellName(lat, lon);
    const demFile = path.join(SRC_DIR, `${n}_DEM.tif`);
    const wbmFile = path.join(SRC_DIR, `${n}_WBM.tif`);
    if (!(await exists(demFile))) continue;
    const dem = await readBand(demFile);
    const wbm = (await exists(wbmFile)) ? (await readBand(wbmFile)).data : null;
    if (wbm) for (let i = 0; i < wbm.length; i += 97) hist[wbm[i]] = (hist[wbm[i]] ?? 0) + 1;
    cells.set(lon * 1000 + lat, { dem: dem.data, wbm, nodata: dem.nodata });
    console.log(`  loaded ${n} (${wbm ? 'DEM+WBM' : 'DEM only, no water mask'})`);
  }
  console.log('WBM class histogram (sampled):', JSON.stringify(hist), '(1 = ocean)');

  // Global pixel (gx, gy): gx = floor(lon * N), gy = floor((90 - lat) * N).
  let lastKey = -1;
  let last = null;
  function cell(gx, gy) {
    const lon = Math.floor(gx / N);
    const lat = 90 - Math.floor(gy / N) - 1; // south-west corner of the cell holding this row
    const key = lon * 1000 + lat;
    if (key !== lastKey) {
      lastKey = key;
      last = cells.get(key) ?? null;
    }
    return last;
  }
  return {
    /** Ocean per the water-body mask; an unpublished (all-ocean) cell counts as ocean. */
    isOcean(gx, gy) {
      const c = cell(gx, gy);
      return !c || (c.wbm !== null && c.wbm[(gy % N) * N + (gx % N)] === WBM_OCEAN);
    },
    /** Height in metres of a non-ocean pixel; NaN for a void/nodata pixel. */
    height(gx, gy) {
      const c = cell(gx, gy);
      if (!c) return NaN;
      const h = c.dem[(gy % N) * N + (gx % N)];
      return Number.isFinite(h) && h !== c.nodata ? h : NaN;
    },
  };
}

const SHORE_SLOPE = 0.02; // m of depth per m offshore
const SHORE_MAX_M = 16; // the shader reads >= 14 m as full deep colour
const SHORE_MARGIN = 24; // px of window around a tile; SHORE_MAX_M / SHORE_SLOPE = 800 m ~ 21 px

/** Metres from each pixel of z12 tile (x, y) to the nearest GLO-30 land (3-4 chamfer over a padded window). */
function shoreDistance(cop, z, x, y) {
  const W = 256 + 2 * SHORE_MARGIN;
  const cols = new Int32Array(W);
  const rows = new Int32Array(W);
  for (let i = 0; i < W; i++) {
    const p = i - SHORE_MARGIN;
    cols[i] = Math.floor(tileXToLon(x + (p + 0.5) / 256, z) * N);
    rows[i] = Math.floor((90 - tileYToLat(y + (p + 0.5) / 256, z)) * N);
  }
  const d = new Float32Array(W * W);
  for (let wy = 0; wy < W; wy++) {
    for (let wx = 0; wx < W; wx++) d[wy * W + wx] = cop.isOcean(cols[wx], rows[wy]) ? 1e9 : 0;
  }
  for (let wy = 0; wy < W; wy++) {
    for (let wx = 0; wx < W; wx++) {
      const i = wy * W + wx;
      let v = d[i];
      if (wx > 0) v = Math.min(v, d[i - 1] + 3);
      if (wy > 0) {
        v = Math.min(v, d[i - W] + 3);
        if (wx > 0) v = Math.min(v, d[i - W - 1] + 4);
        if (wx < W - 1) v = Math.min(v, d[i - W + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let wy = W - 1; wy >= 0; wy--) {
    for (let wx = W - 1; wx >= 0; wx--) {
      const i = wy * W + wx;
      let v = d[i];
      if (wx < W - 1) v = Math.min(v, d[i + 1] + 3);
      if (wy < W - 1) {
        v = Math.min(v, d[i + W] + 3);
        if (wx < W - 1) v = Math.min(v, d[i + W + 1] + 4);
        if (wx > 0) v = Math.min(v, d[i + W - 1] + 4);
      }
      d[i] = v;
    }
  }
  const mpp = (40075016.686 * Math.cos((tileYToLat(y + 0.5, z) * Math.PI) / 180)) / (256 * 2 ** z);
  const out = new Float32Array(256 * 256);
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      out[py * 256 + px] = (d[(py + SHORE_MARGIN) * W + px + SHORE_MARGIN] / 3) * mpp;
    }
  }
  return out;
}

/** Positive metres of depth under each pixel of z12 tile (x, y), upsampled from the old z10 sea (land samples ignored). */
async function deepDepth(z10, z, x, y) {
  const scale = 2 ** (10 - z);
  const f = (t, p) => ((t + (p + 0.5) / 256) * scale) * 256 - 0.5;
  const fxs = [];
  const fys = [];
  for (let p = 0; p < 256; p++) {
    fxs.push(f(x, p));
    fys.push(f(y, p));
  }
  const gx0 = Math.floor(fxs[0]);
  const gy0 = Math.floor(fys[0]);
  const gw = Math.floor(fxs[255]) - gx0 + 2;
  const gh = Math.floor(fys[255]) - gy0 + 2;
  const grid = new Float64Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) grid[j * gw + i] = await z10.pixel(gx0 + i, gy0 + j);
  const out = new Float32Array(256 * 256);
  for (let py = 0; py < 256; py++) {
    const gy = Math.floor(fys[py]);
    const ty = fys[py] - gy;
    for (let px = 0; px < 256; px++) {
      const gx = Math.floor(fxs[px]);
      const tx = fxs[px] - gx;
      let wsum = 0;
      let dsum = 0;
      for (let k = 0; k < 4; k++) {
        const h = grid[(gy - gy0 + (k >> 1)) * gw + (gx - gx0 + (k & 1))];
        if (h >= -1) continue;
        const w = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty);
        wsum += w;
        dsum += w * -h;
      }
      out[py * 256 + px] = wsum > 1e-9 ? dsum / wsum : 0;
    }
  }
  return out;
}

/**
 * Terrarium z12 tile: GLO-30 on land, synthetic depth on sea. `oldH` is the
 * previous height field for the tile (or null); `deep` is the z10 sampler.
 * Returns { field, anyLand }.
 */
async function buildTile(cop, z10, z, x, y, oldH) {
  const cols = [];
  const rows = [];
  for (let p = 0; p < 256; p++) {
    const fx = tileXToLon(x + (p + 0.5) / 256, z) * N - 0.5;
    const gx = Math.floor(fx);
    cols.push({ gx, t: fx - gx });
    const fy = (90 - tileYToLat(y + (p + 0.5) / 256, z)) * N - 0.5;
    const gy = Math.floor(fy);
    rows.push({ gy, t: fy - gy });
  }
  const dist = shoreDistance(cop, z, x, y);
  const deep = await deepDepth(z10, z, x, y);
  const out = new Float64Array(256 * 256);
  let anyLand = false;
  for (let py = 0; py < 256; py++) {
    const { gy, t: ty } = rows[py];
    for (let px = 0; px < 256; px++) {
      const { gx, t: tx } = cols[px];
      const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let oceanW = 0;
      let landW = 0;
      let landHW = 0;
      for (let k = 0; k < 4; k++) {
        const cx = gx + (k & 1);
        const cy = gy + (k >> 1);
        if (cop.isOcean(cx, cy)) {
          oceanW += w[k];
          continue;
        }
        const v = cop.height(cx, cy);
        if (!Number.isNaN(v)) {
          landW += w[k];
          landHW += w[k] * v;
        }
      }
      const i = py * 256 + px;
      const old = oldH ? oldH[i] : 0;
      const oceanH = Math.min(old, -Math.max(deep[i], Math.min(SHORE_MAX_M, dist[i] * SHORE_SLOPE)));
      if (oceanW >= 1 - 1e-9) {
        out[i] = oceanH;
        continue;
      }
      anyLand = true;
      const landH = landW > 1e-9 ? landHW / landW : old;
      out[i] = oceanW * oceanH + (1 - oceanW) * landH;
    }
  }
  return { field: out, anyLand };
}

// ---- build ----------------------------------------------------------------
const tilePath = (dir, z, x, y) => path.join(dir, String(z), String(x), `${y}.png`);

async function writeTile(z, x, y, png) {
  const dest = tilePath(OUT_DIR, z, x, y);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, png);
}

async function readPng(file) {
  try {
    return decodePng(await readFile(file));
  } catch {
    return null;
  }
}

async function buildZ12(cop) {
  const tiles = tilesForBbox(BBOX, MAX_ZOOM);
  const z10 = makeHeightSampler(BASE_DIR, 10);
  let land = 0;
  let sea = 0;
  for (const [n, t] of tiles.entries()) {
    const oldImg = await readPng(tilePath(BASE_DIR, t.z, t.x, t.y));
    const { field, anyLand } = await buildTile(cop, z10, t.z, t.x, t.y, oldImg ? toHeightField(oldImg) : null);
    const img = oldImg ?? { width: 256, height: 256, channels: 3, data: Buffer.alloc(256 * 256 * 3) };
    writeHeightField(img, field);
    await writeTile(t.z, t.x, t.y, encodePng(img));
    if (anyLand) land++;
    else sea++;
    if ((n + 1) % 200 === 0) console.log(`  z12 ${n + 1}/${tiles.length}`);
  }
  console.log(`z12: ${land} tiles with land, ${sea} open-sea tiles (depth synthesised)`);
}

async function buildLower() {
  for (let z = MAX_ZOOM - 1; z >= 0; z--) {
    let built = 0;
    for (const t of tilesForBbox(BBOX, z)) {
      const oldImg = await readPng(tilePath(BASE_DIR, z, t.x, t.y));
      const img = oldImg ?? { width: 256, height: 256, channels: 3, data: Buffer.alloc(256 * 256 * 3) };
      const field = oldImg ? toHeightField(oldImg) : new Float64Array(256 * 256);
      // An absent old tile starts at 0 m (flat sea), not the all-zero-bytes -32768 m.
      let any = false;
      for (let q = 0; q < 4; q++) {
        const cx = t.x * 2 + (q & 1);
        const cy = t.y * 2 + (q >> 1);
        const child = await readPng(tilePath(OUT_DIR, z + 1, cx, cy));
        if (!child) continue;
        any = true;
        const c = toHeightField(child);
        for (let py = 0; py < 128; py++) {
          for (let px = 0; px < 128; px++) {
            const a = (py * 2) * 256 + px * 2;
            const avg = (c[a] + c[a + 1] + c[a + 256] + c[a + 257]) / 4;
            // The z12 sea is flat 0 m, but the old z<=11 tiles carry real offshore
            // bathymetry (GEBCO). Averaging may only replace land; for sea keep
            // the old (deeper) value.
            const i = ((q >> 1) * 128 + py) * 256 + (q & 1) * 128 + px;
            field[i] = avg > 0.5 || field[i] >= 0 ? avg : field[i];
          }
        }
      }
      if (!any && !oldImg) continue;
      writeHeightField(img, field);
      await writeTile(z, t.x, t.y, encodePng(img));
      built++;
    }
    console.log(`z${z}: ${built} tiles`);
  }
}

async function main() {
  console.log(`Fetching Copernicus GLO-30 over bbox ${BBOX.join(', ')} into ${SRC_DIR}`);
  await fetchSources();
  if (process.argv.includes('--fetch-only')) return;

  console.log('\nLoading GLO-30 (about 1 GB in memory)...');
  const cop = await loadCop();
  console.log(`\nBuilding ${OUT_DIR}`);
  const start = Date.now();
  await buildZ12(cop);
  await buildLower();
  console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(0)} s.`);
  console.log('Next: npm run check:peaks, then npm run pack:pmtiles');
}

main().catch((err) => {
  console.error('build-dem failed:', err);
  process.exitCode = 1;
});

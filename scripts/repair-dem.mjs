#!/usr/bin/env node
// Repairs the local Terrarium DEM pyramid in public/tiles/terrain/ in place.
//
// Two independent operations, both off by default unless their flag is given
// (running with no flags does nothing but scan and report):
//
//   --repair   Replace radar-void spikes AND pits — any pixel that sits more
//              than ~200 m above or below every one of its 8 neighbours, plus
//              anything physically impossible — with the median of its
//              non-flagged neighbours, iterating so small void blobs erode
//              from the edges. Catches the SRTM voids over the Victoria
//              reservoir (scattered +800..+2,100 m spikes and -1,000..-7,000 m
//              pits in a real ~470 m plateau) and coastline speckle. Because
//              we self-host the tiles we can just fix them; streaming from
//              AWS we could not.
//
//   --smooth   Light 3x3 Gaussian low-pass over LAND pixels only (sea and
//              sub-sea pixels are left untouched and are excluded from every
//              land pixel's average, so coastlines stay crisp). Raw SRTM is
//              noisy by nature; at the exaggerations this app uses that speckle
//              reads as fake micro-ridging. One pass by default; --smooth=N
//              for N passes.
//
// Idempotent: --repair re-run on already-clean tiles changes nothing. --smooth
// is NOT idempotent (each pass blurs further) — that is deliberate, it is a
// tunable knob, compare results by eye. public/tiles/ is gitignored, so a bad
// run costs a re-fetch, not lost work.
//
//   node scripts/repair-dem.mjs --repair
//   node scripts/repair-dem.mjs --repair --smooth
//   node scripts/repair-dem.mjs --smooth=2
//
// Re-run scripts/pack-pmtiles.mjs afterwards to refresh the deployment archive.
//
// Self-contained minimal PNG codec over node:zlib — the plan's "minimal PNG
// reader over zlib". Only handles what the Terrarium tiles actually are:
// 8-bit, non-interlaced, colour type 2 (RGB) or 6 (RGBA).

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { inflateSync, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TILE_DIR = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../public/tiles/terrain',
);

// A pixel is a spike (or pit) when it sits more than SPIKE_MARGIN_M above (or
// below) EVERY one of its 8 neighbours. Real terrain at 30 m/px never does
// this: even the steepest escarpment crest matches its along-crest neighbours,
// so `value - max(neighbours)` stays near zero. An isolated radar-void
// artefact — the Victoria-reservoir voids, coastline speckle — fails against
// all 8. This test is scale-free (works the same at sea level and at 2,000 m),
// which is why the earlier ">2,600 m" version was wrong: it sailed straight
// past a -7,375 m pit sitting next to 470 m terrain.
const SPIKE_MARGIN_M = 200;
// Re-detect and re-fill until the tile is stable. A median-fill can expose a
// neighbour that only now reads as an extremum (or two artefacts hiding each
// other), so one flag-then-fill pass is not enough; ~12 rounds converges even
// the messy Victoria-reservoir tiles.
const REPAIR_ROUNDS = 16;

// Unconditional backstop for values no terrain or ocean on Earth reaches.
const IMPLAUSIBLE_HIGH_M = 3000;
const IMPLAUSIBLE_LOW_M = -12000;

// z7+ tiles are checked. That includes a strip of southern India at z7-8, but
// the spike test is relative so real Western-Ghats terrain is safe; below z7
// the app never renders and a tile spans continents.
const MIN_OP_ZOOM = 7;

// --- CLI ---------------------------------------------------------------------
const args = process.argv.slice(2);
const doRepair = args.includes('--repair');
let smoothPasses = 0;
for (const a of args) {
  if (a === '--smooth') smoothPasses = Math.max(smoothPasses, 1);
  const m = a.match(/^--smooth=(\d+)$/);
  if (m) smoothPasses = Number(m[1]);
}

// --- PNG codec -------------------------------------------------------------
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode an 8-bit non-interlaced RGB/RGBA PNG. Returns {width,height,channels,data}. */
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      colorType = body[9];
      const interlace = body[12];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (colorType !== 2 && colorType !== 6)
        throw new Error(`unsupported colour type ${colorType}`);
      if (interlace !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len; // len + type + body + crc
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= channels ? data[rowStart + x - channels] : 0;
      const b = y > 0 ? data[prevStart + x] : 0;
      const c = y > 0 && x >= channels ? data[prevStart + x - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${filter}`);
      }
      data[rowStart + x] = val & 0xff;
    }
  }
  return { width, height, channels, data };
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Re-encode with filter 0 (None) on every scanline — simplest valid output. */
function encodePng({ width, height, channels, data }) {
  const stride = width * channels;
  const rawSize = (stride + 1) * height;
  const raw = Buffer.alloc(rawSize);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Terrarium encode / decode ------------------------------------------------
const decodeHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;

function encodeHeight(h) {
  let v = Math.round((h + 32768) * 256);
  if (v < 0) v = 0;
  if (v > 0xffffff) v = 0xffffff;
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

// --- per-tile operations -----------------------------------------------------
function toHeightField({ width, height, channels, data }) {
  const h = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    h[i] = decodeHeight(data[p], data[p + 1], data[p + 2]);
  }
  return h;
}

function writeHeightField(img, h, mask) {
  const { width, height, channels, data } = img;
  for (let i = 0; i < width * height; i++) {
    if (mask && !mask[i]) continue;
    const [r, g, b] = encodeHeight(h[i]);
    const p = i * channels;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
  }
}

/** 3x3 neighbour values around pixel (x,y), skipping the centre and any that
 *  fall outside the tile or are flagged bad. */
function neighbours(h, width, height, x, y, bad) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (bad && bad[j]) continue;
      out.push(h[j]);
    }
  }
  return out;
}

/** Is pixel i a strict local extremum — above (or below) every valid
 *  neighbour by SPIKE_MARGIN_M — or just physically impossible? */
function isSpike(h, width, height, i, bad) {
  const v = h[i];
  if (v > IMPLAUSIBLE_HIGH_M || v < IMPLAUSIBLE_LOW_M) return true;
  const x = i % width;
  const y = (i / width) | 0;
  const ns = neighbours(h, width, height, x, y, bad);
  if (ns.length < 3) return false; // not enough context to judge
  let mn = Infinity;
  let mx = -Infinity;
  for (const nv of ns) {
    if (nv < mn) mn = nv;
    if (nv > mx) mx = nv;
  }
  return v - mx > SPIKE_MARGIN_M || mn - v > SPIKE_MARGIN_M;
}

/** Repair every spike/pit in the tile, re-detecting between rounds so a fill
 *  that exposes a fresh extremum is caught in the same run. Returns the audit
 *  list of {x,y,from,to}. */
function repairSpikes(h, width, height) {
  const repairs = [];
  for (let round = 0; round < REPAIR_ROUNDS; round++) {
    const bad = new Uint8Array(width * height);
    let any = false;
    for (let i = 0; i < h.length; i++) {
      if (isSpike(h, width, height, i, null)) {
        bad[i] = 1;
        any = true;
      }
    }
    if (!any) break;

    // Erode the flagged set from its edges: fill each bad pixel from the
    // median of its currently non-flagged neighbours, over a few sub-passes.
    for (let sub = 0; sub < 6; sub++) {
      let fixed = 0;
      for (let i = 0; i < h.length; i++) {
        if (!bad[i]) continue;
        const x = i % width;
        const y = (i / width) | 0;
        const ns = neighbours(h, width, height, x, y, bad);
        if (ns.length === 0) continue;
        ns.sort((a, b) => a - b);
        const med = ns[ns.length >> 1];
        repairs.push({
          x,
          y,
          from: Math.round(h[i] * 100) / 100,
          to: Math.round(med * 100) / 100,
        });
        h[i] = med;
        bad[i] = 0;
        fixed++;
      }
      if (fixed === 0) break;
    }
  }
  return repairs;
}

/** Count spikes without modifying anything (scan-only mode). */
function countSpikes(h, width, height) {
  let n = 0;
  for (let i = 0; i < h.length; i++) if (isSpike(h, width, height, i, null)) n++;
  return n;
}

const GAUSS = [1, 2, 1, 2, 4, 2, 1, 2, 1];

/** One 3x3 Gaussian pass over land pixels (h > 0), averaging only land
 *  neighbours. Returns count of pixels changed. */
function smoothLand(h, width, height) {
  const out = Float64Array.from(h);
  let changed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (h[i] <= 0) continue;
      let sum = 0;
      let wsum = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++, k++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nv = h[ny * width + nx];
          if (nv <= 0) continue; // keep the coastline crisp
          sum += nv * GAUSS[k];
          wsum += GAUSS[k];
        }
      }
      if (wsum > 0) {
        const nv = sum / wsum;
        if (nv !== h[i]) changed++;
        out[i] = nv;
      }
    }
  }
  out.forEach((v, i) => (h[i] = v));
  return changed;
}

// --- walk -------------------------------------------------------------------
async function collectTiles() {
  const tiles = [];
  let zDirs;
  try {
    zDirs = await readdir(TILE_DIR);
  } catch {
    console.error(`No tile directory at ${TILE_DIR}. Run "npm run fetch:terrain" first.`);
    process.exit(1);
  }
  for (const z of zDirs) {
    if (!Number.isInteger(Number(z))) continue;
    const zPath = path.join(TILE_DIR, z);
    if (!(await stat(zPath)).isDirectory()) continue;
    for (const x of await readdir(zPath)) {
      if (!Number.isInteger(Number(x))) continue;
      const xPath = path.join(zPath, x);
      for (const file of await readdir(xPath)) {
        if (!file.endsWith('.png')) continue;
        tiles.push({ z: Number(z), x: Number(x), y: Number(file.slice(0, -4)), file: path.join(xPath, file) });
      }
    }
  }
  return tiles;
}

async function main() {
  const tiles = await collectTiles();
  console.log(`Scanning ${tiles.length} tiles in ${TILE_DIR}`);
  if (!doRepair && !smoothPasses) {
    console.log('No operation flag given (--repair / --smooth). Scanning only.\n');
  } else {
    console.log(
      `Operations: ${[doRepair && 'repair', smoothPasses && `smooth x${smoothPasses}`]
        .filter(Boolean)
        .join(' + ')}\n`,
    );
  }

  let scannedVoids = 0;
  let repairedPixels = 0;
  let repairedTiles = 0;
  let smoothedTiles = 0;
  let rewritten = 0;

  let skippedLowZoom = 0;
  for (const t of tiles) {
    if (t.z < MIN_OP_ZOOM) {
      skippedLowZoom++;
      continue;
    }
    let img;
    try {
      img = decodePng(await readFile(t.file));
    } catch (err) {
      console.warn(`  skip ${t.z}/${t.x}/${t.y}: ${err.message}`);
      continue;
    }
    const h = toHeightField(img);
    let dirty = false;

    // Always scan and report, even in scan-only mode.
    const spikeCount = countSpikes(h, img.width, img.height);
    if (spikeCount) {
      scannedVoids += spikeCount;
      console.log(`  ${t.z}/${t.x}/${t.y}: ${spikeCount} spike/pit pixel(s)`);
    }

    if (doRepair) {
      const repairs = repairSpikes(h, img.width, img.height);
      if (repairs.length) {
        repairedTiles++;
        repairedPixels += repairs.length;
        for (const r of repairs) {
          console.log(
            `    repair ${t.z}/${t.x}/${t.y} px(${r.x},${r.y}): ${r.from} m -> ${r.to} m`,
          );
        }
        dirty = true;
      }
    }

    if (smoothPasses) {
      let changed = 0;
      for (let p = 0; p < smoothPasses; p++) changed += smoothLand(h, img.width, img.height);
      if (changed) {
        smoothedTiles++;
        dirty = true;
      }
    }

    if (dirty) {
      writeHeightField(img, h);
      await writeFile(t.file, encodePng(img));
      rewritten++;
    }
  }

  console.log('\nDone.');
  console.log(`  z0-${MIN_OP_ZOOM - 1} tiles skipped:   ${skippedLowZoom}`);
  console.log(`  spike/pit pixels found: ${scannedVoids}`);
  if (doRepair) {
    console.log(`  pixels repaired:       ${repairedPixels} across ${repairedTiles} tile(s)`);
  }
  if (smoothPasses) {
    console.log(`  tiles smoothed:        ${smoothedTiles} (${smoothPasses} pass(es))`);
  }
  console.log(`  tiles rewritten:       ${rewritten}`);
  if (rewritten) {
    console.log('\nRe-run "npm run pack:pmtiles" to refresh the deployment archive.');
  }
}

main().catch((err) => {
  console.error('repair-dem failed:', err);
  process.exitCode = 1;
});

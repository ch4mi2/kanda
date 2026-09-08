#!/usr/bin/env node
// Packs the loose Terrarium PNG pyramid in public/tiles/terrain/ into a
// single PMTiles v3 archive at public/tiles/terrain.pmtiles.
//
// Why: a directory of ~2,024 PNGs is a terrible deployment artifact (2,024
// requests, awkward to upload, no range support). One PMTiles file is served
// from any static host / object store and MapLibre reads individual tiles
// out of it with HTTP range requests via the pmtiles:// protocol.
//
//   npm run pack:pmtiles
//   # then set VITE_TILE_MODE=pmtiles
//
// Self-contained PMTiles v3 writer — the `pmtiles` npm package only ships a
// reader. Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3.md

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zxyToTileId } from 'pmtiles';

const TILE_DIR = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../public/tiles/terrain',
);
const OUT_FILE = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../public/tiles/terrain.pmtiles',
);

// Same bbox as fetch-terrain.mjs / SRI_LANKA_BBOX.
const BBOX = { west: 79.5, south: 5.7, east: 82.0, north: 10.0 };
const CENTER_ZOOM = 8;

const COMPRESSION_NONE = 1;
const COMPRESSION_GZIP = 2;
const TILETYPE_PNG = 2;

/** unsigned LEB128 */
function writeVarint(arr, n) {
  while (n >= 0x80) {
    arr.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  arr.push(n);
}

function serializeDirectory(entries) {
  const out = [];
  writeVarint(out, entries.length);
  let lastId = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    if (
      i > 0 &&
      entries[i].offset === entries[i - 1].offset + entries[i - 1].length
    ) {
      writeVarint(out, 0);
    } else {
      writeVarint(out, entries[i].offset + 1);
    }
  }
  return Buffer.from(out);
}

async function collectTiles() {
  const tiles = [];
  const zDirs = await readdir(TILE_DIR);
  for (const z of zDirs) {
    const zNum = Number(z);
    if (!Number.isInteger(zNum)) continue;
    const zPath = path.join(TILE_DIR, z);
    if (!(await stat(zPath)).isDirectory()) continue;
    for (const x of await readdir(zPath)) {
      const xNum = Number(x);
      if (!Number.isInteger(xNum)) continue;
      const xPath = path.join(zPath, x);
      for (const file of await readdir(xPath)) {
        if (!file.endsWith('.png')) continue;
        const yNum = Number(file.slice(0, -4));
        if (!Number.isInteger(yNum)) continue;
        tiles.push({ z: zNum, x: xNum, y: yNum, file: path.join(xPath, file) });
      }
    }
  }
  return tiles;
}

function i32(deg) {
  return Math.round(deg * 1e7);
}

async function main() {
  const tiles = await collectTiles();
  if (tiles.length === 0) {
    console.error(
      `No tiles found in ${TILE_DIR}. Run "npm run fetch:terrain" first.`,
    );
    process.exitCode = 1;
    return;
  }

  tiles.forEach((t) => {
    t.tileId = zxyToTileId(t.z, t.x, t.y);
  });
  tiles.sort((a, b) => a.tileId - b.tileId);

  let minZoom = Infinity;
  let maxZoom = -Infinity;
  for (const t of tiles) {
    minZoom = Math.min(minZoom, t.z);
    maxZoom = Math.max(maxZoom, t.z);
  }

  // Build clustered tile-data blob + run-length-encoded directory entries,
  // deduplicating identical tile contents (common for ocean/no-data tiles).
  const dataChunks = [];
  let dataLen = 0;
  const seen = new Map(); // sha1 -> { offset, length }
  const entries = [];
  let addressed = 0;

  for (const t of tiles) {
    const buf = await readFile(t.file);
    addressed++;
    const hash = createHash('sha1').update(buf).digest('hex');
    let loc = seen.get(hash);
    if (!loc) {
      loc = { offset: dataLen, length: buf.length };
      seen.set(hash, loc);
      dataChunks.push(buf);
      dataLen += buf.length;
    }
    const last = entries[entries.length - 1];
    if (
      last &&
      last.offset === loc.offset &&
      last.tileId + last.runLength === t.tileId
    ) {
      last.runLength++;
    } else {
      entries.push({
        tileId: t.tileId,
        offset: loc.offset,
        length: loc.length,
        runLength: 1,
      });
    }
  }

  const tileData = Buffer.concat(dataChunks, dataLen);
  const rootDir = gzipSync(serializeDirectory(entries));
  const metadata = gzipSync(
    Buffer.from(
      JSON.stringify({
        name: 'kanda-terrain',
        description: 'Terrarium-encoded SRTM/GMTED2010 DEM for Sri Lanka',
        format: 'png',
        type: 'baselayer',
      }),
    ),
  );

  const HEADER_LEN = 127;
  const rootDirOffset = HEADER_LEN;
  const metadataOffset = rootDirOffset + rootDir.length;
  const leafDirOffset = metadataOffset + metadata.length;
  const leafDirLength = 0;
  const tileDataOffset = leafDirOffset + leafDirLength;

  const header = Buffer.alloc(HEADER_LEN);
  header.write('PMTiles', 0, 'ascii');
  header.writeUInt8(3, 7);
  header.writeBigUInt64LE(BigInt(rootDirOffset), 8);
  header.writeBigUInt64LE(BigInt(rootDir.length), 16);
  header.writeBigUInt64LE(BigInt(metadataOffset), 24);
  header.writeBigUInt64LE(BigInt(metadata.length), 32);
  header.writeBigUInt64LE(BigInt(leafDirOffset), 40);
  header.writeBigUInt64LE(BigInt(leafDirLength), 48);
  header.writeBigUInt64LE(BigInt(tileDataOffset), 56);
  header.writeBigUInt64LE(BigInt(tileData.length), 64);
  header.writeBigUInt64LE(BigInt(addressed), 72); // num addressed tiles
  header.writeBigUInt64LE(BigInt(entries.length), 80); // num tile entries
  header.writeBigUInt64LE(BigInt(seen.size), 88); // num tile contents
  header.writeUInt8(1, 96); // clustered
  header.writeUInt8(COMPRESSION_GZIP, 97); // internal compression
  header.writeUInt8(COMPRESSION_NONE, 98); // tile compression (PNG as-is)
  header.writeUInt8(TILETYPE_PNG, 99);
  header.writeUInt8(minZoom, 100);
  header.writeUInt8(maxZoom, 101);
  header.writeInt32LE(i32(BBOX.west), 102);
  header.writeInt32LE(i32(BBOX.south), 106);
  header.writeInt32LE(i32(BBOX.east), 110);
  header.writeInt32LE(i32(BBOX.north), 114);
  header.writeUInt8(CENTER_ZOOM, 118);
  header.writeInt32LE(i32((BBOX.west + BBOX.east) / 2), 119);
  header.writeInt32LE(i32((BBOX.south + BBOX.north) / 2), 123);

  await writeFile(OUT_FILE, Buffer.concat([header, rootDir, metadata, tileData]));

  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  ${addressed} tiles (z${minZoom}-z${maxZoom})`);
  console.log(`  ${entries.length} directory entries, ${seen.size} unique contents`);
  console.log(`  root dir ${rootDir.length} B (gzip), tile data ${mb(tileData.length)} MB`);
  if (rootDir.length > 16384) {
    console.warn(
      '  WARNING: root directory exceeds 16 KB — some strict readers expect leaf directories here.',
    );
  }
}

main().catch((err) => {
  console.error('pack-pmtiles failed:', err);
  process.exitCode = 1;
});

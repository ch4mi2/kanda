#!/usr/bin/env node
// Packs a loose {z}/{x}/{y}.png tile pyramid into a single PMTiles v3 archive.
//
//   npm run pack:pmtiles      # public/tiles/terrain/  -> terrain.pmtiles
//   npm run pack:texture      # public/tiles/texture/  -> texture.pmtiles
//   node scripts/pack-pmtiles.mjs --dir <in> --out <file.pmtiles> --name <id>
//                               [--bbox w,s,e,n] [--center-zoom N] [--desc "…"]
//
// Why: a directory of thousands of PNGs is a terrible deployment artifact
// (one request each, no range support). One PMTiles file is served from any
// static host and MapLibre reads individual tiles out of it with HTTP range
// requests via the pmtiles:// protocol.
//
// Self-contained PMTiles v3 writer — the `pmtiles` npm package only ships a
// reader. Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3.md

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { zxyToTileId } from 'pmtiles';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Same bbox as fetch-terrain.mjs / SRI_LANKA_BBOX — the whole island. The
// texture archive uses it too (its z10-12 base is island-wide).
const SRI_LANKA_BBOX = { west: 79.5, south: 5.7, east: 82.0, north: 10.0 };

const COMPRESSION_NONE = 1;
const COMPRESSION_GZIP = 2;
const TILETYPE_PNG = 2;
// PMTiles readers expect the root directory to fit in a 16 KiB range request.
// Spill at 12 KiB so there's headroom and the texture archive (~15 KiB flat)
// actually exercises the leaf path — which is round-trip tested. Terrain
// (~3.9 KiB) stays flat and byte-identical to the pre-refactor writer.
const MAX_ROOT_DIR_BYTES = 12288;

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

/**
 * Serialize the tile index as a root directory, spilling into leaf directories
 * when the gzipped root would exceed 16 KiB (the texture archive, ~7.5k
 * entries, needs this; terrain does not and comes out byte-identical to the
 * pre-refactor writer).
 *
 * Leaf pointers are marked by `runLength === 0`; their `offset` is relative to
 * `leaf_directories_offset`, whereas a real entry's `offset` is relative to
 * `tile_data_offset`. Partitioning the already-run-length-encoded `entries`
 * list into fixed-size chunks keeps every run inside a single leaf, so
 * serializeDirectory's contiguity collapse never crosses a leaf boundary.
 */
function buildDirectories(entries) {
  const flat = gzipSync(serializeDirectory(entries));
  if (flat.length <= MAX_ROOT_DIR_BYTES) {
    return { rootDir: flat, leaves: Buffer.alloc(0) };
  }
  // Start near sqrt(n) so leaf count ~= root-entry count (one extra range
  // request of a right-sized leaf), then double the leaf size until the root
  // directory gzips under the limit.
  let leafSize = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  for (;;) {
    const leafBufs = [];
    const rootEntries = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const chunk = entries.slice(i, i + leafSize);
      const gz = gzipSync(serializeDirectory(chunk));
      rootEntries.push({
        tileId: chunk[0].tileId,
        offset, // within the leaf-directories section
        length: gz.length,
        runLength: 0, // marks a leaf pointer
      });
      leafBufs.push(gz);
      offset += gz.length;
    }
    const rootDir = gzipSync(serializeDirectory(rootEntries));
    if (rootDir.length <= MAX_ROOT_DIR_BYTES) {
      return { rootDir, leaves: Buffer.concat(leafBufs, offset) };
    }
    leafSize *= 2;
    if (leafSize >= entries.length) {
      throw new Error('pack-pmtiles: cannot fit the root directory under 16 KiB');
    }
  }
}

async function collectTiles(dir) {
  const tiles = [];
  const zDirs = await readdir(dir);
  for (const z of zDirs) {
    const zNum = Number(z);
    if (!Number.isInteger(zNum)) continue;
    const zPath = path.join(dir, z);
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

export async function packPmtiles({
  tileDir,
  outFile,
  name,
  description,
  bbox = SRI_LANKA_BBOX,
  centerZoom = 8,
}) {
  const tiles = await collectTiles(tileDir);
  if (tiles.length === 0) {
    throw new Error(`No tiles found in ${tileDir}.`);
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

  // Clustered tile-data blob + run-length-encoded directory entries,
  // deduplicating identical tile contents (ocean/no-data, empty texture tiles).
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
  const { rootDir, leaves } = buildDirectories(entries);
  const metadata = gzipSync(
    Buffer.from(
      JSON.stringify({
        name,
        description,
        format: 'png',
        type: 'baselayer',
      }),
    ),
  );

  const HEADER_LEN = 127;
  const rootDirOffset = HEADER_LEN;
  const metadataOffset = rootDirOffset + rootDir.length;
  const leafDirOffset = metadataOffset + metadata.length;
  const tileDataOffset = leafDirOffset + leaves.length;

  const header = Buffer.alloc(HEADER_LEN);
  header.write('PMTiles', 0, 'ascii');
  header.writeUInt8(3, 7);
  header.writeBigUInt64LE(BigInt(rootDirOffset), 8);
  header.writeBigUInt64LE(BigInt(rootDir.length), 16);
  header.writeBigUInt64LE(BigInt(metadataOffset), 24);
  header.writeBigUInt64LE(BigInt(metadata.length), 32);
  header.writeBigUInt64LE(BigInt(leafDirOffset), 40);
  header.writeBigUInt64LE(BigInt(leaves.length), 48);
  header.writeBigUInt64LE(BigInt(tileDataOffset), 56);
  header.writeBigUInt64LE(BigInt(tileData.length), 64);
  header.writeBigUInt64LE(BigInt(addressed), 72); // num addressed tiles
  header.writeBigUInt64LE(BigInt(entries.length), 80); // num tile entries (root + leaves)
  header.writeBigUInt64LE(BigInt(seen.size), 88); // num tile contents
  header.writeUInt8(1, 96); // clustered
  header.writeUInt8(COMPRESSION_GZIP, 97); // internal compression
  header.writeUInt8(COMPRESSION_NONE, 98); // tile compression (PNG as-is)
  header.writeUInt8(TILETYPE_PNG, 99);
  header.writeUInt8(minZoom, 100);
  header.writeUInt8(maxZoom, 101);
  header.writeInt32LE(i32(bbox.west), 102);
  header.writeInt32LE(i32(bbox.south), 106);
  header.writeInt32LE(i32(bbox.east), 110);
  header.writeInt32LE(i32(bbox.north), 114);
  header.writeUInt8(centerZoom, 118);
  header.writeInt32LE(i32((bbox.west + bbox.east) / 2), 119);
  header.writeInt32LE(i32((bbox.south + bbox.north) / 2), 123);

  await writeFile(outFile, Buffer.concat([header, rootDir, metadata, leaves, tileData]));

  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  console.log(`Wrote ${outFile}`);
  console.log(`  ${addressed} tiles (z${minZoom}-z${maxZoom})`);
  console.log(`  ${entries.length} directory entries, ${seen.size} unique contents`);
  console.log(
    `  root dir ${rootDir.length} B (gzip)` +
      (leaves.length ? `, ${leaves.length} B leaf directories` : ', no leaves') +
      `, tile data ${mb(tileData.length)} MB`,
  );
}

const DEFAULTS = {
  terrain: {
    tileDir: path.join(ROOT, 'public/tiles/terrain'),
    outFile: path.join(ROOT, 'public/tiles/terrain.pmtiles'),
    name: 'kanda-terrain',
    description: 'Terrarium-encoded SRTM/GMTED2010 DEM for Sri Lanka',
    centerZoom: 8,
  },
};

async function main() {
  const argv = process.argv.slice(2);
  const opts = { ...DEFAULTS.terrain };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.tileDir = path.resolve(argv[++i]);
    else if (a === '--out') opts.outFile = path.resolve(argv[++i]);
    else if (a === '--name') opts.name = argv[++i];
    else if (a === '--desc') opts.description = argv[++i];
    else if (a === '--center-zoom') opts.centerZoom = Number(argv[++i]);
    else if (a === '--bbox') {
      const [west, south, east, north] = argv[++i].split(',').map(Number);
      opts.bbox = { west, south, east, north };
    }
  }
  await packPmtiles(opts);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('pack-pmtiles failed:', err);
    process.exitCode = 1;
  });
}

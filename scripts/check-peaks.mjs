#!/usr/bin/env node
// Compares DEM height at each OSM peak against its tagged `ele`, for the
// Tilezen Terrarium base (SRTM) and the Copernicus pyramid the app serves. The
// objective "is the DEM better" number for Phase 8A.
//
//   npm run check:peaks
//   node scripts/check-peaks.mjs [--old public/tiles/src-terrarium] [--new public/tiles/terrain]
//
// Two readings per DEM: the bilinear height AT the OSM point, and the highest
// pixel within 1 px of it (OSM nodes often sit a pixel off the true summit, so
// the second isolates DEM error from placement error). Only peaks with an
// `ele` tag count (115 of 198 at time of writing).

import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeHeightSampler } from './lib/terrarium.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? path.resolve(argv[i + 1]) : def;
};
const OLD_DIR = arg('--old', path.join(ROOT, 'public/tiles/src-terrarium'));
const NEW_DIR = arg('--new', path.join(ROOT, 'public/tiles/terrain'));

const exists = (p) => stat(p).then(() => true, () => false);

const geo = JSON.parse(await readFile(path.join(ROOT, 'src/data/peaks.geojson'), 'utf8'));
const peaks = geo.features
  .filter((f) => f.properties.ele != null && f.properties.ele !== '' && Number.isFinite(Number(f.properties.ele)))
  .map((f) => ({
    name: f.properties.name ?? `#${f.properties.id}`,
    ele: Number(f.properties.ele),
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

async function measure(label, dir) {
  const s = makeHeightSampler(dir, 12);
  const rows = [];
  for (const p of peaks) {
    const at = await s.at(p.lon, p.lat);
    const near = await s.maxNear(p.lon, p.lat, 1);
    rows.push({ ...p, atErr: at - p.ele, nearErr: near - p.ele });
  }
  const stats = (key) => {
    const e = rows.map((r) => r[key]);
    const n = e.length;
    return {
      mean: e.reduce((a, b) => a + b, 0) / n,
      rms: Math.sqrt(e.reduce((a, b) => a + b * b, 0) / n),
      mae: e.reduce((a, b) => a + Math.abs(b), 0) / n,
      med: [...e].map(Math.abs).sort((a, b) => a - b)[Math.floor(n / 2)],
    };
  };
  const at = stats('atErr');
  const near = stats('nearErr');
  console.log(`\n${label}  (${dir})  n=${rows.length}`);
  console.log('                       mean     RMS     MAE  median|e|  (metres, DEM - ele)');
  console.log(`  at OSM point     ${at.mean.toFixed(1).padStart(8)} ${at.rms.toFixed(1).padStart(7)} ${at.mae.toFixed(1).padStart(7)} ${at.med.toFixed(1).padStart(9)}`);
  console.log(`  max within 1 px  ${near.mean.toFixed(1).padStart(8)} ${near.rms.toFixed(1).padStart(7)} ${near.mae.toFixed(1).padStart(7)} ${near.med.toFixed(1).padStart(9)}`);
  const worst = [...rows].sort((a, b) => Math.abs(b.atErr) - Math.abs(a.atErr)).slice(0, 10);
  console.log('  worst 10 (at OSM point):');
  for (const r of worst) {
    console.log(
      `    ${r.name.padEnd(26)} ele ${String(r.ele).padStart(5)}  err ${r.atErr.toFixed(0).padStart(5)}  (near ${r.nearErr.toFixed(0).padStart(5)})`,
    );
  }
  return { rows, at, near };
}

const old = await measure('Terrarium base (SRTM)', OLD_DIR);
if (await exists(NEW_DIR)) {
  const cop = await measure('Copernicus GLO-30', NEW_DIR);
  console.log('\nRMS change, at point:   ', (cop.at.rms - old.at.rms).toFixed(1), 'm (negative = better)');
  console.log('RMS change, within 1 px:', (cop.near.rms - old.near.rms).toFixed(1), 'm');
} else {
  console.log(`\n${NEW_DIR} not found; run npm run build:dem first.`);
}

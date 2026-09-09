#!/usr/bin/env node
// Queries Overpass once for Sri Lanka's water bodies and major rivers, then
// writes small committed GeoJSON files. Same rationale as fetch-peaks.mjs: the
// app never calls Overpass at runtime.
//
// The full dataset is ~16k water polygons — far too big to commit or ship. We
// keep only what reads at this app's zooms (island to massif): water bodies
// between MIN_WATER_HA and MAX_WATER_HA (excludes paddy-field tanks and the
// ocean polygon), and named rivers. Geometry is Douglas-Peucker simplified.
//
//   node scripts/fetch-osm-features.mjs

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const BBOX = '5.7,79.5,10.0,82.0'; // Overpass order: S,W,N,E

const MIN_WATER_HA = 50; // smaller = village tank, a couple of px at z10
const MAX_WATER_HA = 60000; // larger = the sea polygon or a mega-lagoon blob
const MIN_FOREST_HA = 700; // only the big blocks / named reserves
const MAX_FOREST_HA = 120000; // guard against a country-sized "wood" polygon
const SIMPLIFY_DEG = 0.0005; // ~55 m — plenty at z13, near the DEM's own limit
const SIMPLIFY_FOREST_DEG = 0.0006; // ~65 m — enough to stay smooth, not spiky

const OUT_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/data');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: '*/*',
          'User-Agent': 'SriLankaMountains/0.1 (contact: chamithu4@gmail.com)',
        },
        body: 'data=' + encodeURIComponent(query),
      });
      if (res.ok) return res.json();
      console.log(`  attempt ${i + 1}: ${res.status} ${res.statusText}, backing off`);
    } catch (err) {
      console.log(`  attempt ${i + 1}: ${err.message}, backing off`);
    }
    await sleep(5000 * (i + 1)); // Overpass rate-limits hard; be patient
  }
  throw new Error('Overpass unreachable');
}

// --- geometry helpers -------------------------------------------------------
function ringAreaHa(pts) {
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  }
  const latM = 111_000;
  const lonM = 111_000 * Math.cos((pts[0][1] * Math.PI) / 180);
  return (Math.abs(a / 2) * latM * lonM) / 10_000;
}

/** Douglas-Peucker in degrees (fine for a ~600 km island). */
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
    const len2 = dx * dx + dy * dy || 1e-12;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = pts[i];
      const t = ((px - ax) * dx + (py - ay) * dy) / len2;
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

const toRing = (geom) => geom.map((p) => [Number(p.lon.toFixed(5)), Number(p.lat.toFixed(5))]);
const closed = (r) => r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];

// --- water bodies ----------------------------------------------------------
async function fetchWater() {
  console.log('Querying water bodies...');
  const data = await overpass(`
    [out:json][timeout:180];
    (
      way[natural=water](${BBOX});
      way[landuse=reservoir](${BBOX});
      relation[natural=water](${BBOX});
    );
    out geom;
  `);

  const polys = [];
  for (const el of data.elements ?? []) {
    const members =
      el.type === 'relation'
        ? (el.members ?? []).filter((m) => m.type === 'way' && m.geometry)
        : [el];
    for (const m of members) {
      const geom = m.geometry;
      if (!geom || geom.length < 4) continue;
      let ring = toRing(geom);
      if (!closed(ring)) ring.push(ring[0]);
      const ha = ringAreaHa(ring);
      if (ha < MIN_WATER_HA || ha > MAX_WATER_HA) continue;
      ring = simplify(ring, SIMPLIFY_DEG);
      if (ring.length < 4) continue;
      if (!closed(ring)) ring.push(ring[0]);
      polys.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          name: el.tags?.name ?? null,
          kind: el.tags?.water ?? el.tags?.landuse ?? 'water',
          ha: Math.round(ha),
        },
      });
    }
  }
  polys.sort((a, b) => b.properties.ha - a.properties.ha);
  return polys;
}

// --- forest blocks -------------------------------------------------------
async function fetchForest() {
  console.log('Querying forest blocks...');
  const data = await overpass(`
    [out:json][timeout:180];
    (
      way[natural=wood](${BBOX});
      way[landuse=forest](${BBOX});
      relation[natural=wood](${BBOX});
      relation[landuse=forest](${BBOX});
    );
    out geom;
  `);

  const polys = [];
  for (const el of data.elements ?? []) {
    const members =
      el.type === 'relation'
        ? (el.members ?? []).filter((m) => m.type === 'way' && m.geometry)
        : [el];
    for (const m of members) {
      if (!m.geometry || m.geometry.length < 4) continue;
      let ring = toRing(m.geometry);
      if (!closed(ring)) ring.push(ring[0]);
      const ha = ringAreaHa(ring);
      if (ha < MIN_FOREST_HA || ha > MAX_FOREST_HA) continue;
      ring = simplify(ring, SIMPLIFY_FOREST_DEG);
      if (!closed(ring)) ring.push(ring[0]);
      // Drop anything simplification degraded into a sliver — a big forest
      // shrunk to a triangle jutting off the terrain is worse than no forest.
      if (ring.length < 6) continue;
      if (ringAreaHa(ring) < 0.55 * ha) continue;
      polys.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { name: el.tags?.name ?? null, ha: Math.round(ha) },
      });
    }
  }
  polys.sort((a, b) => b.properties.ha - a.properties.ha);
  return polys;
}

// --- rivers (named lines) ------------------------------------------------
async function fetchRivers() {
  console.log('Querying named rivers...');
  const data = await overpass(`
    [out:json][timeout:180];
    ( way[waterway=river][name](${BBOX}); );
    out geom;
  `);

  const lines = [];
  for (const el of data.elements ?? []) {
    if (!el.geometry || el.geometry.length < 2) continue;
    const line = simplify(toRing(el.geometry), SIMPLIFY_DEG);
    if (line.length < 2) continue;
    lines.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line },
      properties: { name: el.tags?.name ?? null },
    });
  }
  return lines;
}

function wrap(features, extra) {
  return {
    type: 'FeatureCollection',
    metadata: {
      source: 'OpenStreetMap via Overpass API',
      license: 'ODbL',
      fetched: new Date().toISOString(),
      count: features.length,
      ...extra,
    },
    features,
  };
}

async function main() {
  const water = await fetchWater();
  const forest = await fetchForest();
  const rivers = await fetchRivers();

  await writeFile(
    path.join(OUT_DIR, 'water.geojson'),
    JSON.stringify(wrap(water, { minHa: MIN_WATER_HA, maxHa: MAX_WATER_HA })) + '\n',
  );
  await writeFile(
    path.join(OUT_DIR, 'forest.geojson'),
    JSON.stringify(wrap(forest, { minHa: MIN_FOREST_HA })) + '\n',
  );
  await writeFile(
    path.join(OUT_DIR, 'rivers.geojson'),
    JSON.stringify(wrap(rivers)) + '\n',
  );

  const kb = (o) => Math.round(JSON.stringify(o).length / 1024);
  console.log(`\nwater.geojson  : ${water.length} bodies, ${kb(wrap(water))} KB`);
  console.log(`  biggest: ${water.slice(0, 5).map((f) => `${f.properties.name ?? '?'} ${f.properties.ha}ha`).join(', ')}`);
  console.log(`forest.geojson : ${forest.length} blocks, ${kb(wrap(forest))} KB`);
  console.log(`  biggest: ${forest.slice(0, 5).map((f) => `${f.properties.name ?? '?'} ${f.properties.ha}ha`).join(', ')}`);
  console.log(`rivers.geojson : ${rivers.length} rivers, ${kb(wrap(rivers))} KB`);
}

main().catch((err) => {
  console.error('fetch-osm-features failed:', err);
  process.exitCode = 1;
});

#!/usr/bin/env node
// Queries the Overpass API once for every named peak in Sri Lanka and writes
// a committed GeoJSON file. Run manually with `node scripts/fetch-peaks.mjs`
// whenever OSM data should be refreshed — the app never calls Overpass
// itself (rate-limited, slow, not suitable for a runtime dependency).

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// [south, west, north, east] — Overpass bbox order, matches SRI_LANKA_BBOX
// in src/config/tiles.ts ([west, south, east, north]) rearranged.
const QUERY = `
[out:json][timeout:90];
node[natural=peak][name](5.7,79.5,10.0,82.0);
out body;
`;

const OUT_PATH = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../src/data/peaks.geojson',
);

function parseElevation(raw) {
  if (raw == null) return null;
  const n = Number.parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function fetchWithRetry(url, body, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      // Overpass's Apache front-end returns 406 without an explicit Accept
      // header, and form-encoded body is more reliable than a raw text/plain
      // POST across mirrors.
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: '*/*',
          'User-Agent': 'SriLankaMountains/0.1 (contact: chamithu4@gmail.com)',
        },
        body: 'data=' + encodeURIComponent(body),
      });
      if (res.ok) return res;
      lastErr = new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      lastErr = err;
    }
    console.log(`  attempt ${i + 1} failed (${lastErr.message}), retrying...`);
  }
  throw lastErr;
}

async function main() {
  console.log('Querying Overpass for named peaks in Sri Lanka...');
  const res = await fetchWithRetry(OVERPASS_URL, QUERY);

  const data = await res.json();
  const elements = data.elements ?? [];
  console.log(`Received ${elements.length} peak nodes.`);

  const features = elements
    .map((el) => {
      const tags = el.tags ?? {};
      const ele = parseElevation(tags.ele);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
        properties: {
          id: el.id,
          name: tags.name ?? null,
          name_si: tags['name:si'] ?? null,
          name_ta: tags['name:ta'] ?? null,
          ele, // meters, or null if OSM had no usable value
          wikipedia: tags.wikipedia ?? null,
          wikidata: tags.wikidata ?? null,
        },
      };
    })
    // Peaks with no name at all shouldn't happen given the query filter,
    // but guard anyway since this feeds label rendering directly.
    .filter((f) => f.properties.name)
    .sort((a, b) => (b.properties.ele ?? -Infinity) - (a.properties.ele ?? -Infinity));

  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      source: 'OpenStreetMap via Overpass API',
      license: 'ODbL',
      fetched: new Date().toISOString(),
      count: features.length,
    },
    features,
  };

  await writeFile(OUT_PATH, JSON.stringify(geojson, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${features.length} peaks to ${OUT_PATH}`);
  console.log(
    `Top 5 by elevation: ${features
      .slice(0, 5)
      .map((f) => `${f.properties.name} (${f.properties.ele ?? '?'}m)`)
      .join(', ')}`,
  );
}

main().catch((err) => {
  console.error('fetch-peaks failed:', err);
  process.exitCode = 1;
});

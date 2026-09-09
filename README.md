# Sri Lanka in 3D

An interactive 3D terrain map of Sri Lanka for hiking enthusiasts — pinch, drag,
and tilt to explore the central highlands, with every named peak from
OpenStreetMap labelled and clickable.

Built with [MapLibre GL JS](https://maplibre.org/), styled entirely from
elevation data (no satellite imagery), and designed to run **fully offline**
once the terrain tiles are downloaded once.

## Quick start

```bash
npm install
npm run dev
```

Opens against the live [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
bucket by default — no API key needed.

## Why no satellite imagery?

Elevation data for Sri Lanka is small, static, and effectively public domain
(SRTM/GMTED2010, credit requested). Satellite imagery is none of those things
— it's licensed, not redistributable, and multiple GB at usable resolution.

So this app skips imagery entirely. MapLibre's `color-relief` layer (6.2+)
paints the map straight from the elevation data already loaded for the 3D
terrain — a hypsometric tint tuned to Sri Lanka's 0–2,524 m range — plus a
`hillshade` layer for ridge texture. One dataset, no licensing questions, and
arguably a better look for hiking than a green satellite blur.

## Going fully offline

The entire z0–12 elevation pyramid for Sri Lanka is ~2,000 tiles / ~80 MB —
z12 is the native resolution of the underlying SRTM data, so nothing higher
is useful. Download it once:

```bash
npm run fetch:terrain
```

This writes to `public/tiles/terrain/` (gitignored — the script is the
reproducible artifact, not the binaries). Then:

```bash
cp .env.local.example .env.local
npm run dev
```

With `VITE_TILE_MODE=local` set, the app never touches the network again.

## Regenerating peak data

`src/data/peaks.geojson` is committed and the app never calls the Overpass
API itself. To refresh it against current OpenStreetMap data:

```bash
npm run fetch:peaks
```

## Project structure

```
src/
  config/tiles.ts     Every tile URL and map default — the one place to
                       change providers, bbox, or camera defaults.
  skins/              The map's look as data: a Skin type + the "Kanda" pack.
  map/
    buildStyle.ts      MapLibre style plumbing — takes a Skin, wires layers.
    MapView.tsx         Imperative MapLibre lifecycle in a React wrapper.
    peaksLayer.ts        Peak markers, label tiers, click handling.
    middleDragRotate.ts  Middle-button drag → rotate + tilt.
  components/          Search, filter chips, peak card, nearby peaks, legend,
                       relief slider, gesture hint, attribution.
  index.css           Design tokens (palette, grid, radii, type scale).
  data/peaks.geojson   Committed OSM peak data (198 named summits).
public/fonts/         Self-hosted MapLibre glyph PBFs (committed).
scripts/
  fetch-peaks.mjs       Regenerates peaks.geojson from Overpass.
  fetch-terrain.mjs     Downloads the offline terrain tile pyramid.
  repair-dem.mjs        Repairs DEM void spikes in the local pyramid.
  fetch-glyphs.mjs      Downloads the self-hosted glyph PBFs.
  pack-pmtiles.mjs      Packs the loose pyramid into one .pmtiles archive.
```

## Data sources & attribution

- Elevation: SRTM (NASA/USGS) & GMTED2010 (USGS) via [Tilezen](https://github.com/tilezen/joerd) / AWS Open Data
- Peaks: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- Rendering: [MapLibre GL JS](https://maplibre.org/)

## Scope

This is v1: 3D terrain + named peaks. Hiking trails, route drawing, elevation
profiles, and GPX import/export are intentionally out of scope for now. The
config module and layer structure are built so trails slot in later as an
additional source without rework.

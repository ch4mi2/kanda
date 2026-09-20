# Kanda &nbsp;කන්ද

**Stand on a summit, look around, and the map names what you're seeing.**

Kanda (Sinhala for "mountain") is a peak-identification and orientation tool for
Sri Lanka. You climb Gombaniya, wonder what the surrounding mountains are — and
Kanda tells you: Lakegala there, the Five Peaks that way, Thunhisgala across the
valley. Rotating the camera is the whole point.

[![CI](https://github.com/ch4mi2/kanda/actions/workflows/ci.yml/badge.svg)](https://github.com/ch4mi2/kanda/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Live:** https://kanda.pages.dev

## Features

- **3D terrain** — the whole island as an explorable relief model, coloured
  straight from the elevation data
- **198 named peaks** from OpenStreetMap, in three zoom tiers, filterable by an
  elevation floor
- **Summit view** — stand on any peak at eye level and spin; nearby summits
  appear as skyline labels, ridge-hidden ones ghosted
- **Sun-driven lighting** — hillshade and haze follow the real solar position
  for any time of day
- **Offline-capable** — no satellite imagery, no API keys, no runtime network
  calls once the tiles are local
- **Zero API keys** — the entire look is derived from public-domain elevation
  data

## Quick start

```bash
git clone https://github.com/ch4mi2/kanda.git
cd kanda
npm install
npm run dev
```

Opens at `localhost:5173`, streaming elevation tiles live from the
[AWS Open Data](https://registry.opendata.aws/terrain-tiles/) bucket — no key
needed. It re-downloads ~2,000 tiles per session this way, so it's slow; for
real work, set up local tiles below.

## Full tile pipeline

Everything under `public/tiles/` is gitignored — the scripts are the
reproducible artifact, not the binaries. After a fresh clone:

```bash
npm run fetch:terrain      # ~54 MB elevation pyramid
npm run repair:dem         # repair DEM spikes/pits + one smooth pass
npm run generate:texture   # DEM + forest -> procedural surface texture (~10 min)
npm run pack:texture       # -> public/tiles/texture.pmtiles
npm run pack:pmtiles       # -> public/tiles/terrain.pmtiles
npm run fetch:glyphs       # self-hosted map-label glyphs

cp .env.local.example .env.local   # sets VITE_TILE_MODE=local
npm run dev
```

With `VITE_TILE_MODE=local` (or `pmtiles`) the app never touches the network.

## Tech

Vite + React + [MapLibre GL JS](https://maplibre.org/), used imperatively.
MapLibre's `color-relief` layer paints the map from the elevation data already
loaded for the 3D terrain — one dataset, no licensing questions, and a better
look for orientation than a satellite blur. Locally, packed elevation and
texture tiles can ship as [PMTiles](https://protomaps.com/docs/pmtiles)
archives served over HTTP range requests; the live deploy currently streams
terrain straight from AWS Open Data instead (see `CLAUDE.md` for why).

Architecture, design decisions, and the traps that have already cost time are
documented in [`CLAUDE.md`](CLAUDE.md).

## Data sources & attribution

- **Elevation:** SRTM (NASA/USGS) & GMTED2010 (USGS) via
  [Tilezen](https://github.com/tilezen/joerd) / AWS Open Data — public domain,
  credit requested
- **Peaks, rivers, water, forest, landcover:** © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, ODbL
- **Rendering:** [MapLibre GL JS](https://maplibre.org/), BSD-3-Clause

Attribution is shown in-app and is not optional — see
`src/components/Attribution.tsx`.

## Contributing

Issues and PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup,
branch naming, and the checks CI runs. This project follows the
[Contributor Covenant](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2024–2026 Chamithu Thamara. Map data carries its own licenses,
noted above.

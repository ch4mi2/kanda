# Kanda &nbsp;කන්ද

**Stand on a summit, look around, and the map names what you're seeing.**

Kanda (Sinhala for "mountain") is a peak-identification and orientation tool for
Sri Lanka. You climb Gombaniya, wonder what the surrounding mountains are — and
Kanda tells you: Lakegala there, the Five Peaks that way, Thunhisgala across the
valley. Rotating the camera is the whole point.

[![CI](https://github.com/ch4mi2/kanda/actions/workflows/ci.yml/badge.svg)](https://github.com/ch4mi2/kanda/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Live:** https://kanda.ch4mi2.workers.dev

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

Opens at `localhost:5273`, streaming elevation tiles live from the
[AWS Open Data](https://registry.opendata.aws/terrain-tiles/) bucket — no key
needed. It re-downloads tiles every session this way, so it's slow; for real work,
set up local tiles below.

## Full tile pipeline

Everything under `public/tiles/` is gitignored — the scripts are the
reproducible artifact, not the binaries. After a fresh clone:

```bash
npm run fetch:terrain      # ~54 MB Terrarium pyramid -> public/tiles/src-terrarium/ (offshore bathymetry)
npm run build:dem          # Copernicus GLO-30 (~300 MB download) -> public/tiles/terrain/
npm run pack:pmtiles       # -> public/tiles/terrain.pmtiles

cp .env.local.example .env.local   # sets VITE_TILE_MODE=local
npm run dev
```

With `VITE_TILE_MODE=local` (or `pmtiles`) the app never touches the network.

## Tech

Vite + React + [three.js](https://threejs.org/), used imperatively. A custom
terrain engine streams Terrarium elevation tiles (z7–z12) with a quadtree LOD,
shades them with cel lighting, GPU cast shadows and depth-based outlines, and
paints everything from the elevation data plus forest/lake masks — one dataset,
no licensing questions, and a look built for telling mountains apart. Four
skins (Arena, Ember, Clay, Block World) are plain data. Packed elevation
tiles can ship as a [PMTiles](https://protomaps.com/docs/pmtiles) archive
served over HTTP range requests; the live deploy currently streams terrain
straight from AWS Open Data instead (see `CLAUDE.md` for why).

Architecture, design decisions, and the traps that have already cost time are
documented in [`CLAUDE.md`](CLAUDE.md).

## Data sources & attribution

- **Elevation:** [Copernicus DEM](https://registry.opendata.aws/copernicus-dem) GLO-30
  (ESA / European Union), via AWS Open Data. Offshore depth: Terrarium bathymetry
  (GEBCO) via [Tilezen](https://github.com/tilezen/joerd). The live site still
  serves the SRTM-based Terrarium tiles until the new pyramid is hosted
- **Peaks, rivers, water, forest, landcover:** © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, ODbL
- **Rendering:** [three.js](https://threejs.org/), MIT

Attribution is shown in-app and is not optional — see
`src/components/Attribution.tsx`.

## Contributing

Issues and PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup,
branch naming, and the checks CI runs. This project follows the
[Contributor Covenant](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2024–2026 Chamithu Thamara. Map data carries its own licenses,
noted above.

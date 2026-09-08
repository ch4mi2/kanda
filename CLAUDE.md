# Kanda — project context for Claude

Read this before touching anything. It carries the decisions and the traps.

## What Kanda is

**A peak-identification and orientation tool for Sri Lanka**, not a hiking-trail
app and not a generic terrain viewer. The defining use case, in the owner's
words:

> "I climbed Gombaniya, wonder what the surrounding mountains are... oh Lakegala
> is this, Five Peaks is this, Thunhisgala is that side."

You're on a summit, you look around, the app names what you're seeing. Every
design call follows from that — most importantly, **rotating the camera is the
primary interaction**, not an incidental one.

`Kanda` (කන්ද) is Sinhala for "mountain". Hobby project; donations first,
monetization possibly later. The folder is still named `SriLankaMountains` —
that's deliberate, nothing depends on it, rename it later if you want.

## Architecture

```
src/
  config/tiles.ts     ALL tile URLs + camera defaults. Single choke point —
                      change providers here and nowhere else.
  map/
    buildStyle.ts     MapLibre style: color-relief ramp, hillshade, sky, glyphs.
    MapView.tsx       Imperative MapLibre lifecycle in a thin React wrapper.
    peaksLayer.ts     Peak symbols, 3 zoom tiers, canvas-generated triangle icon.
  components/         PeakCard, ExaggerationSlider, Legend, Attribution.
  data/peaks.geojson  198 named OSM peaks. Committed — the app never calls
                      Overpass at runtime.
scripts/
  fetch-peaks.mjs         Overpass → src/data/peaks.geojson
  fetch-terrain.mjs       AWS → public/tiles/terrain/ (~2,024 tiles, 54 MB)
  copy-maplibre-worker.mjs  Build-time worker copy (see gotchas)
design/               Exported Claude Design source. Tokens live in the
                      "1D Handoff sheet" section of Kanda Trails UI.dc.html.
```

**Use `maplibre-gl` imperatively inside `useEffect`, never `react-map-gl`.**
Terrain and camera work fight declarative wrappers. React earns its place in the
UI panels, not in the map instance.

## Data — why there are no API keys

- **Elevation:** Terrarium-encoded SRTM/GMTED2010 from AWS Open Data. Public
  domain, credit requested. **z12 is the ceiling** — a z12 tile is ~38 m/px,
  which is SRTM's native resolution. z13+ is pure upscaling, 4× the bytes for
  zero new information.
- **Peaks:** OpenStreetMap via Overpass, ODbL, fetched once into a committed
  GeoJSON.
- **No satellite imagery, deliberately.** It's licensed, non-redistributable and
  multiple GB. The map is colored entirely from the elevation data via MapLibre's
  `color-relief` layer. That's why the whole app can run offline.

Attribution is required and is not optional — see `components/Attribution.tsx`.

## Tile modes

`TERRAIN.mode` in `config/tiles.ts` reads `VITE_TILE_MODE`:
- `remote` (default) — AWS S3. **Slow: re-downloads ~2,024 tiles per session.**
- `local` — `public/tiles/`, populated by `npm run fetch:terrain`.

**`.env.local` with `VITE_TILE_MODE=local` should always exist in development.**
Without it the app silently runs in remote mode and feels broken-slow. This was
a real bug, not a hypothetical.

## Gotchas that have already cost time

1. **`maxBounds` breaks rotation.** Tight `MAP_BOUNDS` + high pitch means the
   frustum spills past the bounds and MapLibre's `_constrain()` fights every
   bearing change. Keep bounds generous.
2. **`style.load`, not `load`.** The `load` event can hang indefinitely waiting
   on every visible tile across a wide oblique view. Do setup on `style.load`.
3. **`demotiles.maplibre.org` glyphs must go.** Currently referenced in
   `buildStyle.ts` — it's MapLibre's *demo* server and a hard network dependency
   that breaks offline. Self-host glyph PBFs (needs Sinhala + Tamil too).
4. **Vite + maplibre worker.** `optimizeDeps.exclude: ['maplibre-gl']` is
   required for dev, and `scripts/copy-maplibre-worker.mjs` runs on pre-dev and
   pre-build for production. **The production build worker still 404s
   (`/assets/maplibre-gl-worker.mjs`, MIME error) — this is an open bug.**
5. **No sprite sheet exists.** Icon names like `triangle-15` silently fail.
   `peaksLayer.ts` generates its triangle on a canvas and registers it as an SDF
   image instead.
6. **Vertical exaggeration is load-bearing.** At true 1.0×, 2,524 m across a
   400 km island looks flat and the app reads as broken. The design specifies
   ~4× at island view easing to ~2× zoomed in.

## Design

Tokens (from the design's own handoff sheet):

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| Ink | `#0d251b` | | Route | `#ff5c46` |
| Moss | `#6b8779` | | Water | `#a9dcea` |
| Leaf | `#2f7d54` `#22694a` `#5cb17a` | | Paper | `#f7f5ec` |
| Chip | `#e8eee5` `#eef3ea` | | | |

Type: **Bricolage Grotesque 800** (display) + **Outfit 400/600** (UI), both
self-hosted. Scale 44/19/15/12. 4 px grid. Radii 12/14/16/20/26.

Interactions the design specifies: drag orbits (yaw ±180°, pitch 12°–72°), pinch
zooms, tap flies to bounds in 700 ms, labels collide-cull by priority.

**The design is trail-centric but trails are cut from scope** (no trustworthy
trail data source yet). Keep its visual language and component anatomy, repoint
content from trails to peaks: trail card → peak card, trail list → nearby peaks.

**Known flaw in the design's own mockups:** `design/terrain.html:187` ramps nine
near-identical greens and then applies `Math.pow(h/MAXH, 2.0)`, which squashes a
1,200 m peak to 0.23 — so the whole island renders green. Do not port that ramp.
MapLibre's `['elevation']` gives metres directly; place stops at real elevations
with genuinely different hues per band.

## Commands

```bash
npm run dev             # localhost:5173
npm run build           # tsc + vite build
npm run lint            # oxlint
npm run fetch:peaks     # refresh peaks from Overpass
npm run fetch:terrain   # download the 54 MB tile pyramid (resumable)
```

## Verifying map work

Screenshots lie less than assumptions here. Always:
- Check the network panel for requests to `amazonaws.com` — any means local tile
  mode isn't actually on.
- Assert `map.getBearing()` actually changes and *holds* when testing rotation.
- Test at the `mobile` viewport preset; most users are on phones.
- Use a **fresh browser tab** for console checks — the console buffer persists
  across navigations in a reused tab and will show you stale errors.

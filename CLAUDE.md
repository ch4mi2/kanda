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
  skins/             Skin type + the "Kanda" pack. The map's whole look is
                     data here, not code — buildStyle takes a Skin and owns
                     no palette. "Skin packs" is later a menu over SKINS[].
  map/
    buildStyle.ts     MapLibre style plumbing: takes a Skin, wires sources +
                      layers + sky. Glyphs are self-hosted (public/fonts/).
    MapView.tsx       Imperative MapLibre lifecycle in a thin React wrapper.
    middleDragRotate.ts  Middle-button drag → rotate + tilt (the one gesture
                      MapLibre has no built-in handler for).
    peaksLayer.ts     Peak symbols, 3 zoom tiers, canvas-generated triangle
                      icon; setPeakElevationFloor() for the filter chips.
    nearbyPeaks.ts    Haversine + initial-bearing maths for the nearby list.
  components/         PeakCard, NearbyPeaks, SearchField, FilterChips,
                     GestureHint, ExaggerationSlider, Legend, Attribution.
  index.css          Design tokens (palette, 4 px grid, radii, type scale).
  data/peaks.geojson  198 named OSM peaks. Committed — the app never calls
                      Overpass at runtime.
  data/water.geojson  ~920 water bodies (reservoirs, tanks) 40-60,000 ha.
  data/rivers.geojson ~450 named rivers, simplified. Both committed, ODbL.
  data/usePeaks.ts    Loads the GeoJSON once for the nearby-peaks maths.
public/fonts/        Self-hosted MapLibre glyph PBFs (npm run fetch:glyphs).
scripts/
  fetch-peaks.mjs         Overpass → src/data/peaks.geojson
  fetch-osm-features.mjs  Overpass → src/data/water.geojson + rivers.geojson
  fetch-terrain.mjs       AWS → public/tiles/terrain/ (~2,024 tiles, 54 MB)
  repair-dem.mjs          Repair DEM spikes/pits + one light smooth pass
  fetch-glyphs.mjs        demotiles → public/fonts/ (Noto Sans PBF ranges)
  pack-pmtiles.mjs        public/tiles/terrain/ → public/tiles/terrain.pmtiles
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
- `local` — loose PNG pyramid in `public/tiles/terrain/`, `npm run fetch:terrain`.
- `pmtiles` — single `public/tiles/terrain.pmtiles` archive, `npm run pack:pmtiles`.
  Served via HTTP range requests through the `pmtiles://` protocol registered
  in `MapView.tsx`. This is the deployment artifact — one file, not 2,024.

`config/tiles.ts` exposes `terrainSourceSpec()` so `buildStyle.ts` never branches
on the mode: PMTiles gets a `url`, loose tiles get a `tiles` template. It also
sets the source `bounds` to `SRI_LANKA_BBOX` — without that MapLibre requests a
margin of tiles beyond the data and the dev/preview server answers those with
its SPA `index.html` fallback, which MapLibre logs as "source image could not be
decoded" (harmless once bounds is set; a real static host would 404 cleanly).
The low-zoom pyramid on disk is sparse, so a few of those logs still appear.

**`.env.local` with `VITE_TILE_MODE=local` (or `pmtiles`) should always exist in
development.** Without it the app silently runs in remote mode and feels
broken-slow. This was a real bug, not a hypothetical.

## Gotchas that have already cost time

1. **`maxBounds` vs rotation.** Tight `MAP_BOUNDS` + high pitch means the
   frustum spills past the bounds and MapLibre's `_constrain()` can fight
   bearing changes. `MAP_BOUNDS` is now deliberately generous
   (`[[73,1],[89,15]]`). Controls are the Google Earth scheme, all stock
   MapLibre handlers (Phase 4C): left-drag / one-finger-drag pans, right-drag
   and two-finger drag rotate + tilt, wheel/pinch zooms. `map/middleDragRotate.ts`
   adds middle-button rotate/tilt — the only gesture MapLibre has no handler
   for — with the sign matched to MapLibre's own `MouseRotateHandler`. Pitch is
   clamped 12°–72° via `minPitch`/`maxPitch`. Camera zoom is capped at
   `MAX_ZOOM` (13) so it can't push past the z12 DEM.
2. **`style.load`, not `load`.** The `load` event can hang indefinitely waiting
   on every visible tile across a wide oblique view. Do setup on `style.load`.
3. **`demotiles.maplibre.org` glyphs — done (Phase 4D).** Glyph PBFs are
   self-hosted in `public/fonts/` (`npm run fetch:glyphs`), `buildStyle.ts`
   points `glyphs` at `${BASE_URL}fonts/{fontstack}/{range}.pbf`, and the app
   makes zero external requests. Only Latin + punctuation ranges of "Noto Sans
   Regular/Bold" are fetched — map labels are romanised peak names. Sinhala/
   Tamil map glyphs are still a follow-up (only needed if local names ever go
   on map labels; the PeakCard renders them in HTML with the web font today).
4. **Vite + maplibre worker.** `optimizeDeps.exclude: ['maplibre-gl']` plus
   `worker: { format: 'es' }` in `vite.config.ts`, and `MapView.tsx` imports the
   worker as `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` and feeds it to
   `setWorkerUrl()`. MapLibre's default (`new URL('./maplibre-gl-worker.mjs',
   import.meta.url)`) otherwise gets the HMR client injected in dev (style never
   loads, map blank) and 404s in the build (the old MIME bug). This fixed the
   production 404. **Dev caveat:** the map reliably loads on the *first* page
   load after `npm run dev`, but can go blank after a hot reload / subsequent
   navigation — a full `npm run dev` restart clears it. The production build
   (`npm run build && npm run preview`) is unaffected and is the check of record.
5. **No sprite sheet exists.** Icon names like `triangle-15` silently fail.
   `peaksLayer.ts` generates its triangle on a canvas and registers it as an SDF
   image instead.
6. **Vertical exaggeration is load-bearing.** At true 1.0×, 2,524 m across a
   400 km island looks flat and the app reads as broken. The design specced
   ~4×/2×; the shipped curve is ~2.5× island / 1.8× regional / 1.4× close
   (`EXAGGERATION_STOPS` in `config/tiles.ts`) because ≥3× amplifies SRTM's
   30 m speckle into fake ridging.
7. **`repair-dem.mjs` writes WHOLE-metre elevations.** The `--smooth` pass
   writes a fractional value to every land pixel; without rounding to whole
   metres that collapses PNG delta-filter compression and the packed PMTiles
   goes 48 MB → 106 MB. SRTM's real precision is metres, so `encodeHeight`
   always rounds. Don't "restore" the 1/256 m fraction.
8. **Hillshade illumination anchor.** MapLibre defaults
   `hillshade-illumination-anchor` to `viewport`, which adds the camera
   bearing to the light direction every frame — orbiting re-shades every
   slope and the whole map appears to change colour. Kanda's skin forces
   `'map'`. Any new skin must too.

## Design

Tokens (from the design's own handoff sheet):

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| Ink | `#0d251b` | | Route | `#ff5c46` |
| Moss | `#6b8779` | | Water | `#a9dcea` |
| Leaf | `#2f7d54` `#22694a` `#5cb17a` | | Paper | `#f7f5ec` |
| Chip | `#e8eee5` `#eef3ea` | | | |

Type: **Bricolage Grotesque 800** (display) + **Outfit 400/600** (UI). Scale
44/19/15/12. 4 px grid. Radii 12/14/16/20/26.

Phase 4D landed all of this: tokens are CSS custom properties in `src/index.css`
(the app reads `var(--ink)` etc., never a raw hex); fonts are self-hosted via
the `@fontsource/*` packages (bundled by Vite, no Google Fonts CDN), imported in
`main.tsx`. The chrome was rebuilt to the mockups — brand lockup, `SearchField`,
`FilterChips` (repointed to an elevation floor), `PeakCard`, `NearbyPeaks`,
mobile bottom sheet, restyled MapLibre compass/zoom cluster, `GestureHint`.

**The design is trail-centric but trails are cut from scope** (no trustworthy
trail data source yet). Its visual language and component anatomy were kept and
repointed from trails to peaks: trail card → peak card, trail list → nearby
peaks, trail filters → elevation-floor chips.

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
npm run fetch:osm       # refresh water.geojson + rivers.geojson from Overpass
npm run fetch:terrain   # download the 54 MB tile pyramid (resumable)
npm run repair:dem      # repair DEM spikes/pits + one smooth pass (in place)
npm run fetch:glyphs    # download the self-hosted glyph PBFs
npm run pack:pmtiles    # re-pack the loose pyramid into terrain.pmtiles
```

After a fresh clone: `fetch:terrain` → `repair:dem` → `pack:pmtiles`, then set
`VITE_TILE_MODE` in `.env.local`. `public/tiles/` is gitignored; everything in
`src/data/` and `public/fonts/` is committed.

`public/tiles/` is gitignored; after a fresh clone run `fetch:terrain` then
`repair:dem` then `pack:pmtiles`. `public/fonts/` **is** committed.

## Verifying map work

Screenshots lie less than assumptions here. Always:
- Check the network panel for requests to `amazonaws.com` — any means local tile
  mode isn't actually on.
- Assert `map.getBearing()` actually changes and *holds* when testing rotation.
- Test at the `mobile` viewport preset; most users are on phones.
- Use a **fresh browser tab** for console checks — the console buffer persists
  across navigations in a reused tab and will show you stale errors.

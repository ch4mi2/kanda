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
                     lstar.ts (sRGB→CIE L*), color.ts (rgba parse + ramp
                     sampling) support the monotonic ramp + sun-driven tints.
  map/
    buildStyle.ts     MapLibre style plumbing: takes a Skin + a sun position,
                      wires sources + layers + sky. hillshadeLightForSun() and
                      skyForSun() are re-applied live by MapView. Hydronym
                      labels (water tiers by `ha`, rivers on line placement)
                      live here. Self-hosted glyphs (public/fonts/).
    sunPosition.ts    NOAA solar position (no dep) + SLST helpers — drives the
                      hillshade light direction/altitude and the fog tint.
    summitView.ts     Phase 5B — the "stand on the peak and spin" camera mode.
                      createSummitView(map, deps): enter/exit, look-around,
                      terrain + pitch/bounds takeover. See gotcha #11.
    MapView.tsx       Imperative MapLibre lifecycle in a thin React wrapper.
                      Attaches summitView on a `viewpoint` prop.
    middleDragRotate.ts  Middle-button drag → rotate + tilt (the one gesture
                      MapLibre has no built-in handler for).
    peaksLayer.ts     Peak symbols, 3 zoom tiers, canvas-generated triangle
                      icon; setPeakElevationFloor() for the filter chips. Label
                      size/opacity ramp with zoom so distance is felt (5A.4).
                      setPeaksVisible() — summit view hides the tiers.
    treesLayer.ts     Billboard tree sprites over the forest blocks (canvas
                      icon, colours from Skin.foliage). Hidden below z10.3;
                      summit view lowers that. src/data/trees.geojson.
                      Kept small — billboards are constant SCREEN size, so a
                      tree big enough to read up close is huge on a far ridge.
    layerToggles.ts   Groups the optional furniture (contours / trees / water
                      names) so the dock chips can switch it. Contours ship
                      OFF — closed 200 m rings read as a wireframe grid at an
                      oblique angle.
    nearbyPeaks.ts    Haversine, initial-bearing, destinationPoint maths for
                      the nearby list and summit view.
  components/         PeakCard ("Stand here" → summit view), NearbyPeaks,
                     SearchField, FilterChips, GestureHint, ExaggerationSlider,
                     TimeOfDaySlider (sun scrub), Legend, Attribution.
                     Summit view: SummitBar (exit), SummitLabels (skyline +
                     occlusion), CompassStrip (heading ribbon).
  index.css          Design tokens (palette, 4 px grid, radii, type scale).
  data/peaks.geojson  198 named OSM peaks. Committed — the app never calls
                      Overpass at runtime.
  data/water.geojson  ~740 water bodies (reservoirs, tanks) 50-60,000 ha.
  data/rivers.geojson ~450 named rivers, simplified.
  data/forest.geojson ~270 forest blocks >700 ha (OSM, ODbL).
  data/trees.geojson  ~5k point "trees" scattered inside forest.geojson,
                      pre-generated. npm run generate:trees (deterministic).
  data/contours.geojson  highland contour lines 800-2400 m, pre-generated
                      from the DEM (public domain). npm run generate:contours
                      — run it AFTER repair:dem.
  data/usePeaks.ts    Loads the GeoJSON once for the nearby-peaks maths.
public/fonts/        Self-hosted MapLibre glyph PBFs (npm run fetch:glyphs).
scripts/
  fetch-peaks.mjs         Overpass → src/data/peaks.geojson
  fetch-osm-features.mjs  Overpass → src/data/water.geojson + rivers.geojson
  fetch-terrain.mjs       AWS → public/tiles/terrain/ (~2,024 tiles, 54 MB)
  repair-dem.mjs          Repair DEM spikes/pits + one light smooth pass
  generate-contours.mjs   local DEM → src/data/contours.geojson (highlands)
  generate-trees.mjs      forest.geojson → src/data/trees.geojson (tree scatter)
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
   clamped 12°–80° via `minPitch`/`maxPitch` (`PITCH_MAX` lifted from 72 in
   Phase 5A so the resting view is inside the terrain-fog band — see gotcha #9).
   Camera zoom is capped at `MAX_ZOOM` (13) so it can't push past the z12 DEM.
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
   `'map'` (set inside `buildStyle.hillshadeLightForSun`). Any new skin must too.
9. **Terrain fog is pitch-gated (Phase 5A).** MapLibre's `sky` fog is genuine
   distance fog but `calculateFogBlendOpacity` returns 0 below 60° pitch,
   ramps 60→70, full ≥70. `DEFAULT_PITCH` is 68 and `PITCH_MAX` 80 so aerial
   perspective actually renders; drop either back toward 60 and the depth cue
   silently vanishes.
10. **Hillshade + fog follow the real sun (Phase 5A).** `src/map/sunPosition.ts`
   (NOAA, no dep) drives `hillshade-illumination-direction/-altitude` and the
   fog tint. `buildStyle.hillshadeLightForSun` / `skyForSun` build the paint;
   `MapView` re-applies both on the `TimeOfDaySlider` via `setPaintProperty`
   /`setSky` without rebuilding the style. `hillshade-method` is `'combined'`
   (not `'igor'` — too matte, Chamithu called it "just mist"), exaggeration
   ~0.9, illumination altitude **clamped 10–62°** so equatorial-noon sun still
   casts. Keep relief strong; don't trade it back for haze.
12. **There are THREE hillshade layers, and that's deliberate.** MapLibre has no
   cast-shadow or ambient-occlusion renderer — a hillshade is a per-pixel
   normal-vs-light dot product, it never throws a ridge's shadow into the next
   valley — and `hillshade-exaggeration` caps at 1.0. Stacking is the only way
   past that ceiling:
   - `hillshade` — the sun-driven main pass (`combined`).
   - `hillshade-detail` — `multidirectional` with **four lights on a ring**
     around the sun. Lit from all sides, only *concavities* stay dark, which
     approximates AO. This is what supplies the "black shadow" and the
     high-frequency surface texture.
   - `hillshade-rock` — slope-only, lit from 88° so flat ground takes nothing
     and steep faces take a stony grey. `color-relief` can only see height,
     so this is the only way to say "that's a cliff".
   All three come from `Skin.hillshade` (`.detail`, `.rock`); a skin can set
   either to `null`. Three full-screen raster passes on one DEM — fine today,
   but it's the first thing to look at if terrain rendering ever gets slow.
13. **The sea uses real bathymetry (reversing a Phase 4 call).** Phase 4
   clamped every depth to one flat cyan for a "clean game-map sea". Measured
   against reference art that turned out to be most of why the coastline read
   as a cut-out, so `Skin.shore` now ramps open blue → shelf → turquoise
   shallows → surf, plus a sand strand held 0–8 m. The strand lives in
   `shore`, **not** in `elevationBands` — it's bright and the first land band
   is dark, which would break the monotonic-L\* rule (lstar.test.ts). Keep
   `background` matched to the deepest `shore` stop or the edge of DEM
   coverage seams against open ocean.
11. **Summit view fights MapLibre 6.8 (Phase 5B, `src/map/summitView.ts`).**
   All verified in the maplibre source, all easy to get wrong:
   - **No free-camera API.** `get/setFreeCameraOptions` are Mapbox-only.
     Placing the camera at a summit looking out = pick a target ~40 km along
     the heading and `map.calculateCameraOptionsFromTo(eye, alt, target, alt)`.
     A level line of sight yields pitch exactly 90; `setBearing()` orbits the
     40 km-away centre, so every look-around delta re-solves the whole camera.
   - **`_elevateCameraIfInsideTerrain`** silently rewrites pitch + zoom on
     every camera path when the camera is inside terrain — no margin, no off
     switch. Mitigated by a ~25 m eye margin **and** a
     `map.setTransformCameraUpdate` hook that re-asserts pitch/zoom (it runs
     after the elevate pass).
   - **`map.transform` is gone** — it's `map._camera.transform` in 6.x (no
     public getter on the Map type). `SummitLabels` reaches through it for
     nothing now; occlusion is a **CPU DEM march** along the sight line
     (`queryTerrainElevation` samples) because `isLocationOccluded` is a
     mercator no-op and `depthAtPoint` over-reported occlusion here.
   - **`queryTerrainElevation` returns 0 / null on unloaded tiles** — never
     feed it straight into a sight-line calc; fall back to the OSM `ele`.
   - Above 90° pitch also needs `setCenterClampedToGround(false)`, and drop
     `maxBounds` (pitch-90 frustum spills continent-wide, gotcha #1).
   - **Look-around is "grab the world"** (`bearing -= dx`, `pitch += dy`) —
     the point under the cursor tracks the cursor, like PeakFinder / Street
     View. That's the *opposite* sign to the overhead map's rotate gestures
     (gotcha #1) and it's deliberate; Chamithu called the other way "inverted".
     Arrow keys stay direct-look.

## Tests

`npm test` (vitest, added Phase 5A). `src/skins/lstar.test.ts` locks the
elevation ramp to **monotonic in CIE L\*** — the pre-Phase-5 ramp was a V
(brightest mid-slope) which made tall peaks read as dark; don't reintroduce it.
`src/map/sunPosition.test.ts` sanity-checks the solar maths.

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
npm test                # vitest — ramp monotonicity + sun position
npm run fetch:peaks     # refresh peaks from Overpass
npm run fetch:osm       # refresh water.geojson + rivers.geojson from Overpass
npm run fetch:terrain   # download the 54 MB tile pyramid (resumable)
npm run repair:dem      # repair DEM spikes/pits + one smooth pass (in place)
npm run fetch:glyphs    # download the self-hosted glyph PBFs
npm run generate:contours  # local DEM -> contours.geojson (after repair:dem)
npm run generate:trees  # forest.geojson -> trees.geojson (deterministic)
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
- The local tile pyramid is **slow to serve on a cold `npm run preview`** — the
  island can take 20-40 s to fully paint on first load. Wait it out before
  judging a screenshot; a blank blue map right after navigate is loading, not
  broken.
- **Summit view is the acceptance test for the user story.** Stand on Gombaniya
  (search it → "Stand here"): the camera sits at the summit, dragging pivots in
  place (not an orbit), the compass strip tracks your heading, and Knuckles /
  Lakegala / Kirigalpotta appear as skyline labels with ridge-hidden ones
  ghosted. `summitView`/`SummitLabels` occlusion tuning
  (`RIDGE_FUDGE_M`, step counts) is eye-calibrated — sanity-check against
  summits you know.

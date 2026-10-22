# Kanda — project context for Claude

Read this before touching anything. It carries the decisions and the traps.

## What Kanda is

**A peak-identification and orientation tool for Sri Lanka**, not a hiking-trail
app and not a generic terrain viewer. The defining use case, in the owner's
words:

> "I climbed Gombaniya, wonder what the surrounding mountains are... oh Lakegala
> is this, Five Peaks is this, Thunhisgala is that side."

You're on a summit, you look around, the app names what you're seeing. Every
design call follows from that — most importantly, **looking around is the
primary interaction**, and **telling one mountain from the next** (distinct
silhouettes, depth, cast shadows) beats photorealism.

`Kanda` (කන්ද) is Sinhala for "mountain". Hobby project, not monetized. The
folder is still named `SriLankaMountains` — that's deliberate, nothing depends
on it, rename it later if you want.

## History in one paragraph

Phases 1–6 were a MapLibre GL map (hillshade stacks, `color-relief`, a baked
texture pyramid). It topped out: no cast shadows, no custom shaders, and summit
view fought the library at every step. **Phase 7 (this code) replaced it with a
custom three.js renderer** — see `docs/plans/phase-7-threejs.md` for the plan
and `design/prototypes/` for the two look labs it grew from. The last MapLibre
commit is tagged **`pre-threejs`** (one revert away if the new engine ever has
to be rolled back).

## Architecture

```
src/
  engine/
    Engine.ts          WebGLRenderer, scene, camera, frame loop, summit mode,
                       fly-to animations, projection + occlusion queries.
                       Imperative; React only wraps it (ThreeView.tsx).
    geo.ts             Scene space: km, +x east, +z SOUTH, +y up, origin at
                       DEFAULT_CENTER; lng/lat <-> scene, tile footprints.
    labels.ts          Peak labels: a DOM layer positioned from the camera each
                       frame (elevation priority, declutter, occlusion ghosting;
                       summit mode adds distance + compass direction).
    masks.ts           CPU copy of src/data/masks.png (tree placement).
    tiles/
      TileSource.ts    Terrarium DEM fetch + decode for remote/local/pmtiles.
      TerrainTiles.ts  Tile cache, quadtree LOD (z7 roots -> z12), mesh builder,
                       CPU heightAt(). Smooth (128 grid).
    shading/
      terrain.ts       Terrain/ocean/sky materials + the shared GLSL chunks.
      shadow.ts        Sun depth pass fitting + bias maths.
      post.ts          Fullscreen pass: depth outlines, tilt-shift, grade.
    props/             trees.ts (instanced, per z12 tile near the camera),
                       clouds.ts.
    ThreeView.tsx      React shell (creates/disposes the Engine, WebGL error).
  skins/               A Skin is pure data (palette, light, fog, outline, water,
                       geometry mode, trees, clouds, label font). Arena (default),
                       Ember, Block World. localStorage 'kanda:skin'.
  config/tiles.ts      Terrain URLs/modes, bbox, camera + relief limits.
  map/                 sunPosition.ts (NOAA solar maths, no dep) and
                       nearbyPeaks.ts (haversine, bearings). Name is historical.
  components/          PeakCard, NearbyPeaks, SearchField, FilterChips,
                       TimeOfDaySlider, ExaggerationSlider, SkinPicker (dock,
                       desktop) / SkinFab (phones), NavCluster, CompassStrip,
                       SummitBar, GestureHint, Attribution.
  App.tsx              The shell: wires engine, labels, summit, panels.
  data/                peaks / water / rivers / forest .geojson (committed, the
                       app never calls Overpass), masks.png (forest + lake
                       masks, committed, `npm run generate:masks`), usePeaks.ts.
scripts/               fetch-peaks, fetch-osm-features, fetch-terrain,
                       build-dem, check-peaks, pack-pmtiles, generate-masks;
                       lib/tilemath.mjs, lib/texture-core.mjs (the polygon
                       rasteriser + blur + bbox the masks script reuses; the
                       rest of that file is dead weight from the old texture
                       bake — trim it if you touch it).
design/                Exported Claude Design source + prototypes/ (the labs).
docs/plans/            phase-7-threejs.md.
```

**three.js is used imperatively, never react-three-fiber** (same reasoning as
the old "never react-map-gl"). React earns its place in the panels.

## Data — why there are no API keys

- **Elevation:** Copernicus GLO-30 (TanDEM-X, 30 m) from AWS Open Data, built
  into a Terrarium pyramid by `scripts/build-dem.mjs`; sea comes from the old
  Tilezen Terrarium pyramid (`public/tiles/src-terrarium/`) because GLO-30 has
  no ocean. **The DEM ceiling is z12** (~38 m/px). Never fetch or pack tiles
  past z12 — pure upscaling, 4× the bytes. `remote` mode (production, until the
  new pyramid is hosted) still reads AWS Terrarium (SRTM).
- **Peaks:** OpenStreetMap via Overpass, ODbL, fetched once into a committed
  GeoJSON. **Forest / lakes:** OSM, baked into `masks.png`.
- **No satellite imagery, deliberately** (licensed, huge). Every colour comes
  from the elevation data + masks + the skin, so the app can run offline.

Attribution is required — see `components/Attribution.tsx`.

## Tile modes

`TERRAIN.mode` in `config/tiles.ts` reads `VITE_TILE_MODE`:
- `remote` (default) — AWS S3 (CORS `*`). Slow-ish: tiles re-download per session.
- `local` — loose PNG pyramid in `public/tiles/terrain/` (`npm run build:dem`).
  The pyramid is **sparse outside the island**; `TileSource` returns `null` for
  a missing tile and the engine treats it as flat sea (also guards the SPA
  `index.html` fallback by checking `content-type`).
- `pmtiles` — `public/tiles/terrain.pmtiles` via range requests (`npm run
  pack:pmtiles`). The deployment artifact — one file, not 2,000.

**`.env.local` with `VITE_TILE_MODE=local` (or `pmtiles`) should always exist in
development**; without it you silently run in remote mode.

## Gotchas that have already cost time

1. **Scene space is km, +z is SOUTH.** Web-Mercator y grows south, so tiles and
   rasters index the same way. North is −z; `bearingOf()` is a compass bearing.
   Vertex `position.y` is **raw metres**; vertical exaggeration is the `uExag`
   uniform, so the slider never rebuilds meshes. Anything on the CPU that needs
   a true height uses `tiles.heightAt()` (metres, **not** exaggerated) and
   multiplies by `engine.effectiveExaggeration()/1000` itself.
2. **Quadtree rule: a parent keeps drawing until all its *visible* children are
   ready and buildable.** That is what prevents holes and parent/child overlap.
   Mesh builds are budgeted per frame; a tile that is loaded but not yet built
   counts as not ready. Tiles are skirted to hide LOD cracks.
3. **Shadow bias scales with mesh spacing and exaggeration.** `Engine.renderShadow`
   picks the shadow-pass zoom from `TerrainTiles.estimateZoom()` (an SSE estimate
   at the camera's distance to the pivot, clamped z9–12) so it matches the main
   pass's LOD instead of a fixed z10–11, and sizes the bias off
   `SunShadow.spacingKm()` for whichever of the two is coarser. `shadowAt()` also
   pushes the receiver along its normal by ~1.5 shadow texels and fades to lit
   over the outer 15% of the box, and shadows turn off past ~180 km (island
   view) where they can't resolve anything. Too small a bias = the whole map is
   in shadow. **`uShadowMat` already includes the clip→[0,1] remap**
   (`SunShadow.bias`); the shader must not `* .5 + .5` again. It once did, which
   sampled the wrong quadrant of the depth map and squashed `c.z` into
   [0.5, 1] — a big, bias-insensitive self-shadowed box (the long-standing
   "known residual").
4. **GLSL: texture reads must stay in uniform control flow.** An early
   `return` before `texture2D` triggered ANGLE's X3595 warning (undefined
   derivatives). `shadowAt` uses `step()` masks instead; derivative normals
   (`faceN`) are computed at the top of `main()`, never inside a branch.
5. **Skins are data; the engine owns no colours.** Geometry mode lives on the
   skin: `smooth` (default) or `terrace` = quantised in the vertex shader
   (`terraceH`, also applied to trees; uses triangle normals from screen
   derivatives). `Engine.applySkin` is the only place uniforms change.
6. **Summit eye = above the highest DEM ground within ~250 m**, +50 m. The DEM
   high point is rarely at the OSM coordinate; standing at the sampled height
   buries the camera in a ridge (this happened — a violet slab filling the view).
7. **Look-around is grab-the-world** (`yaw −= dx`, `pitch += dy`): the point
   under the finger follows the finger, like PeakFinder/Street View. The owner
   called the opposite "inverted". Arrow keys are direct-look. Wheel/pinch
   changes FOV (24–80°).
8. **Outlines need linear depth.** The scene renders into a float-depth target
   (MSAA 4, 2 on phones) and the post pass takes a Laplacian of 1/z. They are
   forced on in summit view (min 0.55) — they are what separates the summit you
   stand on from the ridges behind it.
9. **`THREE.ColorManagement` is disabled** and output is linear-sRGB-as-is:
   hex in = hex out, skins are authored in display space.
10. **Occlusion/labels are a CPU march on `heightAt`.** Lakegala reads as hidden
    from Gombaniya in both the labs and the real engine; two independent
    implementations agree, so it is most likely real terrain. Hidden labels are
    ghosted, not removed. Eye-calibrated, like the old one — sanity-check
    against summits you know.
11. **The dock is desktop-only (≥721 px)** by design; phones get the skin FAB.
    Most users are on phones — test the `mobile` preset.
12. **Dev tooling quirks.** (a) The Browser pane throttles `requestAnimationFrame`
    to ~1 fps when it is not focused — never judge performance there (engine
    work is a few ms per frame); camera smoothing is time-based for this
    reason, and tests need long waits. (b) Vite re-optimises dependencies the
    first time a new import appears and **hard-reloads the page** — a reload in
    the middle of a scripted test looks like a bug. (c) `erasableSyntaxOnly`:
    no TS parameter properties (`constructor(private x)`).
13. **Sea depth is synthetic at z12.** Terrarium's z12 sea is flat 0 m and the
    shader draws 0 m as foam, so zooming in turned blue sea white. `build-dem`
    gives z12 sea a depth (upsampled z10 bathymetry or a shelf ramp from the
    shore, whichever is deeper); z11 and below inherit it. AWS `remote` mode
    still has the flat sea.
14. **`public/` is copied into `dist/` by Vite regardless of tile mode.** If you
    have ever run the local tile pipeline, `public/tiles/terrain.pmtiles`
    exists and a local `wrangler deploy` rejects it (>25 MiB asset). A fresh CI
    checkout never has `public/tiles/` so `deploy.yml` is unaffected; move it
    aside before test-deploying locally.
14. **`wrangler-action`'s default Wrangler is v3, not v4.** The assets-only Worker
    needs v4 (`Missing entry-point` otherwise); `deploy.yml` pins
    `wranglerVersion: "4"` (the `@v3` is the Action's own version).
15. **The default sun avoids night.** Time-of-day starts at the real SLST time
    only 06:30–17:30; otherwise 16:00. Colours dim with the sun's altitude
    (`dayFactor`), so a "real" night map is nearly black.

## Tests

`npm test` (vitest): `engine/geo.test.ts` (scene maths round-trips, tile
footprints, bearings), `skins/skins.test.ts` (schema: hex colours, shade darker
than light, outlines contrast, sane ranges, Arena default), `map/sunPosition.test.ts`.
There is no elevation-ramp test any more — the old monotonic-L* lock belonged
to MapLibre's `color-relief`; cel bands and outlines now carry readability.

## Design

Tokens (from the design's own handoff sheet), all CSS custom properties in
`src/index.css`:

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| Ink | `#0d251b` | | Route | `#ff5c46` |
| Moss | `#6b8779` | | Water | `#a9dcea` |
| Leaf | `#2f7d54` `#22694a` `#5cb17a` | | Paper | `#f7f5ec` |
| Chip | `#e8eee5` `#eef3ea` | | | |

UI type: **Bricolage Grotesque 800** (display) + **Outfit 400/600**; skin label
fonts are self-hosted too (Luckiest Guy, Fredoka) via `@fontsource/*`. Scale
44/19/15/12, 4 px grid, radii 12/14/16/20/26. No CDN fonts — the app makes no
third-party requests except the terrain tiles.

The design is trail-centric but trails are cut from scope (no trustworthy data
source). Its anatomy was repointed: trail card → peak card, trail list → nearby
peaks, trail filters → elevation-floor chips.

## Commands

```bash
npm run dev             # localhost:5273 (strictPort)
npm run build           # tsc + vite build
npm run lint            # oxlint
npm test                # vitest
npm run fetch:peaks     # refresh peaks from Overpass
npm run fetch:osm       # refresh water/rivers geojson from Overpass
npm run fetch:terrain   # 54 MB Terrarium pyramid -> src-terrarium/ (bathymetry input)
npm run build:dem       # Copernicus GLO-30 -> terrain/ (fetches ~300 MB, resumable)
npm run check:peaks     # DEM height vs OSM ele: Terrarium base vs terrain/
npm run pack:pmtiles    # pack the loose pyramid into terrain.pmtiles
npm run generate:masks  # forest.geojson + water.geojson -> src/data/masks.png
```

After a fresh clone (`public/tiles/` is gitignored): `fetch:terrain` →
`build:dem` → `pack:pmtiles`, then set `VITE_TILE_MODE` in `.env.local`.
Everything in `src/data/` **is** committed.

## Deployment

Public. `github.com/ch4mi2/kanda`, MIT. Live at https://kanda.ch4mi2.workers.dev.

**Branch strategy.** `main` is protected (PR + passing CI + 1 approval, no force
pushes; admins can bypass). Work on `feature/*` / `bugfix/*` / `docs/*`.

**CI/CD** (`.github/workflows/`):
- `ci.yml` — every PR and push to `main`/`master`: `npm ci` → lint → `tsc -b` →
  `npm test` → `npm run build`. No tile data needed.
- `deploy.yml` — push to `main`: builds with no `VITE_TILE_MODE` (so `remote`
  terrain from AWS Open Data), then `wrangler deploy` ships `dist/` as static
  assets on the Cloudflare Worker `kanda`. Repo secrets:
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

**Tiles in production.** `deploy.yml` serves the Copernicus archive from R2 when
the repo variable `TILE_BASE_URL` (Settings > Secrets and variables > Actions >
Variables) is set, and falls back to AWS `remote` (SRTM, flat z12 sea) when it is
not. The archive lives in the R2 bucket `kanda-tiles` as `terrain.pmtiles`
(CORS allows the site origin and localhost; `Range` allowed, `Content-Range`
exposed). `TILE_BASE_URL` is the bucket's public origin with no trailing slash,
and the app requests `${TILE_BASE_URL}/tiles/terrain.pmtiles`, so the object key
is `tiles/terrain.pmtiles`. Re-upload it after every `build:dem` + `pack:pmtiles`.

## Verifying map work

Screenshots lie less than assumptions here. Always:
- Check requests for `amazonaws.com`: none in `local`/`pmtiles` mode. (The pane's
  network tool does not list cross-origin fetches; use
  `performance.getEntriesByType('resource')` instead.)
- Assert `engine.getBearing()` changes **and holds** after a rotate drag
  (`window.__engine` exists in dev builds only).
- Test at the `mobile` viewport preset (and remember the dock is hidden there).
- Use a fresh tab for console checks; wait out tile loading (the pane runs ~1
  fps, so the island can take 20–40 s to refine) before judging a screenshot.
- **Summit view is the acceptance test for the user story.** Search Gombaniya →
  "Stand here": the camera sits on the summit, dragging pivots in place, the
  compass strip tracks your heading, Knuckles/Dothalugala/Pettigala etc. appear
  with distance + direction, ridge-hidden ones ghosted, and your own summit
  slope is outlined against the ridges behind it.
- Check each skin in island view, regional view (~35 km) and summit view.

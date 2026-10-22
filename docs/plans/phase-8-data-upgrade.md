# Phase 8: better elevation and real land cover

## Status and tracking

**Work is tracked in GitHub issues** under the milestone
[Phase 8: data upgrade](https://github.com/ch4mi2/kanda/milestones). This file is the
design reference; tick progress there, not here.

| Item | Status |
|---|---|
| 8A GLO-30 height | Done: #16, served from R2 via #17 |
| Rivers + water names + layer toggle (added) | #19 |
| 8B-1/2 WorldCover source + script | #20 |
| 8B-3 wire land cover | #21 |
| 8B-4 urban/farmland look (optional) | #22 |
| 8B-5 small tanks from WorldCover (optional) | #23 |
| 8C-1/2 canopy height | #24 |
| 8C-3 bare-earth height (optional) | #25 |
| 8C-4 waterfalls + national parks | #26 |

Decision 1 below is settled: **R2** (`kanda-tiles` bucket, `TILE_BASE_URL` repo variable).

**Added after planning: water.** Rivers and lake/river names were MapLibre layers and
were dropped by accident in the 7D cutover; only the lake tint survived (baked into
`masks.png`). `water.geojson` and `rivers.geojson` are still committed. #19 brings them
back in the three.js engine with a persisted toggle.

## Context

Kanda is now a three.js app (Phase 7, `feature/threejs-cutover` = 7D). Its
data is still the old MapLibre-era data:

- **Height:** Mapzen Terrarium tiles, i.e. SRTM (2000) with GMTED2010 fill, z12 = ~38 m/px.
  Noisy (spikes, pits), so `repair-dem.mjs` exists, and gotcha #6 caps exaggeration at ~2.5x.
- **Forest:** `forest.geojson`, ~270 OSM blocks over 700 ha, baked into the R channel
  of `src/data/masks.png` (`scripts/generate-masks.mjs`). `engine/masks.ts` reads it on
  the CPU, and `engine/props/trees.ts` places trees only where R is set.

You want the most accurate data for hikers, and non-commercial is fine. Decisions made in chat:

1. **Height: Copernicus GLO-30** (TanDEM-X radar, 2011-15, 30 m). Canopy stays in the
   heights, which you accepted. FABDEM (trees removed) was considered and dropped:
   its NC-SA license and ML correction buy little once trees are acceptable.
2. **Land cover: ESA WorldCover 2021 v200** (10 m, CC BY 4.0). Trees go where the class
   says tree cover, and nowhere in built-up, grass, water or bare ground.
3. **Peak heights stay OSM `ele`** (surveyed or tagged), not read off the DEM.
   Any 30 m DEM can be 5-15 m off at a summit.

Nothing here makes the grid finer than 30 m. No free source is.

## Alignment with the Phase 7 session

The "Map graphics and UI/UX styling" session owns `docs/plans/phase-7-threejs.md` and
the cutover branch. This plan stays out of its way:

- **Does not touch** `src/engine/shading`, skins, `controls`, or CLAUDE.md.
  7D rewrites CLAUDE.md, so every doc fix this phase needs is listed under
  "CLAUDE.md follow-ups" for after 7D merges.
- **Phase 7 work needed first:** none for the data scripts. 8A-1/8A-2 and 8B-1/8B-2
  write only to `scripts/` and to new gitignored dirs under `public/tiles/`, so they can
  start now. Everything that edits `src/` waits for 7D to be merged to `main`.
- **Interfaces kept:** `TileSource` still gets Terrarium PNGs (z0-12, same
  encoding); `Masks` still gets an RGB image. The engine does not know the data changed.

## Traps found while planning

1. **Copernicus has no ocean.** GLO-30 is land-only; the sea reads 0 m / nodata.
   Terrarium's bathymetry is what the shore ramp and ocean plane lean on. So this is a
   **composite**, not a replacement: keep the existing Terrarium value for ocean
   pixels and write GLO-30 over land. No GEBCO needed.
2. **Coast blend.** Use GLO-30's water body mask (`WBM`) to pick land vs ocean,
   and feather over ~2 px so the coastline doesn't step.
3. **Inland water is already flat in GLO-30** (hydro-flattening): reservoirs come out
   level and rivers monotonic. Cleaner than SRTM. No depth, so the lake depth channel
   stays a distance-from-shore proxy.
4. **The live site serves `remote` AWS Terrarium** (`deploy.yml`), so a new DEM
   reaches production only if the new terrain archive is hosted. `terrain.pmtiles` is
   ~48 MB and Workers assets cap at 25 MiB per file, so it can't ship as a single asset.
   See Decision 1.
5. **Whole-metre rounding (gotcha #7) still applies.** GLO-30 is float32; round to
   whole metres when encoding or the PNG delta filter stops compressing.
6. **DEM ceiling stays z12.** GLO-30 is 1 arc-second (~30 m), so z12 (~38 m) is the
   native-ish ceiling; z13 would be pure upscaling again. Match `TERRAIN.maxzoom = 12`
   and the quadtree's z8..z12.
7. **A 10 m class raster is huge.** Island at 10 m is ~28k x 47k px. Never load it;
   aggregate to the mask grid while streaming COG windows, and keep the baked
   output at z10 (~150 m, same grid as `masks.png`).

## Phase 8A: GLO-30 height

**8A-0: diagnose the spikes you see (before any data work).** Reproduce one in a
fresh tab and find where it comes from: the raw height in the current tiles at that
spot (is the DEM itself spiky?), whether `repair:dem` was applied to the packed
`terrain.pmtiles`, exaggeration amplifying small errors, LOD seams/skirts, or tree
instances. GLO-30 only fixes the first. If the cause is in the engine, hand that fix to
the Phase 7 session; don't expect the data swap to cure it.

**8A-1: verify sources (no code).** Before writing anything:
- Open the AWS registry entry for the Copernicus DEM (`copernicus-dem-30m`) and
  list the tiles over `SRI_LANKA_BBOX` (79.5-82.0 E, 5.7-10.0 N), about 10 1-degree
  COGs. Confirm Sri Lanka is in the **GLO-30 Public** set (some countries are
  withheld), and that `*_DEM.tif` and `*_WBM.tif` both exist per cell.
- Read the current license annex (the bucket's linked text is reported out of date).
  Record the exact attribution wording for `Attribution.tsx`.
- `npm view geotiff version` (or the chosen reader) before pinning anything.

**8A-2: `scripts/build-dem.mjs` (new).**
- Fetch the DEM and WBM COGs into `public/tiles/src-cop/` (gitignored, resumable like
  `fetch-terrain.mjs`).
- For each z0-12 tile in the existing bbox, sample GLO-30 bilinearly at the pixel centre
  (shared `lib/tilemath.mjs`), pick land vs ocean per pixel from the mask, and take the
  ocean value from the existing Terrarium tile. Encode Terrarium, whole metres.
- Write to `public/tiles/terrain-cop/` (new dir, so the old pyramid stays for A/B and
  rollback). `pack:pmtiles` gets an input-dir argument if it doesn't have one.

**8A-3: measure before swapping.** `scripts/check-peaks.mjs` (new): for all 198 peaks in
`peaks.geojson`, compare DEM height at the peak vs OSM `ele`, for old and new DEM.
Report mean error, RMS and worst 10. This is the objective "is it better" number. It
also tells us whether `repair:dem` is still needed (run it on the new DEM and diff).

**8A-4: swap (after 7D is on `main`).** `config/tiles.ts`: point `local`/`pmtiles` at the new
pyramid, update `TERRAIN.attribution`. Then retune exaggeration: if speckle is gone,
`EXAGGERATION_STOPS` and the per-skin multipliers can go up. That's an eye call, so
screenshot Knuckles before and after.

Done when: `check-peaks` RMS improves or is equal; coast shows no seam or step in a
fresh-tab screenshot at the Colombo and Trincomalee coastlines; Knuckles and the
Peak Wilderness ridge render with no pits; no `amazonaws.com` requests in local mode.

## Phase 8B: WorldCover land cover

**8B-1: verify sources.** Bucket `esa-worldcover` (eu-central-1, unsigned access), 2021
map = **v200**. Tiles are 3 x 3 degree COGs; the island needs about four
(N06/N09 x E078/E081). Confirm exact keys by listing, not by guessing a path. Class
values to map (verify against the product doc): 10 tree cover, 20 shrubland,
30 grassland, 40 cropland, 50 built-up, 60 bare/sparse, 80 permanent water,
90 herbaceous wetland, 95 mangroves, 100 moss/lichen.

**8B-2: `scripts/generate-landcover.mjs` (new).** Stream COG windows, aggregate 10 m
pixels into z10 cells as **fractions** (not classes), write `src/data/landcover.png`
(committed, RGBA, same grid as `masks.png`):

| Channel | Meaning |
|---|---|
| R | tree-cover fraction (class 10, plus mangroves at full weight) |
| G | shrub + moss fraction (20, 100) |
| B | built-up fraction (50) |
| A | grass/crop/bare/wetland "open ground" fraction (30, 40, 60, 90) |

`masks.png` keeps G (lake edge) and B (lake depth) from `water.geojson`. Its R
(forest) channel is **replaced by `landcover.png` R** once 8B-3 lands, so there's one
forest truth. `forest.geojson` stays as input for nothing else and can go.

**8B-3: wire it (after 7D is on `main`).**
- `engine/masks.ts`: load `landcover.png` as a second CPU image, expose
  `treeDensity(lng,lat)`, `shrubDensity`, `builtUp`. Same projection as now.
- `engine/props/trees.ts`: density per class instead of on/off. Tree cells are 110 m
  and the mask is ~150 m, so jitter the accept test by the density fraction (hash
  already exists). Built-up fraction above a threshold forces zero. Dense
  rainforest (fraction > 0.8) uses the tall shape, open woodland the sparse one.
- `shading/terrain.ts`: forest tint reads the new R channel. Skin files untouched
  except an optional `treeDensityScale`.
- Keep `MAX_PER_TILE`, the per-frame build cap and the phone tree cap from 7D.

**8B-4 (optional, last): urban and farmland look.** Built-up fraction can tint the
ground to a neutral and drop rock/grass detail, so towns read as towns. Tea country
(cropland on the highlands) could get its own pattern. Cut this if 8B-3 already reads well.

**8B-5 (optional): water.** Class 80 at 10 m can add small tanks that OSM
`water.geojson` lacks. Only worth it if the island-wide view shows obvious gaps.

Done when: Sinharaja, Knuckles and Peak Wilderness are tree-filled with natural edges;
Colombo, Kandy and Galle have no trees in the built-up core; Horton Plains and the
patanas are open; per-tile instance cap unchanged and phone fps not worse than 7D.

## Phase 8C: canopy height and hiker features

Chosen on value per effort. Skipped for now: Sentinel-2 colour, HydroRIVERS, GEBCO,
WorldClim zones (revisit if 8B still reads flat), and OSM trails (patchy; see below).

**8C-1: verify sources.** Global canopy height maps (ETH 10 m 2020, Meta/WRI 1 m):
license, download access, Sri Lanka coverage, which is easier to aggregate. Pick one.
`npm view` any reader before pinning.

**8C-2: canopy height into the trees.** Extend `generate-landcover.mjs` to also bake
mean canopy height (metres, quantised) over the tree-cover cells into a second image
or a fifth channel (decide when sizes are known). `trees.ts` scales tree height by it,
so Sinharaja's tall dipterocarp reads taller than Knuckles cloud-forest scrub.

**8C-3 (optional): bare-earth height.** Subtract canopy height from GLO-30 under tree
cover to approximate bare ground. Only do this if 8A shows summits and ridges reading
visibly high under forest; it adds the model error of the canopy map, so measure with
`check-peaks` first and keep it only if RMS improves.

**8C-4: OSM waterfalls and protected areas.** Extend `fetch-osm-features.mjs`
(Overpass, committed output like the others) with `waterway=waterfall` (name, height
where tagged) and `boundary=national_park` / `protected_area` outlines.
- Waterfalls: markers or labels in the same system as peaks, optional layer.
- Parks: faint boundary line plus a name on the peak card ("in Horton Plains NP").
- Trails stay out: OSM paths and hiking relations are patchy and the earlier call
  was "no trustworthy trail source". Revisit as named trails only (Adam's Peak,
  Knuckles) once the above is done.

Done when: tall and short forest are visibly different heights; waterfalls and park
names appear and match what you know on the ground; `check-peaks` is not worse.

## Decisions for you

1. **How does the new DEM reach production?** Options: (a) Cloudflare R2: one
   `terrain.pmtiles`, needs a card on file, the cleanest. (b) Ship the loose z0-12
   pyramid (~2,000 PNG files, ~54 MB) as Workers static assets: no card, each file is
   far under 25 MiB, but CI must obtain the pyramid (build it from Copernicus in CI, or
   fetch a GitHub Release asset). I'd pick **(b)** to stay free, unless the Workers
   file-count limit on your plan rules it out (verify, I believe 20,000 on free).
   Until this is decided, 8A can merge but production keeps using AWS.
2. **Tile format of the landcover.** z10 fractions (default, ~150 m, one small PNG) vs
   adding a z12 highlands-only window if tree edges look soft. Decide after seeing 8B-3.

## Order and model split

0. 8A-0 (spike diagnosis), can run now, read-only.
1. 8A-1, 8B-1, 8C-1 (verify), Sonnet, can run now.
2. 8A-2, 8A-3, 8B-2 (scripts only), Sonnet, can run now in parallel; they write only
   to `scripts/`, `src/data/landcover.png` and gitignored `public/tiles/` dirs.
3. Wait for 7D on `main`.
4. 8A-4, 8B-3, 8B-4: touch `src/`. Opus for the coast composite review in 8A-2 if
   Sonnet loops twice; otherwise Sonnet.

One branch and PR per sub-phase, off `main`: `feature/dem-cop30`, `feature/landcover-worldcover`.

## Verification (each sub-phase)

- `npm run lint && npx tsc -b && npm test && npm run build`, then `npm run preview`.
- Fresh browser tab: no console errors; no `amazonaws.com` in local/pmtiles mode.
- Mobile preset.
- 8A: `check-peaks` before/after table in the PR. Coastline screenshots. Gombaniya
  summit acceptance test (skyline labels unchanged or better).
- 8B: screenshots at Sinharaja, Kandy, Horton Plains, Colombo.

## Attribution (Attribution.tsx and README)

- Copernicus DEM: wording per the license annex read in 8A-1.
- ESA WorldCover 2021: "(c) ESA WorldCover project 2021 / Contains modified Copernicus
  Sentinel data (2021) processed by ESA WorldCover consortium", CC BY 4.0. Confirm
  wording against the product page.
- Drop the SRTM/GMTED/Tilezen line once the swap lands; keep OSM (ODbL) for peaks and rivers.

## CLAUDE.md follow-ups (after 7D merges, not before)

- Data section: elevation = Copernicus GLO-30 over Terrarium bathymetry; land cover = WorldCover.
- Gotcha: GLO-30 has no ocean, composite or the sea goes flat. Whole-metre rounding still applies.
- Gotcha: never load the 10 m WorldCover raster; aggregate while streaming.
- Commands: `build:dem`, `check:peaks`, `generate:landcover`.
- Fix the stale MapLibre-era text (CLAUDE.md still describes the old stack).

## Handoff prompt for the fresh session

> Read `docs/plans/phase-8-data-upgrade.md` and `docs/plans/phase-7-threejs.md`. Start
> with 8A-1 and 8B-1 (verify sources, no code, report findings). Then write
> `scripts/build-dem.mjs`, `scripts/check-peaks.mjs` and `scripts/generate-landcover.mjs`
> on `feature/dem-cop30`, writing only to `scripts/`, `src/data/landcover.png` and
> gitignored `public/tiles/` dirs. Do not edit `src/`, CLAUDE.md or anything on
> `feature/threejs-cutover` until 7D is merged to `main`. Stop after reporting the
> `check-peaks` numbers; I decide the swap.

# Phase 7: Kanda on a custom three.js renderer

## Context

You approved replacing the MapLibre map with a custom three.js renderer. You looked at two prototypes on real Knuckles DEM:
- [Look Lab](https://claude.ai/artifact/BxRqJTJqPZ1hS4pv6aeiN1)
- [Toon Lab](https://claude.ai/artifact/ANJzYAPBWyWEGwq88S2kFt)

**The skins are Arena (default), Ember, Clay, Block World and Ink.** Drift and Wild are dropped. Arena is the default because it is the easiest to tell mountains apart in.

Why move off MapLibre:
- It cannot cast shadows.
- It allows no custom shaders.
- It fights summit view at every step (CLAUDE.md gotcha #11).

The prototypes proved each of these is easy in three.js: shadows, outlines, skins, and a real summit camera in about 30 lines.

What matters most to you: telling mountains apart, depth, and shadows. Known complaints from the reviews:
- Standing on a peak, the summit underfoot blends into the ridges behind it.
- Water looks the same in every skin.

This session writes **the plan and the docs only**, per your plan-and-handoff rule. Implementation runs in fresh sessions. Use Opus for the 7A engine and the 7B camera/summit work, and Sonnet for 7C skins and 7D cleanup.

## Overnight autonomous run (your decision, replaces the fresh-session handoff)

This session runs all of it unattended: docs, then 7A → 7B → 7C → 7D.
- **One branch and PR per phase**, each opened off the latest `main`.
- **Admin-merge** (`gh pr merge --admin --squash`) only after CI is green and my own browser verification passes. Each merge to `main` deploys.
- **Full cutover** happens in 7D. Before it, I tag `main` as `pre-threejs` and push the tag, so going back is one revert or deploy away.
- **If a phase fails** its verification after two serious attempts, I stop at the last good merge. I don't push broken work to live. I leave a status note in the PR and the session recap.
- **Untouched:** `.mcp.json` (untracked, yours). No secrets in commits.
- **Morning summary:** what merged, live URL checks, open issues.

## What this session does first (docs)

1. **Update memory.** In `memory/threejs-revamp-skins.md`, make Arena the default and drop Drift. Fix the matching line in `MEMORY.md`.
2. **Save the prototypes into the repo.** Copy the two prototype sources into `design/prototypes/` as `look-lab.src.html` and `toon-lab.src.html`, without the inlined DEM. Add the extraction scripts (`extract.mjs`, `extract2.mjs`) and a short README. They currently live in temp scratchpads that will disappear, and they are the reference for every shader below.
3. **Write the plan doc** to `docs/plans/phase-7-threejs.md` (the content below) on a `docs/phase-7-threejs-plan` branch.
4. **Commit.** Hand you the 7A handoff prompt.

## Architecture

The rules stay the same: three.js runs imperatively inside `useEffect`, with no react-three-fiber (same reasoning as "never react-map-gl"). React keeps the panels.

```
src/engine/
  KandaMap.ts        renderer-agnostic interface the UI talks to (below)
  Engine.ts          WebGLRenderer, scene, camera, frame loop, render passes
  geo.ts             lng/lat <-> scene km (Web Mercator x cos(lat0), origin at
                     DEFAULT_CENTER); heightAt(lng,lat) from the CPU tile cache
  tiles/
    TileSource.ts    fetches terrarium PNGs for TERRAIN.mode: remote / local /
                     pmtiles (pmtiles lib `PMTiles.getZxy`, no MapLibre)
    tileWorker.ts    decode (createImageBitmap + OffscreenCanvas) -> Float32
                     heights -> mesh arrays (+ skirt), per geometry mode
    Quadtree.ts      screen-space-error LOD, z8..z12 (DEM ceiling stays z12),
                     128-segment tiles, skirts hide LOD cracks
  shading/
    terrain.glsl.ts  ported from the toon lab: lightTerm (soft/cel), rock/snow/
                     cliff, water modes, foam, rim, fog, valley mist
    sunShadow.ts     GPU sun shadow: orthographic depth pass fitted around the
                     camera target (~60 km), sampled in the terrain shader with PCF.
                     Replaces the lab's CPU march, which can't scale island-wide.
    post.ts          one fullscreen pass: depth outlines (1/z Laplacian),
                     tilt-shift, saturation/contrast, vignette
  props/             instanced trees (forest mask), clouds, ocean plane
  controls/
    MapControls.ts   three's MapControls in the Google Earth scheme (left pan,
                     right/middle rotate+tilt, wheel/pinch zoom), polar clamp
                     = PITCH_MIN/MAX
    SummitControls.ts  eye fixed at the summit, grab-the-world drag, arrow keys
                     look directly (keep gotcha #11's sign convention)
  labels.ts          projected HTML peak labels: elevation-priority declutter,
                     occlusion by CPU march on heightAt, click -> select
src/skins/           rewritten: Skin = palette + lighting + fog + outline + post
                     + geometry mode + water + trees + clouds + label font.
                     SKINS = [arena, ember, clay, blockWorld, ink], DEFAULT = arena
```

### The `KandaMap` interface

This is the only thing components see. All four map-touching components use a small surface, confirmed by grep:

| Component | MapLibre calls |
|---|---|
| CompassStrip | `getBearing`, `on`, `off` |
| NearbyPeaks | `getCenter`, `easeTo` |
| SummitLabels | `getCenter`, `getBearing`, `getPitch`, `getCanvas`, `project`, `queryTerrainElevation`, `on`, `off` |
| PeakCard | `flyTo`, `getBearing` |

So the interface is:
- `getBearing`, `getPitch`, `getCenter`
- `flyTo` / `easeTo` (center, distance or zoom, bearing, duration)
- `heightAt` (synchronous; `null` only when no tile is loaded)
- `project(lng, lat, ele)` → `{x, y, visible}`
- `on` / `off` for `move` and `render`

In 7B a thin MapLibre adapter implements the same interface, so `App.tsx` can switch engines with a flag. Both engines stay runnable until the cutover.

### Data

- **Kept as is:** `src/data/*.geojson` (peaks, water, rivers, forest) and every tile mode in `config/tiles.ts`. `terrainSourceSpec`'s URL logic gets reused through `TileSource`.
- **Water:** reuse the island-wide `water-depth.png` (gotcha #13) as the water mask and depth ramp in the shader. That gives turquoise shallows, deep middles and foam for free, which fixes "water looks the same".
- **Forest:** add a `generate:masks` script that bakes `forest.geojson` into a committed island-wide `forest-mask.png`, using `rasterizePolygons` from `scripts/lib/texture-core.mjs`. It feeds tree placement and forest tint.
- **Sea:** an ocean plane at 0 m over the real coastline (the DEM has bathymetry). Diorama skirts only exist in the prototype.

### Skins (from the labs, per-skin vertical exaggeration × the slider)

| Skin | Exaggeration | What defines it |
|---|---|---|
| **Arena** (default) | 2.6 | Smooth geometry, 3-band cel shading, violet shadows, rim light, lollipop trees, foam shorelines, light outlines, saturation 1.3 |
| **Ember** | 1.6 | Posterised golden-hour light, near-black shadows, banded fog, rim light, ridge outlines added |
| **Clay** | 3.2 | Jittered low-poly geometry, snowcaps, mauve rock, cone trees, tilt-shift |
| **Block World** | 2.8 | 240 m terraces, striped cliffs, round bushes, diamond-pattern water |
| **Ink** | 2.6 | 2-band hard cel, thick black outlines, candy-pink rock, squiggle water |

Geometry mode (smooth / clay / terrace) is a skin field applied in `tileWorker`. Switching to or from Clay or Block World rebuilds the visible tiles.

**Fix for "the summit underfoot blends in":**
- Outlines are always on in summit view (at least a thin ink line, even in Ember).
- Near-field detail noise fades in within about 2 km of the camera.
- A slight darkening of the camera's own peak.

**`lstar.test.ts` is retired.** It locks the MapLibre `color-relief` ramp, and the toon skins deliberately break monotonic L\* (Arena gets darker with height); outlines and cel bands now carry the tell-apart job. Replace it with a skin-schema test (every field present, shadow tint darker than sun colour, outline colour contrasts with grass).

## Phases (one PR each, `feature/*` off `main`)

**7A — Engine skeleton behind `?engine=three` (MapLibre stays the default)**
- Build: `TileSource`, worker, quadtree LOD, `geo.ts`/`heightAt`, Arena terrain shader, sun from `src/map/sunPosition.ts` (reuse), GPU sun shadow, fog, post outlines, `MapControls`, `TimeOfDaySlider` and exaggeration wired.
- Done when: the whole island renders from `pmtiles`/`local`, rotating holds its bearing, shadows sweep with the sun slider, and there are no `amazonaws.com` requests in local mode.

**7B — UI parity + summit view**
- Build: the `KandaMap` interface plus the MapLibre adapter; move CompassStrip, SummitLabels, PeakCard and NearbyPeaks onto it; HTML peak labels with picking and the elevation-floor filter; search fly-to; `SummitControls`.
- Done when: standing on Gombaniya, the camera sits at the summit, drag pivots in place grab-the-world style, the compass tracks, and Knuckles / Lakegala / Kirigalpotta label correctly. Also check the "Lakegala falsely shown as hidden" bug seen in the labs; tune occlusion against known sightlines.

**7C — Skins + props**
- Build: Ember, Clay, Block World and Ink; a skin picker chip in the dock (persisted in `localStorage`); instanced trees from the forest mask, capped per tile; clouds; per-skin water modes; tilt-shift (Clay only, off in summit view); label fonts (Fredoka and Luckiest Guy via `@fontsource`, no Google CDN — keeps "zero external requests").

**7D — Cutover + cleanup**
- Make three the default and delete the MapLibre engine, along with `maplibre-gl`, `maplibre-contour`, the glyph PBFs and `fetch:glyphs`, plus the texture pyramid pipeline (`generate:texture`, `pack:texture`, `texture-*`).
- Rewrite CLAUDE.md: retire MapLibre gotchas 1–4, 8–9 and 11–12 and 14; record the new engine traps.
- Mobile performance pass: DPR cap, render scale of about 0.75 on phones, tree caps.
- Done when: CI is green, deploy works, and the phone preset holds 30+ fps on the island view.

**Later — Weather (separate setting).** Open-Meteo (free, no key): cloud cover → clouds and shadows, rain → particles and darker light, visibility → fog distance, wind → drift speed.

## Risks

- **Island-wide LOD and streaming is the real engineering.** The labs were one 46 km tile. Fix the quadtree tile budget early (about 80 tiles × 129² vertices).
- **GPU shadow pass sizing.** It must cover far ridges in summit view: fit the sun frustum to the view direction, at 2048² on mobile.
- **Depth outlines vary with the near/far ratio.** Use a float `DepthTexture` (already proven in the toon lab) and adjust near/far per mode.
- **The CPU heightfield and the GPU mesh must agree** for label occlusion and tree placement. Clay and terrace geometry differ from bilinear heights; sample through the same per-mode height function the worker uses.

## Verification (each phase)

- `npm run lint && npx tsc -b && npm test && npm run build`, then `npm run preview`.
- Browser pane in a fresh tab:
  - no console errors
  - no `amazonaws.com` requests in local or pmtiles mode
  - bearing changes and holds
  - mobile preset
- Summit acceptance test on Gombaniya (CLAUDE.md "Verifying map work").
- Screenshot each skin at an island view and in summit view, side by side with the lab artifact for the same skin.

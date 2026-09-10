// Single source of truth for every tile URL the app uses.
// Swapping providers (remote AWS -> local self-hosted -> packed PMTiles)
// should only ever require editing this file.

export type TileMode = 'remote' | 'local' | 'pmtiles';

export const TERRAIN = {
  // VITE_TILE_MODE switches the terrain source:
  //   remote  - AWS Open Data S3 (default; re-fetches ~2,024 tiles per session)
  //   local   - loose PNG pyramid in public/tiles/terrain/ (npm run fetch:terrain)
  //   pmtiles - single packed archive public/tiles/terrain.pmtiles
  //             (npm run pack:pmtiles) served via HTTP range requests
  mode: (import.meta.env.VITE_TILE_MODE ?? 'remote') as TileMode,

  remote: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  local: '/tiles/terrain/{z}/{x}/{y}.png',
  // The `pmtiles://` prefix is the protocol registered by the `pmtiles`
  // package in MapView.tsx. Path is relative to the deployed site root.
  pmtiles: 'pmtiles:///tiles/terrain.pmtiles',

  encoding: 'terrarium' as const,
  tileSize: 256,
  // z12 tiles are ~38 m/px at this latitude, matching native SRTM
  // resolution. Higher zoom is pure oversampling of the same data.
  maxzoom: 12,

  attribution:
    'Elevation: SRTM (NASA/USGS) &amp; GMTED2010 (USGS) via <a href="https://github.com/tilezen/joerd" target="_blank" rel="noopener">Tilezen</a> / AWS Open Data',
};

export function terrainTileUrl(): string {
  return TERRAIN.mode === 'local' ? TERRAIN.local : TERRAIN.remote;
}

// Sri Lanka bounding box: [west, south, east, north]. This is exactly the
// area scripts/fetch-terrain.mjs and scripts/pack-pmtiles.mjs cover, so it
// doubles as the raster-dem source `bounds` — without it MapLibre requests a
// margin of tiles beyond the data, the dev/preview server answers those with
// its SPA index.html fallback, and MapLibre logs "source image could not be
// decoded" for every one (and can stall the first terrain paint).
export const SRI_LANKA_BBOX = [79.5, 5.7, 82.0, 10.0] as const;

/**
 * Source fragment for the `terrain-dem` raster-dem source. PMTiles archives
 * are addressed by a single `url`; loose tiles (remote/local) by a `tiles`
 * template. Kept here so buildStyle.ts never has to branch on the mode.
 */
export function terrainSourceSpec() {
  const common = {
    type: 'raster-dem' as const,
    tileSize: TERRAIN.tileSize,
    maxzoom: TERRAIN.maxzoom,
    encoding: TERRAIN.encoding,
    attribution: TERRAIN.attribution,
    bounds: [...SRI_LANKA_BBOX] as [number, number, number, number],
  };
  if (TERRAIN.mode === 'pmtiles') {
    return { ...common, url: TERRAIN.pmtiles };
  }
  return { ...common, tiles: [terrainTileUrl()] };
}

// Central highlands window covered by the z13-14 texture tiles. Contains 68 of
// the 70 peaks above 1,000 m, the Adam's Peak approach and the western
// escarpment. KEEP IN SYNC with TEXTURE_HIGHLANDS_BBOX in
// scripts/lib/texture-core.mjs (the bake can't import this file).
export const TEXTURE_HIGHLANDS_BBOX = [80.05, 6.1, 81.45, 7.75] as const;

export type TextureMode = 'off' | 'local' | 'pmtiles';

// Baked procedural diffuse-detail texture draped over the terrain (npm run
// generate:texture -> pack:texture). Two zoom bands: island-wide z10-12, and
// the highlands window z13-14 (4x DEM overzoom — high-res texture on a low-res
// mesh, exactly what the reference terrain renders do). VITE_TEXTURE_MODE:
//   off     - no texture layer (default; a fresh clone renders without the archive)
//   local   - loose PNG pyramid in public/tiles/texture/ (npm run generate:texture)
//   pmtiles - single packed archive public/tiles/texture.pmtiles (npm run pack:texture)
export const TEXTURE = {
  mode: (import.meta.env.VITE_TEXTURE_MODE ?? 'off') as TextureMode,
  local: '/tiles/texture/{z}/{x}/{y}.png',
  pmtiles: 'pmtiles:///tiles/texture.pmtiles',
  tileSize: 256,
  base: { minzoom: 10, maxzoom: 12, bounds: SRI_LANKA_BBOX },
  highlands: { minzoom: 13, maxzoom: 14, bounds: TEXTURE_HIGHLANDS_BBOX },
  attribution:
    'Surface texture: procedurally baked from the elevation data + OpenStreetMap landcover (ODbL)',
};

/**
 * Raster source specs for the texture, keyed by source id. **Two** sources, not
 * one: a single source with `maxzoom: 14` makes MapLibre stop overzooming at 14
 * and request z13/z14 tiles *everywhere*, so outside the highlands (where none
 * exist) the texture goes blank above z12. Two sources with different max zooms
 * by region is the fix — `buildStyle` crossfades their layers 12.5->13.5.
 * Returns `{}` when the texture is off.
 */
export function textureSourceSpecs() {
  if (TEXTURE.mode === 'off') return {};
  const src = (band: { minzoom: number; maxzoom: number; bounds: readonly number[] }) => {
    const common = {
      type: 'raster' as const,
      tileSize: TEXTURE.tileSize,
      minzoom: band.minzoom,
      maxzoom: band.maxzoom,
      bounds: [...band.bounds] as [number, number, number, number],
      attribution: TEXTURE.attribution,
    };
    return TEXTURE.mode === 'pmtiles'
      ? { ...common, url: TEXTURE.pmtiles }
      : { ...common, tiles: [TEXTURE.local] };
  };
  return {
    'texture-base': src(TEXTURE.base),
    'texture-highlands': src(TEXTURE.highlands),
  };
}

// Generous draggable area around the island. Deliberately loose: a tight
// maxBounds fights the camera during rotation because MapLibre's internal
// _constrain() assumes an unrotated viewport, and a pitched + rotated
// frustum spills well past the visible island. See CLAUDE.md gotcha #1.
export const MAP_BOUNDS: [[number, number], [number, number]] = [
  [73.0, 1.0],
  [89.0, 15.0],
];

export const MAX_ELEVATION_M = 2524; // Pidurutalagala, the tallest peak

// Central highlands, a good default view showing the main mountain ranges.
export const DEFAULT_CENTER: [number, number] = [80.7, 6.85];
export const DEFAULT_ZOOM = 8.3;
// 68°, not 60°: MapLibre only renders terrain fog above ~60° pitch
// (calculateFogBlendOpacity ramps 60->70), so at 60° aerial perspective was
// switched off and every ridge sat at the same apparent distance. 68° puts
// the resting view inside the band where haze actually draws. See §5A.3.
export const DEFAULT_PITCH = 68;
export const DEFAULT_BEARING = -20;

// The DEM tops out at z12 (~38 m/px) — that ceiling is unchanged. The *camera*
// now reaches z14 because the highlands texture tiles carry real detail to
// ~9.5 m/px there (high-res texture drape on a low-res mesh, the classic
// reference-render trade). Outside the highlands window z13-14 is 4x-overzoomed
// DEM with the texture fading out — acceptable, and every peak the app is about
// is inside the window.
export const MIN_ZOOM = 6.5;
export const MAX_ZOOM = 14;

// Camera rotate/tilt limits. Yaw is free (±180°). Pitch clamps 12°-80°:
// the design specced 72°, but the terrain-fog band is 60°-70°+, so the top of
// the range is lifted to 80° to give a clearly-hazed oblique view. Applied as
// the map's minPitch/maxPitch (so MapLibre's own dragRotate respects them) and
// re-clamped by the middle-drag handler. (Summit view in 5B pushes past this.)
export const PITCH_MIN = 12;
export const PITCH_MAX = 80;
// Sensitivity of the middle-button rotate/tilt drag (map/middleDragRotate.ts).
export const ORBIT_YAW_SENSITIVITY = 0.35; // deg of bearing per px dragged
export const ORBIT_PITCH_SENSITIVITY = 0.25; // deg of pitch per px dragged

// Vertical exaggeration is adaptive, driven by zoom (~2.5x at island view
// easing to ~1.4x zoomed in). At true 1x a 2,524 m island 400 km across
// reads as flat and the app looks broken. MapLibre 6's setTerrain only
// takes a plain number for exaggeration (no zoom expression), so MapView
// recomputes it on the `zoom` event via this curve. The manual slider is a
// multiplier on top — demoted to a fine-tune, not the primary control.
// Softened from 4.0/2.8/2.0 in Phase 4A. Exaggeration multiplies SRTM's
// inherent ~30 m speckle as well as real relief; at 4x that noise reads as
// fake micro-ridging along every slope. 2.5x still makes a 2,524 m island
// 400 km across read as unmistakably mountainous.
const EXAGGERATION_STOPS: Array<[number, number]> = [
  [6.5, 2.5], // whole-island view
  [9, 1.8], // regional
  [12, 1.4], // zoomed to a massif
  [14, 1.3], // standing among the peaks — keep the last levels easing, not a step
];

/** Adaptive terrain exaggeration for a given zoom, scaled by the user's
 *  fine-tune multiplier (1.0 = leave the curve alone). Linear between stops,
 *  clamped outside them. */
export function exaggerationForZoom(zoom: number, multiplier: number): number {
  const stops = EXAGGERATION_STOPS;
  let base = stops[0][1];
  if (zoom <= stops[0][0]) base = stops[0][1];
  else if (zoom >= stops[stops.length - 1][0]) base = stops[stops.length - 1][1];
  else {
    for (let i = 1; i < stops.length; i++) {
      const [z0, e0] = stops[i - 1];
      const [z1, e1] = stops[i];
      if (zoom <= z1) {
        base = e0 + ((e1 - e0) * (zoom - z0)) / (z1 - z0);
        break;
      }
    }
  }
  return base * multiplier;
}

export const DEFAULT_EXAGGERATION = 1.0; // multiplier — see exaggerationForZoom
export const MIN_EXAGGERATION = 0.5;
export const MAX_EXAGGERATION = 1.8;

// ---- Summit view (Phase 5B) ----
// Stand *on* a peak at eye level and look around. The camera sits at the
// summit; "looking" recomputes a target point this far out along the current
// heading and re-solves the camera with calculateCameraOptionsFromTo (there is
// no free-camera API in MapLibre).
export const SUMMIT_LOOK_DISTANCE_KM = 40;
// Eye clearance above the (exaggerated) summit surface. ~25 m, not 1.7 m: far
// enough that _elevateCameraIfInsideTerrain (which silently rewrites pitch/zoom
// when the camera is inside terrain, with no off switch) can't nudge us, and
// visually indistinguishable from standing at this scale.
export const SUMMIT_EYE_MARGIN_M = 25;
// Relief multiplier baseline while in summit view — near-honest heights, which
// is the whole point of standing there. The user's relief slider still rides
// on top of this.
export const SUMMIT_EXAGGERATION = 1.2;
// Look pitch: 90 = level horizon. Clamp to a narrow cone around the horizon —
// a summit panorama is about what's *out there*, not your own feet or the
// empty sky. Below ~84 the near slope drops out of the DEM mesh and leaves a
// void under the horizon.
export const SUMMIT_PITCH_MIN = 84;
export const SUMMIT_PITCH_MAX = 99;
// maxPitch must clear SUMMIT_PITCH_MAX (default maxPitch is 60; the hard
// MapLibre ceiling is 180). Above 90 also needs setCenterClampedToGround(false).
export const SUMMIT_MAX_PITCH = 115;
// Peaks within this range of the summit are candidates for a skyline label.
export const SUMMIT_LABEL_RADIUS_KM = 65;

export const PEAKS_ATTRIBUTION =
  'Peaks: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL)';

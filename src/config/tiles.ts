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
export const DEFAULT_PITCH = 60;
export const DEFAULT_BEARING = -20;

// The DEM tops out at z12 (~38 m/px). Past ~z13 the camera is just staring
// at upscaled texels, so cap it rather than let users zoom into blur.
export const MIN_ZOOM = 6.5;
export const MAX_ZOOM = 13;

// Drag-to-orbit gesture (the primary interaction — see CLAUDE.md).
// Design handoff sheet: yaw is free (±180°), pitch clamps 12°-72°.
export const PITCH_MIN = 12;
export const PITCH_MAX = 72;
export const ORBIT_YAW_SENSITIVITY = 0.35; // deg of bearing per px dragged
export const ORBIT_PITCH_SENSITIVITY = 0.25; // deg of pitch per px dragged

export const DEFAULT_EXAGGERATION = 1.8;
export const MIN_EXAGGERATION = 1.0;
export const MAX_EXAGGERATION = 3.0;

export const PEAKS_ATTRIBUTION =
  'Peaks: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL)';

// Single source of truth for every tile URL the app uses.
// Swapping providers (remote AWS -> local self-hosted -> MapTiler etc.)
// should only ever require editing this file.

export type TileMode = 'remote' | 'local';

export const TERRAIN = {
  // VITE_TILE_MODE=local switches to the offline copy produced by
  // scripts/fetch-terrain.mjs (see public/tiles/terrain/).
  mode: (import.meta.env.VITE_TILE_MODE ?? 'remote') as TileMode,

  remote: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  local: '/tiles/terrain/{z}/{x}/{y}.png',

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

// Sri Lanka bounding box: [west, south, east, north]
export const SRI_LANKA_BBOX = [79.5, 5.7, 82.0, 10.0] as const;

// Padding added around the bbox for maxBounds so the island isn't jammed
// against the edge of the draggable area.
export const MAP_BOUNDS: [[number, number], [number, number]] = [
  [78.8, 5.0],
  [82.7, 10.7],
];

export const MAX_ELEVATION_M = 2524; // Pidurutalagala, the tallest peak

// Central highlands, a good default view showing the main mountain ranges.
export const DEFAULT_CENTER: [number, number] = [80.7, 6.85];
export const DEFAULT_ZOOM = 8.3;
export const DEFAULT_PITCH = 60;
export const DEFAULT_BEARING = -20;

export const DEFAULT_EXAGGERATION = 1.8;
export const MIN_EXAGGERATION = 1.0;
export const MAX_EXAGGERATION = 3.0;

export const PEAKS_ATTRIBUTION =
  'Peaks: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL)';

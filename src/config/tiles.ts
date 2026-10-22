// Single source of truth for where terrain data comes from and the camera /
// relief limits the engine and UI share. Swapping providers (remote AWS ->
// local self-hosted -> packed PMTiles) should only ever require editing this
// file.

export type TileMode = 'remote' | 'local' | 'pmtiles';

// Origin the packed PMTiles archive is served from. Empty in local dev - the
// archive sits at the site root (`/tiles/terrain.pmtiles`). In production it's
// the Cloudflare R2 public origin, injected as VITE_TILE_BASE_URL at build
// time. Set with no trailing slash.
const TILE_BASE_URL = import.meta.env.VITE_TILE_BASE_URL ?? '';

export const TERRAIN = {
  // VITE_TILE_MODE switches the terrain source:
  //   remote  - AWS Open Data S3, SRTM-based Terrarium (default; re-fetches tiles
  //             every session). Lower accuracy and flat z12 sea - the production
  //             stopgap until the Copernicus pyramid below is hosted.
  //   local   - loose PNG pyramid in public/tiles/terrain/, Copernicus GLO-30
  //             (npm run build:dem)
  //   pmtiles - the same pyramid packed into public/tiles/terrain.pmtiles
  //             (npm run pack:pmtiles) served via HTTP range requests
  mode: (import.meta.env.VITE_TILE_MODE ?? 'remote') as TileMode,

  remote: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  local: '/tiles/terrain/{z}/{x}/{y}.png',
  // `TileSource` strips the `pmtiles://` prefix and hands the rest to the
  // pmtiles library. Empty TILE_BASE_URL -> site root; R2 origin in prod.
  pmtiles: `pmtiles://${TILE_BASE_URL}/tiles/terrain.pmtiles`,

  encoding: 'terrarium' as const,
  tileSize: 256,
  // z12 tiles are ~38 m/px at this latitude, about the native 30 m of both
  // SRTM and Copernicus GLO-30. Higher zoom is pure oversampling.
  maxzoom: 12,

  // Matches the data each mode actually serves.
  attribution:
    (import.meta.env.VITE_TILE_MODE ?? 'remote') === 'remote'
      ? 'Elevation: SRTM (NASA/USGS) &amp; GMTED2010 (USGS) via <a href="https://github.com/tilezen/joerd" target="_blank" rel="noopener">Tilezen</a> / AWS Open Data'
      : 'Elevation: <a href="https://registry.opendata.aws/copernicus-dem" target="_blank" rel="noopener">Copernicus DEM</a> GLO-30 (ESA / European Union), accessed 22 October 2026. Sea depth: SRTM-era Terrarium bathymetry (GEBCO) via <a href="https://github.com/tilezen/joerd" target="_blank" rel="noopener">Tilezen</a> / AWS Open Data',
};

// Sri Lanka bounding box: [west, south, east, north]. Exactly the area
// scripts/build-dem.mjs and scripts/pack-pmtiles.mjs cover; it also frames
// the z7 root tiles and the masks image.
export const SRI_LANKA_BBOX = [79.5, 5.7, 82.0, 10.0] as const;

export const MAX_ELEVATION_M = 2524; // Pidurutalagala, the tallest peak

// Scene origin (see engine/geo.ts): the central highlands.
export const DEFAULT_CENTER: [number, number] = [80.7, 6.85];

// Orbit camera tilt limits, degrees from straight down. Yaw is free.
export const PITCH_MIN = 12;
export const PITCH_MAX = 80;

// Vertical exaggeration: each skin sets its own (about 1.7-3x - at true 1x a
// 2,524 m island 400 km across reads as flat and the app looks broken); the
// slider is a multiplier on top of that.
export const DEFAULT_EXAGGERATION = 1.0;
export const MIN_EXAGGERATION = 0.5;
export const MAX_EXAGGERATION = 1.8;

// Summit view: peaks within this range of the summit get a skyline label.
export const SUMMIT_LABEL_RADIUS_KM = 65;

export const PEAKS_ATTRIBUTION =
  'Peaks: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL)';

export const WATER_ATTRIBUTION =
  'Water &amp; rivers: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL)';

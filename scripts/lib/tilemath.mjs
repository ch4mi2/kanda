// Shared Web-Mercator / XYZ tile maths. Single copy — fetch-terrain.mjs,
// generate-texture.mjs and generate-contours.mjs each used to carry their own
// near-identical pair of projection helpers.
//
// Two flavours of the forward projection:
//   * lonToMercX / latToMercY  -> fractional tile-space coordinate at zoom z
//   * lonToTileX / latToTileY  -> that, Math.floor'd to an integer tile index
// plus the inverse (tileXToLon / tileYToLat), a bbox enumerator, and the
// REF_Z world-pixel helpers the texture bake needs for seam-free world-space
// noise (see scripts/generate-texture.mjs and the Phase 6 plan §1).

export const TILE_SIZE = 256;

// Reference zoom for world-space noise parameterisation. At z20 one "reference
// pixel" is ~0.149 m at the equator. Fine enough that every octave the bake
// cares about lands on a sane wavelength in ref px; coarse enough that
// u * TILE_SIZE * 2**REF_Z stays an exact integer for Sri Lankan longitudes
// (~1.9e8, well inside Number's 2^53 safe range).
export const REF_Z = 20;

export function lonToMercX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}
export function latToMercY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export function tileXToLon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}
export function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export const lonToTileX = (lon, z) => Math.floor(lonToMercX(lon, z));
export const latToTileY = (lat, z) => Math.floor(latToMercY(lat, z));

/**
 * Every {z, x, y} tile whose extent intersects bbox = [west, south, east,
 * north]. Order is column-major (x outer, y inner) to match the loops the
 * fetch/bake scripts have always used.
 */
export function tilesForBbox(bbox, z) {
  const [w, s, e, n] = bbox;
  const xMin = lonToTileX(w, z);
  const xMax = lonToTileX(e, z);
  const yMin = latToTileY(n, z);
  const yMax = latToTileY(s, z);
  const tiles = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) tiles.push({ z, x, y });
  }
  return tiles;
}

// ---- REF_Z world-pixel helpers (texture bake) ----------------------------
// World position of tile-pixel centre (px, py) inside tile (x, y) at zoom z,
// expressed in reference-zoom pixels. A pure function of world position, so
// two adjacent tiles evaluate an identical field along their shared edge and
// the noise cannot seam.
export function refPxX(x, px, z) {
  return ((x + (px + 0.5) / TILE_SIZE) / 2 ** z) * TILE_SIZE * 2 ** REF_Z;
}
export function refPxY(y, py, z) {
  return ((y + (py + 0.5) / TILE_SIZE) / 2 ** z) * TILE_SIZE * 2 ** REF_Z;
}
// Reference px spanned by one screen pixel at tile zoom z. Used to band-limit
// octaves: 2**(REF_Z - z - log2(TILE_SIZE)).
export function refPxPerScreenPx(z) {
  return 2 ** (REF_Z - z - 8);
}

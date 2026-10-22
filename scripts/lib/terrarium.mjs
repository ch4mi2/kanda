// Terrarium height encoding + a global-pixel bilinear sampler over a z12 tile
// directory. Shared by build-dem.mjs and check-peaks.mjs.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodePng } from './png.mjs';
import { lonToMercX, latToMercY } from './tilemath.mjs';

export const decodeHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;

// WHOLE metres only — the low byte (1/256 m) is always 0. PNG delta filters
// compress whole-metre data far better (fractional heights more than doubled
// the packed archive).
export function encodeHeight(h) {
  let v = (Math.round(h) + 32768) * 256;
  if (v < 0) v = 0;
  if (v > 0xffffff) v = 0xffffff;
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

export function toHeightField({ width, height, channels, data }) {
  const h = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    h[i] = decodeHeight(data[p], data[p + 1], data[p + 2]);
  }
  return h;
}

export function writeHeightField(img, h) {
  const { width, height, channels, data } = img;
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = encodeHeight(h[i]);
    const p = i * channels;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
  }
}

/**
 * Bilinear height sampler over {dir}/{z}/{x}/{y}.png at one zoom. Pixel
 * centres sit at (tile + (px + .5) / 256), so the global pixel grid is just
 * mercator * 256 - .5. A missing tile reads as 0 m (flat sea), matching how
 * TileSource treats sparse tiles.
 */
export function makeHeightSampler(dir, z = 12) {
  const cache = new Map(); // "x/y" -> Float64Array | null

  async function tile(x, y) {
    const key = `${x}/${y}`;
    if (cache.has(key)) return cache.get(key);
    let field = null;
    try {
      field = toHeightField(decodePng(await readFile(path.join(dir, String(z), String(x), `${y}.png`))));
    } catch {
      /* missing -> flat sea */
    }
    cache.set(key, field);
    return field;
  }

  async function pixel(gx, gy) {
    const f = await tile(Math.floor(gx / 256), Math.floor(gy / 256));
    return f ? f[(gy & 255) * 256 + (gx & 255)] : 0;
  }

  return {
    pixel,
    async at(lon, lat) {
      const fx = lonToMercX(lon, z) * 256 - 0.5;
      const fy = latToMercY(lat, z) * 256 - 0.5;
      const gx = Math.floor(fx);
      const gy = Math.floor(fy);
      const tx = fx - gx;
      const ty = fy - gy;
      const [a, b, c, d] = await Promise.all([
        pixel(gx, gy),
        pixel(gx + 1, gy),
        pixel(gx, gy + 1),
        pixel(gx + 1, gy + 1),
      ]);
      return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    },
    /** Highest pixel within `r` pixels of the nearest one: the peak may sit a pixel off. */
    async maxNear(lon, lat, r = 1) {
      const gx = Math.round(lonToMercX(lon, z) * 256 - 0.5);
      const gy = Math.round(latToMercY(lat, z) * 256 - 0.5);
      let m = -Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) m = Math.max(m, await pixel(gx + dx, gy + dy));
      }
      return m;
    },
  };
}

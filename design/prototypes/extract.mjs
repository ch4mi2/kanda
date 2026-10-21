import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng } from 'file:///C:/Users/chami/Desktop/Projects/SriLankaMountains/scripts/lib/texture-core.mjs';
import { lonToMercX, latToMercY } from 'file:///C:/Users/chami/Desktop/Projects/SriLankaMountains/scripts/lib/tilemath.mjs';
const [W0, E0, S0, N0] = [80.60, 81.02, 7.18, 7.56];
const GW = 336, GH = 304, z = 12;
const ROOT = 'C:/Users/chami/Desktop/Projects/SriLankaMountains/public/tiles/terrain/12';
const cache = new Map();
function tile(x, y) {
  const k = x + '/' + y;
  if (!cache.has(k)) cache.set(k, decodePng(readFileSync(`${ROOT}/${x}/${y}.png`)));
  return cache.get(k);
}
function px(gx, gy) { // global pixel at z12
  const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const t = tile(tx, ty), i = ((gy - ty * 256) * t.W + (gx - tx * 256)) * t.ch;
  return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
}
function sample(mx, my) {
  const x = mx * 256 - 0.5, y = my * 256 - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  return (px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx) * (1 - fy) + (px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx) * fy;
}
const out = new Uint16Array(GW * GH); let mx = 0;
const x0 = lonToMercX(W0, z), x1 = lonToMercX(E0, z), y0 = latToMercY(N0, z), y1 = latToMercY(S0, z);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
  const h = Math.max(0, Math.round(sample(x0 + (x1 - x0) * i / (GW - 1), y0 + (y1 - y0) * j / (GH - 1))));
  out[j * GW + i] = h; mx = Math.max(mx, h);
}
const kmW = (E0 - W0) * 111.32 * Math.cos(7.37 * Math.PI / 180), kmH = (N0 - S0) * 110.57;
writeFileSync(process.argv[2], JSON.stringify({ bbox: [W0, S0, E0, N0], w: GW, h: GH, kmW, kmH, max: mx, b64: Buffer.from(out.buffer).toString('base64') }));
console.log({ max: mx, kmW, kmH, tiles: cache.size });

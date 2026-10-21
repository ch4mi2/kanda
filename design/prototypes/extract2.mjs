import { readFileSync, writeFileSync } from 'node:fs';
import { rasterizePolygons } from 'file:///C:/Users/chami/Desktop/Projects/SriLankaMountains/scripts/lib/texture-core.mjs';
import { lonToMercX, latToMercY } from 'file:///C:/Users/chami/Desktop/Projects/SriLankaMountains/scripts/lib/tilemath.mjs';
const D = 'C:/Users/chami/Desktop/Projects/SriLankaMountains/src/data/';
const dem = JSON.parse(readFileSync(process.argv[2]));
const [W0, S0, E0, N0] = dem.bbox, z = 12;
const x0 = lonToMercX(W0, z), x1 = lonToMercX(E0, z), y0 = latToMercY(N0, z), y1 = latToMercY(S0, z);
const toPx = lon => (lonToMercX(lon, z) - x0) / (x1 - x0) * (dem.w - 1);
const toPy = lat => (latToMercY(lat, z) - y0) / (y1 - y0) * (dem.h - 1);
const mask = (f) => { const m = rasterizePolygons(JSON.parse(readFileSync(D + f)).features, dem.w, dem.h, toPx, toPy); for (let i = 0; i < m.length; i++) m[i] = m[i] ? 255 : 0; return m; };
const water = mask('water.geojson'), forest = mask('forest.geojson');
const peaks = JSON.parse(readFileSync(D + 'peaks.geojson')).features
  .filter(f => { const [lo, la] = f.geometry.coordinates; return lo > W0 + .01 && lo < E0 - .01 && la > S0 + .01 && la < N0 - .01 && (f.properties.ele || 0) >= 1000; })
  .map(f => ({ n: f.properties.name, e: Math.round(f.properties.ele), u: toPx(f.geometry.coordinates[0]) / (dem.w - 1), v: toPy(f.geometry.coordinates[1]) / (dem.h - 1) }));
dem.water = Buffer.from(water).toString('base64'); dem.forest = Buffer.from(forest).toString('base64'); dem.peaks = peaks;
writeFileSync(process.argv[3], 'window.KANDA_DEM=' + JSON.stringify(dem) + ';');
console.log(peaks.map(p => p.n + ' ' + p.e).join(', '), '| water px', water.filter(Boolean).length, '| forest px', forest.filter(Boolean).length);

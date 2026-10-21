// Streams DEM tiles, keeps a CPU height cache, builds one mesh per tile and
// picks the tiles to draw with a screen-space-error quadtree (z7 roots down to
// the DEM ceiling, z12 - CLAUDE.md "Data").
//
// Vertex layout (see shading/chunks.ts): `position` is tile-local (x east km,
// z south km) with Y = RAW METRES, so vertical exaggeration is a uniform and
// the slider needs no rebuild. `aGrad` is dh/dx, dh/dz (m/m) for analytic
// normals. `aDrop` > 0 marks skirt vertices (they hide LOD cracks).

import * as THREE from 'three';
import { SRI_LANKA_BBOX } from '../../config/tiles';
import { sceneToTileXY, tileFootprint } from '../geo';
import { TILE_PX, TileSource } from './TileSource';

export const GRID = 128;
export const CLAY_GRID = 32;
export const ROOT_Z = 7;
export const MAX_Z = 12;
const MAX_ELEV_M = 2600;
/** Split a tile while its geometric error exceeds this many screen pixels. */
const SPLIT_PX = 2.4;
const MESH_BUILDS_PER_FRAME = 6;
const MAX_ENTRIES = 520;
const MAX_MESHES = 240;

type State = 'idle' | 'loading' | 'ready';

export interface Entry {
  key: string;
  z: number;
  x: number;
  y: number;
  state: State;
  heights: Int16Array | null; // null once ready => missing tile => sea level
  mesh: THREE.Mesh | null;
  lastUsed: number;
  box: THREE.Box3;
}

// ---- shared index buffers, one per grid size: (n+1)^2 grid + a skirt ring ----
interface Layout {
  n: number;
  gridVerts: number;
  ring: number[];
  index: THREE.BufferAttribute;
}
const LAYOUTS = new Map<number, Layout>();
function layoutFor(n: number): Layout {
  let l = LAYOUTS.get(n);
  if (l) return l;
  const v = n + 1;
  const gridVerts = v * v;
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * v + i;
      const b = a + 1;
      const c = a + v;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const ring: number[] = [];
  for (let i = 0; i < n; i++) ring.push(i);
  for (let j = 0; j < n; j++) ring.push(j * v + n);
  for (let i = n; i > 0; i--) ring.push(n * v + i);
  for (let j = n; j > 0; j--) ring.push(j * v);
  const r = ring.length;
  for (let k = 0; k < r; k++) {
    const p0 = ring[k];
    const p1 = ring[(k + 1) % r];
    idx.push(p0, gridVerts + k, p1, p1, gridVerts + k, gridVerts + ((k + 1) % r));
  }
  l = { n, gridVerts, ring, index: new THREE.BufferAttribute(new Uint16Array(idx), 1) };
  LAYOUTS.set(n, l);
  return l;
}

const ZERO = new Int16Array(TILE_PX * TILE_PX);

/** Bilinear height (m) at tile-local u,v in [0,1]. */
export function sampleHeights(h: Int16Array, u: number, v: number): number {
  const fx = Math.min(TILE_PX - 1.001, Math.max(0, u * (TILE_PX - 1)));
  const fy = Math.min(TILE_PX - 1.001, Math.max(0, v * (TILE_PX - 1)));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const a = fx - i;
  const b = fy - j;
  const p = j * TILE_PX + i;
  return (
    (h[p] * (1 - a) + h[p + 1] * a) * (1 - b) +
    (h[p + TILE_PX] * (1 - a) + h[p + TILE_PX + 1] * a) * b
  );
}

/** Deterministic 0..1 pair for a global grid vertex: tiles that share an edge agree. */
function hash2(gx: number, gy: number, z: number): [number, number] {
  let h = Math.imul(gx | 0, 374761393) + Math.imul(gy | 0, 668265263) + Math.imul(z | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const a = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  const b = ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  return [a, b];
}

interface GeoOptions {
  n: number;
  /** Jitter interior vertices (low-poly clay look), keyed by tile coordinates. */
  jitter: { z: number; x: number; y: number } | null;
}

function buildGeometry(heights: Int16Array | null, size: number, opt: GeoOptions): THREE.BufferGeometry {
  const h = heights ?? ZERO;
  const L = layoutFor(opt.n);
  const n = opt.n;
  const V = n + 1;
  const total = L.gridVerts + L.ring.length;
  const pos = new Float32Array(total * 3);
  const grad = new Float32Array(total * 2);
  const drop = new Float32Array(total);
  const pxMeters = (size * 1000) / (TILE_PX - 1);
  const du = 1 / (TILE_PX - 1);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      let u = i / n;
      let v = j / n;
      if (opt.jitter) {
        const [a, b] = hash2(opt.jitter.x * n + i, opt.jitter.y * n + j, opt.jitter.z);
        // Edge vertices only slide along their edge, so neighbouring tiles still meet.
        if (i > 0 && i < n) u += (a - 0.5) * 0.8 / n;
        if (j > 0 && j < n) v += (b - 0.5) * 0.8 / n;
      }
      const k = j * V + i;
      pos[k * 3] = u * size;
      pos[k * 3 + 1] = sampleHeights(h, u, v);
      pos[k * 3 + 2] = v * size;
      grad[k * 2] = (sampleHeights(h, u + du, v) - sampleHeights(h, u - du, v)) / (2 * pxMeters);
      grad[k * 2 + 1] = (sampleHeights(h, u, v + du) - sampleHeights(h, u, v - du)) / (2 * pxMeters);
    }
  }
  const skirtDrop = Math.min(800, Math.max(60, size * 30));
  for (let k = 0; k < L.ring.length; k++) {
    const src = L.ring[k];
    const dst = L.gridVerts + k;
    pos[dst * 3] = pos[src * 3];
    pos[dst * 3 + 1] = pos[src * 3 + 1];
    pos[dst * 3 + 2] = pos[src * 3 + 2];
    grad[dst * 2] = grad[src * 2];
    grad[dst * 2 + 1] = grad[src * 2 + 1];
    drop[dst] = skirtDrop;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aGrad', new THREE.BufferAttribute(grad, 2));
  g.setAttribute('aDrop', new THREE.BufferAttribute(drop, 1));
  g.setIndex(L.index);
  return g;
}

const ROOTS = (() => {
  const [w, s, e, n] = SRI_LANKA_BBOX;
  const n2 = 2 ** ROOT_Z;
  const mercX = (lng: number) => ((lng + 180) / 360) * n2;
  const mercY = (lat: number) => {
    const sn = Math.sin((lat * Math.PI) / 180);
    return (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * n2;
  };
  const out: Array<[number, number]> = [];
  for (let x = Math.floor(mercX(w)); x <= Math.floor(mercX(e)); x++) {
    for (let y = Math.floor(mercY(n)); y <= Math.floor(mercY(s)); y++) out.push([x, y]);
  }
  return out;
})();

export class TerrainTiles {
  readonly group = new THREE.Group();
  /** Tiles drawn in the main pass this frame. */
  rendered: Entry[] = [];
  /** Effective vertical exaggeration - only used to size culling boxes. */
  exaggeration = 2.6;
  /** Vertices per tile edge: 128 normally, 32 for the faceted clay skin. */
  grid = GRID;
  /** Screen-space error (px) a tile may have before it splits; phones use a coarser value. */
  splitPx = SPLIT_PX;
  private jitter = false;

  private entries = new Map<string, Entry>();
  private frame = 0;
  private builds = 0;
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();

  private source: TileSource;
  private material: THREE.Material;

  constructor(source: TileSource, material: THREE.Material) {
    this.source = source;
    this.material = material;
  }

  private entry(z: number, x: number, y: number): Entry {
    const key = `${z}/${x}/${y}`;
    let e = this.entries.get(key);
    if (!e) {
      const f = tileFootprint(z, x, y);
      e = {
        key,
        z,
        x,
        y,
        state: 'idle',
        heights: null,
        mesh: null,
        lastUsed: this.frame,
        box: new THREE.Box3(
          new THREE.Vector3(f.x0, 0, f.z0),
          new THREE.Vector3(f.x0 + f.size, 0, f.z0 + f.size),
        ),
      };
      this.entries.set(key, e);
    }
    return e;
  }

  private ask(e: Entry, priority: number) {
    if (e.state === 'ready') return;
    e.state = 'loading';
    this.source.request(e.z, e.x, e.y, priority, (heights) => {
      e.heights = heights;
      e.state = 'ready';
    });
  }

  private mesh(e: Entry): THREE.Mesh | null {
    if (e.mesh) return e.mesh;
    if (e.state !== 'ready' || this.builds >= MESH_BUILDS_PER_FRAME) return null;
    this.builds++;
    const f = tileFootprint(e.z, e.x, e.y);
    const m = new THREE.Mesh(
      buildGeometry(e.heights, f.size, {
        n: this.grid,
        jitter: this.jitter ? { z: e.z, x: e.x, y: e.y } : null,
      }),
      this.material,
    );
    m.position.set(f.x0, 0, f.z0);
    m.frustumCulled = false;
    m.visible = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.group.add(m);
    e.mesh = m;
    return m;
  }

  private boxFor(e: Entry): THREE.Box3 {
    e.box.max.y = (MAX_ELEV_M / 1000) * this.exaggeration;
    return e.box;
  }

  /** Pick the tiles to draw for `camera` and request whatever is missing. */
  update(camera: THREE.PerspectiveCamera, viewportH: number) {
    this.frame++;
    this.builds = 0;
    for (const e of this.rendered) if (e.mesh) e.mesh.visible = false;
    this.rendered = [];
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const focalPx = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const [x, y] of ROOTS) this.visit(this.entry(ROOT_Z, x, y), camera.position, focalPx);
  }

  /** Call once per frame after every update()/shadowMeshes(). */
  settle() {
    for (const key of this.source.pump()) {
      const e = this.entries.get(key);
      if (e && e.state === 'loading') e.state = 'idle';
    }
    this.evict();
  }

  private visit(e: Entry, cam: THREE.Vector3, focalPx: number) {
    const box = this.boxFor(e);
    if (!this.frustum.intersectsBox(box)) return;
    e.lastUsed = this.frame;
    const dist = Math.max(0.05, box.distanceToPoint(cam));
    this.ask(e, dist);
    if (e.state !== 'ready') return;

    if (e.z < MAX_Z) {
      const errPx = ((((box.max.x - box.min.x) / this.grid) * 0.5) / dist) * focalPx;
      if (errPx > this.splitPx) {
        const kids: Entry[] = [];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) kids.push(this.entry(e.z + 1, e.x * 2 + dx, e.y * 2 + dy));
        }
        let ready = true;
        let needBuild = 0;
        for (const k of kids) {
          const kb = this.boxFor(k);
          if (!this.frustum.intersectsBox(kb)) continue;
          k.lastUsed = this.frame;
          this.ask(k, Math.max(0.05, kb.distanceToPoint(cam)));
          if (k.state !== 'ready') ready = false;
          else if (!k.mesh) needBuild++;
        }
        if (ready && needBuild <= MESH_BUILDS_PER_FRAME - this.builds) {
          for (const k of kids) this.visit(k, cam, focalPx);
          return;
        }
      }
    }
    const m = this.mesh(e);
    if (!m) return;
    m.visible = true;
    this.rendered.push(e);
  }

  /** Meshes (all at zoom `zoom`) overlapping a scene-plane rectangle: the
   *  casters/receivers for the sun-shadow pass. Requests + builds as needed. */
  shadowMeshes(x0: number, x1: number, z0: number, z1: number, zoom: number): THREE.Mesh[] {
    const [tx0, ty0] = sceneToTileXY(x0, z0, zoom);
    const [tx1, ty1] = sceneToTileXY(x1, z1, zoom);
    const out: THREE.Mesh[] = [];
    for (let y = Math.floor(ty0); y <= Math.floor(ty1); y++) {
      for (let x = Math.floor(tx0); x <= Math.floor(tx1); x++) {
        const e = this.entry(zoom, x, y);
        e.lastUsed = this.frame;
        this.ask(e, 5000 + zoom);
        const m = this.mesh(e);
        if (m) out.push(m);
      }
    }
    return out;
  }

  /** Terrain height in metres at a scene point, from the finest loaded tile
   *  covering it; null when nothing covering it has loaded yet. */
  heightAt(x: number, z: number): number | null {
    for (let zoom = MAX_Z; zoom >= ROOT_Z; zoom--) {
      const [tx, ty] = sceneToTileXY(x, z, zoom);
      const e = this.entries.get(`${zoom}/${Math.floor(tx)}/${Math.floor(ty)}`);
      if (!e || e.state !== 'ready') continue;
      if (!e.heights) return 0;
      return sampleHeights(e.heights, tx - Math.floor(tx), ty - Math.floor(ty));
    }
    return null;
  }

  private evict() {
    if (this.entries.size > MAX_ENTRIES) {
      const old = [...this.entries.values()]
        .filter((e) => e.z > 9 && this.frame - e.lastUsed > 90)
        .sort((a, b) => a.lastUsed - b.lastUsed);
      for (const e of old.slice(0, this.entries.size - MAX_ENTRIES)) this.drop(e);
    }
    let meshes = 0;
    for (const e of this.entries.values()) if (e.mesh) meshes++;
    if (meshes > MAX_MESHES) {
      const old = [...this.entries.values()]
        .filter((e) => e.mesh && this.frame - e.lastUsed > 120)
        .sort((a, b) => a.lastUsed - b.lastUsed);
      for (const e of old.slice(0, meshes - MAX_MESHES)) this.disposeMesh(e);
    }
  }

  /** Switch mesh style (smooth / faceted clay). Rebuilds every mesh; heights stay cached. */
  setFaceted(faceted: boolean) {
    if (this.jitter === faceted) return;
    this.jitter = faceted;
    this.grid = faceted ? CLAY_GRID : GRID;
    for (const e of this.entries.values()) this.disposeMesh(e);
    this.rendered = [];
  }

  private disposeMesh(e: Entry) {
    if (!e.mesh) return;
    this.group.remove(e.mesh);
    e.mesh.geometry.dispose();
    e.mesh = null;
  }

  private drop(e: Entry) {
    this.disposeMesh(e);
    this.entries.delete(e.key);
  }

  dispose() {
    for (const e of this.entries.values()) this.disposeMesh(e);
    this.entries.clear();
  }

  get stats() {
    return { entries: this.entries.size, drawn: this.rendered.length };
  }
}

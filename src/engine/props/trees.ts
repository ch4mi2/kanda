// Instanced trees on the tiles closest to the camera. Placement is a pure
// function of the tile (DEM + forest mask + a hash), so the same trees appear
// every visit. Heights live in a per-instance attribute so the exaggeration
// slider and terraces move trees with the ground without any rebuild.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tileFootprint } from '../geo';
import type { Masks } from '../masks';
import type { TreeStyle } from '../skins';
import { MAX_Z, sampleHeights, type Entry } from '../tiles/TerrainTiles';
import type { TerrainUniforms } from '../shading/terrain';
import { COMMON_GLSL, TERRACE_GLSL } from '../shading/terrain';

const NEAR_KM = 14;
const CELL_KM = 0.11;
const MAX_PER_TILE = 1500;
const BUILDS_PER_FRAME = 2;

function tag(g: THREE.BufferGeometry, part: number): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  out.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count).fill(part), 1));
  return out;
}

function treeGeometry(shape: TreeStyle['shape']): THREE.BufferGeometry {
  switch (shape) {
    case 'cone':
      return mergeGeometries([
        tag(new THREE.ConeGeometry(0.055, 0.19, 5).translate(0, 0.115, 0), 1),
        tag(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 4), 0),
      ]);
    case 'pine':
      return mergeGeometries([
        tag(new THREE.ConeGeometry(0.05, 0.12, 6).translate(0, 0.1, 0), 1),
        tag(new THREE.ConeGeometry(0.036, 0.1, 6).translate(0, 0.17, 0), 1),
        tag(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 4).translate(0, 0.01, 0), 0),
      ]);
    case 'ball':
      return mergeGeometries([
        tag(new THREE.IcosahedronGeometry(0.06, 1).translate(0, 0.1, 0), 1),
        tag(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 5).translate(0, 0.02, 0), 0),
      ]);
    case 'lolly':
      return mergeGeometries([
        tag(new THREE.IcosahedronGeometry(0.07, 1).scale(1, 0.9, 1).translate(0, 0.15, 0), 1),
        tag(new THREE.CylinderGeometry(0.012, 0.016, 0.14, 5).translate(0, 0.04, 0), 0),
      ]);
  }
}

export class TreeLayer {
  readonly group = new THREE.Group();
  private style: TreeStyle | null = null;
  private geo: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial;
  private tiles = new Map<string, { mesh: THREE.InstancedMesh | null; seen: number }>();
  private frame = 0;
  private tmpOut = { forest: 0, lake: 0 };
  private masks: Masks;

  constructor(masks: Masks, u: TerrainUniforms) {
    this.masks = masks;
    this.group.visible = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...u,
        uCrown: { value: new THREE.Color() },
        uCrownAlt: { value: new THREE.Color() },
        uTrunk: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        attribute float aPart;
        attribute float aH;
        uniform float uExag, uTerrace, uTerraceStep;
        varying vec3 vW; varying float vPart; varying float vSeed;
        ${TERRACE_GLSL}
        void main() {
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.);
          float h = uTerrace > .5 ? terraceH(aH, uTerraceStep) : aH;
          w.y += max(h, 0.) * 0.001 * uExag;
          vW = w.xyz; vPart = aPart;
          vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCrown, uCrownAlt, uTrunk;
        varying vec3 vW; varying float vPart; varying float vSeed;
        ${COMMON_GLSL}
        void main() {
          vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
          vec3 c = mix(uTrunk, mix(uCrown, uCrownAlt, vSeed), vPart);
          gl_FragColor = vec4(fogIt(shadeCol(c, lightTerm(dot(N, uSun), 1.)), vW), 1.);
        }`,
    });
  }

  setStyle(style: TreeStyle | null) {
    this.clear();
    this.style = style;
    this.geo?.dispose();
    this.geo = style ? treeGeometry(style.shape) : null;
    if (style) {
      this.material.uniforms.uCrown.value.set(style.crown);
      this.material.uniforms.uCrownAlt.value.set(style.crownAlt);
      this.material.uniforms.uTrunk.value.set(style.trunk);
    }
    this.group.visible = style != null;
  }

  private release(mesh: THREE.InstancedMesh | null) {
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    mesh.dispose();
  }

  /** Drop every tree (terrain mesh style changed). */
  clear() {
    for (const t of this.tiles.values()) {
      this.release(t.mesh);
    }
    this.tiles.clear();
  }

  update(camera: THREE.Vector3, rendered: Entry[]) {
    this.frame++;
    const style = this.style;
    if (!style || !this.geo || !this.masks.ready) return;
    let builds = 0;
    for (const e of rendered) {
      if (e.z !== MAX_Z || !e.heights) continue;
      const f = tileFootprint(e.z, e.x, e.y);
      const dx = Math.max(f.x0 - camera.x, 0, camera.x - (f.x0 + f.size));
      const dz = Math.max(f.z0 - camera.z, 0, camera.z - (f.z0 + f.size));
      if (Math.hypot(dx, dz) > NEAR_KM) continue;
      let t = this.tiles.get(e.key);
      if (!t) {
        if (builds >= BUILDS_PER_FRAME) continue;
        builds++;
        t = { mesh: this.build(e, style), seen: this.frame };
        this.tiles.set(e.key, t);
      }
      t.seen = this.frame;
      if (t.mesh) t.mesh.visible = true;
    }
    for (const [key, t] of this.tiles) {
      if (t.seen === this.frame) continue;
      if (t.mesh) t.mesh.visible = false;
      if (this.frame - t.seen > 240) {
        this.release(t.mesh);
        this.tiles.delete(key);
      }
    }
  }

  private build(e: Entry, style: TreeStyle): THREE.InstancedMesh | null {
    const heights = e.heights!;
    const f = tileFootprint(e.z, e.x, e.y);
    const cells = Math.floor(f.size / CELL_KM);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const mats: THREE.Matrix4[] = [];
    const hs: number[] = [];
    let seed = (e.x * 73856093) ^ (e.y * 19349663) ^ 0x9e3779b9;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return ((seed >>> 8) & 0xffffff) / 0x1000000;
    };
    for (let j = 0; j < cells && mats.length < MAX_PER_TILE; j++) {
      for (let i = 0; i < cells && mats.length < MAX_PER_TILE; i++) {
        const r = rnd();
        const jx = rnd();
        const jz = rnd();
        const u = (i + jx) / cells;
        const v = (j + jz) / cells;
        const h = sampleHeights(heights, u, v);
        if (h < 4 || h > 1650) continue;
        const x = f.x0 + u * f.size;
        const z = f.z0 + v * f.size;
        this.masks.sample(x, z, this.tmpOut);
        if (this.tmpOut.lake > 0.25) continue;
        const slope = Math.hypot(
          sampleHeights(heights, u + 0.004, v) - sampleHeights(heights, u - 0.004, v),
          sampleHeights(heights, u, v + 0.004) - sampleHeights(heights, u, v - 0.004),
        ) / (2 * 0.004 * f.size * 1000);
        if (slope > 0.85) continue;
        const p = this.tmpOut.forest > 0.45 ? style.density : style.density * 0.05;
        if (r > p) continue;
        const sc = (0.7 + rnd() * 0.6) * style.scale;
        pos.set(x, 0, z);
        q.setFromAxisAngle(up, rnd() * 6.283);
        scl.set(sc, sc * (0.85 + rnd() * 0.3), sc);
        mats.push(m.compose(pos, q, scl).clone());
        hs.push(h);
      }
    }
    if (!mats.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo!, this.material, mats.length);
    mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    // InstancedMesh shares the geometry, so per-instance height needs its own
    // attribute set on a geometry copy.
    const g = this.geo!.clone();
    g.setAttribute('aH', new THREE.InstancedBufferAttribute(new Float32Array(hs), 1));
    mesh.geometry = g;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    return mesh;
  }
}

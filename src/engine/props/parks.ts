// National park / protected area boundaries (src/data/parks.geojson) as a
// single faint draped ribbon mesh - same technique as rivers.ts (height in
// raw metres, uExag applied in the shader, screen-distance-independent
// width since these are read at a glance rather than followed up close), but
// closed loops: each ring's edge normals use wraparound neighbours instead
// of clamped line ends.

import * as THREE from 'three';
import { lngLatToScene } from '../geo';
import type { ParkFeature } from '../../map/parks';
import type { TerrainUniforms } from '../shading/terrain';
import { COMMON_GLSL } from '../shading/terrain';

interface TileHeightSource {
  heightAt(x: number, z: number): number | null;
}

/** Raw metres the ribbon sits above the sampled ground - clears LOD noise,
 *  same rationale as rivers.ts's LIFT_M. */
const LIFT_M = 2;
const WIDTH_KM = 0.06;
const RESAMPLE_EVERY_MS = 1500;

export class ParkLayer {
  readonly group = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh | null = null;
  private xz = new Float32Array(0);
  private lastResample = 0;

  constructor(u: TerrainUniforms) {
    this.group.visible = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...u, uPark: { value: new THREE.Color() }, uWidthKm: { value: WIDTH_KM } },
      transparent: true,
      // Same reasoning as rivers.ts: a sharp bend from Douglas-Peucker
      // simplification can flip a quad's winding, which back-face culling
      // would turn into a dropped segment.
      side: THREE.DoubleSide,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      vertexShader: /* glsl */ `
        attribute vec2 aSide;
        uniform float uExag, uWidthKm;
        varying vec3 vW;
        void main() {
          vec3 p = position;
          p.xz += aSide * uWidthKm;
          p.y = max(p.y, 0.) * 0.001 * uExag;
          vec4 w = modelMatrix * vec4(p, 1.);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uPark;
        varying vec3 vW;
        ${COMMON_GLSL}
        void main() {
          gl_FragColor = vec4(fogIt(uPark, vW), 0.5);
        }`,
    });
  }

  setColor(hex: string) {
    this.material.uniforms.uPark.value.set(hex);
  }

  setFeatures(features: ParkFeature[], tiles: TileHeightSource) {
    this.clear();
    if (features.length === 0) return;
    const positions: number[] = [];
    const sides: number[] = [];
    const indices: number[] = [];
    const xz: number[] = [];
    for (const f of features) {
      const ring = f.geometry.coordinates[0];
      if (ring.length < 4) continue;
      const pts = ring.map(([lng, lat]) => lngLatToScene(lng, lat));
      const n = pts.length;
      const base = positions.length / 3;
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const next = pts[(i + 1) % n];
        const dx = next.x - prev.x;
        const dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        const px = -dz / len;
        const pz = dx / len;
        const { x, z } = pts[i];
        positions.push(x, 0, z, x, 0, z);
        sides.push(px, pz, -px, -pz);
        xz.push(x, z, x, z);
      }
      for (let i = 0; i < n; i++) {
        const a = base + i * 2;
        const b = a + 1;
        const c = base + ((i + 1) % n) * 2;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 2));
    geometry.setIndex(indices);
    this.xz = new Float32Array(xz);
    this.resampleHeights(tiles, geometry.attributes.position as THREE.BufferAttribute);
    geometry.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = true;
    this.group.add(this.mesh);
  }

  private resampleHeights(tiles: TileHeightSource, position: THREE.BufferAttribute) {
    const arr = position.array as Float32Array;
    for (let i = 0; i < this.xz.length / 2; i++) {
      const x = this.xz[i * 2];
      const z = this.xz[i * 2 + 1];
      const h = tiles.heightAt(x, z) ?? 0;
      arr[i * 3 + 1] = Math.max(h, 0) + LIFT_M;
    }
    position.needsUpdate = true;
  }

  /** Called once a frame: re-samples ground height as finer terrain tiles
   *  load in (boundaries are static, so unlike rivers.ts there is no width
   *  to rescale by camera distance). */
  update(nowMs: number, tiles: TileHeightSource) {
    if (!this.mesh) return;
    if (nowMs - this.lastResample < RESAMPLE_EVERY_MS) return;
    this.lastResample = nowMs;
    this.resampleHeights(tiles, this.mesh.geometry.attributes.position as THREE.BufferAttribute);
  }

  private clear() {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  dispose() {
    this.clear();
    this.material.dispose();
  }
}

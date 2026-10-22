// Named rivers (src/data/rivers.geojson) as a single draped ribbon mesh.
// Height is the terrain's own raw-metres convention (CLAUDE.md "Scene
// space") - stored per vertex and multiplied by uExag in the vertex shader,
// same as trees.ts, so the exaggeration slider never needs a rebuild.
//
// Width is screen-distance driven rather than per-vertex billboarded (a true
// fat-line would need a join-aware screen-space extrusion): a single uniform,
// updated every frame from how far the camera is, scales every segment's
// perpendicular offset at once. Good enough to read as a line at island view
// and a believable ribbon up close, without fighting the terrain LOD.

import * as THREE from 'three';
import { lngLatToScene } from '../geo';
import type { RiverFeature } from '../../map/water';
import type { TerrainUniforms } from '../shading/terrain';
import { COMMON_GLSL } from '../shading/terrain';

interface TileHeightSource {
  heightAt(x: number, z: number): number | null;
}

/** Raw metres the ribbon sits above the sampled ground - clears LOD noise
 *  between the coarse height this mesh samples at and the finer mesh the
 *  terrain itself draws, before uExag is applied to both. */
const LIFT_M = 3;
const FAR_KM = 160;
/** Distance (km) at which the ribbon reaches its widest - also what Engine
 *  feeds in summit mode, where "camera orbit distance" doesn't apply. */
export const NEAR_KM = 10;
const WIDTH_FAR_KM = 0.05;
const WIDTH_NEAR_KM = 0.22;
const RESAMPLE_EVERY_MS = 1200;

export class RiverLayer {
  readonly group = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh | null = null;
  /** x,z scene-km per vertex (same order/stride as the position attribute),
   *  cached so a resample doesn't need to re-project lng/lat every tick. */
  private xz = new Float32Array(0);
  private lastResample = 0;

  constructor(u: TerrainUniforms) {
    this.group.visible = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...u, uRiver: { value: new THREE.Color() }, uWidthKm: { value: WIDTH_FAR_KM } },
      transparent: true,
      // The ribbon's winding flips at a sharp bend in the simplified line
      // (CLAUDE.md "55m Douglas-Peucker" in fetch-osm-features.mjs), which
      // back-face culling would turn into a dropped quad - a dashed-looking
      // river. Double-sided avoids it; this mesh is thin enough that it
      // never matters which way a given triangle faces.
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
        uniform vec3 uRiver;
        uniform float uTime;
        varying vec3 vW;
        ${COMMON_GLSL}
        void main() {
          // Same idea as the lake/ocean waterPattern() in terrain.ts (a
          // moving vnoise highlight) so rivers don't read as flat/static
          // next to lakes - just lighter, since a thin ribbon doesn't need
          // the full multi-octave version.
          float shimmer = vnoise(vW.xz * 5. + vec2(uTime * .4, uTime * .27));
          vec3 c = uRiver * (0.82 + shimmer * 0.36);
          gl_FragColor = vec4(fogIt(c, vW), 0.82);
        }`,
    });
  }

  setColor(hex: string) {
    this.material.uniforms.uRiver.value.set(hex);
  }

  setFeatures(features: RiverFeature[], tiles: TileHeightSource) {
    this.clear();
    if (features.length === 0) return;
    const positions: number[] = [];
    const sides: number[] = [];
    const indices: number[] = [];
    const xz: number[] = [];
    for (const f of features) {
      const coords = f.geometry.coordinates;
      if (coords.length < 2) continue;
      const pts = coords.map(([lng, lat]) => lngLatToScene(lng, lat));
      const base = positions.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
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
      for (let i = 0; i < pts.length - 1; i++) {
        const a = base + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
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

  /** Called once a frame: scales the ribbon width by how close the camera
   *  is, and re-samples ground height as finer terrain tiles load in. */
  update(distanceKm: number, nowMs: number, tiles: TileHeightSource) {
    if (!this.mesh) return;
    const w = THREE.MathUtils.clamp(
      THREE.MathUtils.mapLinear(distanceKm, NEAR_KM, FAR_KM, WIDTH_NEAR_KM, WIDTH_FAR_KM),
      WIDTH_FAR_KM,
      WIDTH_NEAR_KM,
    );
    this.material.uniforms.uWidthKm.value = w;
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

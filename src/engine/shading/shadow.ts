// Real cast shadows: an orthographic depth pass from the sun, fitted around
// the area the camera cares about. MapLibre's hillshade could only shade by
// slope; this lets a ridge throw its shadow across the next valley.

import * as THREE from 'three';

export interface ShadowFit {
  /** Scene-plane rectangle of tiles to draw into the depth pass. */
  rect: [number, number, number, number];
  /** Tile zoom to draw them at (as passed to fit()). */
  zoom: number;
  /** Width of one shadow-map texel in km - for pushing a receiver off the surface before the lookup. */
  texelKm: number;
  /** Changes whenever the depth map has to be re-rendered. */
  signature: string;
}

const CORNERS = Array.from({ length: 8 }, () => new THREE.Vector3());

export class SunShadow {
  readonly target: THREE.WebGLRenderTarget;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  readonly matrix = new THREE.Matrix4();
  /** Depth range in km — the shader's depth bias is expressed against it. */
  depthRangeKm = 100;
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private lastSignature = '';

  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.target = new THREE.WebGLRenderTarget(size, size);
    this.target.depthTexture = new THREE.DepthTexture(size, size);
    this.target.depthTexture.type = THREE.UnsignedIntType;
  }

  /** Vertex spacing (km) of the tiles drawn at `zoom` - the coarse shadow mesh
   *  sits up to ~this far off the finer main-pass mesh, so the bias scales with it. */
  static spacingKm(zoom: number): number {
    return 39787 / 2 ** zoom / 128;
  }

  /** Fit the light camera around a ground square of half-width `radiusKm`
   *  centred on `center`, for a sun in direction `sun` (unit, pointing at it).
   *  `zoom` is the caller's choice of tile zoom for the shadow mesh (picked to
   *  match the main pass's LOD, not derived from radiusKm). */
  fit(center: THREE.Vector3, radiusKm: number, sun: THREE.Vector3, maxHeightKm: number, zoom: number): ShadowFit {
    const cam = this.camera;
    const up = Math.abs(sun.y) > 0.98 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    cam.position.copy(center).addScaledVector(sun, radiusKm * 3 + maxHeightKm);
    cam.up.copy(up);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);

    let i = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, maxHeightKm]) {
          CORNERS[i++].set(center.x + sx * radiusKm, y, center.z + sz * radiusKm).applyMatrix4(cam.matrixWorldInverse);
        }
      }
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of CORNERS) {
      x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x);
      y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y);
      z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z);
    }
    // Snap to whole texels so the shadows do not shimmer while the camera moves.
    const texel = Math.max(x1 - x0, y1 - y0) / this.size;
    const snap = (v: number, ceil: boolean) => (ceil ? Math.ceil(v / texel) : Math.floor(v / texel)) * texel;
    x0 = snap(x0, false); x1 = snap(x1, true); y0 = snap(y0, false); y1 = snap(y1, true);
    // Casters sunward of the receivers must stay inside the depth range.
    const pad = radiusKm * 0.5 + 10;
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.near = Math.max(0.01, -z1 - pad);
    cam.far = -z0 + pad;
    cam.updateProjectionMatrix();
    this.depthRangeKm = cam.far - cam.near;
    this.matrix.multiplyMatrices(this.bias, cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    const h = Math.hypot(sun.x, sun.z) || 1;
    const reach = 30; // km of terrain upsun that can still shadow the square
    const sx = (sun.x / h) * reach;
    const sz = (sun.z / h) * reach;
    const rect: [number, number, number, number] = [
      Math.min(center.x - radiusKm, center.x - radiusKm + sx) - 2,
      Math.max(center.x + radiusKm, center.x + radiusKm + sx) + 2,
      Math.min(center.z - radiusKm, center.z - radiusKm + sz) - 2,
      Math.max(center.z + radiusKm, center.z + radiusKm + sz) + 2,
    ];
    return {
      rect,
      zoom,
      texelKm: texel,
      signature: [x0, x1, y0, y1, sun.x.toFixed(4), sun.y.toFixed(4), sun.z.toFixed(4), zoom].join('|'),
    };
  }

  needsRender(signature: string, meshCount: number): boolean {
    const sig = `${signature}|${meshCount}`;
    if (sig === this.lastSignature) return false;
    this.lastSignature = sig;
    return true;
  }

  invalidate() {
    this.lastSignature = '';
  }

  dispose() {
    this.target.dispose();
    this.target.depthTexture?.dispose();
  }
}

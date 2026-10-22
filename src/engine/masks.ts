// CPU copy of masks.png (R forest, G lake edge, B lake depth) so props can be
// placed where the shader paints forest. Same projection as the GPU sampling:
// the image spans SRI_LANKA_BBOX linearly in scene km.

import masksUrl from '../data/masks.png';
import { SRI_LANKA_BBOX } from '../config/tiles';
import { lngLatToScene } from './geo';

export class Masks {
  ready = false;
  private data: Uint8ClampedArray | null = null;
  private w = 0;
  private h = 0;
  private x0: number;
  private z0: number;
  private invW: number;
  private invH: number;

  constructor() {
    const [w, s, e, n] = SRI_LANKA_BBOX;
    const nw = lngLatToScene(w, n);
    const se = lngLatToScene(e, s);
    this.x0 = nw.x;
    this.z0 = nw.z;
    this.invW = 1 / (se.x - nw.x);
    this.invH = 1 / (se.z - nw.z);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = this.w = img.naturalWidth;
      c.height = this.h = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      this.data = ctx.getImageData(0, 0, c.width, c.height).data;
      this.ready = true;
    };
    img.src = masksUrl;
  }

  /** Forest 0..1 and lake 0..1 at a scene point (zeros outside the image). */
  sample(x: number, z: number, out: { forest: number; lake: number }) {
    out.forest = 0;
    out.lake = 0;
    if (!this.data) return out;
    const u = (x - this.x0) * this.invW;
    const v = (z - this.z0) * this.invH;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return out;
    const i = ((Math.floor(v * this.h) * this.w + Math.floor(u * this.w)) << 2) as number;
    out.forest = this.data[i] / 255;
    out.lake = this.data[i + 1] / 255;
    return out;
  }
}

// CPU copies of masks.png (G lake edge, B lake depth — R is unused, see
// CLAUDE.md) and landcover.png (R tree, G shrub, B built-up, A open ground)
// so props can be placed by land cover. Both images span SRI_LANKA_BBOX
// linearly in scene km, same grid, so they share one projection.

import masksUrl from '../data/masks.png';
import landcoverUrl from '../data/landcover.png';
import { SRI_LANKA_BBOX } from '../config/tiles';
import { lngLatToScene } from './geo';
import { fetchPng } from './decodePng';

export class Masks {
  ready = false;
  landcoverReady = false;
  private data: Uint8ClampedArray | null = null;
  private w = 0;
  private h = 0;
  private lc: Uint8Array | null = null;
  private lcW = 0;
  private lcH = 0;
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

    // Manual decode (see decodePng.ts) — landcover.png's alpha channel is
    // real data (open-ground fraction), not transparency, and canvas decode
    // is free to lose RGB wherever alpha is 0.
    fetchPng(landcoverUrl)
      .then((png) => {
        if (!png) return;
        this.lc = png.data;
        this.lcW = png.width;
        this.lcH = png.height;
        this.landcoverReady = true;
      })
      // Without this, a decode failure left landcoverReady false forever
      // with no visible signal beyond an unhandled-rejection console entry
      // (that's exactly how the manual-decode bug this file once had went
      // unnoticed - see git history) - trees.ts gates all placement on
      // landcoverReady, so a silent failure here means no trees at all.
      .catch((err) => console.error('landcover.png decode failed - no trees will place:', err));
  }

  /** Lake 0..1 at a scene point (zero outside the image). */
  sample(x: number, z: number, out: { lake: number }) {
    out.lake = 0;
    if (!this.data) return out;
    const u = (x - this.x0) * this.invW;
    const v = (z - this.z0) * this.invH;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return out;
    const i = ((Math.floor(v * this.h) * this.w + Math.floor(u * this.w)) << 2) as number;
    out.lake = this.data[i + 1] / 255;
    return out;
  }

  private landcoverAt(x: number, z: number, channel: number): number {
    if (!this.lc) return 0;
    const u = (x - this.x0) * this.invW;
    const v = (z - this.z0) * this.invH;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
    const i = (Math.floor(v * this.lcH) * this.lcW + Math.floor(u * this.lcW)) * 4 + channel;
    return this.lc[i] / 255;
  }

  /** ESA WorldCover tree-cover fraction 0..1 at a scene point. */
  treeDensity(x: number, z: number): number {
    return this.landcoverAt(x, z, 0);
  }

  /** ESA WorldCover shrub + moss/lichen fraction 0..1 at a scene point. */
  shrubDensity(x: number, z: number): number {
    return this.landcoverAt(x, z, 1);
  }

  /** ESA WorldCover built-up fraction 0..1 at a scene point. */
  builtUp(x: number, z: number): number {
    return this.landcoverAt(x, z, 2);
  }
}

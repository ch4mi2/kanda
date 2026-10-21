// Fetches + decodes Terrarium DEM tiles for whichever TERRAIN.mode is active.
// Delivers whole-metre heights (Int16, 256x256) or null when the tile does not
// exist (the loose pyramid is sparse outside the island) — callers treat null
// as flat sea level.

import { PMTiles } from 'pmtiles';
import { TERRAIN } from '../../config/tiles';

export const TILE_PX = 256;
const MAX_IN_FLIGHT = 8;

type Done = (heights: Int16Array | null) => void;

interface Job {
  key: string;
  priority: number;
  z: number;
  x: number;
  y: number;
  done: Done;
}

export class TileSource {
  private pm: PMTiles | null = null;
  private queued = new Map<string, Job>();
  private running = new Set<string>();
  private asked = new Set<string>();
  private canvas = new OffscreenCanvas(TILE_PX, TILE_PX);
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

  constructor() {
    if (TERRAIN.mode === 'pmtiles') {
      this.pm = new PMTiles(TERRAIN.pmtiles.replace(/^pmtiles:\/\//, ''));
    }
  }

  /** Ask for a tile; lower priority number = sooner. Call every frame while the
   *  tile is wanted — repeat calls only refresh the priority. */
  request(z: number, x: number, y: number, priority: number, done: Done) {
    const key = `${z}/${x}/${y}`;
    this.asked.add(key);
    if (this.running.has(key)) return;
    const q = this.queued.get(key);
    if (q) q.priority = priority;
    else this.queued.set(key, { key, priority, z, x, y, done });
  }

  /** Once per frame, after the request()s: forget queued jobs nobody asked for
   *  this frame (returns their keys) and start the most urgent ones. */
  pump(): string[] {
    const dropped: string[] = [];
    for (const key of this.queued.keys()) {
      if (!this.asked.has(key)) {
        this.queued.delete(key);
        dropped.push(key);
      }
    }
    this.asked.clear();
    if (this.running.size < MAX_IN_FLIGHT && this.queued.size) {
      const next = [...this.queued.values()].sort((a, b) => a.priority - b.priority);
      for (const job of next) {
        if (this.running.size >= MAX_IN_FLIGHT) break;
        this.queued.delete(job.key);
        this.running.add(job.key);
        this.run(job);
      }
    }
    return dropped;
  }

  private async run(job: Job) {
    let heights: Int16Array | null = null;
    try {
      heights = await this.fetchDecode(job.z, job.x, job.y);
    } catch {
      heights = null;
    }
    this.running.delete(job.key);
    job.done(heights);
  }

  private async fetchDecode(z: number, x: number, y: number): Promise<Int16Array | null> {
    let blob: Blob;
    if (this.pm) {
      const res = await this.pm.getZxy(z, x, y);
      if (!res) return null;
      blob = new Blob([res.data], { type: 'image/png' });
    } else {
      const url = (TERRAIN.mode === 'local' ? TERRAIN.local : TERRAIN.remote)
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
      const res = await fetch(url);
      if (!res.ok) return null;
      // The dev/preview server answers missing tiles with its SPA index.html.
      if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
      blob = await res.blob();
    }
    const bmp = await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    this.ctx.clearRect(0, 0, TILE_PX, TILE_PX);
    this.ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const px = this.ctx.getImageData(0, 0, TILE_PX, TILE_PX).data;
    const out = new Int16Array(TILE_PX * TILE_PX);
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.round(px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768);
    }
    return out;
  }
}

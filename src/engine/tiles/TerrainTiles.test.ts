import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { tileFootprint } from '../geo';
import { TerrainTiles } from './TerrainTiles';
import { TILE_PX, type TileSource } from './TileSource';

/** Answers every tile request synchronously with a flat height of z*100 m, so
 *  tests can tell which zoom a sample came from. */
class FakeSource {
  request(z: number, _x: number, _y: number, _priority: number, done: (h: Int16Array | null) => void) {
    done(new Int16Array(TILE_PX * TILE_PX).fill(z * 100));
  }
  pump(): string[] {
    return [];
  }
}

describe('TerrainTiles.heightAtZoom', () => {
  it('falls back to the next coarser loaded zoom', () => {
    const tiles = new TerrainTiles(new FakeSource() as unknown as TileSource, new THREE.MeshBasicMaterial());
    const f = tileFootprint(9, 300, 200);
    const px = f.x0 + f.size * 0.5;
    const pz = f.z0 + f.size * 0.5;
    const eps = f.size * 0.01;
    // Load only zoom 9 and zoom 11 for this point - zoom 10 and 12 stay empty.
    tiles.shadowMeshes(px - eps, px + eps, pz - eps, pz + eps, 9);
    tiles.shadowMeshes(px - eps, px + eps, pz - eps, pz + eps, 11);

    expect(tiles.heightAtZoom(px, pz, 11)).toBeCloseTo(1100, 0);
    expect(tiles.heightAtZoom(px, pz, 10)).toBeCloseTo(900, 0); // not loaded -> falls back to 9
    expect(tiles.heightAtZoom(px, pz, 12)).toBeCloseTo(1100, 0); // not loaded -> falls back to 11
    expect(tiles.heightAtZoom(px, pz, 7)).toBeNull(); // nothing ready at zoom 7 for this point
  });
});

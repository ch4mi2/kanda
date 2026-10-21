import { describe, expect, it } from 'vitest';
import { DEFAULT_CENTER } from '../config/tiles';
import { bearingOf, KM_PER_MERC, lngLatToScene, sceneToLngLat, sceneToTileXY, tileFootprint } from './geo';

describe('scene space', () => {
  it('puts DEFAULT_CENTER at the origin', () => {
    const p = lngLatToScene(DEFAULT_CENTER[0], DEFAULT_CENTER[1]);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('round-trips lng/lat', () => {
    const p = lngLatToScene(80.7482898, 7.4551115); // Gombaniya
    const [lng, lat] = sceneToLngLat(p.x, p.z);
    expect(lng).toBeCloseTo(80.7482898, 9);
    expect(lat).toBeCloseTo(7.4551115, 9);
  });

  it('is ~1 km per unit: 0.1 deg of latitude is ~11 km, north is -z', () => {
    const a = lngLatToScene(80.7, 6.85);
    const b = lngLatToScene(80.7, 6.95);
    expect(a.z - b.z).toBeGreaterThan(10.9);
    expect(a.z - b.z).toBeLessThan(11.3);
  });

  it('tile footprints tile the plane exactly', () => {
    const a = tileFootprint(10, 740, 492);
    const b = tileFootprint(10, 741, 492);
    const c = tileFootprint(10, 740, 493);
    expect(a.x0 + a.size).toBeCloseTo(b.x0, 9);
    expect(a.z0 + a.size).toBeCloseTo(c.z0, 9);
    expect(a.size).toBeCloseTo(KM_PER_MERC / 1024, 9);
  });

  it('finds the tile a point is in', () => {
    const f = tileFootprint(11, 1481, 985);
    const [tx, ty] = sceneToTileXY(f.x0 + f.size * 0.25, f.z0 + f.size * 0.75, 11);
    expect(tx).toBeCloseTo(1481.25, 6);
    expect(ty).toBeCloseTo(985.75, 6);
  });

  it('bearings are compass bearings (north = -z)', () => {
    expect(bearingOf(0, -1)).toBeCloseTo(0);
    expect(bearingOf(1, 0)).toBeCloseTo(90);
    expect(bearingOf(0, 1)).toBeCloseTo(180);
    expect(bearingOf(-1, 0)).toBeCloseTo(-90);
  });
});

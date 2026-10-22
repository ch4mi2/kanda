import { describe, expect, it } from 'vitest';
import { limitForZone, nextLabelZone } from './labels';

describe('label zone hysteresis', () => {
  it('steps out at the outer threshold and stays out through the dead band', () => {
    let zone = nextLabelZone(1, 120);
    expect(zone).toBe(0);
    zone = nextLabelZone(zone, 100); // 95..110: dead band, stays in the outer zone
    expect(zone).toBe(0);
    zone = nextLabelZone(zone, 90);
    expect(zone).toBe(1);
  });

  it('steps in at the inner threshold and stays in through its own dead band', () => {
    let zone = nextLabelZone(1, 40);
    expect(zone).toBe(2);
    zone = nextLabelZone(zone, 50); // 45..55: dead band, stays in the inner zone
    expect(zone).toBe(2);
    zone = nextLabelZone(zone, 60);
    expect(zone).toBe(1);
  });

  it('never jumps more than one zone per call', () => {
    expect(nextLabelZone(2, 1000)).toBe(1);
    expect(nextLabelZone(0, 0)).toBe(1);
  });

  it('maps zones to label counts', () => {
    expect(limitForZone(0)).toBe(14);
    expect(limitForZone(1)).toBe(24);
    expect(limitForZone(2)).toBe(36);
  });
});

import { describe, expect, it } from 'vitest';
import { lstar } from './lstar';
import { KANDA_SKIN } from './kanda';
import { SKINS } from './index';

describe('lstar', () => {
  it('anchors black at 0 and white at 100', () => {
    expect(lstar('#000000')).toBeCloseTo(0, 5);
    expect(lstar('#ffffff')).toBeCloseTo(100, 5);
  });

  it('accepts shorthand hex', () => {
    expect(lstar('#fff')).toBeCloseTo(lstar('#ffffff'), 5);
  });

  it('mid-grey #777 sits near L* 50', () => {
    expect(lstar('#777777')).toBeGreaterThan(48);
    expect(lstar('#777777')).toBeLessThan(52);
  });
});

// The elevation ramp's entire job is "brighter = higher". The eye reads
// perceived lightness (L*), so the ramp must climb in L* monotonically — the
// pre-Phase-5 Kanda ramp was a V and this test would have caught it. Any skin
// added to SKINS[] is held to the same rule.
describe.each(SKINS)('$name elevation ramp', (skin) => {
  const ls = skin.elevationBands.map(([, hex]) => lstar(hex));

  it('is strictly increasing in L* with elevation', () => {
    for (let i = 1; i < ls.length; i++) {
      expect(
        ls[i],
        `band ${skin.elevationBands[i][0]} m (${skin.elevationBands[i][1]}) ` +
          `is not brighter than band ${skin.elevationBands[i - 1][0]} m`,
      ).toBeGreaterThan(ls[i - 1]);
    }
  });

  it('spans a wide lightness range (deep lowland, pale tops)', () => {
    expect(ls[0]).toBeLessThan(45); // lowlands genuinely dark
    expect(ls[ls.length - 1]).toBeGreaterThan(90); // tops near-white
  });
});

describe('Kanda ramp bands are ascending in elevation', () => {
  it('elevation floors are strictly ascending', () => {
    const es = KANDA_SKIN.elevationBands.map(([e]) => e);
    for (let i = 1; i < es.length; i++) {
      expect(es[i]).toBeGreaterThan(es[i - 1]);
    }
  });
});

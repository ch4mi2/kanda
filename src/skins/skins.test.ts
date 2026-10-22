import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN, SKINS, skinById } from './index';

const HEX = /^#[0-9a-f]{6}$/i;
const COLOUR_FIELDS = [
  'zenith', 'horizon', 'seaDeep', 'fog', 'sunColor', 'shade', 'grassLow', 'grassHigh', 'forest',
  'rock', 'snow', 'cliffColor', 'water', 'waterHigh', 'waterDeep', 'foam', 'outlineColor', 'labelColor',
  'river', 'waterLabel', 'waterfall', 'park',
] as const;

function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

describe('skins', () => {
  it('ships Arena as the default, listed first', () => {
    expect(DEFAULT_SKIN.id).toBe('arena');
    expect(SKINS[0]).toBe(DEFAULT_SKIN);
  });

  it('has unique ids and resolves them', () => {
    const ids = SKINS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SKINS) expect(skinById(s.id)).toBe(s);
    expect(skinById('nope')).toBe(DEFAULT_SKIN);
    expect(skinById(null)).toBe(DEFAULT_SKIN);
  });

  for (const skin of SKINS) {
    describe(skin.id, () => {
      it('uses #rrggbb for every colour field', () => {
        for (const f of COLOUR_FIELDS) expect(skin[f], `${skin.id}.${f}`).toMatch(HEX);
        if (skin.trees) for (const c of [skin.trees.crown, skin.trees.crownAlt, skin.trees.trunk]) expect(c).toMatch(HEX);
        if (skin.clouds) for (const c of [skin.clouds.lit, skin.clouds.shaded]) expect(c).toMatch(HEX);
      });

      it('shades darker than it lights', () => {
        expect(luma(skin.shade)).toBeLessThan(luma(skin.sunColor));
      });

      it('keeps outlines visible against the grass', () => {
        if (skin.outline > 0) {
          expect(Math.abs(luma(skin.outlineColor) - luma(skin.grassHigh))).toBeGreaterThan(0.2);
        }
      });

      it('keeps the water label legible against the grass', () => {
        expect(Math.abs(luma(skin.waterLabel) - luma(skin.grassHigh))).toBeGreaterThan(0.2);
      });

      it('keeps the waterfall label legible against the grass', () => {
        expect(Math.abs(luma(skin.waterfall) - luma(skin.grassHigh))).toBeGreaterThan(0.2);
      });

      it('has sane numeric ranges', () => {
        expect(skin.exaggeration).toBeGreaterThan(1);
        expect(skin.exaggeration).toBeLessThan(4);
        expect(skin.fogDensity).toBeGreaterThan(0);
        expect(skin.celBands).toBeGreaterThanOrEqual(2);
        if (skin.trees) expect(skin.trees.density).toBeLessThan(0.6);
      });
    });
  }
});

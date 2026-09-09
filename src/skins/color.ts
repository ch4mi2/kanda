// Tiny colour helpers for skins that need to *compute* a colour at runtime
// rather than hand MapLibre a static value — today just the sun-driven
// hillshade, which interpolates its shadow/highlight tint by the live sun
// altitude (buildStyle.ts holds no palette, so the keyframes live in the Skin).
//
// Handles `#rgb`, `#rrggbb`, `rgb(...)` and `rgba(...)`. Not a general colour
// library — no hsl, no named colours.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(css: string): Rgba {
  const s = css.trim();
  const hex = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const h = hex[1];
    const full =
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = s.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[,/]/).map((p) => parseFloat(p.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  throw new Error(`parseColor: unsupported colour: ${css}`);
}

export function toRgbaString({ r, g, b, a }: Rgba): string {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${round(a)})`;
}

export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
    a: a.a + (b.a - a.a) * k,
  };
}

/**
 * Sample a keyframe ramp (`[[x, css], ...]`, ascending by x) at `x`, linearly
 * interpolating between the two bracketing stops and clamping past the ends.
 */
export function sampleColorRamp(
  stops: ReadonlyArray<readonly [number, string]>,
  x: number,
): string {
  if (stops.length === 0) throw new Error('sampleColorRamp: no stops');
  if (x <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [x0, c0] = stops[i - 1];
    const [x1, c1] = stops[i];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return toRgbaString(mix(parseColor(c0), parseColor(c1), t));
    }
  }
  return last[1];
}

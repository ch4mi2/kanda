// CIE L* (perceptual lightness, 0–100) of an sRGB colour.
//
// The elevation ramp's whole job is "brighter = higher". The eye reads
// perceived lightness, not any single RGB channel, so the ramp is checked in
// L* — see the monotonicity test next to this file and §5A.1 of the Phase 5
// plan, where the shipped-before-Phase-5 ramp measured as a V (brightest at
// 480 m, darkest at 2,000 m).
//
// Accepts `#rgb`, `#rrggbb`. No dependency — this is ~15 lines of the standard
// sRGB → linear → relative-luminance → L* pipeline.

function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) {
    throw new Error(`lstar: not a hex colour: ${hex}`);
  }
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Perceptual lightness L* (0 = black, 100 = white) of an sRGB hex colour. */
export function lstar(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y <= 216 / 24389 ? y * 24389 / 27 : 116 * Math.cbrt(y) - 16;
}

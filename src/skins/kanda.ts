import type { Skin } from './types';

// "Kanda" — the default skin. A deliberately stylised game-map palette: bright,
// saturated, posterised into clean bands. Not a satellite impression.
//
// Genuinely different hues per tier — grass -> olive -> khaki -> ochre -> tan ->
// clay -> stone -> snow — so from a summit you can still read "that ridge is
// higher than this one" at a glance. What it does NOT do is the design mockup's
// nine near-identical greens (see the "why the mockups look green" note in
// CLAUDE.md).
//
// Crucially the ramp is **monotonic in perceived lightness (CIE L*)** — every
// band is brighter than the one below it, so "brighter = higher" holds across
// the whole island. The pre-Phase-5 ramp was a V (brightest at 480 m, darkest
// at 2,000 m), which made a foothill out-glow a near-summit and the tallest
// peaks read as the darkest thing on the map — §5A.1 of the Phase 5 plan. The
// low end is also deepened (L* ~37 at the coast vs ~67 before) so lowlands stop
// competing with the hills. `src/skins/lstar.test.ts` locks the monotonicity
// in; the L* of each band is in the trailing comment.
//
// All stops are at or above sea level. Everything below 0 m is flat `water`
// (see softColorRamp) — no bathymetry gradient, so the sea reads as one clean
// colour the way a game map's does. Resolution is concentrated low: most of
// the island's land is under 1,000 m.
const bands: Skin['elevationBands'] = [
  [0, '#2b6138'], // coast / lowland — deep forest green   L* 37
  [120, '#3c7a37'], // plains — green                       L* 46
  [280, '#588c33'], // rising ground, green                 L* 53
  [480, '#74923b'], // low hills, olive-green               L* 57
  [720, '#95924c'], // foothills, deep khaki                L* 59
  [1000, '#b0965a'], // hill country, ochre                 L* 63
  [1300, '#c4a06e'], // highlands, warm tan                 L* 68
  [1650, '#d3ad8e'], // ridges, pale clay                   L* 73
  [2000, '#e0c3b1'], // near-summit rock, warm stone        L* 81
  [2300, '#ecdccf'], // summit shoulders, pale stone        L* 89
  [2524, '#f7f1e8'], // the very tops — snow-pale           L* 95
];

export const KANDA_SKIN: Skin = {
  id: 'kanda',
  name: 'Kanda',
  // Matches `water` so terrain edges melt into the sea rather than showing a
  // hard shelf against a different-coloured void.
  background: '#8fd0dc',
  elevationBands: bands,
  // Tight cross-fade: just enough to anti-alias the band edges. Wider reads as
  // a gradient stripe following every contour; this reads as a clean cel-shaded
  // zone.
  bandBlendM: 12,
  water: '#8fd0dc',
  lake: '#79c1d3',
  river: '#57aecb',
  // Deep blue-green, half-transparent — darkens the forested blocks (Sinharaja,
  // Knuckles, Peak Wilderness...) without hiding the relief under them.
  forest: 'rgba(44, 92, 66, 0.5)',
  hillshade: {
    // 'igor' reads landform far better than the Lambertian 'standard' default,
    // which was crushing every band to mud. Direction + altitude are driven by
    // the real sun at runtime (buildStyle's hillshadeLightForSun), so shading
    // tells a time-of-day story instead of a fixed NW keylight.
    method: 'igor',
    exaggeration: 0.55,
    illuminationAnchor: 'map',
    accentColor: 'rgba(0, 0, 0, 0)',
    // 'igor' is single-light; multidirectional Swiss fill is a future skin.
    fillLights: [],
    // Cool blue-violet shadow that deepens and warms slightly at golden hour,
    // and a night-blue floor so a below-horizon sun still gives readable form
    // rather than a black slab.
    shadowByAltitude: [
      [-12, 'rgba(36, 48, 86, 0.36)'],
      [2, 'rgba(84, 64, 96, 0.33)'],
      [12, 'rgba(70, 66, 104, 0.31)'],
      [45, 'rgba(58, 70, 104, 0.30)'],
      [90, 'rgba(58, 70, 104, 0.28)'],
    ],
    // Sunlit faces: cool and faint at night, warm amber at low sun, easing to
    // a neutral warm-white overhead.
    highlightByAltitude: [
      [-12, 'rgba(72, 98, 150, 0.20)'],
      [2, 'rgba(255, 212, 156, 0.36)'],
      [12, 'rgba(255, 234, 202, 0.32)'],
      [45, 'rgba(255, 247, 231, 0.29)'],
      [90, 'rgba(255, 250, 240, 0.27)'],
    ],
  },
  sky: {
    skyColor: '#a9d8ef',
    skyHorizonBlend: 0.6,
    horizonColor: '#e9f1f0',
    horizonFogBlend: 0.55,
    fogColor: '#dcedf0', // toward the water colour so the horizon hazes out
    fogGroundBlend: 0.5,
  },
  contour: {
    line: '#4a3626', // dark cocoa — enough contrast on the green AND terracotta
    labelHalo: 'rgba(247, 245, 236, 0.9)',
    width: 1,
    indexEvery: 1000, // metres between labelled "index" contours
  },
};

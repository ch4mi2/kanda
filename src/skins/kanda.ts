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
  // Matches the deepest `shore` stop so the edge of the DEM's coverage melts
  // into open ocean instead of showing a seam against a different colour.
  background: '#2f6f91',
  elevationBands: bands,
  // Tight cross-fade: just enough to anti-alias the band edges. Wider reads as
  // a gradient stripe following every contour; this reads as a clean cel-shaded
  // zone.
  bandBlendM: 12,
  water: '#8fd0dc',
  // Open blue out deep, turquoise over the shelf, a pale surf line at the
  // shore, then a narrow strand. This is the single biggest thing separating
  // the old flat-cyan coastline from a game map's.
  shore: {
    byDepth: [
      [-4000, '#2f6f91'],
      [-900, '#3b86a6'],
      [-180, '#57a8c0'],
      [-40, '#84cddb'],
      [-6, '#b9e9ea'],
    ],
    sand: '#e6d9b2',
    sandTopM: 8,
  },
  lake: '#79c1d3',
  river: '#57aecb',
  // Deep blue-green, half-transparent — darkens the forested blocks (Sinharaja,
  // Knuckles, Peak Wilderness...) without hiding the relief under them.
  forest: 'rgba(44, 92, 66, 0.5)',
  // Deep teal on the water names, a lighter blue on the rivers — both cool
  // enough to sit apart from the warm peak/contour labels, with a paper halo.
  hydroLabel: {
    water: '#1f5d6b',
    river: '#337a90',
    halo: 'rgba(247, 245, 236, 0.9)',
  },
  hillshade: {
    // 'combined' blends a slope term with the directional term, so ridges and
    // valleys stay legible even when the sun is high (near the equator it's
    // overhead at noon and a pure directional shade goes flat — "just mist").
    // 'igor' was too matte for that. Direction + altitude still track the real
    // sun (buildStyle's hillshadeLightForSun) for the time-of-day story.
    method: 'combined',
    exaggeration: 1,
    illuminationAnchor: 'map',
    // Dark crest accent — picks out ridge edges the flat bands otherwise hide.
    accentColor: 'rgba(18, 14, 10, 0.3)',
    fillLights: [],
    // Near-black shadow at high opacity. A washed blue-grey here is what made
    // the relief read as haze; the dark side of a ridge should be *dark*.
    // Still faintly cool/violet rather than pure black so it sits in the
    // palette, and it warms a touch at golden hour.
    shadowByAltitude: [
      [-12, 'rgba(8, 12, 30, 0.74)'],
      [3, 'rgba(34, 16, 30, 0.8)'],
      [15, 'rgba(18, 16, 36, 0.76)'],
      [45, 'rgba(14, 20, 40, 0.7)'],
      [90, 'rgba(16, 22, 38, 0.62)'],
    ],
    // Sunlit faces: cool and faint at night, warm amber at low sun, easing to
    // a neutral warm-white overhead. Brighter now, to widen the gap against
    // the darker shadow.
    highlightByAltitude: [
      [-12, 'rgba(72, 98, 150, 0.22)'],
      [3, 'rgba(255, 206, 142, 0.5)'],
      [15, 'rgba(255, 232, 196, 0.44)'],
      [45, 'rgba(255, 248, 233, 0.4)'],
      [90, 'rgba(255, 252, 244, 0.36)'],
    ],
    // Second pass: multidirectional, hard and dark. This is what supplies the
    // "black shadow" and the surface texture — one pass at max exaggeration
    // simply can't go darker.
    detail: {
      method: 'multidirectional',
      exaggeration: 1,
      shadowColor: 'rgba(6, 8, 16, 0.42)',
      highlightColor: 'rgba(255, 253, 245, 0.12)',
      accentColor: 'rgba(10, 8, 6, 0.4)',
    },
    // Steep ground goes stony grey-brown regardless of its elevation — the
    // Knuckles crags, Lakegala's face, the Adam's Peak cone.
    rock: { exaggeration: 1, color: 'rgba(104, 98, 92, 0.5)' },
  },
  sky: {
    skyColor: '#a9d8ef',
    skyHorizonBlend: 0.6,
    horizonColor: '#e9f1f0',
    horizonFogBlend: 0.5,
    // Haze that goes golden as the sun drops, pale and cool by day, dim at
    // night — so a distant ridge reads as distant. Only visible at pitch
    // >~60° (why DEFAULT_PITCH is now 68).
    fogColorByAltitude: [
      [-10, '#3c4a63'],
      [3, '#efce9f'],
      [12, '#ecdcc4'],
      [35, '#c9e3ee'],
      [90, '#cfe8f0'],
    ],
    // 0.55 — haze holds off until the far distance so mid-ground terrain stays
    // crisp. (Was 0.38, which greyed the whole view — "just mist".)
    fogGroundBlend: 0.55,
  },
  contour: {
    line: '#4a3626', // dark cocoa — enough contrast on the green AND terracotta
    labelHalo: 'rgba(247, 245, 236, 0.9)',
    width: 1,
    indexEvery: 1000, // metres between labelled "index" contours
  },
};

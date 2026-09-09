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
  // Cartoon broadleaf tree, deliberately a couple of shades off the forest
  // tint so a scatter of them over a wooded hillside reads as canopy, not noise.
  foliage: {
    trunk: '#6b4a2f',
    canopy: '#2c6b43',
    canopyLight: '#43935e',
  },
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
    exaggeration: 0.9,
    illuminationAnchor: 'map',
    accentColor: 'rgba(0, 0, 0, 0)',
    fillLights: [],
    // Deep cool shadow — this is what makes it read as cast shadow rather than
    // haze. Warms toward violet at golden hour; a dim blue floor for night.
    shadowByAltitude: [
      [-12, 'rgba(28, 38, 74, 0.5)'],
      [3, 'rgba(74, 52, 84, 0.5)'],
      [15, 'rgba(52, 52, 92, 0.48)'],
      [45, 'rgba(44, 56, 96, 0.46)'],
      [90, 'rgba(44, 56, 96, 0.42)'],
    ],
    // Sunlit faces: cool and faint at night, warm amber at low sun, easing to
    // a neutral warm-white overhead.
    highlightByAltitude: [
      [-12, 'rgba(72, 98, 150, 0.22)'],
      [3, 'rgba(255, 208, 150, 0.42)'],
      [15, 'rgba(255, 232, 198, 0.36)'],
      [45, 'rgba(255, 246, 230, 0.32)'],
      [90, 'rgba(255, 250, 240, 0.3)'],
    ],
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

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
    // Lighter and cooler than a literal shaded-relief: the colour should carry
    // the map, the shading should just give it form. A heavy dark hillshade
    // was crushing every band to mud.
    exaggeration: 0.42,
    illuminationDirection: 315,
    illuminationAnchor: 'map',
    shadowColor: 'rgba(58, 70, 104, 0.32)', // cool blue-violet, soft
    highlightColor: 'rgba(255, 246, 224, 0.28)', // warm, subtle
    accentColor: 'rgba(0, 0, 0, 0)',
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

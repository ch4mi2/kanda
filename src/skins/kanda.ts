import type { Skin } from './types';

// "Kanda" — the default skin. A deliberately stylised game-map palette: bright,
// saturated, posterised into clean bands. Not a satellite impression.
//
// Genuinely different hues per tier — grass -> meadow -> khaki -> terracotta ->
// brown -> rock -> snow — so from a summit you can still read "that ridge is
// higher than this one" at a glance. What it does NOT do is the design mockup's
// nine near-identical greens (see the "why the mockups look green" note in
// CLAUDE.md).
//
// All stops are at or above sea level. Everything below 0 m is flat `water`
// (see softColorRamp) — no bathymetry gradient, so the sea reads as one clean
// colour the way a game map's does. Resolution is concentrated low: most of
// the island's land is under 1,000 m.
const bands: Skin['elevationBands'] = [
  [0, '#63b756'], // coast / lowland — vivid grass
  [120, '#7ec24e'], // plains
  [280, '#9bcc4c'], // rising ground, yellow-green
  [480, '#c3c85c'], // low hills, chartreuse
  [720, '#ccb062'], // foothills, khaki
  [1000, '#c68f4f'], // hill country, ochre
  [1300, '#bd7846'], // highlands, terracotta
  [1650, '#a5623f'], // ridges, warm brown
  [2000, '#8c6a63'], // near-summit rock, mauve-grey
  [2300, '#b9aca6'], // summit shoulders, pale stone
  [2524, '#efe9df'], // the very tops — snow-pale
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
    line: 'rgba(13, 37, 27, 0.35)',
    labelHalo: '#f7f5ec',
    width: 1,
    indexEvery: 5,
  },
};

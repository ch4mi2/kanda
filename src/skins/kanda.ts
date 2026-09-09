import type { Skin } from './types';

// "Kanda" — the default skin, and for now the only one. Built from the design
// handoff tokens (Ink #0d251b, Moss #2f7d54, Leaf #5cb17a, Water #a9dcea,
// Paper #f7f5ec). Deliberately stylised: a game-map palette, not a satellite
// impression.
//
// The ramp keeps genuinely different hues per tier — green -> chartreuse ->
// tan -> ochre -> russet -> brown -> grey -> pale — so a viewer standing on a
// summit can still tell "that ridge is higher than this one" at a glance. That
// was the original complaint and softening the band blend (below) must not
// regress it. What it does NOT do is the design mockup's nine near-identical
// greens (see the "why the mockups look green" note in CLAUDE.md).
//
// Resolution is concentrated low: eight of the thirteen stops sit at or below
// 1,350 m, because that is where most of the island's land actually is.
const bands: Skin['elevationBands'] = [
  [-500, '#0f3f52'], // sea floor / deep water
  [0, '#2f7d54'], // shoreline — Moss
  [60, '#4c9c63'], // coastal lowland
  [180, '#68b46f'], // plains — toward Leaf
  [350, '#8fc766'], // rising ground, yellow-green
  [550, '#bcc563'], // low hills, chartreuse
  [800, '#cdae64'], // mid hills, tan
  [1050, '#c59256'], // highlands, ochre
  [1350, '#b0774f'], // upper highlands, russet
  [1700, '#95674f'], // ridges, brown
  [2050, '#8a7c73'], // near-summit, grey-brown
  [2350, '#cabfb2'], // summit shoulders, pale
  [2524, '#eae2d4'], // the very tops — toward Paper
];

export const KANDA_SKIN: Skin = {
  id: 'kanda',
  name: 'Kanda',
  background: '#0a3140',
  elevationBands: bands,
  // 30 m cross-fade: wide enough to kill the stair-step terracing, narrow
  // enough that each colour zone still reads as a distinct band.
  bandBlendM: 30,
  water: '#a9dcea',
  hillshade: {
    exaggeration: 0.6,
    illuminationDirection: 315,
    illuminationAnchor: 'map',
    shadowColor: 'rgba(35, 25, 20, 0.9)',
    highlightColor: 'rgba(255, 250, 235, 0.7)',
    accentColor: 'rgba(0, 0, 0, 0)',
  },
  sky: {
    skyColor: '#bcd8f0',
    skyHorizonBlend: 0.5,
    horizonColor: '#e8ecdd',
    horizonFogBlend: 0.6,
    fogColor: '#d9e4d9',
    fogGroundBlend: 0.5,
  },
  contour: {
    line: 'rgba(13, 37, 27, 0.35)',
    labelHalo: '#f7f5ec',
    width: 1,
    indexEvery: 5,
  },
};

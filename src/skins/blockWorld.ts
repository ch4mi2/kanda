import type { Skin } from './types';

/** Stepped plateaus with striped earth cliffs, round bushes and a patterned
 *  sea - a world-map board game. */
export const BLOCK_WORLD: Skin = {
  id: 'block',
  name: 'Block World',
  blurb: 'Terraced plateaus, striped cliffs, round bushes, a patterned sea.',
  exaggeration: 2.8,
  geometry: 'terrace',

  zenith: '#3f8ee2',
  horizon: '#c2e6f7',
  seaDeep: '#2a62b8',
  fog: '#bfe0f2',
  fogDensity: 0.0035,
  fogStart: 18,
  fogBands: 0,

  sunColor: '#fffaf0',
  shade: '#8ea0d0',
  cel: true,
  celBands: 2,
  celSoftness: 0.12,
  wrap: 0,
  rim: 0.1,

  grassLow: '#6cc24a',
  grassHigh: '#56b03e',
  patch: 0.15,
  forest: '#46a43e',
  rock: '#56b03e',
  rockSlope: 2,
  snow: '#ffffff',
  snowLine: 99999,
  cliff: true,
  cliffColor: '#dba56c',

  water: '#3d7fd6',
  waterHigh: '#86b8f2',
  waterDeep: '#2a5fb4',
  foam: '#eaf5ff',
  foamAmount: 0.9,
  waterMode: 1,
  river: '#3f74c9',
  waterLabel: '#1c3f73',

  outline: 0.55,
  outlineColor: '#3a2614',
  outlineThickness: 1.2,
  saturation: 1.15,
  contrast: 1.05,
  vignette: 0.12,
  tiltShift: 0.3,

  trees: { shape: 'ball', crown: '#2e9a3a', crownAlt: '#4cb444', trunk: '#8a5a32', density: 0.12, scale: 2.2 },
  clouds: { lit: '#ffffff', shaded: '#cfe0f5', cel: true },

  labelColor: '#ffffff',
  labelHalo: 'rgba(20,10,0,.95)',
  labelFont: '"Luckiest Guy", "Arial Black", sans-serif',
};

import type { Skin } from './types';

/** A hand-modelled clay diorama: chunky low-poly facets, snowcaps, tilt-shift
 *  blur at the top and bottom of the frame. */
export const CLAY: Skin = {
  id: 'clay',
  name: 'Clay',
  blurb: 'Low-poly clay facets, snowcaps and a miniature tilt-shift blur.',
  exaggeration: 3.0,
  geometry: 'clay',

  zenith: '#e59a62',
  horizon: '#f9d6aa',
  seaDeep: '#4a8c93',
  fog: '#f4c896',
  fogDensity: 0.0035,
  fogStart: 16,
  fogBands: 0,

  sunColor: '#fff1de',
  shade: '#8a6e8c',
  cel: false,
  celBands: 2,
  celSoftness: 0.1,
  wrap: 0.25,
  rim: 0.15,

  grassLow: '#7ec84c',
  grassHigh: '#4f9d3c',
  patch: 0.25,
  forest: '#2f7a3a',
  rock: '#8a6a62',
  rockSlope: 0.32,
  snow: '#f6efe8',
  snowLine: 1560,
  cliff: false,
  cliffColor: '#000000',

  water: '#5f9ea3',
  waterHigh: '#a6cfcc',
  waterDeep: '#3f7f86',
  foam: '#e6f2ee',
  foamAmount: 0.3,
  waterMode: 3,

  outline: 0,
  outlineColor: '#2a1a1a',
  outlineThickness: 1,
  saturation: 1.06,
  contrast: 1.02,
  vignette: 0.25,
  tiltShift: 1,

  trees: { shape: 'cone', crown: '#3c9a40', crownAlt: '#2a7a34', trunk: '#6b4a34', density: 0.26, scale: 1.8 },
  clouds: { lit: '#e9e1dc', shaded: '#9a8e98', cel: false },

  labelColor: '#ffffff',
  labelHalo: 'rgba(70,40,40,.9)',
  labelFont: '"Fredoka", system-ui, sans-serif',
};

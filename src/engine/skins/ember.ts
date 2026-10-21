import type { Skin } from './types';

/** Golden hour: posterised light, near-black shadows, fog in paper-cut layers.
 *  The best skin for reading every ridge line when zoomed in. */
export const EMBER: Skin = {
  id: 'ember',
  name: 'Ember',
  blurb: 'Golden-hour light, black shadows, ridges stacked in layers.',
  exaggeration: 1.7,
  geometry: 'smooth',

  zenith: '#e9874f',
  horizon: '#ffd59a',
  seaDeep: '#2f5a62',
  fog: '#f4ad72',
  fogDensity: 0.0036,
  fogStart: 18,
  fogBands: 7,

  sunColor: '#ffdca0',
  shade: '#3a1f3e',
  cel: true,
  celBands: 3,
  celSoftness: 0.09,
  wrap: 0,
  rim: 0.6,

  grassLow: '#5a3029',
  grassHigh: '#d0743f',
  patch: 0.1,
  forest: '#2e4638',
  rock: '#b8643f',
  rockSlope: 0.42,
  snow: '#ffe2c0',
  snowLine: 99999,
  cliff: false,
  cliffColor: '#000000',

  water: '#3d6e74',
  waterHigh: '#ffc98a',
  waterDeep: '#25474f',
  foam: '#f4d8b8',
  foamAmount: 0.35,
  waterMode: 0,

  outline: 0.5,
  outlineColor: '#2a1018',
  outlineThickness: 1,
  saturation: 1.05,
  contrast: 1.04,
  vignette: 0.2,
  tiltShift: 0,

  trees: null,
  clouds: null,

  labelColor: '#fff3e0',
  labelHalo: 'rgba(80,32,20,.9)',
  labelFont: '"Outfit", system-ui, sans-serif',
};

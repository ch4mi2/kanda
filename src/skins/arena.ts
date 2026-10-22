import type { Skin } from './types';

/** Punchy saturated colour, violet shadows, foamy shores. The default skin —
 *  the easiest one to tell neighbouring mountains apart in. */
export const ARENA: Skin = {
  id: 'arena',
  name: 'Arena',
  blurb: 'Punchy saturated colour, violet shadows, foamy shores.',
  exaggeration: 2.6,
  geometry: 'smooth',

  zenith: '#2c82ff',
  horizon: '#aee0ff',
  seaDeep: '#1496c8',
  fog: '#b9e2ff',
  fogDensity: 0.0042,
  fogStart: 20,
  fogBands: 0,

  sunColor: '#fff8e6',
  shade: '#a398dc',
  cel: true,
  celBands: 3,
  celSoftness: 0.22,
  wrap: 0,
  rim: 0.5,

  grassLow: '#a6dc3c',
  grassHigh: '#4cb64a',
  patch: 0.35,
  forest: '#2e9e4c',
  rock: '#c2ac90',
  rockSlope: 0.42,
  snow: '#ffffff',
  snowLine: 1760,
  cliff: false,
  cliffColor: '#000000',

  water: '#1ec6ea',
  waterHigh: '#bff7ff',
  waterDeep: '#0c6fb8',
  foam: '#ffffff',
  foamAmount: 1,
  waterMode: 0,
  river: '#1f8fc2',
  waterLabel: '#0d4a66',

  outline: 0.35,
  outlineColor: '#1b2a5a',
  outlineThickness: 1,
  saturation: 1.3,
  contrast: 1.08,
  vignette: 0.1,
  tiltShift: 0,

  trees: { shape: 'lolly', crown: '#38b445', crownAlt: '#86d63a', trunk: '#7a4f2e', density: 0.2, scale: 1.9 },
  clouds: { lit: '#ffffff', shaded: '#bcc8f2', cel: true },

  labelColor: '#ffffff',
  labelHalo: 'rgba(20,30,90,.95)',
  labelFont: '"Luckiest Guy", "Arial Black", sans-serif',
};

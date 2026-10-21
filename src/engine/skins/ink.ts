import type { Skin } from './types';

/** Flat two-tone colour and thick black outlines: a cartoon-series backdrop. */
export const INK: Skin = {
  id: 'ink',
  name: 'Ink',
  blurb: 'Flat colour, thick black outlines, candy-pink cliffs.',
  exaggeration: 2.6,
  geometry: 'smooth',

  zenith: '#86d0f2',
  horizon: '#cdeef8',
  seaDeep: '#2d86c8',
  fog: '#cdeef8',
  fogDensity: 0.0018,
  fogStart: 30,
  fogBands: 0,

  sunColor: '#ffffff',
  shade: '#9a8cc8',
  cel: true,
  celBands: 2,
  celSoftness: 0.015,
  wrap: 0,
  rim: 0,

  grassLow: '#86d46a',
  grassHigh: '#5cbc5c',
  patch: 0.2,
  forest: '#3fa45c',
  rock: '#ef9db7',
  rockSlope: 0.36,
  snow: '#fff4fa',
  snowLine: 1720,
  cliff: false,
  cliffColor: '#000000',

  water: '#4aa8e8',
  waterHigh: '#ffffff',
  waterDeep: '#2a7fc0',
  foam: '#ffffff',
  foamAmount: 0,
  waterMode: 2,

  outline: 1,
  outlineColor: '#141414',
  outlineThickness: 1.6,
  saturation: 1.05,
  contrast: 1,
  vignette: 0,
  tiltShift: 0,

  trees: { shape: 'lolly', crown: '#2f9e50', crownAlt: '#5cc85a', trunk: '#8a5a3a', density: 0.16, scale: 1.8 },
  clouds: { lit: '#ffffff', shaded: '#d6ecf8', cel: true },

  labelColor: '#141414',
  labelHalo: 'rgba(255,255,255,.98)',
  labelFont: '"Fredoka", system-ui, sans-serif',
};

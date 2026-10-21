// A skin is data: palette + lighting + atmosphere + post settings. The engine
// owns no colours — switching skins only rewrites uniforms (and, for the
// geometry modes, rebuilds tile meshes).

export type GeometryMode = 'smooth' | 'clay' | 'terrace';
export type WaterMode = 0 | 1 | 2 | 3; // glints | diamonds | squiggles | clay

export interface Skin {
  id: string;
  name: string;
  blurb: string;
  /** Per-skin vertical exaggeration; the UI slider multiplies it. */
  exaggeration: number;
  geometry: GeometryMode;

  // sky + atmosphere
  zenith: string;
  horizon: string;
  seaDeep: string;
  fog: string;
  /** Fog density per km and the distance (km) where it starts. */
  fogDensity: number;
  fogStart: number;

  // light
  sunColor: string;
  shade: string;
  /** false = soft wrap lighting, true = quantised cel bands. */
  cel: boolean;
  celBands: number;
  celSoftness: number;
  wrap: number;
  rim: number;

  // surface
  grassLow: string;
  grassHigh: string;
  patch: number;
  forest: string;
  rock: string;
  /** Slope (1 - N.y) where rock starts to take over. */
  rockSlope: number;
  snow: string;
  snowLine: number;
  cliff: boolean;
  cliffColor: string;

  // water
  water: string;
  waterHigh: string;
  waterDeep: string;
  foam: string;
  foamAmount: number;
  waterMode: WaterMode;

  // post
  outline: number;
  outlineColor: string;
  outlineThickness: number;
  saturation: number;
  contrast: number;
  vignette: number;
  tiltShift: number;

  // peak labels
  labelColor: string;
  labelHalo: string;
  labelFont: string;
}

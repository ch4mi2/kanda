// A skin is data: palette + lighting + atmosphere + post settings. The engine
// owns no colours — switching skins only rewrites uniforms (and, for the
// geometry modes, rebuilds tile meshes).

export type GeometryMode = 'smooth' | 'clay' | 'terrace';
export type WaterMode = 0 | 1 | 2 | 3; // glints | diamonds | squiggles | clay

export type TreeShape = 'cone' | 'pine' | 'ball' | 'lolly';

export interface TreeStyle {
  shape: TreeShape;
  crown: string;
  crownAlt: string;
  trunk: string;
  /** Planting probability per candidate cell inside forest. */
  density: number;
  /** Tree size multiplier (trees are drawn chunky on purpose). */
  scale: number;
}

export interface CloudStyle {
  lit: string;
  shaded: string;
  /** Hard two-tone (toon) instead of soft shading. */
  cel: boolean;
}

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
  /** > 0 posterises the fog into this many depth layers (paper-cut ridges). */
  fogBands: number;

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

  // props
  trees: TreeStyle | null;
  clouds: CloudStyle | null;

  // peak labels
  labelColor: string;
  labelHalo: string;
  labelFont: string;
}

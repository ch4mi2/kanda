import type { StyleSpecification } from 'maplibre-gl';
import { MAX_ELEVATION_M, terrainSourceSpec } from '../config/tiles';

// Hypsometric tint ramp in real metres (MapLibre's ['elevation'] is metres
// directly — no normalise, no gamma; see the "why the mockups all look green"
// note in CLAUDE.md). Two deliberate choices:
//
//  1. Resolution is concentrated where Sri Lanka's land actually is — eight of
//     the twelve bands sit at or below 1,350 m. A linear stretch to 2,524 m
//     would collapse the lowlands (most of the island) into one or two greens.
//  2. Genuinely different hues per band: green -> chartreuse -> olive -> tan ->
//     ochre -> russet -> brown -> grey -> pale. Not nine near-identical greens.
//
// ELEVATION_BANDS is [floor metres, colour]. The ramp is rendered as hard
// steps (see steppedColorRamp) so each tier has a crisp, readable edge rather
// than a smeared gradient the eye can't lock onto.
export const ELEVATION_BANDS: Array<[number, string]> = [
  [-500, '#15455a'], // sea floor / below sea level
  [0, '#3d7d6a'], // shoreline
  [60, '#4f9e5b'], // coastal lowland, green
  [180, '#6fb257'], // plains
  [350, '#93c159'], // rising ground, yellow-green
  [550, '#bcc563'], // low hills, chartreuse
  [800, '#cdae64'], // mid hills, tan
  [1050, '#c59256'], // highlands, ochre
  [1350, '#b0774f'], // upper highlands, russet
  [1700, '#95674f'], // ridges, brown
  [2050, '#8a7c73'], // near-summit, grey-brown
  [2350, '#c9bfb4'], // summit shoulders, pale
  [MAX_ELEVATION_M, '#e6ded2'], // the very tops
];

// color-relief-color is a color-ramp (interpolated) property, so `step` isn't
// reliably valid. Epsilon-paired stops give the same hard edges: hold the
// previous colour to within 0.1 m of the boundary, then jump.
const STEP_EPSILON = 0.1;

function steppedColorRamp(): unknown[] {
  const expr: unknown[] = ['interpolate', ['linear'], ['elevation']];
  ELEVATION_BANDS.forEach(([ele, color], i) => {
    if (i > 0) {
      expr.push(ele - STEP_EPSILON, ELEVATION_BANDS[i - 1][1]);
    }
    expr.push(ele, color);
  });
  return expr;
}

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    // MapLibre requires glyphs to be set for symbol layers (peak labels) to
    // render text. fonts.openmaptiles.org is dead (200s an HTML page for
    // every range instead of a PBF) despite still resolving; MapLibre's own
    // demo glyph host is free, keyless, and actually serves the font data.
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'terrain-dem': terrainSourceSpec(),
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': 'rgb(9, 55, 84)' },
      },
      {
        id: 'color-relief',
        type: 'color-relief',
        source: 'terrain-dem',
        paint: {
          // Cast needed: colorReliefExpression() builds a generic
          // expression array, but the style types want the narrower
          // ColorRampProperty shape.
          'color-relief-color': steppedColorRamp() as never,
          // 'linear' (bilinear) between DEM texels. 'nearest' was tried to
          // fix "blurry" but it renders every 30 m texel as a hard square —
          // the single biggest source of the "jaggery" look (Phase 4 plan).
          // Crispness is meant to come from the band edges and, later,
          // contour lines — not from visible pixel squares.
          resampling: 'linear',
        },
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
        paint: {
          'hillshade-exaggeration': 0.6,
          'hillshade-illumination-direction': 315,
          'hillshade-shadow-color': 'rgba(35, 25, 20, 0.9)',
          'hillshade-highlight-color': 'rgba(255, 250, 235, 0.7)',
          'hillshade-accent-color': 'rgba(0,0,0,0)',
        },
      },
    ],
    sky: {
      'sky-color': '#bcd8f0',
      'sky-horizon-blend': 0.5,
      'horizon-color': '#e8ecdd',
      'horizon-fog-blend': 0.6,
      'fog-color': '#d9e4d9',
      'fog-ground-blend': 0.5,
    },
  };
}

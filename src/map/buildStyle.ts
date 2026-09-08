import type { StyleSpecification } from 'maplibre-gl';
import { MAX_ELEVATION_M, terrainSourceSpec } from '../config/tiles';

// Hypsometric tint ramp tuned to Sri Lanka's actual elevation range
// (sea level to 2,524 m at Pidurutalagala). A generic world ramp (built for
// 0-8000m+) would put the whole island in the bottom two color stops and
// read as flat and muddy, so the stops below are hand-placed against
// MAX_ELEVATION_M instead.
const ELEVATION_COLOR_STOPS: Array<[number, string]> = [
  [-10, 'rgb(9, 55, 84)'], // below sea level / sea floor
  [0, 'rgb(24, 98, 112)'], // coastline
  [15, 'rgb(64, 130, 90)'], // coastal lowlands
  [150, 'rgb(96, 148, 68)'], // plains, green
  [450, 'rgb(140, 163, 70)'], // low hills
  [800, 'rgb(181, 168, 88)'], // mid hills, drier
  [1200, 'rgb(163, 128, 78)'], // highlands, ochre
  [1650, 'rgb(140, 100, 76)'], // upper highlands, brown
  [2050, 'rgb(148, 128, 116)'], // near-summit, cooler grey-brown
  [MAX_ELEVATION_M, 'rgb(214, 206, 196)'], // summit, pale
];

function colorReliefExpression() {
  const expr: unknown[] = ['interpolate', ['linear'], ['elevation']];
  for (const [stop, color] of ELEVATION_COLOR_STOPS) {
    expr.push(stop, color);
  }
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
          'color-relief-color': colorReliefExpression() as never,
          // Sample the DEM texel-for-texel instead of bilinear-blending
          // between texels. The DEM is already at its native resolution
          // (z12 ~= 38 m/px); 'linear' just smears that into mush when the
          // camera overzooms. 'nearest' keeps the elevation bands crisp.
          resampling: 'nearest',
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

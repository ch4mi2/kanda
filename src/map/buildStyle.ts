import type { StyleSpecification } from 'maplibre-gl';
import { DEFAULT_CENTER, terrainSourceSpec } from '../config/tiles';
import { DEFAULT_SKIN, type Skin } from '../skins';
import { sampleColorRamp } from '../skins/color';
import { sunPosition, type SunPosition } from './sunPosition';
// Committed OSM vector data (npm run fetch:osm), same offline-first pattern as
// the peaks GeoJSON — never fetched from Overpass at runtime.
import waterUrl from '../data/water.geojson?url';
import riversUrl from '../data/rivers.geojson?url';
import forestUrl from '../data/forest.geojson?url';
import contoursUrl from '../data/contours.geojson?url';

// buildStyle owns MapLibre style plumbing only — sources, layer wiring, sky.
// Every colour and the shape of the hypsometric ramp come from the Skin (see
// src/skins/). Swapping the look is a different Skin, not an edit here.

// color-relief-color is a colour-ramp (interpolated) property, so `step` isn't
// reliably valid. Epsilon-paired stops emulate steps: hold the previous colour
// flat, then cross-fade over a narrow window centred on each boundary — a
// cel-shaded band, not a smeared gradient.
//
// Everything below sea level is clamped to the skin's flat `water` colour: the
// tiles carry bathymetry, but a game map's sea is one clean colour, not a
// depth gradient. The land ramp's own first stop is at (or above) 0 m.
function softColorRamp(skin: Skin): unknown[] {
  const bands = skin.elevationBands;
  const halfBlend = Math.max(0, skin.bandBlendM) / 2;
  const eps = 0.1; // keeps stops strictly ascending when blend is 0
  const firstLandEle = bands[0][0];

  const expr: unknown[] = ['interpolate', ['linear'], ['elevation']];
  // Flat water for all depths, then a short fade up onto the coast.
  expr.push(-12000, skin.water);
  expr.push(Math.max(firstLandEle - 1, -1), skin.water);

  bands.forEach(([ele, color], i) => {
    if (i === 0) {
      // Fade water -> first land colour across ~2 m at the shoreline.
      expr.push(ele + 1, color);
      return;
    }
    const lo = ele - Math.max(halfBlend, eps);
    expr.push(lo, bands[i - 1][1]);
    expr.push(halfBlend > 0 ? ele + halfBlend : ele, color);
  });
  return expr;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const mod360 = (a: number) => ((a % 360) + 360) % 360;

/**
 * The `hillshade` layer's paint properties for a given sun position. The real
 * sun is the dominant light (its azimuth + true elevation); any skin fill
 * lights follow it in the arrays for `multidirectional`. Shadow/highlight tint
 * is sampled from the skin's altitude keyframes, so shading warms at golden
 * hour and falls to a dim blue below the horizon — all palette, no code.
 *
 * Exported so MapView can re-apply it as the time-of-day slider moves without
 * rebuilding the style.
 */
export function hillshadeLightForSun(skin: Skin, sun: SunPosition) {
  const hs = skin.hillshade;
  const lights: Array<[number, number]> = [
    [sun.azimuthDeg, sun.altitudeDeg],
    ...hs.fillLights,
  ];
  return {
    'hillshade-method': hs.method,
    'hillshade-exaggeration': hs.exaggeration,
    'hillshade-illumination-anchor': hs.illuminationAnchor,
    'hillshade-illumination-direction': lights.map(([az]) =>
      clamp(Math.round(mod360(az)), 0, 359),
    ),
    // Clamp the light elevation to 10°–62°: a grazing sun degenerates the
    // shading, and a near-overhead sun (equatorial noon) flattens it to "mist"
    // — cap it so ridges always cast. The colour ramps still read the *true*
    // altitude, so dawn/dusk stays warm and night stays blue.
    'hillshade-illumination-altitude': lights.map(([, alt]) =>
      clamp(Math.round(alt), 10, 62),
    ),
    'hillshade-shadow-color': lights.map(([, alt]) =>
      sampleColorRamp(hs.shadowByAltitude, alt),
    ),
    'hillshade-highlight-color': lights.map(([, alt]) =>
      sampleColorRamp(hs.highlightByAltitude, alt),
    ),
    'hillshade-accent-color': hs.accentColor,
  };
}

/** Sun position over the island centre right now — buildStyle's default when
 *  no explicit sun is passed (MapView pushes the slider value on mount). */
export function currentSun(): SunPosition {
  return sunPosition(new Date(), DEFAULT_CENTER[1], DEFAULT_CENTER[0]);
}

/**
 * The `sky` spec for a given sun position — aerial-perspective fog whose tint
 * follows the sun (golden low, pale by day). Exported so MapView can push it
 * via `map.setSky()` as the time-of-day slider moves. Sky/horizon colours
 * stay fixed; only the haze is time-driven.
 */
export function skyForSun(skin: Skin, sun: SunPosition) {
  const s = skin.sky;
  return {
    'sky-color': s.skyColor,
    'sky-horizon-blend': s.skyHorizonBlend,
    'horizon-color': s.horizonColor,
    'horizon-fog-blend': s.horizonFogBlend,
    'fog-color': sampleColorRamp(s.fogColorByAltitude, sun.altitudeDeg),
    'fog-ground-blend': s.fogGroundBlend,
  };
}

export function buildStyle(
  skin: Skin = DEFAULT_SKIN,
  sun: SunPosition = currentSun(),
): StyleSpecification {
  return {
    version: 8,
    // Self-hosted glyph PBFs (public/fonts/, npm run fetch:glyphs). Same
    // "Noto Sans Regular/Bold" files demotiles.maplibre.org served — copied
    // local so peak labels render with the network off (CLAUDE.md gotcha #3).
    glyphs: `${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`,
    sources: {
      'terrain-dem': terrainSourceSpec(),
      water: { type: 'geojson', data: waterUrl },
      rivers: { type: 'geojson', data: riversUrl },
      forest: { type: 'geojson', data: forestUrl },
      contours: { type: 'geojson', data: contoursUrl },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': skin.background },
      },
      {
        id: 'color-relief',
        type: 'color-relief',
        source: 'terrain-dem',
        paint: {
          // Cast needed: softColorRamp() builds a generic expression array,
          // but the style types want the narrower ColorRampProperty shape.
          'color-relief-color': softColorRamp(skin) as never,
          // 'linear' (bilinear) between DEM texels — 'nearest' rendered every
          // 30 m texel as a hard square (Phase 4A).
          resampling: 'linear',
        },
      },
      // Forest tint sits between the elevation ramp and the hillshade so the
      // shading falls on the forested blocks too, giving them form.
      {
        id: 'forest',
        type: 'fill',
        source: 'forest',
        paint: { 'fill-color': skin.forest },
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
        // Direction/altitude/tint come from the live sun. 'illumination-anchor'
        // stays 'map' (inside the helper) — 'viewport' would add the camera
        // bearing every frame and re-shade the whole map as you orbit
        // (CLAUDE.md gotcha #8).
        paint: hillshadeLightForSun(skin, sun) as never,
      },
      // Rivers first so a reservoir fill draws over the line feeding it.
      {
        id: 'rivers',
        type: 'line',
        source: 'rivers',
        paint: {
          'line-color': skin.river,
          'line-opacity': 0.85,
          // Hairline far out, a real ribbon once you're looking at a valley.
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 10, 1.4, 13, 3.5],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'water',
        paint: {
          'fill-color': skin.lake,
          'fill-outline-color': skin.river,
        },
      },
      // Highland contours (src/data/contours.geojson, 800-2400 m). Only worth
      // drawing once you're looking at a massif — noise at island view.
      {
        id: 'contours',
        type: 'line',
        source: 'contours',
        minzoom: 9.5,
        paint: {
          'line-color': skin.contour.line,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            9.5,
            ['case', ['==', ['get', 'index'], 1], 0.8, 0.3],
            13,
            ['case', ['==', ['get', 'index'], 1], 2.2, 1],
          ],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0, 10.5, 0.45, 13, 0.6],
        },
      },
      {
        id: 'contour-labels',
        type: 'symbol',
        source: 'contours',
        minzoom: 11,
        filter: ['==', ['get', 'index'], 1],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'symbol-spacing': 400,
        },
        paint: {
          'text-color': skin.contour.line,
          'text-halo-color': skin.contour.labelHalo,
          'text-halo-width': 1.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 11.8, 0.9],
        },
      },
    ],
    sky: skyForSun(skin, sun) as never,
  };
}

import type { StyleSpecification } from 'maplibre-gl';
import { DEFAULT_CENTER, terrainSourceSpec, textureSourceSpecs } from '../config/tiles';
import { DEFAULT_SKIN, type Skin } from '../skins';
import { sampleColorRamp } from '../skins/color';
import { sunPosition, type SunPosition } from './sunPosition';
// Committed OSM vector data (npm run fetch:osm), same offline-first pattern as
// the peaks GeoJSON — never fetched from Overpass at runtime.
import waterUrl from '../data/water.geojson?url';
import riversUrl from '../data/rivers.geojson?url';
import forestUrl from '../data/forest.geojson?url';
import contoursUrl from '../data/contours.geojson?url';

// Baked procedural diffuse-detail texture, draped between `forest` and the
// hillshade passes (npm run generate:texture -> pack:texture). Two sources
// with different max zooms by region — see textureSourceSpecs() for why one
// won't do — crossfaded here so the z12->z13 handover never double-composites
// alpha. LOAD-BEARING: collapsing these into one source blanks the texture
// above z12 across most of the island.
const TEXTURE_BASE_LAYER_ID = 'terrain-texture-base';
const TEXTURE_HIGHLANDS_LAYER_ID = 'terrain-texture-highlands';
export const TEXTURE_LAYER_IDS = [TEXTURE_BASE_LAYER_ID, TEXTURE_HIGHLANDS_LAYER_ID];

function textureLayers(): StyleSpecification['layers'] {
  if (Object.keys(textureSourceSpecs()).length === 0) return [];
  return [
    {
      id: TEXTURE_BASE_LAYER_ID,
      type: 'raster',
      source: 'texture-base',
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 1, 13.5, 0],
        'raster-fade-duration': 200,
        'raster-resampling': 'linear',
      },
    },
    {
      id: TEXTURE_HIGHLANDS_LAYER_ID,
      type: 'raster',
      source: 'texture-highlands',
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, 1],
        'raster-fade-duration': 200,
        'raster-resampling': 'linear',
      },
    },
  ];
}

// buildStyle owns MapLibre style plumbing only — sources, layer wiring, sky.
// Every colour and the shape of the hypsometric ramp come from the Skin (see
// src/skins/). Swapping the look is a different Skin, not an edit here.

// color-relief-color is a colour-ramp (interpolated) property, so `step` isn't
// reliably valid. Epsilon-paired stops emulate steps: hold the previous colour
// flat, then cross-fade over a narrow window centred on each boundary — a
// cel-shaded band, not a smeared gradient.
//
// Below sea level the ramp now follows the DEM's real bathymetry (skin.shore)
// instead of clamping every depth to one flat colour — shallows read turquoise
// and grade to open blue, with a narrow sand strand riding the 0 m line. The
// land ramp proper starts just above the strand.
function softColorRamp(skin: Skin): unknown[] {
  const bands = skin.elevationBands;
  const halfBlend = Math.max(0, skin.bandBlendM) / 2;
  const eps = 0.1; // keeps stops strictly ascending when blend is 0
  const { byDepth, sand, sandTopM } = skin.shore;

  const expr: unknown[] = ['interpolate', ['linear'], ['elevation']];
  for (const [depth, color] of byDepth) expr.push(depth, color);
  // Strand: hold sand across the whole band so it reads as a rim, not a fade.
  expr.push(0, sand);
  expr.push(sandTopM, sand);

  // Land starts above the strand, with a short fade off the sand.
  const landStart = sandTopM + 4;
  bands.forEach(([ele, color], i) => {
    if (i === 0) {
      expr.push(Math.max(landStart, ele + 1), color);
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

export const HILLSHADE_LAYER_ID = 'hillshade';
export const HILLSHADE_DETAIL_LAYER_ID = 'hillshade-detail';
export const HILLSHADE_ROCK_LAYER_ID = 'hillshade-rock';

/**
 * Slope-only pass: light from 88° (near-overhead) so flat ground takes no
 * shadow at all and only steep faces pick up the rock tint. Sun-independent
 * by design — a cliff is a cliff at any hour.
 */
export function hillshadeRock(skin: Skin) {
  const r = skin.hillshade.rock;
  if (!r) return null;
  return {
    'hillshade-method': 'combined',
    'hillshade-exaggeration': r.exaggeration,
    'hillshade-illumination-anchor': skin.hillshade.illuminationAnchor,
    'hillshade-illumination-direction': [315],
    'hillshade-illumination-altitude': [88],
    'hillshade-shadow-color': [r.color],
    'hillshade-highlight-color': ['rgba(0, 0, 0, 0)'],
    'hillshade-accent-color': 'rgba(0, 0, 0, 0)',
  };
}

/**
 * Paint for the stacked second hillshade pass, or null if the skin has none.
 *
 * Four lights on a ring anchored to the sun's azimuth. Lighting a surface from
 * all sides means only *concavities* stay dark — gullies, valley floors, the
 * inside of a cirque — which is the closest thing to ambient occlusion
 * MapLibre can do, and it's what makes terrain look carved rather than tinted.
 * Fixed dark colours: this pass is the shadow, not the time-of-day story.
 */
export function hillshadeDetailForSun(skin: Skin, sun: SunPosition) {
  const d = skin.hillshade.detail;
  if (!d) return null;
  const ring = [0, 90, 180, 270].map((offset) =>
    clamp(Math.round(mod360(sun.azimuthDeg + offset)), 0, 359),
  );
  const alt = clamp(Math.round(sun.altitudeDeg), 10, 62);
  return {
    'hillshade-method': d.method,
    'hillshade-exaggeration': d.exaggeration,
    'hillshade-illumination-anchor': skin.hillshade.illuminationAnchor,
    'hillshade-illumination-direction': ring,
    'hillshade-illumination-altitude': ring.map(() => alt),
    'hillshade-shadow-color': ring.map(() => d.shadowColor),
    'hillshade-highlight-color': ring.map(() => d.highlightColor),
    'hillshade-accent-color': d.accentColor,
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
      ...(textureSourceSpecs() as StyleSpecification['sources']),
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
      // Baked diffuse detail — canopy mottle, rock striation, ground grain.
      // Above the flat elevation ramp so it adds surface, below the hillshade
      // passes so the shading lights it rather than being covered by it.
      // `color-relief` can only paint one colour per elevation; this is the
      // only way to get per-pixel texture without shipping satellite imagery.
      ...textureLayers(),
      {
        id: HILLSHADE_LAYER_ID,
        type: 'hillshade',
        source: 'terrain-dem',
        // Direction/altitude/tint come from the live sun. 'illumination-anchor'
        // stays 'map' (inside the helper) — 'viewport' would add the camera
        // bearing every frame and re-shade the whole map as you orbit
        // (CLAUDE.md gotcha #8).
        paint: hillshadeLightForSun(skin, sun) as never,
      },
      // Stacked shadow/texture pass. Present only if the skin defines one;
      // an empty paint object on a hidden layer is harmless if it doesn't.
      {
        id: HILLSHADE_DETAIL_LAYER_ID,
        type: 'hillshade',
        source: 'terrain-dem',
        layout: { visibility: skin.hillshade.detail ? 'visible' : 'none' },
        paint: (hillshadeDetailForSun(skin, sun) ?? {}) as never,
      },
      // Slope-only rock tint — steep ground reads stony whatever its height.
      {
        id: HILLSHADE_ROCK_LAYER_ID,
        type: 'hillshade',
        source: 'terrain-dem',
        layout: { visibility: skin.hillshade.rock ? 'visible' : 'none' },
        paint: (hillshadeRock(skin) ?? {}) as never,
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
      // ---- hydronyms (names already in water.geojson / rivers.geojson) ----
      // Two water tiers by area (`ha`), same idea as the peak tiers: the big
      // reservoirs read at island view, small tanks wait until you're close.
      {
        id: 'water-labels-major',
        type: 'symbol',
        source: 'water',
        minzoom: 8.2,
        filter: ['all', ['has', 'name'], ['>=', ['coalesce', ['get', 'ha'], 0], 500]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 12, 14],
          'text-max-width': 7,
          'text-optional': true,
          // Bigger bodies win label collisions.
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ha'], 0]],
        },
        paint: {
          'text-color': skin.hydroLabel.water,
          'text-halo-color': skin.hydroLabel.halo,
          'text-halo-width': 1.3,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 8.2, 0, 9.2, 0.95],
        },
      },
      {
        id: 'water-labels-minor',
        type: 'symbol',
        source: 'water',
        minzoom: 10.5,
        filter: [
          'all',
          ['has', 'name'],
          ['<', ['coalesce', ['get', 'ha'], 0], 500],
          ['>=', ['coalesce', ['get', 'ha'], 0], 20],
        ],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 12.5],
          'text-max-width': 7,
          'text-optional': true,
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ha'], 0]],
        },
        paint: {
          'text-color': skin.hydroLabel.water,
          'text-halo-color': skin.hydroLabel.halo,
          'text-halo-width': 1.3,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 11.8, 0.92],
        },
      },
      {
        id: 'river-labels',
        type: 'symbol',
        source: 'rivers',
        minzoom: 10.5,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 9, 14, 12],
          'text-letter-spacing': 0.06,
          'text-max-angle': 40,
          'symbol-spacing': 550,
        },
        paint: {
          'text-color': skin.hydroLabel.river,
          'text-halo-color': skin.hydroLabel.halo,
          'text-halo-width': 1.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11.3, 0.88],
        },
      },
    ],
    sky: skyForSun(skin, sun) as never,
  };
}

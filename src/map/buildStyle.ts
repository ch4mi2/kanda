import type { StyleSpecification } from 'maplibre-gl';
import { terrainSourceSpec } from '../config/tiles';
import { DEFAULT_SKIN, type Skin } from '../skins';

// buildStyle owns MapLibre style plumbing only — sources, layer wiring, sky.
// Every colour and the shape of the hypsometric ramp come from the Skin (see
// src/skins/). Swapping the look is a different Skin, not an edit here.

// color-relief-color is a colour-ramp (interpolated) property, so `step` isn't
// reliably valid. Epsilon-paired stops emulate steps: hold the previous colour
// until just before the boundary, then move to the next. With a non-zero blend
// the "just before" becomes a real cross-fade window centred on the boundary,
// which is what softens the stair-step terracing.
function softColorRamp(skin: Skin): unknown[] {
  const bands = skin.elevationBands;
  const halfBlend = Math.max(0, skin.bandBlendM) / 2;
  // Epsilon keeps stops strictly ascending when blend is 0.
  const eps = 0.1;
  const expr: unknown[] = ['interpolate', ['linear'], ['elevation']];
  bands.forEach(([ele, color], i) => {
    if (i > 0) {
      const lo = ele - Math.max(halfBlend, eps);
      expr.push(lo, bands[i - 1][1]);
      if (halfBlend > 0) expr.push(ele + halfBlend, color);
      else expr.push(ele, color);
    } else {
      expr.push(ele, color);
    }
  });
  return expr;
}

export function buildStyle(skin: Skin = DEFAULT_SKIN): StyleSpecification {
  return {
    version: 8,
    // Self-hosted glyph PBFs (public/fonts/, npm run fetch:glyphs). Same
    // "Noto Sans Regular/Bold" files demotiles.maplibre.org served — copied
    // local so peak labels render with the network off (CLAUDE.md gotcha #3).
    glyphs: `${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`,
    sources: {
      'terrain-dem': terrainSourceSpec(),
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
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
        paint: {
          'hillshade-exaggeration': skin.hillshade.exaggeration,
          'hillshade-illumination-direction': skin.hillshade.illuminationDirection,
          // Without this MapLibre defaults to 'viewport' and the sun orbits
          // with the camera — the "colours change when I rotate" bug.
          'hillshade-illumination-anchor': skin.hillshade.illuminationAnchor,
          'hillshade-shadow-color': skin.hillshade.shadowColor,
          'hillshade-highlight-color': skin.hillshade.highlightColor,
          'hillshade-accent-color': skin.hillshade.accentColor,
        },
      },
    ],
    sky: {
      'sky-color': skin.sky.skyColor,
      'sky-horizon-blend': skin.sky.skyHorizonBlend,
      'horizon-color': skin.sky.horizonColor,
      'horizon-fog-blend': skin.sky.horizonFogBlend,
      'fog-color': skin.sky.fogColor,
      'fog-ground-blend': skin.sky.fogGroundBlend,
    },
  };
}

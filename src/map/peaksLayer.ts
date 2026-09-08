import type { GeoJSONSource, Map as MLMap, MapGeoJSONFeature } from 'maplibre-gl';
import peaksGeoJson from '../data/peaks.geojson?url';

export const PEAKS_SOURCE_ID = 'peaks';
const PEAK_ICON_ID = 'peak-marker';

// A tiny filled triangle drawn on a canvas, registered as an SDF image so
// `icon-color` can tint it. There's no sprite sheet in this style (see
// buildStyle.ts), so a built-in icon name like "triangle-15" doesn't exist
// and silently fails to render — this generates the one icon we need
// instead of pulling in a whole sprite dependency for it.
function createTriangleIcon(size = 24): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(size / 2, size * 0.12);
  ctx.lineTo(size * 0.88, size * 0.85);
  ctx.lineTo(size * 0.12, size * 0.85);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function ensurePeakIcon(map: MLMap) {
  if (map.hasImage(PEAK_ICON_ID)) return;
  map.addImage(PEAK_ICON_ID, createTriangleIcon(), { sdf: true, pixelRatio: 2 });
}

// Three tiers, each its own layer with a fixed minzoom, rather than one
// layer with a zoom-dependent filter expression: zoom expressions are only
// valid at the top level of a property (as the direct input to
// step/interpolate), not nested inside a comparison inside a filter, so a
// single dynamic filter isn't reliably supported. Splitting into tiers also
// sidesteps that entirely and is easier to tune by eye.
//
// Sri Lanka's highlands are dense with named summits; without an elevation
// floor at low zoom the map would be an unreadable pile of labels for peaks
// nobody's heard of sitting next to Adam's Peak.
const PEAK_TIERS = [
  { id: 'peaks-major', minzoom: 0, minEle: 1500 },
  { id: 'peaks-mid', minzoom: 9, minEle: 1000 },
  // Below 1000m, including peaks with no OSM `ele` tag at all — in practice
  // the well-known summits were the ones contributors bothered to tag, so
  // untagged peaks are treated as minor and held back until closer zoom.
  { id: 'peaks-minor', minzoom: 11, minEle: 0 },
] as const;

export function addPeaksLayer(map: MLMap) {
  ensurePeakIcon(map);

  map.addSource(PEAKS_SOURCE_ID, {
    type: 'geojson',
    data: peaksGeoJson,
  });

  for (const tier of PEAK_TIERS) {
    map.addLayer({
      id: tier.id,
      type: 'symbol',
      source: PEAKS_SOURCE_ID,
      minzoom: tier.minzoom,
      filter:
        tier.minEle === 0
          ? true
          : ['>=', ['coalesce', ['get', 'ele'], 0], tier.minEle],
      layout: {
        'text-field': [
          'case',
          ['!=', ['get', 'ele'], null],
          ['concat', ['get', 'name'], '\n', ['to-string', ['get', 'ele']], ' m'],
          ['get', 'name'],
        ],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.6],
        'text-optional': true,
        'icon-image': PEAK_ICON_ID,
        'icon-size': 0.9,
        'icon-allow-overlap': false,
        'text-allow-overlap': false,
        // Tallest peaks win label collisions within and across tiers.
        'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ele'], 0]],
      },
      paint: {
        'text-color': '#2a2118',
        'text-halo-color': 'rgba(255,255,255,0.85)',
        'text-halo-width': 1.4,
        'icon-color': '#7a2e1d',
      },
    });
  }
}

export const PEAK_LAYER_IDS = PEAK_TIERS.map((t) => t.id);

export function reloadPeaksSource(map: MLMap) {
  const source = map.getSource(PEAKS_SOURCE_ID) as GeoJSONSource | undefined;
  source?.setData(peaksGeoJson);
}

export function topPeakFeature(
  features: MapGeoJSONFeature[] | undefined,
): MapGeoJSONFeature | undefined {
  return features?.[0];
}

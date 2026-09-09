import type { Map as MLMap } from 'maplibre-gl';
import treesGeoJson from '../data/trees.geojson?url';
import { DEFAULT_SKIN, type Skin } from '../skins';

// Billboard "trees" scattered inside the OSM forest blocks
// (src/data/trees.geojson, npm run generate:trees). Pure decoration on top of
// the Phase 5 legibility work — a wooded hillside should look wooded, and from
// a summit the nearby forest gets some texture.
//
// Same "no sprite sheet" situation as peaksLayer: the icon is drawn on a
// canvas once and registered. Not SDF — it's a full-colour cartoon tree, so
// `icon-color` doesn't apply and the palette lives in the Skin's `foliage`.

export const TREES_SOURCE_ID = 'trees';
export const TREES_LAYER_ID = 'trees';
const TREE_ICON_ID = 'tree-marker';

// Hidden at island view — a few thousand sprites there would be a smear and
// tell you nothing. They fade in as you close on a hillside.
export const TREE_MIN_ZOOM = 10.3;

function createTreeIcon(skin: Skin, size = 48): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const blob = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  ctx.fillStyle = skin.foliage.trunk;
  ctx.fillRect(cx - size * 0.05, size * 0.6, size * 0.1, size * 0.34);

  ctx.fillStyle = skin.foliage.canopy;
  blob(cx, size * 0.46, size * 0.3);
  blob(cx - size * 0.2, size * 0.54, size * 0.21);
  blob(cx + size * 0.2, size * 0.54, size * 0.21);

  ctx.fillStyle = skin.foliage.canopyLight;
  blob(cx - size * 0.07, size * 0.36, size * 0.2);

  return ctx.getImageData(0, 0, size, size);
}

/**
 * Add the trees source + symbol layer. Call once, after `style.load`, before
 * `addPeaksLayer` so peak labels stay on top.
 */
export function addTreesLayer(map: MLMap, skin: Skin = DEFAULT_SKIN) {
  if (!map.hasImage(TREE_ICON_ID)) {
    map.addImage(TREE_ICON_ID, createTreeIcon(skin), { pixelRatio: 2 });
  }
  map.addSource(TREES_SOURCE_ID, { type: 'geojson', data: treesGeoJson });
  map.addLayer({
    id: TREES_LAYER_ID,
    type: 'symbol',
    source: TREES_SOURCE_ID,
    minzoom: TREE_MIN_ZOOM,
    layout: {
      'icon-image': TREE_ICON_ID,
      'icon-anchor': 'bottom', // trunk sits on the ground
      // `s` is the per-tree size jitter baked in by generate-trees.
      // Small. Billboards don't shrink with distance (icon-size is a function
      // of zoom, not of range), so anything big enough to read as an object up
      // close renders absurdly large on a far hillside.
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        TREE_MIN_ZOOM,
        ['*', 0.06, ['get', 's']],
        13,
        ['*', 0.24, ['get', 's']],
      ],
      // Draw them all — collision detection across thousands of icons every
      // frame isn't worth it, and a dense stamp reads fine as forest.
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      // Nearer (bigger screen y) trees draw over farther ones on a pitched view.
      'symbol-z-order': 'viewport-y',
    },
    paint: {
      'icon-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        TREE_MIN_ZOOM,
        0,
        TREE_MIN_ZOOM + 0.8,
        0.95,
      ],
    },
  });
}

/** Let summit view drop the min zoom so foreground forest shows even though
 *  the summit camera sits at a low mercator zoom. */
export function setTreesMinZoom(map: MLMap, minzoom: number) {
  if (map.getLayer(TREES_LAYER_ID)) {
    map.setLayerZoomRange(TREES_LAYER_ID, minzoom, 24);
  }
}

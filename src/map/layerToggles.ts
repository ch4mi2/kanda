import type { Map as MLMap } from 'maplibre-gl';
import { TREES_LAYER_ID } from './treesLayer';

// Optional map furniture the user can switch off. Peaks aren't here — they're
// the point of the app and have their own elevation-floor chips.
//
// Contours default OFF: at an oblique camera angle a few hundred closed
// 200 m rings read as a wireframe grid over the terrain, not as elevation.
// They're genuinely useful looking straight down at a massif, so they stay
// available rather than being deleted.
export const LAYER_GROUPS = {
  contours: ['contours', 'contour-labels'],
  trees: [TREES_LAYER_ID],
  hydronyms: ['water-labels-major', 'water-labels-minor', 'river-labels'],
} as const;

export type LayerGroup = keyof typeof LAYER_GROUPS;

export type LayerVisibility = Record<LayerGroup, boolean>;

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  contours: false,
  trees: true,
  hydronyms: true,
};

export const LAYER_GROUP_LABELS: Record<LayerGroup, string> = {
  contours: 'Contours',
  trees: 'Trees',
  hydronyms: 'Water names',
};

export function setLayerGroupVisible(
  map: MLMap,
  group: LayerGroup,
  visible: boolean,
) {
  for (const id of LAYER_GROUPS[group]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

/** Push every group at once — used on first style load and on any change. */
export function applyLayerVisibility(map: MLMap, vis: LayerVisibility) {
  for (const group of Object.keys(LAYER_GROUPS) as LayerGroup[]) {
    setLayerGroupVisible(map, group, vis[group]);
  }
}

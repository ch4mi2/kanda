// Optional overlay layers, persisted the same way as the skin choice
// (src/skins/index.ts) — a small localStorage-backed preference, not map data.

export interface LayerState {
  /** River lines, water/river name labels, and waterfall markers — one
   *  "water features" switch, not three. The lake tint baked into
   *  masks.png and the park outlines have no toggle: like the lake tint,
   *  they're part of the terrain surface and stay on regardless. */
  water: boolean;
}

const DEFAULT_LAYERS: LayerState = { water: true };
const STORAGE_KEY = 'kanda:layers';

export function loadLayers(): LayerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYERS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_LAYERS, ...parsed };
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

export function saveLayers(state: LayerState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode - the choice just is not remembered */
  }
}

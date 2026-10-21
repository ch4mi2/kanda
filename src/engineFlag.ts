// Phase 7 migration flag: ?engine=three renders the three.js engine instead of MapLibre.
export const USE_THREE = new URLSearchParams(window.location.search).get('engine') === 'three';

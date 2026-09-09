// A Skin is the entire visual identity of the map as data — colour, not code.
//
// Kanda's brief (owner's words): "The map is like a game map, like Fortnite.
// It's just that the data is 100% accurate and smooth like Google Earth. Later
// on we could give a feature to change skin packs too." The geometry pipeline
// (Phase 4A) owns "accurate and smooth"; a Skin owns "like a game map".
//
// buildStyle.ts consumes a Skin and holds no palette of its own, so a
// "Papercraft" or "Topo" pack is a new file in this folder and nothing else.

/** [floor elevation in metres, CSS colour]. Ascending by elevation. The first
 *  entry's floor is the bottom of the ramp (sea floor); the last is the tops. */
export type ElevationBand = [number, string];

export interface HillshadeSkin {
  /** MapLibre hillshade-exaggeration (0-1ish). Relief shading strength. */
  exaggeration: number;
  /** Degrees clockwise from north the light comes from. */
  illuminationDirection: number;
  /**
   * 'map' anchors the sun to map north; 'viewport' anchors it to the camera.
   * MapLibre defaults to 'viewport', which ADDS the camera bearing to the
   * light direction every frame (see its shader uniform setup) — so every
   * slope re-shades as you orbit and the whole map appears to change colour.
   * For a look-around app that is always wrong: the sun does not follow your
   * head. Always 'map' unless a skin has a deliberate reason otherwise.
   */
  illuminationAnchor: 'map' | 'viewport';
  shadowColor: string;
  highlightColor: string;
  accentColor: string;
}

export interface SkySkin {
  skyColor: string;
  skyHorizonBlend: number;
  horizonColor: string;
  horizonFogBlend: number;
  fogColor: string;
  fogGroundBlend: number;
}

/** Contour styling. Contours themselves are a backlog item (maplibre-contour);
 *  the shape is here so a skin can already describe how they should look. */
export interface ContourSkin {
  line: string;
  labelHalo: string;
  /** px width of an ordinary contour; index lines are drawn thicker. */
  width: number;
  /** every Nth contour is an index (labelled, heavier) line. */
  indexEvery: number;
}

export interface Skin {
  id: string;
  name: string;
  /** Colour behind everything — seen as deep water and below the horizon. */
  background: string;
  /** The hypsometric tint ramp, in real metres (MapLibre ['elevation']). */
  elevationBands: ElevationBand[];
  /** Metres of cross-fade centred on each band boundary. 0 = hard step.
   *  ~25-40 m keeps zones distinct (so peaks stay readable) without the
   *  razor "rice paddy" terracing hard steps give on a tilted 3D surface. */
  bandBlendM: number;
  /** Water tint — for the future water layer and as a contour/label accent. */
  water: string;
  hillshade: HillshadeSkin;
  sky: SkySkin;
  contour: ContourSkin;
}

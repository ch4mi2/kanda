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
  /**
   * MapLibre hillshade-method. 'igor' and 'multidirectional' are purpose-built
   * for "read the landform" (Swiss-relief style); 'standard' is the raw
   * Lambertian default that was crushing the bands to mud. Kanda uses 'igor'.
   */
  method: 'standard' | 'basic' | 'combined' | 'igor' | 'multidirectional';
  /** MapLibre hillshade-exaggeration (0-1ish). Relief shading strength. */
  exaggeration: number;
  /**
   * 'map' anchors the sun to map north; 'viewport' anchors it to the camera.
   * MapLibre defaults to 'viewport', which ADDS the camera bearing to the
   * light direction every frame (see its shader uniform setup) — so every
   * slope re-shades as you orbit and the whole map appears to change colour.
   * For a look-around app that is always wrong: the sun does not follow your
   * head. Always 'map' unless a skin has a deliberate reason otherwise.
   */
  illuminationAnchor: 'map' | 'viewport';
  accentColor: string;
  /**
   * Extra fixed fill lights blended with the real sun for Swiss-style relief,
   * each `[azimuthDeg, altitudeDeg]`. Only 'multidirectional' reads past the
   * first light; keep `[]` for a single-sun look (what 'igor' wants).
   */
  fillLights: Array<[number, number]>;
  /**
   * Sun altitude (degrees) -> shadow / highlight tint, interpolated by the live
   * sun altitude: warm and soft near the horizon, neutral overhead, a dim blue
   * "night" floor below it. buildStyle.ts owns no palette, so the whole
   * time-of-day mood lives in these keyframes. Ascending by altitude.
   */
  shadowByAltitude: Array<[number, string]>;
  highlightByAltitude: Array<[number, string]>;
}

export interface SkySkin {
  skyColor: string;
  skyHorizonBlend: number;
  horizonColor: string;
  /** 0–1, the view depth where the haze shifts from `fogColorByAltitude` to
   *  `horizonColor`. */
  horizonFogBlend: number;
  /**
   * Aerial perspective. MapLibre's terrain fog is genuine distance fog
   * (clip-space depth, pow-2 falloff) but it only renders above ~60° pitch —
   * see §5A.3 of the Phase 5 plan and DEFAULT_PITCH/PITCH_MAX in config/tiles.
   * Distant ridges wash toward this colour, keyframed by sun altitude (deg):
   * golden near the horizon, pale by day, dim at night. Ascending by altitude.
   */
  fogColorByAltitude: Array<[number, string]>;
  /** 0–1, the view depth where fog starts. Lower = haze builds nearer. */
  fogGroundBlend: number;
}

/** Highland contour styling (src/data/contours.geojson, pre-generated). */
export interface ContourSkin {
  /** Line + label colour. */
  line: string;
  labelHalo: string;
  /** px width of an ordinary contour; index lines are drawn thicker. */
  width: number;
  /** metres between labelled "index" contours (the script tags these). */
  indexEvery: number;
}

export interface Skin {
  id: string;
  name: string;
  /** Colour behind everything — seen as deep water and below the horizon. */
  background: string;
  /** The hypsometric tint ramp, in real metres (MapLibre ['elevation']). */
  elevationBands: ElevationBand[];
  /** Metres of cross-fade centred on each band boundary. 0 = hard step. */
  bandBlendM: number;
  /** The sea — a single flat colour (softColorRamp clamps all depths to it). */
  water: string;
  /** Inland water fill (reservoirs, tanks). Slightly off `water` so a lake in
   *  a valley doesn't read as a hole through to the ocean. */
  lake: string;
  /** Named-river line colour (src/data/rivers.geojson). */
  river: string;
  /** Forest-block tint (src/data/forest.geojson). Use an rgba with alpha < 1
   *  so the elevation ramp and hillshade still read through it as texture. */
  forest: string;
  hillshade: HillshadeSkin;
  sky: SkySkin;
  contour: ContourSkin;
}

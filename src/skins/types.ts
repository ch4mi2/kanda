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

export type HillshadeMethod =
  | 'standard'
  | 'basic'
  | 'combined'
  | 'igor'
  | 'multidirectional';

/**
 * A second hillshade pass stacked over the first, sharing the sun direction.
 *
 * `hillshade-exaggeration` caps at 1.0 and MapLibre has no cast-shadow or
 * ambient-occlusion renderer — a hillshade is a per-pixel normal-vs-light dot
 * product, it never throws a ridge's shadow into the next valley. Stacking a
 * second, harder pass is the only way to push past that ceiling: it deepens
 * the dark side toward real black and adds the high-frequency surface texture
 * a single soft pass can't.
 */
export interface HillshadeDetailSkin {
  method: HillshadeMethod;
  exaggeration: number;
  /** Keep these dark and fairly opaque — this pass is the "shadow". */
  shadowColor: string;
  highlightColor: string;
  /** Edge accent on ridge crests. Transparent disables it. */
  accentColor: string;
}

export interface HillshadeSkin {
  /**
   * MapLibre hillshade-method. 'igor' and 'multidirectional' are purpose-built
   * for "read the landform" (Swiss-relief style); 'standard' is the raw
   * Lambertian default that was crushing the bands to mud.
   */
  method: HillshadeMethod;
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
  /** Optional second pass stacked on top — see HillshadeDetailSkin. */
  detail: HillshadeDetailSkin | null;
  /**
   * Optional slope-only pass that greys out steep ground — cliffs and crags
   * read as rock rather than as whatever colour their elevation says.
   * `color-relief` can only see height, never steepness, so this is the only
   * way to get it. Implemented as a hillshade lit from almost directly
   * overhead: flat ground stays untouched, steep faces take `color`.
   */
  rock: { exaggeration: number; color: string } | null;
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

/**
 * The coastline: sea colour by depth, plus the strand band just above 0 m.
 *
 * The Terrarium DEM carries real bathymetry and Phase 4 threw it away, painting
 * every depth one flat colour. That's most of why a Kanda coastline reads as a
 * cut-out next to a game map's — those get their richness from turquoise
 * shallows grading to open blue, with a sand rim on top.
 *
 * Deliberately NOT part of `elevationBands`: the strand is bright and the first
 * land band is dark, which would break the ramp's monotonic-lightness rule
 * (see lstar.test.ts). A few metres of beach isn't a height cue.
 */
export interface ShoreSkin {
  /** `[elevation m (negative), colour]`, ascending toward 0. */
  byDepth: Array<[number, string]>;
  /** Sand colour, held from 0 m to `sandTopM`. */
  sand: string;
  sandTopM: number;
}

/** Water-body and river name-label colours (src/data/water|rivers.geojson —
 *  both carry `name`). */
export interface HydroLabelSkin {
  /** Lake / reservoir name. */
  water: string;
  /** River name. */
  river: string;
  halo: string;
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
  /** Representative sea colour — the Legend swatch and any flat fallback.
   *  The rendered sea grades by depth; see `shore`. */
  water: string;
  /** Sea-by-depth ramp + the strand band. */
  shore: ShoreSkin;
  /** Inland water fill (reservoirs, tanks). Slightly off `water` so a lake in
   *  a valley doesn't read as a hole through to the ocean. */
  lake: string;
  /** Named-river line colour (src/data/rivers.geojson). */
  river: string;
  /** Forest-block tint (src/data/forest.geojson). Use an rgba with alpha < 1
   *  so the elevation ramp and hillshade still read through it as texture. */
  forest: string;
  /** Lake / river name-label colours. */
  hydroLabel: HydroLabelSkin;
  hillshade: HillshadeSkin;
  sky: SkySkin;
  contour: ContourSkin;
}

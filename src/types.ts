export interface PeakProperties {
  id: number;
  name: string;
  name_si: string | null;
  name_ta: string | null;
  ele: number | null;
  wikipedia: string | null;
  wikidata: string | null;
}

export interface SelectedPeak extends PeakProperties {
  lng: number;
  lat: number;
  /** Elevation actually shown to the user: OSM's `ele` if present,
   *  otherwise sampled from the loaded terrain at click time. */
  displayEle: number | null;
  eleSource: 'osm' | 'terrain' | 'unknown';
}

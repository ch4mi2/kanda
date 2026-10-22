// Pure types over the committed waterfall GeoJSON (src/data/waterfalls.geojson).
// Point features - no anchor maths needed, unlike water.ts's lake/river labels.

export interface WaterfallFeature {
  properties: { name: string | null; height: number | null };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

import { useEffect, useRef } from 'react';
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle } from './buildStyle';
import { addPeaksLayer, PEAK_LAYER_IDS, topPeakFeature } from './peaksLayer';
import {
  DEFAULT_BEARING,
  DEFAULT_CENTER,
  DEFAULT_PITCH,
  DEFAULT_ZOOM,
  MAP_BOUNDS,
} from '../config/tiles';
import type { SelectedPeak } from '../types';

interface MapViewProps {
  exaggeration: number;
  onPeakSelect: (peak: SelectedPeak | null) => void;
  /** Exposes the live map instance so sibling UI (fly-to buttons etc.) can
   *  drive the camera without routing every interaction through props. */
  onMapReady?: (map: MapLibreMap) => void;
}

function peakFromFeature(
  feature: MapGeoJSONFeature,
  map: MapLibreMap,
): SelectedPeak {
  // Peak features are always Points; avoid pulling in the ambient GeoJSON
  // type package for a single narrow cast.
  const geom = feature.geometry as { type: 'Point'; coordinates: [number, number] };
  const [lng, lat] = geom.coordinates;
  const props = feature.properties as SelectedPeak;
  const hasOsmEle = props.ele != null;

  let displayEle: number | null = hasOsmEle ? Number(props.ele) : null;
  let eleSource: SelectedPeak['eleSource'] = hasOsmEle ? 'osm' : 'unknown';

  if (!hasOsmEle) {
    // OSM had no elevation tag for this peak — sample it from the DEM
    // that's already loaded in the browser rather than leaving it blank.
    const sampled = map.queryTerrainElevation([lng, lat]);
    if (sampled != null) {
      displayEle = Math.round(sampled);
      eleSource = 'terrain';
    }
  }

  return {
    id: props.id,
    name: props.name,
    name_si: props.name_si,
    name_ta: props.name_ta,
    ele: hasOsmEle ? Number(props.ele) : null,
    wikipedia: props.wikipedia,
    wikidata: props.wikidata,
    lng,
    lat,
    displayEle,
    eleSource,
  };
}

export default function MapView({ exaggeration, onPeakSelect, onMapReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: buildStyle(),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      maxBounds: MAP_BOUNDS,
      maxPitch: 78,
      // Defaults, stated explicitly: pinch-zoom, two-finger rotate and
      // two-finger pitch all need to work on touch for this to be usable
      // for a hiker checking terrain on their phone.
      touchZoomRotate: true,
      touchPitch: true,
      dragRotate: true,
      // MapLibre's own attribution control would duplicate the custom
      // Attribution component in App.tsx (which reads the same source
      // attribution strings); disabled here to avoid showing both.
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    // 'style.load' fires once the style/sources are parsed and ready to
    // accept new layers — everything setup needs. The full 'load'/'idle'
    // events additionally wait for every visible tile across the whole
    // oblique-pitch view to finish loading, which for a wide 3D terrain
    // view can take a while (or, in some automated/throttled render-loop
    // contexts, effectively never resolve) and isn't necessary just to add
    // a terrain and a layer.
    map.on('style.load', () => {
      map.setTerrain({ source: 'terrain-dem', exaggeration });
      addPeaksLayer(map);
      onMapReady?.(map);

      map.on('mouseenter', PEAK_LAYER_IDS, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', PEAK_LAYER_IDS, () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('click', PEAK_LAYER_IDS, (e) => {
        const feature = topPeakFeature(e.features);
        if (feature) onPeakSelect(peakFromFeature(feature, map));
      });
      map.on('click', (e) => {
        // Clicks that don't hit a peak layer clear the selection. queryable
        // layers already stopped propagation via their own handler above,
        // so this only fires for empty-map clicks.
        const hits = map.queryRenderedFeatures(e.point, { layers: PEAK_LAYER_IDS });
        if (hits.length === 0) onPeakSelect(null);
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Intentionally empty deps: the map instance is created once. Live
    // updates (exaggeration) are pushed via the effect below instead of
    // recreating the whole map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;
    map.setTerrain({ source: 'terrain-dem', exaggeration });
  }, [exaggeration]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}

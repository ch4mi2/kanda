import { useEffect, useRef } from 'react';
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  addProtocol,
  setWorkerUrl,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import { Protocol as PMTilesProtocol } from 'pmtiles';
// Vite bundles the worker (resolving its `./maplibre-gl-shared.mjs` import)
// into one file and hands back a URL — in dev it is served untransformed, in
// the build it is emitted as a hashed asset. See the setWorkerUrl call below.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle, hillshadeLightForSun, skyForSun } from './buildStyle';
import { DEFAULT_SKIN } from '../skins';
import { addPeaksLayer, PEAK_LAYER_IDS, topPeakFeature } from './peaksLayer';
import { addTreesLayer } from './treesLayer';
import {
  DEFAULT_BEARING,
  DEFAULT_CENTER,
  DEFAULT_PITCH,
  DEFAULT_ZOOM,
  MAP_BOUNDS,
  MAX_ZOOM,
  MIN_ZOOM,
  PITCH_MAX,
  PITCH_MIN,
  TERRAIN,
  exaggerationForZoom,
} from '../config/tiles';
import { sunDateFromSlstMinutes, sunPosition } from './sunPosition';
import { attachMiddleDragRotate } from './middleDragRotate';
import { createSummitView, type SummitView } from './summitView';
import type { SelectedPeak } from '../types';

/** Enable or disable every base camera gesture in one call — summit view takes
 *  the camera over completely and restores this on exit. Middle-drag rotate
 *  isn't a MapLibre handler, so it's re-attached through `detachRef`. */
function setBaseGestures(
  map: MapLibreMap,
  enabled: boolean,
  detachRef: { current: () => void },
) {
  const handlers = [
    map.dragPan,
    map.dragRotate,
    map.scrollZoom,
    map.touchZoomRotate,
    map.touchPitch,
    map.keyboard,
  ];
  for (const h of handlers) {
    if (enabled) h.enable();
    else h.disable();
  }
  if (enabled) {
    detachRef.current = attachMiddleDragRotate(map);
  } else {
    detachRef.current();
    detachRef.current = () => {};
  }
}

/** Push the sun-driven hillshade paint for `slstMinutes` onto a live map. */
function applySun(map: MapLibreMap, slstMinutes: number) {
  if (!map.getLayer('hillshade')) return;
  const sun = sunPosition(
    sunDateFromSlstMinutes(slstMinutes),
    DEFAULT_CENTER[1],
    DEFAULT_CENTER[0],
  );
  const paint = hillshadeLightForSun(DEFAULT_SKIN, sun);
  for (const [key, value] of Object.entries(paint)) {
    map.setPaintProperty('hillshade', key as never, value as never);
  }
  // Haze tint tracks the sun too (golden at dawn/dusk).
  map.setSky(skyForSun(DEFAULT_SKIN, sun) as never);
}

// Point MapLibre at the Vite-produced worker URL. MapLibre's default —
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)` — otherwise routes
// through Vite's module transform: in dev the HMR client gets injected into
// the worker and the actor handshake stalls (style never loads, map blank);
// in the production build the path 404s (the historical worker-MIME bug,
// CLAUDE.md gotcha #4). `?worker&url` sidesteps both.
setWorkerUrl(maplibreWorkerUrl);

// The pmtiles:// protocol only needs registering once per page load. Safe to
// call unconditionally — it's a cheap map insert keyed by scheme.
if (TERRAIN.mode === 'pmtiles') {
  addProtocol('pmtiles', new PMTilesProtocol().tile);
}

interface MapViewProps {
  exaggeration: number;
  /** Minutes past midnight Sri Lanka Standard Time — drives the hillshade sun. */
  sunMinutes: number;
  /** The peak to stand on in summit view, or null for the normal overhead map. */
  viewpoint: SelectedPeak | null;
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

export default function MapView({
  exaggeration,
  sunMinutes,
  viewpoint,
  onPeakSelect,
  onMapReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Latest slider multiplier, read by the map's own `zoom` handler (which
  // outlives any single render) without re-subscribing.
  const multiplierRef = useRef(exaggeration);
  multiplierRef.current = exaggeration;
  // Latest sun-slider value, so the one-shot style.load handler can apply it.
  const sunMinutesRef = useRef(sunMinutes);
  sunMinutesRef.current = sunMinutes;
  // Teardown for the (non-handler) middle-drag rotate, swapped out while summit
  // view owns the camera.
  const detachRotateRef = useRef<() => void>(() => {});
  const summitRef = useRef<SummitView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Adaptive vertical exaggeration: MapLibre 6 only takes a plain number,
    // so recompute it from the live zoom whenever the zoom changes.
    const applyAdaptiveTerrain = () => {
      const map = mapRef.current;
      if (!map || !map.getSource('terrain-dem')) return;
      // Summit view manages terrain exaggeration itself (~1.2x, honest heights).
      if (summitRef.current?.active()) return;
      map.setTerrain({
        source: 'terrain-dem',
        exaggeration: exaggerationForZoom(map.getZoom(), multiplierRef.current),
      });
    };

    const map = new MapLibreMap({
      container: containerRef.current,
      style: buildStyle(DEFAULT_SKIN),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      maxBounds: MAP_BOUNDS,
      minPitch: PITCH_MIN,
      maxPitch: PITCH_MAX,
      // Google Earth control scheme, all stock MapLibre handlers:
      //   left-drag / one-finger-drag  -> pan            (dragPan, default on)
      //   right-drag                   -> rotate + tilt   (dragRotate)
      //   wheel / pinch                -> zoom
      //   two-finger drag              -> rotate + tilt   (touchZoomRotate + touchPitch)
      // Middle-drag also rotates + tilts — the one gap MapLibre has no
      // handler for — via map/middleDragRotate.ts, attached below.
      touchZoomRotate: true,
      touchPitch: true,
      dragRotate: true,
      // MapLibre's own attribution control would duplicate the custom
      // Attribution component in App.tsx (which reads the same source
      // attribution strings); disabled here to avoid showing both.
      attributionControl: false,
    });
    mapRef.current = map;

    // dragPan stays enabled (left-drag / one-finger pans). Rotation is still
    // central to a look-around app, but it lives on right-drag, middle-drag,
    // two-finger drag and the on-screen compass — not by stealing left-drag,
    // which left users unable to pan at all.
    detachRotateRef.current = attachMiddleDragRotate(map);

    // Dev-only escape hatch for verifying camera state from the console —
    // `__map.getBearing()` should change AND hold during a drag.
    if (import.meta.env.DEV) {
      (window as unknown as { __map?: MapLibreMap }).__map = map;
    }

    // Bottom-right compass + zoom cluster, per the design. Top-right would
    // collide with the search field on a phone.
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    // 'style.load' fires once the style/sources are parsed and ready to
    // accept new layers — everything setup needs. The full 'load'/'idle'
    // events additionally wait for every visible tile across the whole
    // oblique-pitch view to finish loading, which for a wide 3D terrain
    // view can take a while (or, in some automated/throttled render-loop
    // contexts, effectively never resolve) and isn't necessary just to add
    // a terrain and a layer.
    map.on('style.load', () => {
      // Guard against a zero-size container at construction time (the canvas
      // otherwise sticks at MapLibre's 400x300 fallback and the map looks
      // blank). Cheap and idempotent when the size was already correct.
      map.resize();
      applyAdaptiveTerrain();
      map.on('zoom', applyAdaptiveTerrain);
      applySun(map, sunMinutesRef.current);
      addTreesLayer(map);
      addPeaksLayer(map);
      summitRef.current = createSummitView(map, {
        reliefMultiplier: () => multiplierRef.current,
        onExit: () => applyAdaptiveTerrain(),
      });
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
      summitRef.current?.destroy();
      summitRef.current = null;
      detachRotateRef.current();
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
    if (!map || !map.isStyleLoaded() || !map.getSource('terrain-dem')) return;
    if (summitRef.current?.active()) {
      summitRef.current.setReliefMultiplier(exaggeration);
      return;
    }
    map.setTerrain({
      source: 'terrain-dem',
      exaggeration: exaggerationForZoom(map.getZoom(), exaggeration),
    });
  }, [exaggeration]);

  // Enter / leave summit view when the chosen viewpoint changes.
  useEffect(() => {
    const map = mapRef.current;
    const summit = summitRef.current;
    if (!map || !summit) return;
    if (viewpoint) {
      let ele = viewpoint.displayEle ?? viewpoint.ele ?? 0;
      if (ele <= 0) {
        // Last resort — usually displayEle is already set (OSM or a DEM sample
        // taken at selection time). queryTerrainElevation can return 0 on
        // unloaded tiles, so only trust a positive result.
        const sampled = map.queryTerrainElevation([viewpoint.lng, viewpoint.lat]);
        ele = sampled && sampled > 0 ? sampled : 0;
      }
      setBaseGestures(map, false, detachRotateRef);
      summit.enter({ lng: viewpoint.lng, lat: viewpoint.lat, ele });
    } else if (summit.active()) {
      summit.exit();
      setBaseGestures(map, true, detachRotateRef);
    }
  }, [viewpoint]);

  // Time-of-day scrub: re-light the hillshade from the sun without rebuilding
  // the style. The style.load handler applies the initial value.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applySun(map, sunMinutes);
  }, [sunMinutes]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}

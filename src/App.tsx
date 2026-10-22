// The three.js app shell (Phase 7). Same chrome as App.tsx - brand, search,
// chips, sliders, peak sheet, summit bar - driven by the three.js Engine
// instead of MapLibre. Becomes App.tsx at the 7D cutover.

import { useCallback, useEffect, useRef, useState } from 'react';
import ThreeView from './engine/ThreeView';
import type { Engine } from './engine/Engine';
import { PeakLabels, WaterLabels, WaterfallLabels } from './engine/labels';
import PeakCard from './components/PeakCard';
import NearbyPeaks from './components/NearbyPeaks';
import ExaggerationSlider from './components/ExaggerationSlider';
import TimeOfDaySlider from './components/TimeOfDaySlider';
import Attribution from './components/Attribution';
import SearchField from './components/SearchField';
import FilterChips from './components/FilterChips';
import GestureHint from './components/GestureHint';
import SummitBar from './components/SummitBar';
import CompassStrip from './components/CompassStrip';
import NavCluster from './components/NavCluster';
import SkinPicker from './components/SkinPicker';
import ControlsFab from './components/ControlsFab';
import WaterToggle from './components/WaterToggle';
import { SKINS, loadSavedSkin, saveSkin, type Skin } from './skins';
import { DEFAULT_EXAGGERATION } from './config/tiles';
import { loadLayers, saveLayers, type LayerState } from './config/layers';
import { slstNowMinutes } from './map/sunPosition';
import { initialBearingDeg, type NearbyPeak, type PeakFeature } from './map/nearbyPeaks';
import { usePeaks } from './data/usePeaks';
import { useWaterFeatures } from './data/useWaterFeatures';
import { findContainingPark, type ParkFeature } from './map/parks';
import type { SelectedPeak } from './types';
// Skin label fonts (self-hosted, no CDN). Fredoka is used by the 7C skins.
import '@fontsource/luckiest-guy/latin-400.css';
import '@fontsource/fredoka/latin-600.css';
import './App.css';
import './engine/engine.css';

/** The sun starts where it really is - but opening the app at night should not
 *  give a black map, so outside daylight it starts at golden-hour 16:00. */
function initialSunMinutes(): number {
  const now = slstNowMinutes();
  return now >= 6.5 * 60 && now <= 17.5 * 60 ? now : 16 * 60;
}

function selectedFrom(
  peak: SelectedPeak | PeakFeature['properties'],
  lng: number,
  lat: number,
  engine: Engine | null,
  parks: ParkFeature[],
): SelectedPeak {
  const sampled = peak.ele == null && engine ? engine.heightAt(lng, lat) : null;
  const terrain = sampled != null && sampled > 0 ? Math.round(sampled) : null;
  return {
    ...peak,
    lng,
    lat,
    displayEle: peak.ele ?? terrain,
    eleSource: peak.ele != null ? 'osm' : terrain != null ? 'terrain' : 'unknown',
    parkName: findContainingPark(lng, lat, parks)?.properties.name ?? null,
  };
}

export default function AppThree() {
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION);
  const [sunMinutes, setSunMinutes] = useState(initialSunMinutes);
  const [selectedPeak, setSelectedPeak] = useState<SelectedPeak | null>(null);
  const [viewpoint, setViewpoint] = useState<SelectedPeak | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [elevationFloor, setElevationFloor] = useState(0);
  const [bearing, setBearing] = useState(0);
  const [ready, setReady] = useState(false);
  const [skin, setSkin] = useState<Skin>(loadSavedSkin);
  const [layers, setLayers] = useState<LayerState>(loadLayers);
  const peaks = usePeaks();
  const { water, rivers, waterfalls, parks } = useWaterFeatures();
  const labelsRef = useRef<PeakLabels | null>(null);
  const waterLabelsRef = useRef<WaterLabels | null>(null);
  const waterfallLabelsRef = useRef<WaterfallLabels | null>(null);
  const selectRef = useRef<(f: PeakFeature) => void>(() => {});
  selectRef.current = (f) =>
    setSelectedPeak(selectedFrom(f.properties, f.geometry.coordinates[0], f.geometry.coordinates[1], engine, parks));

  // Peak labels: one DOM layer owned by the engine's frame loop.
  useEffect(() => {
    if (!engine || peaks.length === 0) return;
    const labels = new PeakLabels(engine, peaks, (f) => selectRef.current(f));
    labelsRef.current = labels;
    labels.setFloor(elevationFloor);
    return () => {
      labels.dispose();
      labelsRef.current = null;
    };
    // The layer is rebuilt only when the engine or peak list changes; floor and
    // selection are pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, peaks]);

  useEffect(() => {
    labelsRef.current?.setFloor(elevationFloor);
  }, [elevationFloor, engine, peaks]);
  useEffect(() => {
    labelsRef.current?.setSelected(selectedPeak?.id ?? null);
  }, [selectedPeak, engine, peaks]);

  // Water/river name labels - a second DOM layer, built once the geojson has
  // loaded (runs after the peak-labels effect above, so labelsRef is set).
  useEffect(() => {
    if (!engine || !labelsRef.current || (water.length === 0 && rivers.length === 0)) return;
    const wl = new WaterLabels(engine, labelsRef.current, water, rivers);
    wl.setVisible(layers.water);
    waterLabelsRef.current = wl;
    return () => {
      wl.dispose();
      waterLabelsRef.current = null;
    };
    // Visibility is pushed by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, peaks, water, rivers]);

  useEffect(() => {
    waterLabelsRef.current?.setVisible(layers.water);
  }, [layers.water, engine, water, rivers]);

  // Waterfall markers - same DOM-layer pattern as water/river labels, a
  // fourth layer built once the geojson has loaded.
  useEffect(() => {
    if (!engine || !labelsRef.current || waterfalls.length === 0) return;
    const wfl = new WaterfallLabels(engine, labelsRef.current, waterfalls);
    wfl.setVisible(layers.waterfalls);
    waterfallLabelsRef.current = wfl;
    return () => {
      wfl.dispose();
      waterfallLabelsRef.current = null;
    };
    // Visibility is pushed by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, peaks, waterfalls]);

  useEffect(() => {
    waterfallLabelsRef.current?.setVisible(layers.waterfalls);
  }, [layers.waterfalls, engine, waterfalls]);

  // River lines: fed to the engine once, then shown/hidden by the toggle.
  useEffect(() => {
    if (engine && rivers.length > 0) engine.setRivers(rivers);
  }, [engine, rivers]);
  useEffect(() => {
    engine?.setWaterVisible(layers.water);
  }, [engine, layers.water]);

  // Park/protected-area outlines: fed to the engine once, always visible.
  useEffect(() => {
    if (engine && parks.length > 0) engine.setParks(parks);
  }, [engine, parks]);

  const toggleWater = useCallback((on: boolean) => {
    setLayers((prev) => {
      const next = { ...prev, water: on };
      saveLayers(next);
      return next;
    });
  }, []);
  const toggleWaterfalls = useCallback((on: boolean) => {
    setLayers((prev) => {
      const next = { ...prev, waterfalls: on };
      saveLayers(next);
      return next;
    });
  }, []);

  // Compass: only re-render when the heading moves by a visible amount.
  useEffect(() => {
    if (!engine) return;
    let last: number | null = null;
    let announced = false;
    return engine.onFrame(() => {
      if (!announced && engine.ready) {
        announced = true;
        setReady(true);
      }
      const b = engine.getBearing();
      if (last !== null && Math.abs(b - last) < 0.4) return;
      last = b;
      setBearing(b);
    });
  }, [engine]);

  // Stand on / leave a summit.
  useEffect(() => {
    if (!engine) return;
    if (viewpoint) {
      engine.enterSummit({ lng: viewpoint.lng, lat: viewpoint.lat, ele: viewpoint.displayEle });
      labelsRef.current?.setOrigin({ lng: viewpoint.lng, lat: viewpoint.lat, id: viewpoint.id });
    } else if (engine.currentMode === 'summit') {
      engine.exitSummit();
      labelsRef.current?.setOrigin(null);
    }
  }, [engine, viewpoint, peaks]);

  const pickFromSearch = useCallback(
    (f: PeakFeature) => {
      const [lng, lat] = f.geometry.coordinates;
      setSelectedPeak(selectedFrom(f.properties, lng, lat, engine, parks));
      engine?.flyTo({ lng, lat, distanceKm: 26, pitch: 66 }, 1800);
    },
    [engine, parks],
  );

  const pickNearby = useCallback(
    (np: NearbyPeak) => setSelectedPeak(selectedFrom(np.peak, np.lng, np.lat, engine, parks)),
    [engine, parks],
  );

  const lookAtPeak = useCallback(
    (np: NearbyPeak) => {
      if (!engine) return;
      const v = engine.getView();
      const from: [number, number] = viewpoint ? [viewpoint.lng, viewpoint.lat] : [v.lng, v.lat];
      engine.lookToward(initialBearingDeg(from, [np.lng, np.lat]));
    },
    [engine, viewpoint],
  );

  const chooseSkin = (s: Skin) => {
    setSkin(s);
    saveSkin(s);
  };

  const stand = (peak: SelectedPeak) => {
    setViewpoint(peak);
    setSelectedPeak(null);
  };
  const flyHere = (peak: SelectedPeak) =>
    engine?.flyTo({ lng: peak.lng, lat: peak.lat, distanceKm: 14, pitch: 72 }, 1800);

  return (
    <div className="app">
      <ThreeView exaggeration={exaggeration} sunMinutes={sunMinutes} skin={skin} onEngineReady={setEngine} />

      {viewpoint ? (
        <>
          <CompassStrip bearing={bearing} />
          <SummitBar peak={viewpoint} onExit={() => setViewpoint(null)} />
          {selectedPeak && selectedPeak.id !== viewpoint.id && (
            <div className="sheet sheet--summit">
              <PeakCard
                peak={selectedPeak}
                onClose={() => setSelectedPeak(null)}
                onStand={() => stand(selectedPeak)}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="topstack">
            <div className="card brand">
              <span className="brand__mark">K</span>
              <span className="brand__text">
                <span className="brand__name">KANDA</span>
                <span className="brand__tag">Peaks of Sri Lanka</span>
              </span>
            </div>
            <SearchField peaks={peaks} elevationFloor={elevationFloor} onPick={pickFromSearch} />
            <FilterChips value={elevationFloor} onChange={setElevationFloor} />
          </div>

          <div className="dock">
            <SkinPicker
              skins={SKINS}
              value={skin}
              onChange={chooseSkin}
            />
            <TimeOfDaySlider minutes={sunMinutes} onChange={setSunMinutes} />
            <ExaggerationSlider value={exaggeration} onChange={setExaggeration} />
            <WaterToggle
              value={layers.water}
              onChange={toggleWater}
              waterfalls={layers.waterfalls}
              onWaterfallsChange={toggleWaterfalls}
            />
          </div>

          <ControlsFab
            skins={SKINS}
            skin={skin}
            onSkinChange={chooseSkin}
            sunMinutes={sunMinutes}
            onSunChange={setSunMinutes}
            exaggeration={exaggeration}
            onExaggerationChange={setExaggeration}
            water={layers.water}
            onWaterChange={toggleWater}
            waterfalls={layers.waterfalls}
            onWaterfallsChange={toggleWaterfalls}
          />

          <NavCluster
            bearing={bearing}
            onZoomIn={() => engine?.zoomBy(0.6)}
            onZoomOut={() => engine?.zoomBy(1 / 0.6)}
            onResetNorth={() => engine?.resetNorth()}
          />

          {selectedPeak && (
            <div className="sheet">
              <PeakCard
                peak={selectedPeak}
                onFly={() => flyHere(selectedPeak)}
                onClose={() => setSelectedPeak(null)}
                onStand={() => stand(selectedPeak)}
              />
              <NearbyPeaks
                origin={selectedPeak}
                peaks={peaks}
                elevationFloor={elevationFloor}
                onLook={lookAtPeak}
                onPick={pickNearby}
              />
            </div>
          )}

          {!selectedPeak && <GestureHint />}
        </>
      )}

      {!ready && <div className="loading-pill" role="status">Loading terrain…</div>}

      <Attribution />
    </div>
  );
}

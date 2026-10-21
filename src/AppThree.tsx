// The three.js app shell (Phase 7). Same chrome as App.tsx - brand, search,
// chips, sliders, peak sheet, summit bar - driven by the three.js Engine
// instead of MapLibre. Becomes App.tsx at the 7D cutover.

import { useCallback, useEffect, useRef, useState } from 'react';
import ThreeView from './engine/ThreeView';
import type { Engine } from './engine/Engine';
import { PeakLabels } from './engine/labels';
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
import { DEFAULT_EXAGGERATION } from './config/tiles';
import { slstNowMinutes } from './map/sunPosition';
import { initialBearingDeg, type NearbyPeak, type PeakFeature } from './map/nearbyPeaks';
import { usePeaks } from './data/usePeaks';
import type { SelectedPeak } from './types';
// Skin label fonts (self-hosted, no CDN). Fredoka is used by the 7C skins.
import '@fontsource/luckiest-guy/latin-400.css';
import '@fontsource/fredoka/latin-600.css';
import './App.css';
import './engine/engine.css';

function selectedFrom(
  peak: SelectedPeak | PeakFeature['properties'],
  lng: number,
  lat: number,
  engine: Engine | null,
): SelectedPeak {
  const sampled = peak.ele == null && engine ? engine.heightAt(lng, lat) : null;
  const terrain = sampled != null && sampled > 0 ? Math.round(sampled) : null;
  return {
    ...peak,
    lng,
    lat,
    displayEle: peak.ele ?? terrain,
    eleSource: peak.ele != null ? 'osm' : terrain != null ? 'terrain' : 'unknown',
  };
}

export default function AppThree() {
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION);
  const [sunMinutes, setSunMinutes] = useState(slstNowMinutes);
  const [selectedPeak, setSelectedPeak] = useState<SelectedPeak | null>(null);
  const [viewpoint, setViewpoint] = useState<SelectedPeak | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [elevationFloor, setElevationFloor] = useState(0);
  const [bearing, setBearing] = useState(0);
  const peaks = usePeaks();
  const labelsRef = useRef<PeakLabels | null>(null);
  const selectRef = useRef<(f: PeakFeature) => void>(() => {});
  selectRef.current = (f) =>
    setSelectedPeak(selectedFrom(f.properties, f.geometry.coordinates[0], f.geometry.coordinates[1], engine));

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

  // Compass: only re-render when the heading moves by a visible amount.
  useEffect(() => {
    if (!engine) return;
    let last: number | null = null;
    return engine.onFrame(() => {
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
      setSelectedPeak(selectedFrom(f.properties, lng, lat, engine));
      engine?.flyTo({ lng, lat, distanceKm: 26, pitch: 66 }, 1800);
    },
    [engine],
  );

  const pickNearby = useCallback(
    (np: NearbyPeak) => setSelectedPeak(selectedFrom(np.peak, np.lng, np.lat, engine)),
    [engine],
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

  const stand = (peak: SelectedPeak) => {
    setViewpoint(peak);
    setSelectedPeak(null);
  };
  const flyHere = (peak: SelectedPeak) =>
    engine?.flyTo({ lng: peak.lng, lat: peak.lat, distanceKm: 14, pitch: 72 }, 1800);

  return (
    <div className="app">
      <ThreeView exaggeration={exaggeration} sunMinutes={sunMinutes} onEngineReady={setEngine} />

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
            <TimeOfDaySlider minutes={sunMinutes} onChange={setSunMinutes} />
            <ExaggerationSlider value={exaggeration} onChange={setExaggeration} />
          </div>

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

      <Attribution renderer="three" />
    </div>
  );
}

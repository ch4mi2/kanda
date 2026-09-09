import { useState, useCallback, useEffect } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import MapView from './map/MapView';
import PeakCard from './components/PeakCard';
import NearbyPeaks from './components/NearbyPeaks';
import ExaggerationSlider from './components/ExaggerationSlider';
import TimeOfDaySlider from './components/TimeOfDaySlider';
import Legend from './components/Legend';
import Attribution from './components/Attribution';
import SearchField from './components/SearchField';
import FilterChips from './components/FilterChips';
import GestureHint from './components/GestureHint';
import SummitBar from './components/SummitBar';
import SummitLabels from './components/SummitLabels';
import { DEFAULT_EXAGGERATION } from './config/tiles';
import { slstNowMinutes } from './map/sunPosition';
import { setPeakElevationFloor } from './map/peaksLayer';
import { usePeaks } from './data/usePeaks';
import type { NearbyPeak, PeakFeature } from './map/nearbyPeaks';
import type { SelectedPeak } from './types';
import './App.css';

/** Build a SelectedPeak from a raw GeoJSON feature, sampling the DEM for
 *  elevation when OSM has no `ele` tag. */
function toSelected(f: PeakFeature, map: MLMap | null): SelectedPeak {
  const [lng, lat] = f.geometry.coordinates;
  const p = f.properties;
  const sampled =
    p.ele == null && map ? map.queryTerrainElevation([lng, lat]) : null;
  return {
    ...p,
    lng,
    lat,
    displayEle: p.ele ?? (sampled != null ? Math.round(sampled) : null),
    eleSource: p.ele != null ? 'osm' : sampled != null ? 'terrain' : 'unknown',
  };
}

export default function App() {
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION);
  const [sunMinutes, setSunMinutes] = useState(slstNowMinutes);
  const [selectedPeak, setSelectedPeak] = useState<SelectedPeak | null>(null);
  // Non-null while standing on a summit (5B). Drives MapView's summit mode and
  // swaps the overhead chrome for the summit bar.
  const [viewpoint, setViewpoint] = useState<SelectedPeak | null>(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const [elevationFloor, setElevationFloor] = useState(0);
  const peaks = usePeaks();

  const handleMapReady = useCallback((m: MLMap) => setMap(m), []);

  // Filter-chip floor drives the map's peak layers as well as the panels.
  useEffect(() => {
    if (!map || !map.getLayer('peaks-major')) return;
    setPeakElevationFloor(map, elevationFloor);
  }, [map, elevationFloor]);

  const flyToPeak = useCallback(
    (lng: number, lat: number) => {
      map?.flyTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 11.5),
        pitch: 68,
        bearing: map.getBearing(),
        duration: 1400,
        curve: 1.4,
      });
    },
    [map],
  );

  const pickFromSearch = useCallback(
    (f: PeakFeature) => {
      setSelectedPeak(toSelected(f, map));
      flyToPeak(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    },
    [map, flyToPeak],
  );

  const pickNearby = useCallback(
    (np: NearbyPeak) => {
      const sampled =
        np.peak.ele == null && map
          ? map.queryTerrainElevation([np.lng, np.lat])
          : null;
      setSelectedPeak({
        ...np.peak,
        lng: np.lng,
        lat: np.lat,
        displayEle:
          np.peak.ele ?? (sampled != null ? Math.round(sampled) : null),
        eleSource:
          np.peak.ele != null ? 'osm' : sampled != null ? 'terrain' : 'unknown',
      });
    },
    [map],
  );

  const inSummit = viewpoint != null;

  return (
    <div className="app">
      <MapView
        exaggeration={exaggeration}
        sunMinutes={sunMinutes}
        viewpoint={viewpoint}
        onPeakSelect={setSelectedPeak}
        onMapReady={handleMapReady}
      />

      {inSummit ? (
        <>
          <SummitBar peak={viewpoint} onExit={() => setViewpoint(null)} />
          <SummitLabels
            map={map}
            origin={viewpoint}
            peaks={peaks}
            reliefMultiplier={exaggeration}
            onPick={(f) => setSelectedPeak(toSelected(f, map))}
          />
          {selectedPeak && selectedPeak.id !== viewpoint.id && (
            <div className="sheet sheet--summit">
              <PeakCard
                peak={selectedPeak}
                map={map}
                onClose={() => setSelectedPeak(null)}
                onStand={() => {
                  setViewpoint(selectedPeak);
                  setSelectedPeak(null);
                }}
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
            <SearchField
              peaks={peaks}
              elevationFloor={elevationFloor}
              onPick={pickFromSearch}
            />
            <FilterChips value={elevationFloor} onChange={setElevationFloor} />
          </div>

          <div className="dock">
            <TimeOfDaySlider minutes={sunMinutes} onChange={setSunMinutes} />
            <ExaggerationSlider value={exaggeration} onChange={setExaggeration} />
          </div>

          <Legend />

          {selectedPeak && (
            <div className="sheet">
              <PeakCard
                peak={selectedPeak}
                map={map}
                onClose={() => setSelectedPeak(null)}
                onStand={() => {
                  setViewpoint(selectedPeak);
                  setSelectedPeak(null);
                }}
              />
              <NearbyPeaks
                origin={selectedPeak}
                peaks={peaks}
                elevationFloor={elevationFloor}
                map={map}
                onPick={pickNearby}
              />
            </div>
          )}

          {!selectedPeak && <GestureHint />}
        </>
      )}

      <Attribution />
    </div>
  );
}

import { useState, useCallback } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import MapView from './map/MapView';
import PeakCard from './components/PeakCard';
import NearbyPeaks from './components/NearbyPeaks';
import ExaggerationSlider from './components/ExaggerationSlider';
import Legend from './components/Legend';
import Attribution from './components/Attribution';
import { DEFAULT_EXAGGERATION } from './config/tiles';
import { usePeaks } from './data/usePeaks';
import type { NearbyPeak } from './map/nearbyPeaks';
import type { SelectedPeak } from './types';
import './App.css';

export default function App() {
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION);
  const [selectedPeak, setSelectedPeak] = useState<SelectedPeak | null>(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const peaks = usePeaks();

  const handleMapReady = useCallback((m: MLMap) => setMap(m), []);

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

  return (
    <div className="app">
      <MapView
        exaggeration={exaggeration}
        onPeakSelect={setSelectedPeak}
        onMapReady={handleMapReady}
      />

      <header className="app__header">
        <h1>Kanda</h1>
        <p>Sri Lanka's mountains in 3D — drag to look around the highlands.</p>
      </header>

      <div className="app__panel app__panel--exaggeration">
        <ExaggerationSlider value={exaggeration} onChange={setExaggeration} />
      </div>

      <div className="app__panel app__panel--legend">
        <Legend />
      </div>

      {selectedPeak && (
        <div className="app__panel app__panel--peak">
          <PeakCard peak={selectedPeak} map={map} onClose={() => setSelectedPeak(null)} />
          <NearbyPeaks
            origin={selectedPeak}
            peaks={peaks}
            map={map}
            onPick={pickNearby}
          />
        </div>
      )}

      <Attribution />
    </div>
  );
}

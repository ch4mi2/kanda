import { useState, useCallback } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import MapView from './map/MapView';
import PeakCard from './components/PeakCard';
import ExaggerationSlider from './components/ExaggerationSlider';
import Legend from './components/Legend';
import Attribution from './components/Attribution';
import { DEFAULT_EXAGGERATION } from './config/tiles';
import type { SelectedPeak } from './types';
import './App.css';

export default function App() {
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION);
  const [selectedPeak, setSelectedPeak] = useState<SelectedPeak | null>(null);
  const [map, setMap] = useState<MLMap | null>(null);

  const handleMapReady = useCallback((m: MLMap) => setMap(m), []);

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
        </div>
      )}

      <Attribution />
    </div>
  );
}

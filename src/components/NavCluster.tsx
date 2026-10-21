interface NavClusterProps {
  /** Camera heading in degrees; the needle counter-rotates so N stays true north. */
  bearing: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
}

/** Zoom + compass buttons for the three.js map (MapLibre had its own control). */
export default function NavCluster({ bearing, onZoomIn, onZoomOut, onResetNorth }: NavClusterProps) {
  return (
    <div className="nav-cluster" role="group" aria-label="Map controls">
      <button type="button" onClick={onZoomIn} aria-label="Zoom in">
        +
      </button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out">
        −
      </button>
      <button type="button" onClick={onResetNorth} aria-label="Reset to north">
        <span className="nav-cluster__needle" style={{ transform: `rotate(${-bearing}deg)` }} />
      </button>
    </div>
  );
}

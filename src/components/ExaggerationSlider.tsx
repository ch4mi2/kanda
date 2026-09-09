import { useState } from 'react';
import { MAX_EXAGGERATION, MIN_EXAGGERATION } from '../config/tiles';

interface ExaggerationSliderProps {
  value: number;
  onChange: (v: number) => void;
}

export default function ExaggerationSlider({ value, onChange }: ExaggerationSliderProps) {
  const [showHint, setShowHint] = useState(false);

  return (
    <div className="panel exaggeration">
      <label className="exaggeration__head" htmlFor="exaggeration-input">
        <span>Relief</span>
        <span className="exaggeration__value">{value.toFixed(2)}×</span>
      </label>
      <input
        id="exaggeration-input"
        type="range"
        min={MIN_EXAGGERATION}
        max={MAX_EXAGGERATION}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button
        className="exaggeration__toggle"
        onClick={() => setShowHint((s) => !s)}
        aria-expanded={showHint}
      >
        {showHint ? 'Hide' : 'What is this?'}
      </button>
      {showHint && (
        <p className="exaggeration__hint">
          Height is already exaggerated automatically — more at island view, less
          zoomed in — because at true scale a 2,524 m island 400 km across looks
          flat. This only nudges that; it never changes the elevation data.
        </p>
      )}
    </div>
  );
}

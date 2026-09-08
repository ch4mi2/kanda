import { MAX_EXAGGERATION, MIN_EXAGGERATION } from '../config/tiles';

interface ExaggerationSliderProps {
  value: number;
  onChange: (v: number) => void;
}

export default function ExaggerationSlider({ value, onChange }: ExaggerationSliderProps) {
  return (
    <div className="exaggeration">
      <label htmlFor="exaggeration-input">
        Relief fine-tune: <strong>{value.toFixed(2)}×</strong>
        {value === 1 && <span className="exaggeration__true"> (default)</span>}
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
      <p className="exaggeration__hint">
        Height is already exaggerated automatically — more when viewing the whole
        island, less when zoomed in — because at true scale a 2,524 m island
        400 km across looks flat. This only nudges that; it never changes the
        elevation data.
      </p>
    </div>
  );
}

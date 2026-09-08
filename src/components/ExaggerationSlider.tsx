import { MAX_EXAGGERATION, MIN_EXAGGERATION } from '../config/tiles';

interface ExaggerationSliderProps {
  value: number;
  onChange: (v: number) => void;
}

export default function ExaggerationSlider({ value, onChange }: ExaggerationSliderProps) {
  const isTrueScale = value === MIN_EXAGGERATION;

  return (
    <div className="exaggeration">
      <label htmlFor="exaggeration-input">
        Vertical exaggeration: <strong>{value.toFixed(1)}×</strong>
        {isTrueScale && <span className="exaggeration__true"> (true scale)</span>}
      </label>
      <input
        id="exaggeration-input"
        type="range"
        min={MIN_EXAGGERATION}
        max={MAX_EXAGGERATION}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="exaggeration__hint">
        Sri Lanka's peaks top out at 2,524 m across a wide island — at true scale (1.0×) the
        terrain reads almost flat. Exaggeration stretches height for legibility only; it doesn't
        change the underlying elevation data.
      </p>
    </div>
  );
}

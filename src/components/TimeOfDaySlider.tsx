import { useMemo, useState } from 'react';
import { DEFAULT_CENTER } from '../config/tiles';
import {
  slstNowMinutes,
  sunDateFromSlstMinutes,
  sunPosition,
} from '../map/sunPosition';

interface TimeOfDaySliderProps {
  /** Minutes past midnight, Sri Lanka Standard Time (0–1439). */
  minutes: number;
  onChange: (m: number) => void;
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function TimeOfDaySlider({ minutes, onChange }: TimeOfDaySliderProps) {
  const [showHint, setShowHint] = useState(false);

  const sun = useMemo(
    () =>
      sunPosition(
        sunDateFromSlstMinutes(minutes),
        DEFAULT_CENTER[1],
        DEFAULT_CENTER[0],
      ),
    [minutes],
  );
  const up = sun.altitudeDeg > 0;

  return (
    <div className="panel exaggeration timeofday">
      <label className="exaggeration__head" htmlFor="timeofday-input">
        <span>Sun</span>
        <span className="exaggeration__value">{hhmm(minutes)}</span>
      </label>
      <input
        id="timeofday-input"
        type="range"
        min={0}
        max={1439}
        step={5}
        value={minutes}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="timeofday__row">
        <span className="timeofday__readout">
          {up
            ? `${Math.round(sun.altitudeDeg)}° up · bearing ${Math.round(sun.azimuthDeg)}°`
            : 'below the horizon'}
        </span>
        <button
          className="exaggeration__toggle"
          onClick={() => onChange(slstNowMinutes())}
        >
          Now
        </button>
      </div>
      <button
        className="exaggeration__toggle"
        onClick={() => setShowHint((s) => !s)}
        aria-expanded={showHint}
      >
        {showHint ? 'Hide' : 'What is this?'}
      </button>
      {showHint && (
        <p className="exaggeration__hint">
          The relief shading follows the real sun over Sri Lanka. Scrub to see
          how light rakes the ranges through the day — the shading, not the
          elevation, is what changes.
        </p>
      )}
    </div>
  );
}

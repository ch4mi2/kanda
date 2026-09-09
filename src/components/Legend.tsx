import { DEFAULT_SKIN } from '../skins';

// A readable subset of the active skin's terrain ramp — every other band,
// skipping the below-sea-level floor, so the swatches stay legible.
const LEGEND_STOPS = DEFAULT_SKIN.elevationBands.filter(
  ([ele], i) => ele >= 0 && (i % 2 === 1 || ele === 0),
);

export default function Legend() {
  return (
    <div className="panel legend">
      <div className="legend__ramp">
        {[...LEGEND_STOPS].reverse().map(([ele, color]) => (
          <div key={ele} className="legend__stop">
            <span className="legend__swatch" style={{ background: color }} />
            <span>
              {ele.toLocaleString()}
              {ele === 0 ? ' m · sea level' : ' m'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

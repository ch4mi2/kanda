import { DEFAULT_SKIN } from '../skins';

// A readable subset of the active skin's terrain ramp — every other band —
// plus the flat water colour at the foot.
const LEGEND_STOPS = DEFAULT_SKIN.elevationBands.filter(
  ([ele], i) => i % 2 === 0 || ele === DEFAULT_SKIN.elevationBands.at(-1)![0],
);

export default function Legend() {
  return (
    <div className="panel legend">
      <div className="legend__ramp">
        {[...LEGEND_STOPS].reverse().map(([ele, color]) => (
          <div key={ele} className="legend__stop">
            <span className="legend__swatch" style={{ background: color }} />
            <span>{ele === 0 ? 'coast' : `${ele.toLocaleString()} m`}</span>
          </div>
        ))}
        <div className="legend__stop">
          <span
            className="legend__swatch"
            style={{ background: DEFAULT_SKIN.water }}
          />
          <span>sea</span>
        </div>
      </div>
    </div>
  );
}

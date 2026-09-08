import { MAX_ELEVATION_M } from '../config/tiles';

// Simplified visual sample of the color-relief ramp defined in
// src/map/buildStyle.ts — kept as a separate hand-picked set here since a
// legend needs far fewer, more evenly spaced swatches than the actual paint
// expression's stops.
const LEGEND_STOPS: Array<[number, string]> = [
  [0, 'rgb(24, 98, 112)'],
  [150, 'rgb(96, 148, 68)'],
  [800, 'rgb(181, 168, 88)'],
  [1650, 'rgb(140, 100, 76)'],
  [MAX_ELEVATION_M, 'rgb(214, 206, 196)'],
];

export default function Legend() {
  return (
    <div className="legend">
      <div className="legend__ramp">
        {LEGEND_STOPS.map(([ele, color]) => (
          <div key={ele} className="legend__stop">
            <span className="legend__swatch" style={{ background: color }} />
            <span className="legend__label">{ele.toLocaleString()} m</span>
          </div>
        ))}
      </div>
    </div>
  );
}

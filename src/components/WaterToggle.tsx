interface WaterToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  waterfalls: boolean;
  onWaterfallsChange: (value: boolean) => void;
}

/** Rivers + water/river name labels, and waterfall markers, each on or off.
 *  Same chip-row panel as SkinPicker (.layers), persisted under
 *  `kanda:layers` (src/config/layers.ts). Park outlines have no toggle -
 *  like the lake tint, they stay on regardless (#26). */
export default function WaterToggle({ value, onChange, waterfalls, onWaterfallsChange }: WaterToggleProps) {
  return (
    <div className="panel layers">
      <span className="layers__head">Layers</span>
      <div className="layers__row">
        <button
          type="button"
          className={`layers__chip${value ? ' layers__chip--on' : ''}`}
          aria-pressed={value}
          onClick={() => onChange(!value)}
        >
          Water
        </button>
        <button
          type="button"
          className={`layers__chip${waterfalls ? ' layers__chip--on' : ''}`}
          aria-pressed={waterfalls}
          onClick={() => onWaterfallsChange(!waterfalls)}
        >
          Waterfalls
        </button>
      </div>
    </div>
  );
}

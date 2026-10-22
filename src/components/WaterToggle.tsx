interface WaterToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

/** Rivers + water/river name labels, on or off. Same chip-row panel as
 *  SkinPicker (.layers), persisted under `kanda:layers` (src/config/layers.ts). */
export default function WaterToggle({ value, onChange }: WaterToggleProps) {
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
      </div>
    </div>
  );
}

import type { Skin } from '../engine/skins';

interface SkinPickerProps {
  skins: Skin[];
  value: Skin;
  onChange: (skin: Skin) => void;
}

/** Choose how the map looks. Each chip carries a swatch of the skin's own colours. */
export default function SkinPicker({ skins, value, onChange }: SkinPickerProps) {
  return (
    <div className="panel layers">
      <span className="layers__head">Skin</span>
      <div className="layers__row">
        {skins.map((s) => (
          <button
            key={s.id}
            className={`layers__chip skin-chip${value.id === s.id ? ' layers__chip--on' : ''}`}
            aria-pressed={value.id === s.id}
            title={s.blurb}
            onClick={() => onChange(s)}
          >
            <span
              className="skin-chip__swatch"
              style={{
                background: `linear-gradient(135deg, ${s.zenith} 0 34%, ${s.grassLow} 34% 67%, ${s.water} 67%)`,
              }}
            />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

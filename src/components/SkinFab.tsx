import { useState } from 'react';
import type { Skin } from '../skins';
import SkinPicker from './SkinPicker';

interface SkinFabProps {
  skins: Skin[];
  value: Skin;
  onChange: (skin: Skin) => void;
}

/** Phone-sized skin switcher: the relief dock (which holds the picker on
 *  desktop) is hidden on small screens, so a floating swatch opens it. */
export default function SkinFab({ skins, value, onChange }: SkinFabProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="skin-fab">
      {open && (
        <div className="skin-fab__panel">
          <SkinPicker
            skins={skins}
            value={value}
            onChange={(s) => {
              onChange(s);
              setOpen(false);
            }}
          />
        </div>
      )}
      <button
        type="button"
        className="skin-fab__btn"
        aria-label={`Map skin: ${value.name}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="skin-chip__swatch skin-fab__swatch"
          style={{ background: `linear-gradient(135deg, ${value.zenith} 0 34%, ${value.grassLow} 34% 67%, ${value.water} 67%)` }}
        />
      </button>
    </div>
  );
}

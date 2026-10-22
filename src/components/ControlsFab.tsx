import { useState } from 'react';
import type { Skin } from '../skins';
import SkinPicker from './SkinPicker';
import TimeOfDaySlider from './TimeOfDaySlider';
import ExaggerationSlider from './ExaggerationSlider';
import WaterToggle from './WaterToggle';

interface ControlsFabProps {
  skins: Skin[];
  skin: Skin;
  onSkinChange: (skin: Skin) => void;
  sunMinutes: number;
  onSunChange: (m: number) => void;
  exaggeration: number;
  onExaggerationChange: (v: number) => void;
  water: boolean;
  onWaterChange: (v: boolean) => void;
}

/** Phone-sized stand-in for the relief dock, which is hidden below the
 *  desktop breakpoint: one floating swatch opens skin, sun, relief and layer
 *  toggles together, stacked the same way the dock stacks them on desktop. */
export default function ControlsFab({
  skins,
  skin,
  onSkinChange,
  sunMinutes,
  onSunChange,
  exaggeration,
  onExaggerationChange,
  water,
  onWaterChange,
}: ControlsFabProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="controls-fab">
      {open && (
        <div className="controls-fab__panel">
          <SkinPicker skins={skins} value={skin} onChange={onSkinChange} />
          <TimeOfDaySlider minutes={sunMinutes} onChange={onSunChange} />
          <ExaggerationSlider value={exaggeration} onChange={onExaggerationChange} />
          <WaterToggle value={water} onChange={onWaterChange} />
        </div>
      )}
      <button
        type="button"
        className="controls-fab__btn"
        aria-label="Map settings: skin, sun and relief"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="skin-chip__swatch controls-fab__swatch"
          style={{ background: `linear-gradient(135deg, ${skin.zenith} 0 34%, ${skin.grassLow} 34% 67%, ${skin.water} 67%)` }}
        />
      </button>
    </div>
  );
}

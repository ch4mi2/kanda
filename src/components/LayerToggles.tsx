import {
  LAYER_GROUP_LABELS,
  type LayerGroup,
  type LayerVisibility,
} from '../map/layerToggles';

interface LayerTogglesProps {
  value: LayerVisibility;
  onChange: (next: LayerVisibility) => void;
}

const GROUPS = Object.keys(LAYER_GROUP_LABELS) as LayerGroup[];

/** Switch the optional map furniture on and off. Contours especially — they
 *  read as a wireframe grid at an oblique angle, so they ship off. */
export default function LayerToggles({ value, onChange }: LayerTogglesProps) {
  return (
    <div className="panel layers">
      <span className="layers__head">Layers</span>
      <div className="layers__row">
        {GROUPS.map((g) => (
          <button
            key={g}
            className={`layers__chip${value[g] ? ' layers__chip--on' : ''}`}
            aria-pressed={value[g]}
            onClick={() => onChange({ ...value, [g]: !value[g] })}
          >
            {LAYER_GROUP_LABELS[g]}
          </button>
        ))}
      </div>
    </div>
  );
}

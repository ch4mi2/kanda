import { useEffect, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';

interface CompassStripProps {
  map: MLMap | null;
}

// Degrees of heading visible to each side of centre.
const HALF_SPAN = 54;
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** A heading ribbon across the top of summit view: the compass point you're
 *  facing sits under the needle and the marks slide as you spin, so "that
 *  side" gets a name. */
export default function CompassStrip({ map }: CompassStripProps) {
  const [bearing, setBearing] = useState(0);

  useEffect(() => {
    if (!map) return;
    const update = () => setBearing((map.getBearing() + 360) % 360);
    update();
    map.on('rotate', update);
    map.on('move', update);
    return () => {
      map.off('rotate', update);
      map.off('move', update);
    };
  }, [map]);

  if (!map) return null;

  const ticks: { b: number; pct: number; label: string | null }[] = [];
  for (let b = 0; b < 360; b += 15) {
    const delta = ((b - bearing + 540) % 360) - 180;
    if (Math.abs(delta) > HALF_SPAN) continue;
    ticks.push({
      b,
      pct: 50 + (delta / HALF_SPAN) * 50,
      label: b % 45 === 0 ? CARDINALS[b / 45] : null,
    });
  }

  return (
    <div className="compass" aria-hidden>
      <div className="compass__needle" />
      {ticks.map((t) => (
        <div
          key={t.b}
          className={`compass__tick${t.label ? ' compass__tick--card' : ''}`}
          style={{ left: `${t.pct}%` }}
        >
          <span className="compass__pip" />
          {t.label && <span className="compass__label">{t.label}</span>}
        </div>
      ))}
    </div>
  );
}

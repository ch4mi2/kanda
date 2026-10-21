import { useEffect, useRef } from 'react';
import { Engine } from './Engine';
import type { Skin } from './skins';

interface ThreeViewProps {
  /** UI relief multiplier on top of the skin's own exaggeration. */
  exaggeration: number;
  /** Minutes past midnight Sri Lanka Standard Time. */
  sunMinutes: number;
  skin: Skin;
  onEngineReady?: (engine: Engine) => void;
}

/** Thin React shell around the imperative three.js Engine. */
export default function ThreeView({ exaggeration, sunMinutes, skin, onEngineReady }: ThreeViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const latest = useRef({ exaggeration, sunMinutes, skin });
  latest.current = { exaggeration, sunMinutes, skin };

  useEffect(() => {
    if (!hostRef.current) return;
    const engine = new Engine(hostRef.current, latest.current.skin);
    engineRef.current = engine;
    engine.setExaggeration(latest.current.exaggeration);
    engine.setSunMinutes(latest.current.sunMinutes);
    if (import.meta.env.DEV) (window as unknown as { __engine?: Engine }).__engine = engine;
    onEngineReady?.(engine);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // The engine is created once; live values are pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => engineRef.current?.setExaggeration(exaggeration), [exaggeration]);
  useEffect(() => engineRef.current?.setSunMinutes(sunMinutes), [sunMinutes]);
  useEffect(() => {
    const e = engineRef.current;
    if (e && e.currentSkin.id !== skin.id) e.applySkin(skin);
  }, [skin]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}

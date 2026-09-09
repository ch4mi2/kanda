import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import {
  SUMMIT_EXAGGERATION,
  SUMMIT_EYE_MARGIN_M,
  SUMMIT_LABEL_RADIUS_KM,
} from '../config/tiles';
import { setPeaksVisible } from '../map/peaksLayer';
import {
  compassLabel,
  haversineKm,
  initialBearingDeg,
  type PeakFeature,
} from '../map/nearbyPeaks';
import type { SelectedPeak } from '../types';

interface SummitLabelsProps {
  map: MLMap | null;
  origin: SelectedPeak;
  peaks: PeakFeature[];
  /** User's relief-slider multiplier (summit runs at SUMMIT_EXAGGERATION x it). */
  reliefMultiplier: number;
  onPick: (feature: PeakFeature) => void;
}

interface Placed {
  id: number;
  feature: PeakFeature;
  name: string;
  ele: number | null;
  x: number;
  y: number;
  /** px the text block is lifted above the summit point; the tick bridges it. */
  lift: number;
  distanceKm: number;
  compass: string;
  occluded: boolean;
}

const THROTTLE_MS = 80;
// Declutter: a label reserves this much screen space; lower-priority labels in
// the same column are lifted, then dropped.
const LABEL_HALF_W = 62;
const LABEL_ROW_H = 30;
const MAX_LIFT_STEPS = 5;

// Occlusion: march the DEM along the sight line from the summit to each peak
// and check whether any intervening ground rises above the line of sight. This
// is done on the CPU with queryTerrainElevation rather than the depth buffer —
// MapLibre's `isLocationOccluded` is a mercator no-op, and depthAtPoint proved
// unreliable here. RIDGE_FUDGE_M absorbs DEM speckle so a noisy pixel doesn't
// false-positive.
const OCCLUSION_STEPS = 24;
// Absorbs DEM speckle along the ray. Tuned by eye — too low flags visible peaks
// as hidden, too high lets peaks behind a real ridge show through.
const RIDGE_FUDGE_M = 20;
// Ignore ground within this many km of the eye — that's your own summit,
// which shouldn't count as "a ridge in the way".
const OCCLUSION_SKIP_KM = 0.4;

function smallestAngleDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export default function SummitLabels({
  map,
  origin,
  peaks,
  reliefMultiplier,
  onPick,
}: SummitLabelsProps) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const lastRun = useRef(0);
  const lastCam = useRef('');

  // Candidate peaks: named, within range of the summit, not the summit itself.
  const candidates = useMemo(() => {
    const o: [number, number] = [origin.lng, origin.lat];
    return peaks
      .filter((f) => f.properties.id !== origin.id && f.properties.name)
      .map((f) => ({
        f,
        distanceKm: haversineKm(o, f.geometry.coordinates),
        bearingDeg: initialBearingDeg(o, f.geometry.coordinates),
      }))
      .filter((c) => c.distanceKm <= SUMMIT_LABEL_RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 40);
  }, [peaks, origin.id, origin.lng, origin.lat]);

  // Hide the symbol tiers while standing; restore on the way out.
  useEffect(() => {
    if (!map) return;
    setPeaksVisible(map, false);
    return () => setPeaksVisible(map, true);
  }, [map]);

  useEffect(() => {
    if (!map) return;
    lastCam.current = ''; // force a recompute for the new inputs
    const eyeLL: [number, number] = [origin.lng, origin.lat];
    const exag = SUMMIT_EXAGGERATION * reliefMultiplier;
    // Reliable eye altitude in DEM-exaggerated space — queryTerrainElevation
    // can briefly return null right after the camera jump, and a null there
    // sends the sight line to sea level and hides everything.
    const knownEyeAlt =
      (origin.displayEle ?? origin.ele ?? 0) * exag + SUMMIT_EYE_MARGIN_M;

    const recompute = () => {
      const now = performance.now();
      if (now - lastRun.current < THROTTLE_MS) return;
      // Skip frames where the camera hasn't actually moved — stops the labels
      // flickering between visible/hidden on idle re-renders.
      const c = map.getCenter();
      const cam = `${map.getBearing().toFixed(2)}|${map.getPitch().toFixed(2)}|${c.lng.toFixed(5)}|${c.lat.toFixed(5)}`;
      if (cam === lastCam.current) return;
      lastRun.current = now;
      lastCam.current = cam;

      const canvas = map.getCanvas();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const viewBearing = map.getBearing();
      // Sight-ray origin: prefer the live DEM sample, fall back to the known
      // summit elevation when the tile isn't ready.
      const eyeGround = map.queryTerrainElevation(eyeLL);
      const eyeAlt =
        eyeGround != null && eyeGround > 0
          ? eyeGround + SUMMIT_EYE_MARGIN_M
          : knownEyeAlt;
      const next: Placed[] = [];

      try {
        for (const cand of candidates) {
          // Behind the camera / well outside the view cone — skip early.
          if (smallestAngleDelta(cand.bearingDeg, viewBearing) > 62) continue;

          const [lng, lat] = cand.f.geometry.coordinates;
          const pt = map.project([lng, lat]);
          if (pt.x < -60 || pt.x > w + 60 || pt.y < -40 || pt.y > h + 40) continue;

          const sampled = map.queryTerrainElevation([lng, lat]);
          const peakGround =
            sampled != null && sampled > 0
              ? sampled
              : (cand.f.properties.ele ?? 0) * exag;
          if (peakGround <= 0) continue;

          // March the DEM along the line of sight; a ridge that pokes above the
          // straight eye->peak line hides the peak.
          let occluded = false;
          const skipT = OCCLUSION_SKIP_KM / Math.max(cand.distanceKm, 0.01);
          for (let i = 1; i < OCCLUSION_STEPS; i++) {
            const t = i / OCCLUSION_STEPS;
            if (t < skipT) continue;
            const g = map.queryTerrainElevation([
              lng * t + eyeLL[0] * (1 - t),
              lat * t + eyeLL[1] * (1 - t),
            ]);
            if (g == null) continue;
            const sightAlt = eyeAlt + (peakGround - eyeAlt) * t;
            if (g > sightAlt + RIDGE_FUDGE_M) {
              occluded = true;
              break;
            }
          }

          next.push({
            id: cand.f.properties.id,
            feature: cand.f,
            name: cand.f.properties.name,
            ele: cand.f.properties.ele,
            x: pt.x,
            y: pt.y,
            lift: 0,
            distanceKm: cand.distanceKm,
            compass: compassLabel(cand.bearingDeg),
            occluded,
          });
        }
      } catch {
        return; // terrain not ready this frame — try again next render
      }

      // Declutter: visible + nearer peaks claim their spot; others lift out of
      // the way and, failing that, drop for this frame.
      const byPriority = [...next].sort(
        (a, b) =>
          Number(a.occluded) - Number(b.occluded) || a.distanceKm - b.distanceKm,
      );
      const kept: Placed[] = [];
      for (const p of byPriority) {
        let lift = 0;
        const clashes = () =>
          kept.some(
            (k) =>
              Math.abs(k.x - p.x) < LABEL_HALF_W * 2 &&
              Math.abs(k.y - k.lift - (p.y - lift)) < LABEL_ROW_H,
          );
        while (clashes() && lift < LABEL_ROW_H * MAX_LIFT_STEPS) lift += LABEL_ROW_H;
        if (clashes()) continue;
        kept.push({ ...p, lift });
      }
      // Nearer peaks paint last (on top).
      kept.sort((a, b) => b.distanceKm - a.distanceKm);
      setPlaced(kept);
    };

    recompute();
    map.on('render', recompute);
    return () => {
      map.off('render', recompute);
    };
  }, [map, candidates, origin.lng, origin.lat, origin.displayEle, origin.ele, reliefMultiplier]);

  if (!map) return null;

  return (
    <div className="skyline" aria-hidden={false}>
      {placed.map((p) => {
        // Nearer = larger and more opaque; distance is felt.
        const near = Math.max(0, Math.min(1, 1 - p.distanceKm / SUMMIT_LABEL_RADIUS_KM));
        const scale = 0.82 + near * 0.34;
        return (
          <button
            key={p.id}
            type="button"
            className={`skyline__peak${p.occluded ? ' skyline__peak--hidden' : ''}`}
            style={{
              left: `${p.x}px`,
              top: `${p.y - p.lift}px`,
              transform: `translate(-50%, -100%) scale(${scale.toFixed(3)})`,
              opacity: p.occluded ? 0.55 : 0.72 + near * 0.28,
              zIndex: Math.round(1000 - p.distanceKm),
            }}
            onClick={() => onPick(p.feature)}
          >
            <span className="skyline__name">{p.name}</span>
            <span className="skyline__meta">
              {p.ele != null ? `${p.ele.toLocaleString()} m · ` : ''}
              {p.distanceKm < 10 ? p.distanceKm.toFixed(1) : Math.round(p.distanceKm)} km{' '}
              {p.compass}
              {p.occluded ? ' · hidden' : ''}
            </span>
            <span
              className="skyline__tick"
              style={{ height: `${14 + p.lift}px` }}
            />
          </button>
        );
      })}
    </div>
  );
}

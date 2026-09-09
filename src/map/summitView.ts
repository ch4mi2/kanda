import { LngLat, type CameraOptions, type Map as MLMap } from 'maplibre-gl';
import {
  DEFAULT_PITCH,
  MAP_BOUNDS,
  PITCH_MAX,
  SUMMIT_EXAGGERATION,
  SUMMIT_EYE_MARGIN_M,
  SUMMIT_LOOK_DISTANCE_KM,
  SUMMIT_MAX_PITCH,
  SUMMIT_PITCH_MAX,
  SUMMIT_PITCH_MIN,
} from '../config/tiles';
import { destinationPoint } from './nearbyPeaks';

// Summit view — the thing Phase 5B exists for. Put the camera *on* a peak at
// eye level and let the user spin 360°. Every hard part is a MapLibre 6.8
// constraint verified in its source (see the Phase 5 plan's research section):
//
//  - There is NO free-camera API (get/setFreeCameraOptions are Mapbox-only).
//    The camera is placed by picking a look-at target ~40 km out along the
//    current heading and calling calculateCameraOptionsFromTo(eye -> target).
//  - A level line of sight (dz === 0) makes calculateCameraOptionsFromTo
//    return pitch exactly 90. Looking down is < 90, up is > 90; pitch may
//    legally exceed 90 (hard ceiling 180) but the default maxPitch is 60, and
//    above 90 you must also setCenterClampedToGround(false).
//  - setBearing() orbits the camera around the *centre*, which here is the
//    point 40 km away — it would swing us around the horizon. So every
//    look-around delta re-solves the whole camera from the new target.
//  - _elevateCameraIfInsideTerrain runs on every camera path with terrain on
//    and silently rewrites pitch + zoom when the camera sits inside terrain,
//    with no margin and no off switch. Mitigated by a generous eye margin plus
//    a transformCameraUpdate hook (which runs afterwards) that re-asserts our
//    pitch and zoom.
//  - queryTerrainElevation() returns 0 (not null) on unloaded DEM tiles, so
//    the caller must pass a trustworthy elevation (OSM `ele` first).

export interface SummitTarget {
  lng: number;
  lat: number;
  /** Metres ASL. OSM `ele` where known, DEM sample otherwise — never 0 from an
   *  unloaded tile. */
  ele: number;
}

export interface SummitView {
  /** True between enter() and exit(). */
  active(): boolean;
  enter(target: SummitTarget): void;
  exit(): void;
  /** Re-apply the user's relief multiplier while standing (the eye altitude
   *  rides on the exaggerated surface, so it has to move with it). */
  setReliefMultiplier(multiplier: number): void;
  /** Hard teardown with no fly-back — for map unmount. */
  destroy(): void;
}

interface SummitDeps {
  /** The user's current relief-slider multiplier (1 = leave the curve alone). */
  reliefMultiplier: () => number;
  /** Called on exit so MapView can resume the adaptive-exaggeration curve. */
  onExit: () => void;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const DEG = Math.PI / 180;

// Look-around is "grab the world" — drag the scene the way your finger goes,
// like PeakFinder / Street View (the summit-legibility reference in CLAUDE.md).
// That's the opposite sign to MapLibre's own rotate handlers, which is fine:
// this is first-person look, not the overhead map's rotate gesture.
const YAW_PER_PX = 0.16;
const PITCH_PER_PX = 0.1;

export function createSummitView(map: MLMap, deps: SummitDeps): SummitView {
  let isActive = false;
  let target: SummitTarget | null = null;
  let eye: [number, number] = [0, 0];
  let eyeAltM = 0;
  let bearing = 0;
  let pitch = 90;
  let desired: CameraOptions | null = null;

  // transformCameraUpdate: runs after _elevateCameraIfInsideTerrain, so this is
  // where we win the fight over pitch/zoom.
  const hold = (next: { pitch: number; zoom: number }) => {
    if (!isActive || !desired) return {};
    return {
      pitch: desired.pitch ?? next.pitch,
      zoom: desired.zoom ?? next.zoom,
    };
  };

  function applyExaggeration() {
    if (!target) return;
    const exag = SUMMIT_EXAGGERATION * deps.reliefMultiplier();
    map.setTerrain({ source: 'terrain-dem', exaggeration: exag });
    eyeAltM = target.ele * exag + SUMMIT_EYE_MARGIN_M;
  }

  function jumpLook() {
    const tgt = destinationPoint(eye, SUMMIT_LOOK_DISTANCE_KM, bearing);
    const distM = SUMMIT_LOOK_DISTANCE_KM * 1000;
    // pitch 90 = level; the target's altitude relative to the eye sets the angle.
    const targetAltM = eyeAltM + distM * Math.tan((pitch - 90) * DEG);
    desired = map.calculateCameraOptionsFromTo(
      new LngLat(eye[0], eye[1]),
      eyeAltM,
      new LngLat(tgt[0], tgt[1]),
      targetAltM,
    );
    map.jumpTo(desired);
  }

  // ---- look-around input ----
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const canvas = () => map.getCanvas();

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas().setPointerCapture(e.pointerId);
    canvas().style.cursor = 'grabbing';
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    // Grab-the-world: the point under the cursor tracks the cursor.
    bearing -= dx * YAW_PER_PX;
    pitch = clamp(pitch + dy * PITCH_PER_PX, SUMMIT_PITCH_MIN, SUMMIT_PITCH_MAX);
    jumpLook();
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      canvas().releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    canvas().style.cursor = '';
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 9 : 3;
    if (e.key === 'ArrowLeft') bearing -= step;
    else if (e.key === 'ArrowRight') bearing += step;
    else if (e.key === 'ArrowUp')
      pitch = clamp(pitch + step, SUMMIT_PITCH_MIN, SUMMIT_PITCH_MAX);
    else if (e.key === 'ArrowDown')
      pitch = clamp(pitch - step, SUMMIT_PITCH_MIN, SUMMIT_PITCH_MAX);
    else return;
    e.preventDefault();
    jumpLook();
  };

  function attachInput() {
    const c = canvas();
    c.addEventListener('pointerdown', onPointerDown);
    c.addEventListener('pointermove', onPointerMove);
    c.addEventListener('pointerup', onPointerUp);
    c.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
  }
  function detachInput() {
    const c = canvas();
    c.removeEventListener('pointerdown', onPointerDown);
    c.removeEventListener('pointermove', onPointerMove);
    c.removeEventListener('pointerup', onPointerUp);
    c.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('keydown', onKeyDown);
    c.style.cursor = '';
    dragging = false;
  }

  return {
    active: () => isActive,

    enter(next: SummitTarget) {
      target = next;
      eye = [next.lng, next.lat];
      bearing = map.getBearing();
      pitch = 90;

      // A pitch-90+ frustum spills continent-wide, so drop maxBounds
      // (CLAUDE.md gotcha #1) and lift the pitch ceiling.
      map.setMaxBounds(null);
      map.setMaxPitch(SUMMIT_MAX_PITCH);
      map.setCenterClampedToGround(false);
      map.setTransformCameraUpdate(hold as never);

      applyExaggeration();
      isActive = true;
      attachInput();
      jumpLook();
    },

    exit() {
      if (!isActive) return;
      isActive = false;
      detachInput();
      map.setTransformCameraUpdate(null);
      map.setCenterClampedToGround(true);
      map.setMaxPitch(PITCH_MAX);
      map.setMaxBounds(MAP_BOUNDS);
      desired = null;
      // Resume the adaptive-exaggeration curve before the camera move so the
      // fly-back doesn't briefly show 1.2x terrain.
      deps.onExit();
      map.flyTo({
        center: eye,
        zoom: 11,
        pitch: DEFAULT_PITCH,
        bearing,
        duration: 1400,
      });
      target = null;
    },

    setReliefMultiplier() {
      if (!isActive) return;
      applyExaggeration();
      jumpLook();
    },

    destroy() {
      if (isActive) {
        isActive = false;
        detachInput();
        map.setTransformCameraUpdate(null);
      }
    },
  };
}

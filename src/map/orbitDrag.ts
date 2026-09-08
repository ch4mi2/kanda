import type { Map as MLMap } from 'maplibre-gl';
import {
  ORBIT_PITCH_SENSITIVITY,
  ORBIT_YAW_SENSITIVITY,
  PITCH_MAX,
  PITCH_MIN,
} from '../config/tiles';

/**
 * Makes a single-pointer drag orbit the camera (horizontal → bearing,
 * vertical → pitch) instead of panning the map.
 *
 * Why this exists: Kanda is a "stand on a summit and look around" app, so
 * rotation is THE primary gesture. MapLibre only rotates on right-drag /
 * ctrl-drag by default, which nobody discovers. The design handoff sheet
 * specifies "drag → orbit yaw ±180°, pitch clamp 12°-72°" — this implements
 * exactly that. dragPan is disabled by the caller; taps still fly to peaks,
 * two-finger gestures still pinch-zoom (MapLibre's touch handler owns those,
 * and we bail the moment a second pointer lands).
 *
 * Returns a teardown function.
 */
export function attachOrbitDrag(map: MLMap): () => void {
  const canvas = map.getCanvas();
  const activePointers = new Set<number>();
  let orbiting = false;
  let lastX = 0;
  let lastY = 0;

  const clampPitch = (p: number) => Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));

  const onPointerDown = (e: PointerEvent) => {
    activePointers.add(e.pointerId);
    // Second finger down → this is a pinch/rotate, hand it to MapLibre.
    if (activePointers.size !== 1) {
      orbiting = false;
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return; // left button only
    orbiting = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!orbiting || activePointers.size !== 1) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dx === 0 && dy === 0) return;
    map.setBearing(map.getBearing() - dx * ORBIT_YAW_SENSITIVITY);
    map.setPitch(clampPitch(map.getPitch() - dy * ORBIT_PITCH_SENSITIVITY));
  };

  const endPointer = (e: PointerEvent) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      orbiting = false;
      canvas.style.cursor = '';
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endPointer);
    window.removeEventListener('pointercancel', endPointer);
  };
}

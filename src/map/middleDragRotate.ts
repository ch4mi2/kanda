import type { Map as MLMap } from 'maplibre-gl';
import {
  ORBIT_PITCH_SENSITIVITY,
  ORBIT_YAW_SENSITIVITY,
  PITCH_MAX,
  PITCH_MIN,
} from '../config/tiles';

/**
 * Middle-button drag rotates + tilts the camera.
 *
 * Kanda uses the Google Earth navigation scheme: left-drag pans (MapLibre's
 * dragPan), right-drag rotates + tilts (MapLibre's dragRotate), scroll zooms.
 * The one thing MapLibre has no handler for is the middle button, which
 * Google Earth also binds to rotate/tilt — this fills exactly that gap and
 * nothing else. Everything else is a stock MapLibre handler.
 *
 * The sign matches MapLibre's own MouseRotateHandler (`bearing += dx * speed`)
 * and MousePitchHandler (`pitch -= dy * speed`), so a middle-drag and a
 * right-drag turn the camera the same way. The previous implementation here
 * negated dx, so left-drag and right-drag rotated in opposite directions —
 * an outright bug, now gone with left-drag returned to panning.
 *
 * Returns a teardown function.
 */
export function attachMiddleDragRotate(map: MLMap): () => void {
  const canvas = map.getCanvas();
  let active = false;
  let lastX = 0;
  let lastY = 0;

  const clampPitch = (p: number) => Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));

  const onDown = (e: MouseEvent) => {
    if (e.button !== 1) return;
    // Stops the OS middle-click autoscroll puck from hijacking the drag.
    e.preventDefault();
    active = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
  };

  const onMove = (e: MouseEvent) => {
    if (!active) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dx !== 0) map.setBearing(map.getBearing() + dx * ORBIT_YAW_SENSITIVITY);
    if (dy !== 0) map.setPitch(clampPitch(map.getPitch() - dy * ORBIT_PITCH_SENSITIVITY));
  };

  const onUp = (e: MouseEvent) => {
    if (e.button !== 1 || !active) return;
    active = false;
    canvas.style.cursor = '';
  };

  const blockAuxClick = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('auxclick', blockAuxClick);

  return () => {
    canvas.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('auxclick', blockAuxClick);
  };
}

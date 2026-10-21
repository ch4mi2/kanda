// Peak labels as a DOM layer positioned from the engine's camera every frame.
// Overview: tallest peaks win screen space. Summit view: the same labels carry
// distance + compass direction, nearer ones first, and ones hidden behind a
// ridge are ghosted - the "oh, that's Lakegala" moment the app exists for.

import { SUMMIT_LABEL_RADIUS_KM } from '../config/tiles';
import { compassLabel, haversineKm, initialBearingDeg, type PeakFeature } from '../map/nearbyPeaks';
import type { Engine, Projected } from './Engine';

interface Item {
  feature: PeakFeature;
  id: number;
  name: string;
  lng: number;
  lat: number;
  /** Elevation for placing the label: OSM `ele`, else the first positive DEM
   *  sample seen (cached from then on - it no longer moves with LOD). */
  ele: number;
  el: HTMLButtonElement;
  small: HTMLElement;
  shown: boolean;
  ghost: boolean;
  /** Last raw occlusion reading and how many checks in a row have agreed with
   *  it - `ghost` only flips once this reaches OCCLUSION_HYSTERESIS. */
  occlusionRaw: boolean;
  occlusionStreak: number;
  lastText: string;
  /** Pending `display:none` after a fade-out; cleared if shown again first. */
  hideTimer: ReturnType<typeof setTimeout> | null;
}

/** Fewer labels the further out the camera is, so the island view stays
 *  legible. A pure state machine (zone in, limit out) so the boundary has
 *  hysteresis: crossing 110/55 km outward and 95/45 km inward, with a dead
 *  band between them, so a label doesn't flicker in/out right at the edge. */
export type LabelZone = 0 | 1 | 2;
export function nextLabelZone(zone: LabelZone, distanceKm: number): LabelZone {
  if (zone === 2) return distanceKm > 55 ? 1 : 2;
  if (zone === 1) return distanceKm > 110 ? 0 : distanceKm < 45 ? 2 : 1;
  return distanceKm < 95 ? 1 : 0;
}
export function limitForZone(zone: LabelZone): number {
  return zone === 0 ? 14 : zone === 1 ? 24 : 36;
}

const MAX_SUMMIT = 40;
const OCCLUSION_EVERY = 6;
const OCCLUSION_HYSTERESIS = 3;
const FADE_MS = 180;
/** Already-shown labels get a bonus (pushes them up the priority order) and a
 *  smaller overlap box (so a new candidate has to overlap it more before it
 *  can displace it) - both keep a label from flickering out over a near-tie. */
const SHOWN_BONUS_OVERVIEW = 400; // metres-equivalent, vs. priority = -ele
const SHOWN_BONUS_SUMMIT = 5; // km-equivalent, vs. priority = km
const OVERLAP_HALF: [number, number] = [104, 38];
const OVERLAP_HALF_SHOWN: [number, number] = [60, 22];

export class PeakLabels {
  private engine: Engine;
  private layer: HTMLDivElement;
  private items: Item[] = [];
  private floor = 0;
  private selectedId: number | null = null;
  private origin: { lng: number; lat: number; id: number } | null = null;
  private off: () => void;
  private proj: Projected = { x: 0, y: 0, visible: false, distanceKm: 0 };
  private frame = 0;
  private zone: LabelZone = 1;

  constructor(engine: Engine, peaks: PeakFeature[], onPick: (f: PeakFeature) => void) {
    this.engine = engine;
    this.layer = document.createElement('div');
    this.layer.className = 'peak-labels';
    engine.host.appendChild(this.layer);
    for (const f of peaks) {
      if (!f.properties.name) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'peak-label';
      const name = document.createElement('span');
      name.className = 'peak-label__name';
      name.textContent = f.properties.name;
      const small = document.createElement('small');
      small.className = 'peak-label__meta';
      el.append(name, small);
      el.style.display = 'none';
      el.addEventListener('click', () => onPick(f));
      this.layer.appendChild(el);
      this.items.push({
        feature: f,
        id: f.properties.id,
        name: f.properties.name,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        ele: f.properties.ele ?? 0,
        el,
        small,
        shown: false,
        ghost: false,
        occlusionRaw: false,
        occlusionStreak: 0,
        lastText: '',
        hideTimer: null,
      });
    }
    this.off = engine.onFrame(() => this.update());
  }

  setFloor(metres: number) {
    this.floor = metres;
  }

  setSelected(id: number | null) {
    this.selectedId = id;
  }

  /** Summit view: pass the peak you are standing on; null to return to overview. */
  setOrigin(origin: { lng: number; lat: number; id: number } | null) {
    this.origin = origin;
  }

  dispose() {
    this.off();
    for (const it of this.items) if (it.hideTimer != null) clearTimeout(it.hideTimer);
    this.layer.remove();
  }

  /** OSM `ele`, else the first positive DEM sample - cached on the item from
   *  then on, so it does not drift as finer tiles load (CLAUDE.md "labels"). */
  private elevation(it: Item): number {
    if (it.ele > 0) return it.ele;
    const h = this.engine.heightAt(it.lng, it.lat);
    if (h != null && h > 0) it.ele = h;
    return it.ele;
  }

  private update() {
    const eng = this.engine;
    const frame = this.frame++;
    const summit = eng.currentMode === 'summit' && this.origin != null;
    const viewBearing = eng.getBearing();

    // Candidates with their priority.
    const cands: Array<{ it: Item; p: number; sx: number; sy: number; dist: number; scale: number; bearing: number; km: number }> = [];
    for (const it of this.items) {
      if (summit && it.id === this.origin!.id) continue;
      const ele = this.elevation(it);
      if (ele < this.floor) continue;
      let km = 0;
      let bearing = 0;
      if (summit) {
        km = haversineKm([this.origin!.lng, this.origin!.lat], [it.lng, it.lat]);
        if (km > SUMMIT_LABEL_RADIUS_KM) continue;
        // Low hills far away are noise on the skyline; the peaks you want to name are taller.
        if (ele < 450 && km > 8) continue;
        bearing = initialBearingDeg([this.origin!.lng, this.origin!.lat], [it.lng, it.lat]);
        if (Math.abs(((bearing - viewBearing + 540) % 360) - 180) > 62) continue;
      }
      const pr = eng.project(it.lng, it.lat, ele, this.proj);
      if (!pr.visible) continue;
      // Summit: nearer peaks first. Overview: taller peaks first. A label
      // already shown gets a bonus so it isn't displaced by a near-tie.
      const bonus = it.shown ? (summit ? SHOWN_BONUS_SUMMIT : SHOWN_BONUS_OVERVIEW) : 0;
      const priority = (summit ? km : -ele) - bonus;
      const scale = summit
        ? 0.82 + Math.max(0, Math.min(1, 1 - km / SUMMIT_LABEL_RADIUS_KM)) * 0.34
        : Math.max(0.72, Math.min(1.15, 60 / pr.distanceKm + 0.6));
      cands.push({ it, p: priority, sx: pr.x, sy: pr.y, dist: pr.distanceKm, scale, bearing, km });
    }
    cands.sort((a, b) => a.p - b.p);

    if (!summit) this.zone = nextLabelZone(this.zone, eng.orbitDistanceKm);
    const limit = summit ? MAX_SUMMIT : limitForZone(this.zone);
    const taken: Array<[number, number]> = [];
    let placed = 0;
    const shownNow = new Set<Item>();
    for (const c of cands) {
      if (placed >= limit) break;
      // A label already shown tolerates more overlap, so it keeps its spot.
      const [hx, hy] = c.it.shown ? OVERLAP_HALF_SHOWN : OVERLAP_HALF;
      if (c.it.id !== this.selectedId && taken.some((t) => Math.abs(t[0] - c.sx) < hx && Math.abs(t[1] - c.sy) < hy)) continue;
      taken.push([c.sx, c.sy]);
      placed++;
      shownNow.add(c.it);
      const it = c.it;
      if (!it.shown) {
        if (it.hideTimer != null) {
          clearTimeout(it.hideTimer);
          it.hideTimer = null;
        }
        it.el.style.display = '';
        it.shown = true;
      }
      if ((frame + it.id) % OCCLUSION_EVERY === 0) {
        const raw = eng.occluded(it.lng, it.lat, this.elevation(it));
        if (raw === it.occlusionRaw) it.occlusionStreak++;
        else {
          it.occlusionRaw = raw;
          it.occlusionStreak = 1;
        }
        // Flip only after several consistent checks in a row, so a single
        // noisy sample near a ridgeline doesn't flicker the label.
        if (it.occlusionStreak >= OCCLUSION_HYSTERESIS) it.ghost = raw;
      }
      const eleText = this.elevation(it) > 0 ? `${Math.round(this.elevation(it)).toLocaleString('en')} m` : '';
      const text = summit
        ? `${eleText ? eleText + ' · ' : ''}${c.km < 10 ? c.km.toFixed(1) : Math.round(c.km)} km ${compassLabel(c.bearing)}${it.ghost ? ' · hidden' : ''}`
        : eleText;
      if (text !== it.lastText) {
        it.small.textContent = text;
        it.lastText = text;
      }
      it.el.style.transform = `translate(${c.sx.toFixed(1)}px, ${c.sy.toFixed(1)}px) translate(-50%, -100%) scale(${c.scale.toFixed(3)})`;
      it.el.style.opacity = it.ghost ? '0.42' : '1';
      it.el.style.zIndex = String(Math.round(2000 - c.dist));
      it.el.classList.toggle('peak-label--sel', it.id === this.selectedId);
    }
    for (const it of this.items) {
      if (it.shown && !shownNow.has(it)) {
        it.shown = false;
        it.el.style.opacity = '0';
        if (it.hideTimer != null) clearTimeout(it.hideTimer);
        it.hideTimer = setTimeout(() => {
          if (!it.shown) it.el.style.display = 'none';
          it.hideTimer = null;
        }, FADE_MS);
      }
    }
  }
}

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
  /** Elevation for placing the label: OSM `ele`, else the loaded DEM, else 0. */
  ele: number;
  el: HTMLButtonElement;
  small: HTMLElement;
  shown: boolean;
  ghost: boolean;
  lastText: string;
}

const MAX_OVERVIEW = 36;
const MAX_SUMMIT = 40;
const OCCLUSION_EVERY = 6;

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
        lastText: '',
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
    this.layer.remove();
  }

  private elevation(it: Item): number {
    if (it.ele > 0) return it.ele;
    const h = this.engine.heightAt(it.lng, it.lat);
    return h != null && h > 0 ? h : 0;
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
        bearing = initialBearingDeg([this.origin!.lng, this.origin!.lat], [it.lng, it.lat]);
        if (Math.abs(((bearing - viewBearing + 540) % 360) - 180) > 62) continue;
      }
      const pr = eng.project(it.lng, it.lat, ele, this.proj);
      if (!pr.visible) continue;
      // Summit: nearer peaks first. Overview: taller peaks first.
      const priority = summit ? km : -ele;
      const scale = summit
        ? 0.82 + Math.max(0, Math.min(1, 1 - km / SUMMIT_LABEL_RADIUS_KM)) * 0.34
        : Math.max(0.72, Math.min(1.15, 60 / pr.distanceKm + 0.6));
      cands.push({ it, p: priority, sx: pr.x, sy: pr.y, dist: pr.distanceKm, scale, bearing, km });
    }
    cands.sort((a, b) => a.p - b.p);

    const limit = summit ? MAX_SUMMIT : MAX_OVERVIEW;
    const taken: Array<[number, number]> = [];
    let placed = 0;
    const shownNow = new Set<Item>();
    for (const c of cands) {
      if (placed >= limit) break;
      if (c.it.id !== this.selectedId && taken.some((t) => Math.abs(t[0] - c.sx) < 104 && Math.abs(t[1] - c.sy) < 38)) continue;
      taken.push([c.sx, c.sy]);
      placed++;
      shownNow.add(c.it);
      const it = c.it;
      if (!it.shown) {
        it.el.style.display = '';
        it.shown = true;
      }
      if ((frame + it.id) % OCCLUSION_EVERY === 0) it.ghost = eng.occluded(it.lng, it.lat, this.elevation(it));
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
        it.el.style.display = 'none';
        it.shown = false;
      }
    }
  }
}

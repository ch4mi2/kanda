// The three.js map engine: tiles + shading + camera + frame loop. Imperative,
// owned by a thin React wrapper (ThreeView.tsx) - same split as the MapLibre
// version it replaces. Scene space is documented in geo.ts.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { DEFAULT_CENTER, MAX_ELEVATION_M, PITCH_MAX, PITCH_MIN } from '../config/tiles';
import { sunDateFromSlstMinutes, sunPosition } from '../map/sunPosition';
import { bearingOf, lngLatToScene, sceneToLngLat } from './geo';
import { Masks } from './masks';
import { CloudLayer } from './props/clouds';
import { NEAR_KM as RIVER_NEAR_KM, RiverLayer } from './props/rivers';
import { ParkLayer } from './props/parks';
import { TreeLayer } from './props/trees';
import type { RiverFeature } from '../map/water';
import type { ParkFeature } from '../map/parks';
import {
  createOceanMaterial,
  createShadowDepthMaterial,
  createSkyMaterial,
  createTerrainMaterial,
  createTerrainUniforms,
} from './shading/terrain';
import { PostPass } from './shading/post';
import { SunShadow } from './shading/shadow';
import { DEFAULT_SKIN, type Skin } from '../skins';
import { TerrainTiles } from './tiles/TerrainTiles';
import { TileSource } from './tiles/TileSource';

const DEG = Math.PI / 180;
const MAX_DIST_KM = 700;
const MIN_DIST_KM = 0.8;
/** Beyond this, shadows can't resolve anything useful (whole-island view) - turn them off. */
const SHADOW_MAX_DIST_KM = 180;
/** Where the camera starts: the central highlands, island view. */
const HOME = { lng: 80.75, lat: 7.0, distanceKm: 150, pitch: 62, bearing: -20 };

// Summit view: stand on a peak at eye level and look around.
const SUMMIT_EYE_KM = 0.05;
const SUMMIT_FOV = 62;
const SUMMIT_PITCH_MIN = -14; // degrees below the horizon
const SUMMIT_PITCH_MAX = 20;
const OVERVIEW_FOV = 45;

export interface ViewState {
  lng: number;
  lat: number;
  distanceKm: number;
  pitch: number;
  bearing: number;
}

export interface Projected {
  x: number;
  y: number;
  /** In front of the camera and on screen (with a small margin). */
  visible: boolean;
  /** Straight-line distance camera -> point, km. */
  distanceKm: number;
}

export type EngineMode = 'overview' | 'summit';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = THREE.MathUtils.lerp;

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new THREE.PerspectiveCamera(OVERVIEW_FOV, 1, 1, 4000);
  readonly tiles: TerrainTiles;
  /** Element the canvas lives in; labels mount their layer here too. */
  readonly host: HTMLElement;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private controls: MapControls;
  private dpr: number;
  private rt: THREE.WebGLRenderTarget;
  private post = new PostPass();
  private shadow: SunShadow;
  private shadowMat: THREE.ShaderMaterial;
  private u = createTerrainUniforms();
  private skySky = {
    uZen: { value: new THREE.Color() },
    uHor: { value: new THREE.Color() },
    uLow: { value: new THREE.Color() },
  };
  private sky: THREE.Mesh;
  private ocean: THREE.Mesh;
  private trees: TreeLayer;
  private clouds: CloudLayer;
  private rivers: RiverLayer;
  private parks: ParkLayer;
  private skin: Skin = DEFAULT_SKIN;
  private exaggerationMult = 1;
  private sunMinutes = 12 * 60;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private dayFactor = 1;
  private raf = 0;
  private lastT = performance.now();
  private dt = 0.016;
  private resizer: ResizeObserver;
  private disposed = false;
  private tmp = new THREE.Vector3();
  private listeners = new Set<() => void>();

  // camera animation + modes
  private mode: EngineMode = 'overview';
  private anim: ((now: number) => boolean) | null = null;
  private summit = {
    yaw: 0,
    pitch: 0,
    eye: new THREE.Vector3(),
    lng: 0,
    lat: 0,
    saved: null as null | { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number },
    pointers: new Map<number, { x: number; y: number }>(),
    pinch: 0,
  };

  constructor(container: HTMLElement, skin: Skin = DEFAULT_SKIN) {
    this.host = container;
    this.skin = skin;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    THREE.ColorManagement.enabled = false; // hex in = hex out; skins are authored in display space
    // Phones: cap pixel ratio, use cheaper MSAA and a coarser tile LOD.
    const small = Math.min(window.screen.width, window.screen.height) < 700;
    this.dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
    this.renderer.setPixelRatio(this.dpr);
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
    container.appendChild(this.canvas);

    this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: small ? 2 : 4 });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.rt.depthTexture.type = THREE.FloatType;
    this.post.uniforms.tColor.value = this.rt.texture;
    this.post.uniforms.tDepth.value = this.rt.depthTexture;

    this.shadow = new SunShadow(small ? 1024 : 2048);
    this.u.tShadow.value = this.shadow.target.depthTexture;
    this.u.uShadowTexel.value = 1 / this.shadow.size;
    this.shadowMat = createShadowDepthMaterial(this.u);

    this.tiles = new TerrainTiles(new TileSource(), createTerrainMaterial(this.u));
    if (small) this.tiles.splitPx = 3.4;
    this.scene.add(this.tiles.group);
    const masks = new Masks();
    this.trees = new TreeLayer(masks, this.u);
    this.clouds = new CloudLayer(this.u);
    this.rivers = new RiverLayer(this.u);
    this.parks = new ParkLayer(this.u);
    this.scene.add(this.trees.group, this.clouds.group, this.rivers.group, this.parks.group);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), createSkyMaterial(this.u, this.skySky));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2).translate(0, -0.03, 0),
      createOceanMaterial(this.u),
    );
    this.ocean.frustumCulled = false;
    this.scene.add(this.ocean);

    this.controls = new MapControls(this.camera, this.canvas);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = false;
    c.zoomToCursor = true;
    c.minDistance = MIN_DIST_KM;
    c.maxDistance = MAX_DIST_KM;
    c.minPolarAngle = PITCH_MIN * DEG;
    c.maxPolarAngle = PITCH_MAX * DEG;
    // Google Earth scheme: left = pan, right / middle = rotate + tilt, wheel = zoom.
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

    this.bindSummitInput();
    this.setView(HOME);
    this.applySkin(skin);
    this.setSunMinutes(this.sunMinutes);

    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---- lighting / skin ----

  setSunMinutes(minutes: number) {
    this.sunMinutes = minutes;
    const p = sunPosition(sunDateFromSlstMinutes(minutes), DEFAULT_CENTER[1], DEFAULT_CENTER[0]);
    // Light as if the sun were at least 8 deg up so equatorial noon / dusk still cast.
    const alt = Math.min(70, Math.max(8, p.altitudeDeg)) * DEG;
    const az = p.azimuthDeg * DEG;
    this.sunDir.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)).normalize();
    this.u.uSun.value.copy(this.sunDir);
    const t = Math.min(1, Math.max(0, (p.altitudeDeg + 4) / 12));
    this.dayFactor = t * t * (3 - 2 * t);
    this.refreshColors();
    this.shadow.invalidate();
  }

  /** Multiplier on the skin's own vertical exaggeration (UI slider, 1 = as authored). */
  setExaggeration(mult: number) {
    this.exaggerationMult = mult;
    this.applyExaggeration();
  }

  applySkin(skin: Skin) {
    this.skin = skin;
    const u = this.u;
    u.uCel.value = skin.cel ? 1 : 0;
    u.uBands.value = skin.celBands;
    u.uCelSoft.value = skin.celSoftness;
    u.uWrap.value = skin.wrap;
    u.uRim.value = skin.rim;
    u.uFogDen.value = skin.fogDensity;
    u.uFogStart.value = skin.fogStart;
    u.uPatch.value = skin.patch;
    u.uRockSlope.value = skin.rockSlope;
    u.uSnowLine.value = skin.snowLine;
    u.uCliff.value = skin.cliff ? 1 : 0;
    u.uFoamAmt.value = skin.foamAmount;
    u.uWaterMode.value = skin.waterMode;
    u.uFogBands.value = skin.fogBands;
    u.uFlat.value = skin.geometry === 'smooth' ? 0 : 1;
    u.uTerrace.value = skin.geometry === 'terrace' ? 1 : 0;
    this.trees.setStyle(skin.trees);
    this.clouds.setStyle(skin.clouds);
    this.rivers.setColor(skin.river);
    this.parks.setColor(skin.park);
    this.post.applySkin(skin, this.dpr);
    this.applyExaggeration();
    this.refreshColors();
    this.shadow.invalidate();
    const s = this.host.style;
    s.setProperty('--label-color', skin.labelColor);
    s.setProperty('--label-halo', skin.labelHalo);
    s.setProperty('--label-font', skin.labelFont);
    s.setProperty('--water-label-color', skin.waterLabel);
    s.setProperty('--river-label-color', skin.river);
    s.setProperty('--waterfall-label-color', skin.waterfall);
  }

  get currentSkin(): Skin {
    return this.skin;
  }

  /** Loads the river lines once src/data/rivers.geojson has been fetched. */
  setRivers(features: RiverFeature[]) {
    this.rivers.setFeatures(features, this.tiles);
  }

  /** The "Water" layer toggle: rivers + their name labels (the lake tint
   *  baked into masks.png is unaffected - it's part of the terrain itself). */
  setWaterVisible(visible: boolean) {
    this.rivers.group.visible = visible;
  }

  /** Loads the park/protected-area outlines once src/data/parks.geojson has
   *  been fetched. Always on, like the lake tint - no layer toggle (#26). */
  setParks(features: ParkFeature[]) {
    this.parks.setFeatures(features, this.tiles);
  }

  /** True once enough terrain has loaded to show something. */
  get ready(): boolean {
    return this.tiles.stats.drawn >= 3;
  }

  /** Distance from the camera to its orbit pivot, km. */
  get orbitDistanceKm(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  get currentMode(): EngineMode {
    return this.mode;
  }

  // ---- camera state ----

  /** Compass bearing the camera faces, degrees -180..180. */
  getBearing(): number {
    if (this.mode === 'summit') return this.summit.yaw;
    const t = this.controls.target;
    return bearingOf(t.x - this.camera.position.x, t.z - this.camera.position.z);
  }

  /** Degrees from straight down (0 = overhead, 90 = horizon). */
  getPitch(): number {
    return this.controls.getPolarAngle() / DEG;
  }

  getView(): ViewState {
    const t = this.controls.target;
    const [lng, lat] = sceneToLngLat(t.x, t.z);
    return { lng, lat, distanceKm: this.camera.position.distanceTo(t), pitch: this.getPitch(), bearing: this.getBearing() };
  }

  /** Jump the orbit camera to a view (overview mode). */
  setView(v: Partial<ViewState> & { lng: number; lat: number }) {
    const cur = this.getViewSafe();
    const s = { ...cur, ...v };
    const g = lngLatToScene(s.lng, s.lat);
    const ground = Math.max(0, ((this.tiles.heightAt(g.x, g.z) ?? 0) / 1000) * this.effectiveExaggeration());
    const polar = s.pitch * DEG;
    const bearing = s.bearing * DEG;
    const fwdX = Math.sin(bearing);
    const fwdZ = -Math.cos(bearing);
    const d = s.distanceKm;
    this.controls.target.set(g.x, ground, g.z);
    this.camera.position.set(
      g.x - fwdX * d * Math.sin(polar),
      ground + d * Math.cos(polar),
      g.z - fwdZ * d * Math.sin(polar),
    );
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  /** Smoothly move the orbit camera to a view. */
  flyTo(v: Partial<ViewState> & { lng: number; lat: number }, durationMs = 1600, arc = true) {
    if (this.mode !== 'overview') return;
    const from = this.getView();
    const to = { ...from, ...v };
    const dB = ((to.bearing - from.bearing + 540) % 360) - 180;
    const start = performance.now();
    this.controls.enabled = false;
    this.anim = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const e = ease(t);
      const dist = Math.exp(lerp(Math.log(from.distanceKm), Math.log(to.distanceKm), e));
      this.setView({
        lng: lerp(from.lng, to.lng, e),
        lat: lerp(from.lat, to.lat, e),
        distanceKm: dist * (arc ? 1 + 0.5 * Math.sin(Math.PI * e) : 1),
        pitch: lerp(from.pitch, to.pitch, e),
        bearing: from.bearing + dB * e,
      });
      if (t >= 1) {
        this.controls.enabled = true;
        return true;
      }
      return false;
    };
  }

  /** Zoom the orbit camera by a distance factor (< 1 = closer). */
  zoomBy(factor: number) {
    if (this.mode !== 'overview') return;
    const v = this.getView();
    this.flyTo({ ...v, distanceKm: THREE.MathUtils.clamp(v.distanceKm * factor, MIN_DIST_KM, MAX_DIST_KM) }, 450, false);
  }

  /** Face north at the resting tilt. */
  resetNorth() {
    if (this.mode !== 'overview') return;
    this.flyTo({ ...this.getView(), bearing: 0, pitch: HOME.pitch }, 700, false);
  }

  /** Turn to face `bearing` (overview: orbit around the target; summit: yaw in place). */
  lookToward(bearing: number, durationMs = 700) {
    const from = this.getBearing();
    const dB = ((bearing - from + 540) % 360) - 180;
    const start = performance.now();
    if (this.mode === 'summit') {
      this.anim = (now) => {
        const t = Math.min(1, (now - start) / durationMs);
        this.summit.yaw = from + dB * ease(t);
        return t >= 1;
      };
      return;
    }
    const v = this.getView();
    this.controls.enabled = false;
    this.anim = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      this.setView({ ...v, bearing: from + dB * ease(t) });
      if (t >= 1) {
        this.controls.enabled = true;
        return true;
      }
      return false;
    };
  }

  // ---- summit view ----

  /** Fly onto a summit and stand there; drag to look around. */
  enterSummit(peak: { lng: number; lat: number; ele: number | null }) {
    if (this.mode !== 'overview') return;
    const cam = this.camera;
    const s = this.summit;
    s.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    s.lng = peak.lng;
    s.lat = peak.lat;
    s.yaw = this.getBearing();
    s.pitch = 0;
    s.eye.copy(this.summitEye());
    const from = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    const goalQuat = this.summitQuat(s.yaw, 0);
    const start = performance.now();
    this.controls.enabled = false;
    this.mode = 'summit'; // frame() now keeps the eye on the ground and ignores the orbit controls
    this.anim = (now) => {
      const t = Math.min(1, (now - start) / 2200);
      const e = ease(t);
      cam.position.lerpVectors(from.pos, s.eye, e);
      cam.quaternion.slerpQuaternions(from.quat, goalQuat, e);
      cam.fov = lerp(from.fov, SUMMIT_FOV, e);
      cam.updateProjectionMatrix();
      return t >= 1;
    };
  }

  exitSummit() {
    const s = this.summit;
    if (this.mode !== 'summit' || !s.saved) return;
    const cam = this.camera;
    const from = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    const to = s.saved;
    const start = performance.now();
    this.anim = (now) => {
      const t = Math.min(1, (now - start) / 1800);
      const e = ease(t);
      cam.position.lerpVectors(from.pos, to.pos, e);
      cam.quaternion.slerpQuaternions(from.quat, to.quat, e);
      cam.fov = lerp(from.fov, to.fov, e);
      cam.updateProjectionMatrix();
      if (t >= 1) {
        this.mode = 'overview';
        s.saved = null;
        this.controls.enabled = true;
        this.shadow.invalidate();
        return true;
      }
      return false;
    };
  }

  private summitEye(): THREE.Vector3 {
    const s = this.summit;
    const p = lngLatToScene(s.lng, s.lat);
    // The DEM's local high point is rarely exactly on the OSM coordinate: stand
    // above the highest ground within ~250 m so no ridge is above the eye.
    let top = 0;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        top = Math.max(top, this.tiles.heightAt(p.x + dx * 0.085, p.z + dz * 0.085) ?? 0);
      }
    }
    const ground = (top / 1000) * this.effectiveExaggeration();
    return new THREE.Vector3(p.x, ground + SUMMIT_EYE_KM, p.z);
  }

  private summitQuat(yawDeg: number, pitchDeg: number): THREE.Quaternion {
    const b = yawDeg * DEG;
    const p = pitchDeg * DEG;
    const dir = new THREE.Vector3(Math.sin(b) * Math.cos(p), Math.sin(p), -Math.cos(b) * Math.cos(p));
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  private bindSummitInput() {
    const c = this.canvas;
    const s = this.summit;
    c.addEventListener('pointerdown', (ev) => {
      if (this.mode !== 'summit' || this.anim) return;
      try {
        c.setPointerCapture(ev.pointerId);
      } catch {
        /* synthetic / already-released pointer: dragging still works without capture */
      }
      s.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (s.pointers.size === 2) s.pinch = this.pinchDistance();
    });
    c.addEventListener('pointermove', (ev) => {
      const prev = s.pointers.get(ev.pointerId);
      if (this.mode !== 'summit' || !prev) return;
      if (s.pointers.size >= 2) {
        s.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        const d = this.pinchDistance();
        if (s.pinch > 0 && d > 0) this.setSummitFov(this.camera.fov * (s.pinch / d));
        s.pinch = d;
        return;
      }
      // Grab-the-world (CLAUDE.md gotcha #11): the point under the finger follows the finger.
      const degPerPx = this.camera.fov / Math.max(1, this.host.clientHeight);
      s.yaw -= (ev.clientX - prev.x) * degPerPx;
      s.pitch = THREE.MathUtils.clamp(s.pitch + (ev.clientY - prev.y) * degPerPx, SUMMIT_PITCH_MIN, SUMMIT_PITCH_MAX);
      s.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    });
    const up = (ev: PointerEvent) => {
      s.pointers.delete(ev.pointerId);
      s.pinch = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (ev) => {
        if (this.mode !== 'summit') return;
        ev.preventDefault();
        this.setSummitFov(this.camera.fov * (1 + Math.sign(ev.deltaY) * 0.08));
      },
      { passive: false },
    );
    window.addEventListener('keydown', this.onKey);

    // Orbit view: OrbitControls' two-finger gesture only rotates by dragging the midpoint, which
    // fights pinch-zoom. Add a twist: rotate the camera around the pivot by the change in the
    // angle between the two fingers (the map turns with your fingers).
    const touches = new Map<number, { x: number; y: number }>();
    let twist: number | null = null;
    const twistAngle = () => {
      const [a, b] = [...touches.values()];
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    c.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch') return;
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      twist = touches.size === 2 ? twistAngle() : null;
    });
    c.addEventListener('pointermove', (ev) => {
      if (this.mode === 'summit' || !touches.has(ev.pointerId)) return;
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size !== 2 || twist === null) return;
      const next = twistAngle();
      let d = next - twist;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      twist = next;
      const t = this.controls.target;
      this.camera.position.sub(t).applyAxisAngle(new THREE.Vector3(0, 1, 0), d).add(t);
    });
    const endTouch = (ev: PointerEvent) => {
      touches.delete(ev.pointerId);
      twist = null;
    };
    c.addEventListener('pointerup', endTouch);
    c.addEventListener('pointercancel', endTouch);
  }

  private onKey = (ev: KeyboardEvent) => {
    if (this.mode !== 'summit' || this.anim) return;
    const s = this.summit;
    const step = this.camera.fov / 30;
    if (ev.key === 'ArrowLeft') s.yaw -= step;
    else if (ev.key === 'ArrowRight') s.yaw += step;
    else if (ev.key === 'ArrowUp') s.pitch = Math.min(SUMMIT_PITCH_MAX, s.pitch + step);
    else if (ev.key === 'ArrowDown') s.pitch = Math.max(SUMMIT_PITCH_MIN, s.pitch - step);
  };

  private pinchDistance(): number {
    const pts = [...this.summit.pointers.values()];
    return pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  }

  private setSummitFov(fov: number) {
    this.camera.fov = THREE.MathUtils.clamp(fov, 24, 80);
    this.camera.updateProjectionMatrix();
  }

  // ---- queries ----

  /** Terrain height in metres at lng/lat (null until tiles covering it load). */
  heightAt(lng: number, lat: number): number | null {
    const p = lngLatToScene(lng, lat);
    return this.tiles.heightAt(p.x, p.z);
  }

  /** Project a lng/lat/elevation (true metres - exaggeration applied here) to screen px. */
  project(lng: number, lat: number, elevationM: number, out: Projected): Projected {
    const p = lngLatToScene(lng, lat);
    this.tmp.set(p.x, (elevationM / 1000) * this.effectiveExaggeration(), p.z);
    out.distanceKm = this.camera.position.distanceTo(this.tmp);
    this.tmp.project(this.camera);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    out.x = (this.tmp.x * 0.5 + 0.5) * w;
    out.y = (-this.tmp.y * 0.5 + 0.5) * h;
    out.visible = this.tmp.z < 1 && out.x > -60 && out.x < w + 60 && out.y > -40 && out.y < h + 40;
    return out;
  }

  /** Is the straight line from the camera to a point blocked by terrain? */
  occluded(lng: number, lat: number, elevationM: number): boolean {
    const to = lngLatToScene(lng, lat);
    const exag = this.effectiveExaggeration() / 1000;
    const from = this.camera.position;
    const toY = elevationM * exag;
    const n = 40;
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    for (let k = 3; k < n - 1; k++) {
      const t = k / n;
      if (t * dist < 0.4) continue; // your own summit is not "a ridge in the way"
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const ground = this.tiles.heightAt(x, z);
      if (ground == null) continue;
      if (ground * exag > from.y + (toY - from.y) * t + 0.03) return true;
    }
    return false;
  }

  effectiveExaggeration(): number {
    return this.skin.exaggeration * this.exaggerationMult;
  }

  /** Subscribe to once-per-frame notifications (labels, compass). */
  onFrame(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.resizer.disconnect();
    this.controls.dispose();
    this.tiles.dispose();
    this.rivers.dispose();
    this.parks.dispose();
    this.shadow.dispose();
    this.rt.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---- internals ----

  private getViewSafe(): ViewState {
    return this.camera.position.distanceTo(this.controls.target) > 1e-6 ? this.getView() : { ...HOME };
  }

  private applyExaggeration() {
    const e = this.effectiveExaggeration();
    this.u.uExag.value = e;
    this.tiles.exaggeration = e;
    this.shadow.invalidate();
  }

  /** Skin colours dimmed by how high the sun is (dusk/dawn/night). */
  private refreshColors() {
    const s = this.skin;
    const u = this.u;
    const day = this.dayFactor;
    const dim = (hex: string, k: number, out: THREE.Color) => out.set(hex).multiplyScalar(THREE.MathUtils.lerp(k, 1, day));
    dim(s.sunColor, 0.15, u.uSunCol.value);
    dim(s.shade, 0.45, u.uShade.value);
    dim(s.fog, 0.18, u.uFog.value);
    u.uGrassLo.value.set(s.grassLow);
    u.uGrassHi.value.set(s.grassHigh);
    u.uForest.value.set(s.forest);
    u.uRock.value.set(s.rock);
    u.uSnow.value.set(s.snow);
    u.uCliffCol.value.set(s.cliffColor);
    u.uWater.value.set(s.water);
    u.uWaterHi.value.set(s.waterHigh);
    u.uWaterDeep.value.set(s.waterDeep);
    u.uFoam.value.set(s.foam);
    dim(s.zenith, 0.1, this.skySky.uZen.value);
    dim(s.horizon, 0.16, this.skySky.uHor.value);
    dim(s.seaDeep, 0.2, this.skySky.uLow.value);
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pw = Math.round(w * this.dpr);
    const ph = Math.round(h * this.dpr);
    this.rt.setSize(pw, ph);
    this.post.uniforms.uRes.value.set(pw, ph);
  }

  private loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = performance.now();
    const dt = Math.min((t - this.lastT) / 1000, 0.25);
    this.lastT = t;
    this.dt = dt;
    this.u.uTime.value += dt;
    this.frame();
    for (const fn of this.listeners) fn();
  }

  private frame() {
    const cam = this.camera;
    const ctl = this.controls;
    const exag = this.effectiveExaggeration();
    const now = performance.now();
    const summit = this.mode === 'summit';

    if (this.anim && this.anim(now)) this.anim = null;

    if (summit) {
      const s = this.summit;
      if (!this.anim) {
        // Hold the eye just above the (still refining) ground; look where yaw/pitch say.
        const eyeY = this.summitEye().y;
        s.eye.y += (eyeY - s.eye.y) * (1 - Math.exp(-this.dt * 10));
        cam.position.copy(s.eye);
        cam.quaternion.copy(this.summitQuat(s.yaw, s.pitch));
      }
    } else if (!this.anim) {
      // Keep the orbit pivot on the ground under it, shifting camera and target
      // together - but on a smoothed, scale-aware sample (averaged over a patch,
      // read at a fixed coarse zoom) eased in over ~0.8s, not the raw per-frame
      // DEM height. The raw sample jumps over every ridge while panning and
      // again whenever a finer tile loads in (CLAUDE.md "camera bob").
      const pivotDist = cam.position.distanceTo(ctl.target);
      const zoom = pivotDist < 60 ? 11 : 9;
      const radius = Math.max(1.5, pivotDist * 0.12);
      const g = this.tiles.groundHeightNear(ctl.target.x, ctl.target.z, radius, zoom);
      if (g != null) {
        const want = (Math.max(g, 0) / 1000) * exag;
        const dy = (want - ctl.target.y) * (1 - Math.exp(-this.dt / 0.8));
        ctl.target.y += dy;
        cam.position.y += dy;
      }
      ctl.update();
    }
    // Never let the camera sink into the ground - ease it up rather than snap,
    // and only near the ground, so a refining tile doesn't yank the camera.
    const under = this.tiles.heightAt(cam.position.x, cam.position.z);
    if (under != null && !summit) {
      const floor = (Math.max(under, 0) / 1000) * exag + 0.03;
      const gap = cam.position.y - floor;
      if (gap < 0) {
        // A small dip (LOD noise nudging the sample) eases up smoothly; a big
        // one (e.g. a teleport) still snaps, so the camera never stays buried.
        if (gap > -0.15) cam.position.y += (floor - cam.position.y) * (1 - Math.exp(-this.dt / 0.3));
        else cam.position.y = floor;
      }
    }

    // Depth range follows how close the camera is to the surface.
    const dist = summit ? 1 : cam.position.distanceTo(ctl.target);
    const alt = under != null ? cam.position.y - (Math.max(under, 0) / 1000) * exag : cam.position.y;
    cam.near = THREE.MathUtils.clamp(Math.min(dist * 0.01, alt * 0.25), 0.005, 2);
    cam.far = 4000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.sky.scale.setScalar(cam.far * 0.9);
    this.sky.position.copy(cam.position);
    this.ocean.position.x = cam.position.x;
    this.ocean.position.z = cam.position.z;
    this.post.uniforms.uNear.value = cam.near;
    this.post.uniforms.uFar.value = cam.far;
    // Ridge outlines are what separate your own summit from the ones behind it.
    this.post.uniforms.uOutline.value = summit ? Math.max(this.skin.outline, 0.55) : this.skin.outline;
    this.post.uniforms.uTilt.value = summit ? 0 : this.skin.tiltShift;

    this.tiles.update(cam, this.host.clientHeight);
    this.trees.update(cam.position, this.tiles.rendered);
    this.clouds.group.visible = this.skin.clouds != null && !summit;
    this.clouds.update(this.dt, cam.position, (MAX_ELEVATION_M / 1000) * exag);
    this.rivers.update(summit ? RIVER_NEAR_KM : this.orbitDistanceKm, now, this.tiles);
    this.parks.update(now, this.tiles);
    this.renderShadow(exag);
    this.tiles.settle();

    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(null);
    this.post.render(this.renderer);
  }

  private renderShadow(exag: number) {
    const cam = this.camera;
    const ctl = this.controls;
    const summit = this.mode === 'summit';
    const dist = summit ? 0 : cam.position.distanceTo(ctl.target);
    if (!summit && dist > SHADOW_MAX_DIST_KM) {
      // Whole-island view: nothing at this scale would resolve a shadow anyway.
      this.u.uShadowOn.value = 0;
      return;
    }
    let R: number;
    const center = this.tmp.set(ctl.target.x, 0, ctl.target.z);
    if (summit) {
      // Shadows on the ranges around the eye, biased toward where you are looking.
      R = 60;
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const h = Math.hypot(f.x, f.z) || 1;
      center.set(cam.position.x + (f.x / h) * R * 0.5, 0, cam.position.z + (f.z / h) * R * 0.5);
    } else {
      R = THREE.MathUtils.clamp(dist * 0.5, 20, 80);
    }
    const maxH = (MAX_ELEVATION_M / 1000) * exag + 0.2;

    // Match the shadow mesh's zoom to what the main pass actually draws near
    // the pivot - a shadow mesh coarser than the main mesh makes the finer
    // receiver shadow itself (CLAUDE.md "shadow box").
    const focalPx = this.host.clientHeight / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const mainZoomEstimate = this.tiles.estimateZoom(summit ? 1 : dist, focalPx);
    const shadowZoom = THREE.MathUtils.clamp(mainZoomEstimate, 9, 12);

    const fit = this.shadow.fit(center, R, this.sunDir, maxH, shadowZoom);
    const meshes = this.tiles.shadowMeshes(fit.rect[0], fit.rect[1], fit.rect[2], fit.rect[3], fit.zoom);
    if (!this.shadow.needsRender(fit.signature, meshes.length)) return;

    const children = this.tiles.group.children as THREE.Mesh[];
    const was = children.map((m) => m.visible);
    for (const m of children) m.visible = false;
    for (const m of meshes) m.visible = true;
    const sceneVis = [
      this.sky.visible,
      this.ocean.visible,
      this.trees.group.visible,
      this.clouds.group.visible,
      this.rivers.group.visible,
    ];
    this.sky.visible = this.ocean.visible = this.trees.group.visible = this.clouds.group.visible = this.rivers.group.visible = false;
    this.scene.overrideMaterial = this.shadowMat;
    this.renderer.setRenderTarget(this.shadow.target);
    this.renderer.render(this.scene, this.shadow.camera);
    this.renderer.setRenderTarget(null);
    this.scene.overrideMaterial = null;
    [this.sky.visible, this.ocean.visible, this.trees.group.visible, this.clouds.group.visible, this.rivers.group.visible] =
      sceneVis;
    children.forEach((m, i) => (m.visible = was[i]));

    this.u.uShadowMat.value.copy(this.shadow.matrix);
    // Bias covers whichever mesh (shadow or main) is coarser, so neither a
    // finer shadow mesh nor a finer main mesh self-shadows against the other.
    const biasKm =
      Math.max(SunShadow.spacingKm(shadowZoom), SunShadow.spacingKm(mainZoomEstimate)) * 0.45 * (exag / 2.6) + 0.02;
    this.u.uShadowBias.value = biasKm / this.shadow.depthRangeKm;
    this.u.uShadowNormalOffset.value = 1.5 * fit.texelKm;
    this.u.uShadowOn.value = meshes.length ? 1 : 0;
  }
}

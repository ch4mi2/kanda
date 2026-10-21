// The three.js map engine: tiles + shading + camera + frame loop. Imperative,
// owned by a thin React wrapper (ThreeView.tsx) - same split as the MapLibre
// version it replaces. Scene space is documented in geo.ts.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { DEFAULT_CENTER, MAX_ELEVATION_M, PITCH_MAX, PITCH_MIN } from '../config/tiles';
import { sunDateFromSlstMinutes, sunPosition } from '../map/sunPosition';
import { bearingOf, lngLatToScene, sceneToLngLat } from './geo';
import {
  createOceanMaterial,
  createShadowDepthMaterial,
  createSkyMaterial,
  createTerrainMaterial,
  createTerrainUniforms,
} from './shading/terrain';
import { PostPass } from './shading/post';
import { SunShadow } from './shading/shadow';
import { DEFAULT_SKIN, type Skin } from './skins';
import { TerrainTiles } from './tiles/TerrainTiles';
import { TileSource } from './tiles/TileSource';

const DEG = Math.PI / 180;
const MAX_DIST_KM = 700;
const MIN_DIST_KM = 0.8;
/** Where the camera starts: the central highlands, island view. */
const HOME = { lng: 80.75, lat: 7.0, distanceKm: 150, pitch: 62, bearing: -20 };

export interface ViewState {
  lng: number;
  lat: number;
  distanceKm: number;
  pitch: number;
  bearing: number;
}

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 4000);
  readonly tiles: TerrainTiles;

  private container: HTMLElement;
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
  private skin: Skin = DEFAULT_SKIN;
  private exaggerationMult = 1;
  private sunMinutes = 12 * 60;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private dayFactor = 1;
  private raf = 0;
  private clock = new THREE.Clock();
  private resizer: ResizeObserver;
  private disposed = false;
  private tmp = new THREE.Vector3();
  private listeners = new Set<() => void>();

  constructor(container: HTMLElement, skin: Skin = DEFAULT_SKIN) {
    this.container = container;
    this.skin = skin;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    THREE.ColorManagement.enabled = false; // hex in = hex out; skins are authored in display space
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
    container.appendChild(this.canvas);

    this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.rt.depthTexture.type = THREE.FloatType;
    this.post.uniforms.tColor.value = this.rt.texture;
    this.post.uniforms.tDepth.value = this.rt.depthTexture;

    const small = Math.min(window.screen.width, window.screen.height) < 700;
    this.shadow = new SunShadow(small ? 1024 : 2048);
    this.u.tShadow.value = this.shadow.target.depthTexture;
    this.u.uShadowTexel.value = 1 / this.shadow.size;
    this.shadowMat = createShadowDepthMaterial(this.u);

    this.tiles = new TerrainTiles(new TileSource(), createTerrainMaterial(this.u));
    this.scene.add(this.tiles.group);

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

    this.setView(HOME);
    this.applySkin(skin);
    this.setSunMinutes(this.sunMinutes);

    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---- public API ----

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
    this.post.applySkin(skin, this.dpr);
    this.applyExaggeration();
    this.refreshColors();
    this.shadow.invalidate();
  }

  getBearing(): number {
    const t = this.controls.target;
    return bearingOf(t.x - this.camera.position.x, t.z - this.camera.position.z);
  }

  /** Degrees from straight down (0 = overhead, 90 = horizon), MapLibre-style pitch. */
  getPitch(): number {
    return this.controls.getPolarAngle() / DEG;
  }

  getView(): ViewState {
    const t = this.controls.target;
    const [lng, lat] = sceneToLngLat(t.x, t.z);
    return { lng, lat, distanceKm: this.camera.position.distanceTo(t), pitch: this.getPitch(), bearing: this.getBearing() };
  }

  setView(v: Partial<ViewState> & { lng: number; lat: number }) {
    const cur = this.getViewSafe();
    const s = { ...cur, ...v };
    const g = lngLatToScene(s.lng, s.lat);
    const ground = (this.tiles.heightAt(g.x, g.z) ?? 0) / 1000 * this.effectiveExaggeration();
    const polar = s.pitch * DEG;
    const bearing = s.bearing * DEG;
    const fwdX = Math.sin(bearing);
    const fwdZ = -Math.cos(bearing);
    const d = s.distanceKm;
    this.controls.target.set(g.x, Math.max(0, ground), g.z);
    this.camera.position.set(
      g.x - fwdX * d * Math.sin(polar),
      Math.max(0, ground) + d * Math.cos(polar),
      g.z - fwdZ * d * Math.sin(polar),
    );
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  /** Terrain height in metres at lng/lat (null until tiles covering it load). */
  heightAt(lng: number, lat: number): number | null {
    const p = lngLatToScene(lng, lat);
    return this.tiles.heightAt(p.x, p.z);
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
    this.resizer.disconnect();
    this.controls.dispose();
    this.tiles.dispose();
    this.shadow.dispose();
    this.rt.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---- internals ----

  private getViewSafe(): ViewState {
    return this.camera.position.distanceTo(this.controls.target) > 1e-6
      ? this.getView()
      : { ...HOME };
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
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
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
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.u.uTime.value += dt;
    this.frame();
    for (const fn of this.listeners) fn();
  }

  private frame() {
    const cam = this.camera;
    const ctl = this.controls;
    const exag = this.effectiveExaggeration();

    // Keep the orbit pivot on the ground under it: shift camera and target together.
    const g = this.tiles.heightAt(ctl.target.x, ctl.target.z);
    if (g != null) {
      const want = (Math.max(g, 0) / 1000) * exag;
      const dy = (want - ctl.target.y) * 0.2;
      ctl.target.y += dy;
      cam.position.y += dy;
    }
    ctl.update();
    // Never let the camera sink into the ground.
    const under = this.tiles.heightAt(cam.position.x, cam.position.z);
    if (under != null) {
      const floor = (Math.max(under, 0) / 1000) * exag + 0.03;
      if (cam.position.y < floor) cam.position.y = floor;
    }

    // Depth range follows how close the camera is to the surface.
    const dist = cam.position.distanceTo(ctl.target);
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

    this.tiles.update(cam, this.container.clientHeight);
    this.renderShadow(exag);
    this.tiles.settle();

    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(null);
    this.post.render(this.renderer);
  }

  private renderShadow(exag: number) {
    const ctl = this.controls;
    const R = THREE.MathUtils.clamp(this.camera.position.distanceTo(ctl.target) * 0.5, 20, 80);
    const maxH = (MAX_ELEVATION_M / 1000) * exag + 0.2;
    const fit = this.shadow.fit(this.tmp.set(ctl.target.x, 0, ctl.target.z), R, this.sunDir, maxH);
    const meshes = this.tiles.shadowMeshes(fit.rect[0], fit.rect[1], fit.rect[2], fit.rect[3], fit.zoom);
    if (!this.shadow.needsRender(fit.signature, meshes.length)) return;

    const children = this.tiles.group.children as THREE.Mesh[];
    const was = children.map((m) => m.visible);
    for (const m of children) m.visible = false;
    for (const m of meshes) m.visible = true;
    const sceneVis = [this.sky.visible, this.ocean.visible];
    this.sky.visible = this.ocean.visible = false;
    this.scene.overrideMaterial = this.shadowMat;
    this.renderer.setRenderTarget(this.shadow.target);
    this.renderer.render(this.scene, this.shadow.camera);
    this.renderer.setRenderTarget(null);
    this.scene.overrideMaterial = null;
    [this.sky.visible, this.ocean.visible] = sceneVis;
    children.forEach((m, i) => (m.visible = was[i]));

    this.u.uShadowMat.value.copy(this.shadow.matrix);
    // Coarse shadow mesh vs finer main mesh: tolerate ~35% of the vertex spacing, exaggerated.
    const biasKm = SunShadow.spacingKm(fit.zoom) * 0.35 * (exag / 2.6) + 0.02;
    this.u.uShadowBias.value = biasKm / this.shadow.depthRangeKm;
    this.u.uShadowOn.value = meshes.length ? 1 : 0;
  }
}

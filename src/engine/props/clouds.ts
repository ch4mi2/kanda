// A few smooth puffs drifting over the island, high above the (exaggerated)
// peaks. Cel or soft shading per skin; fogged like everything else.

import * as THREE from 'three';
import type { CloudStyle } from '../../skins';
import type { TerrainUniforms } from '../shading/terrain';
import { COMMON_GLSL } from '../shading/terrain';

const COUNT = 16;
const SPREAD_KM = 170;

interface Puff {
  group: THREE.Group;
  speed: number;
  lift: number;
}

export class CloudLayer {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private material: THREE.ShaderMaterial;

  constructor(u: TerrainUniforms) {
    this.group.visible = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...u,
        uCloudLit: { value: new THREE.Color('#fff') },
        uCloudShade: { value: new THREE.Color('#ccc') },
        uCloudCel: { value: 0 },
      },
      vertexShader: `varying vec3 vW; varying vec3 vN;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uCloudLit, uCloudShade; uniform float uCloudCel; varying vec3 vW; varying vec3 vN;
        ${COMMON_GLSL}
        void main(){
          float l = dot(normalize(vN), uSun);
          float t = uCloudCel > .5 ? smoothstep(.0, .06, l) : smoothstep(-.3, .7, l);
          gl_FragColor = vec4(fogIt(mix(uCloudShade, uCloudLit, t), vW), 1.);
        }`,
    });
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const puff = new THREE.IcosahedronGeometry(1, 3);
    for (let c = 0; c < COUNT; c++) {
      const g = new THREE.Group();
      for (let k = 0, n = 4 + ((rnd() * 3) | 0); k < n; k++) {
        const r = 1.2 + rnd() * 1.6;
        const m = new THREE.Mesh(puff, this.material);
        m.scale.set(r, r * 0.8, r);
        m.position.set((k - n / 2) * 2.1 + rnd(), (1 - Math.abs(k - n / 2) / n) * 1.2 + rnd() * 0.5, rnd() * 1.5 - 0.7);
        g.add(m);
      }
      g.position.set((rnd() - 0.5) * 2 * SPREAD_KM, 0, (rnd() - 0.5) * 2 * SPREAD_KM);
      this.puffs.push({ group: g, speed: 0.25 + rnd() * 0.3, lift: rnd() * 3 });
      this.group.add(g);
    }
  }

  setStyle(style: CloudStyle | null) {
    this.group.visible = style != null;
    if (!style) return;
    const u = this.material.uniforms;
    u.uCloudLit.value.set(style.lit);
    u.uCloudShade.value.set(style.shaded);
    u.uCloudCel.value = style.cel ? 1 : 0;
  }

  /** Drift east, wrap around the camera's neighbourhood, hover above the peaks. */
  update(dt: number, centre: THREE.Vector3, peakTopKm: number) {
    if (!this.group.visible) return;
    for (const p of this.puffs) {
      p.group.position.x += p.speed * dt;
      const dx = p.group.position.x - centre.x;
      if (dx > SPREAD_KM) p.group.position.x -= 2 * SPREAD_KM;
      else if (dx < -SPREAD_KM) p.group.position.x += 2 * SPREAD_KM;
      const dz = p.group.position.z - centre.z;
      if (dz > SPREAD_KM) p.group.position.z -= 2 * SPREAD_KM;
      else if (dz < -SPREAD_KM) p.group.position.z += 2 * SPREAD_KM;
      p.group.position.y = peakTopKm + 1.8 + p.lift;
    }
  }
}

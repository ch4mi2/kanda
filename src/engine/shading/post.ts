// One fullscreen pass after the scene: depth-based ridge outlines, tilt-shift,
// and the skin's colour grade.

import * as THREE from 'three';
import type { Skin } from '../skins';

export class PostPass {
  readonly uniforms = {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uOutline: { value: 0 },
    uOutlineCol: { value: new THREE.Color('#000') },
    uThick: { value: 1 },
    uTilt: { value: 0 },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uVig: { value: 0 },
  };
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: /* glsl */ `#include <packing>
        uniform sampler2D tColor, tDepth; uniform vec2 uRes;
        uniform float uNear,uFar,uOutline,uThick,uTilt,uSat,uContrast,uVig; uniform vec3 uOutlineCol;
        varying vec2 vUv;
        float iz(vec2 uv){ float d = texture2D(tDepth, uv).x; return 1./max(-perspectiveDepthToViewZ(d, uNear, uFar), 1e-4); }
        void main(){
          vec2 px = 1./uRes;
          float b = uTilt * smoothstep(.1, .48, abs(vUv.y - .5)) * 10. * uRes.y/900.;
          vec3 c;
          if (b > .35) { c = vec3(0.); for (int i = 0; i < 20; i++) { float a = float(i)*2.39996; float r = sqrt(float(i)+.5)/sqrt(20.); c += texture2D(tColor, vUv + vec2(cos(a),sin(a))*r*b*px).rgb; } c /= 20.; }
          else c = texture2D(tColor, vUv).rgb;
          if (uOutline > 0.) {
            float t = uThick, z0 = iz(vUv);
            float zl = iz(vUv - vec2(px.x*t,0.)), zr = iz(vUv + vec2(px.x*t,0.)), zu = iz(vUv + vec2(0.,px.y*t)), zd = iz(vUv - vec2(0.,px.y*t));
            float lap = abs(zl+zr+zu+zd-4.*z0)/z0;
            float e = smoothstep(.03, .09, lap) * (1. - smoothstep(0., 3., b));
            c = mix(c, uOutlineCol, e*uOutline);
          }
          float l = dot(c, vec3(.299,.587,.114)); c = mix(vec3(l), c, uSat); c = (c-.5)*uContrast + .5;
          c *= 1. - uVig*pow(length(vUv-.5)*1.35, 2.5);
          gl_FragColor = vec4(c, 1.);
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  }

  applySkin(skin: Skin, dpr: number) {
    const u = this.uniforms;
    u.uOutline.value = skin.outline;
    u.uOutlineCol.value.set(skin.outlineColor);
    u.uThick.value = skin.outlineThickness * dpr;
    u.uSat.value = skin.saturation;
    u.uContrast.value = skin.contrast;
    u.uVig.value = skin.vignette;
    u.uTilt.value = skin.tiltShift;
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.render(this.scene, this.cam);
  }
}

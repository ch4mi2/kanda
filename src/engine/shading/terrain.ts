// Terrain + ocean materials. Everything a skin changes is a uniform; the shader
// text only knows about "cel or soft light, rock/snow/forest/water layers".
// Ported from the look-lab / toon-lab prototypes (design/prototypes/).

import * as THREE from 'three';
import masksUrl from '../../data/masks.png';
import { SRI_LANKA_BBOX } from '../../config/tiles';
import { lngLatToScene } from '../geo';

export const NOISE_GLSL = /* glsl */ `
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }
`;

/** Terrace a height (m): flat plateaus joined by steep risers. */
export const TERRACE_GLSL = /* glsl */ `
float terraceH(float h, float stepM) {
  float q = h / stepM;
  return stepM * (floor(q) + smoothstep(.72, 1., fract(q)));
}`;

/** Shared vertex stage: raw-metre Y -> exaggerated km, sea flattened to 0. */
export const TERRAIN_VERT = /* glsl */ `
attribute vec2 aGrad, aGrad2;
attribute float aDrop;
uniform float uExag, uTerrace, uTerraceStep;
varying vec3 vW;
varying vec2 vGrad, vGrad2;
varying float vH;
${TERRACE_GLSL}
void main() {
  float h = uTerrace > .5 ? terraceH(position.y, uTerraceStep) : position.y;
  float y = (max(h, 0.) - aDrop) * 0.001 * uExag;
  vec4 w = modelMatrix * vec4(position.x, y, position.z, 1.);
  vW = w.xyz; vGrad = aGrad; vGrad2 = aGrad2; vH = position.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uSun, uSunCol, uShade, uFog;
uniform float uCel, uBands, uCelSoft, uWrap, uFogDen, uFogStart, uFogBands;
float lightTerm(float ndl, float sh) {
  if (uCel < .5) return clamp((ndl + uWrap) / (1. + uWrap), 0., 1.) * mix(.3, 1., sh);
  float l = clamp(ndl, 0., 1.) * mix(.1, 1., sh);
  float q = l * uBands;
  return (floor(q) + smoothstep(.5 - uCelSoft, .5 + uCelSoft, fract(q))) / uBands;
}
vec3 shadeCol(vec3 base, float lit) { return base * mix(uShade, uSunCol, lit); }
vec3 fogIt(vec3 c, vec3 p) {
  float d = length(cameraPosition - p);
  float f = 1. - exp(-max(d - uFogStart, 0.) * uFogDen);
  if (uFogBands > 0.) {
    float q = f * uFogBands;
    f = (floor(q) + smoothstep(.3, .7, fract(q))) / uFogBands;
  }
  return mix(c, uFog, f);
}`;

/** Value noise, light terms and fog - shared by terrain, trees and clouds. */
export const COMMON_GLSL = NOISE_GLSL + LIGHT_GLSL;

const TERRAIN_FRAG = /* glsl */ `
uniform float uTime, uRim, uPatch, uRockSlope, uSnowLine, uCliff, uFoamAmt, uWaterMode, uExag, uFlat;
uniform float uShadowOn, uShadowBias, uShadowTexel, uShadowNormalOffset;
uniform vec3 uGrassLo, uGrassHi, uForest, uRock, uSnow, uCliffCol, uWater, uWaterHi, uWaterDeep, uFoam;
uniform vec4 uMaskBox;      // x0, z0, 1/w, 1/h of the masks image in scene km
uniform sampler2D uMasks;   // R forest, G lake edge, B lake depth
uniform sampler2D tShadow;
uniform mat4 uShadowMat;
varying vec3 vW; varying vec2 vGrad, vGrad2; varying float vH;
${NOISE_GLSL}
${LIGHT_GLSL}

float waterPattern(vec2 p) {
  float fade = 1. - smoothstep(25., 90., length(cameraPosition.xz - p) + cameraPosition.y);
  float v;
  if (uWaterMode < .5) {
    v = smoothstep(.74, .95, vnoise(p * 7. + vec2(uTime * .5, uTime * .31)));
  } else if (uWaterMode < 1.5) {
    vec2 q = p * 1.5 + vec2(uTime * .05, 0.);
    float d = abs(fract(q.x + q.y) - .5) + abs(fract(q.x - q.y) - .5);
    v = smoothstep(.6, .66, d) * .85;
  } else if (uWaterMode < 2.5) {
    float s = sin(p.x * 1.4 + sin(p.y * .8 + uTime * .6) * 1.6);
    float band = step(fract(p.y * .45 + .2 * sin(p.x * .5)), .09);
    v = smoothstep(.55, .85, s) * band;
  } else {
    v = step(.64, vnoise(floor(p * 1.3))) * .4;
  }
  return v * fade;
}

float shadowAt(vec3 p, vec3 N, float ndl) {
  // No early returns: texture reads must stay in uniform control flow.
  vec3 op = p + N * uShadowNormalOffset; // off the surface, so a coarser receiver doesn't self-shadow
  // uShadowMat already includes the clip -> [0,1] texture/depth remap (SunShadow.bias).
  vec3 c = (uShadowMat * vec4(op, 1.)).xyz;
  // Fade toward lit over the outer 15% of the box instead of a hard rectangle.
  float edgeDist = min(min(c.x, 1. - c.x), min(c.y, 1. - c.y));
  float edgeFade = smoothstep(0., .15, edgeDist);
  float on = step(.5, uShadowOn) * edgeFade * step(c.z, 1.);
  c.xy = clamp(c.xy, .002, .998);
  float bias = uShadowBias * (1. + 2.5 * (1. - clamp(ndl, 0., 1.)));
  float s = 0.;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    float d = texture2D(tShadow, c.xy + vec2(float(i), float(j)) * uShadowTexel).r;
    s += (c.z - bias <= d) ? 1. : 0.;
  }
  return mix(1., s / 9., on);
}

void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 faceN = normalize(cross(dFdx(vW), dFdy(vW))); // derivatives stay out of branches
  vec3 col;
  bool sea = vH <= 0.5;
  vec2 muv = (vW.xz - uMaskBox.xy) * uMaskBox.zw;
  vec3 mk = texture2D(uMasks, muv).rgb;
  float lakeEdge = mk.g;
  float lake = smoothstep(.3, .5, lakeEdge) * (sea ? 0. : 1.);

  if (sea) {
    float x = -vH; // metres below sea level
    float depth = smoothstep(0., 220., x);
    col = mix(uWaterHi, mix(uWater, uWaterDeep, depth), smoothstep(0., 14., x));
    col = mix(col, uWaterHi, waterPattern(vW.xz) * .6 * (1. - depth * .6));
    float wob = (vnoise(vW.xz * 18. + uTime * .3) - .5) * 2.2;
    float foam = (1. - smoothstep(0., 3.2, x + wob)) * .95
               + smoothstep(.55, .9, sin((x + wob) * .55 - uTime * 1.3)) * (1. - smoothstep(3., 15., x)) * .45;
    col = mix(col, uFoam, clamp(foam, 0., 1.) * uFoamAmt);
    col = shadeCol(col, .85);
  } else {
    vec3 N;
    // Near-field detail: the 38 m DEM is a smooth blob at eye level, so within a few
    // km speckle the colour. Far terrain stays clean.
    float near = 1. - smoothstep(.2, 5., length(cameraPosition - vW));
    if (uFlat > .5) {
      // Faceted skins (clay, terraces): the true triangle normal.
      N = faceN;
      if (dot(N, V) < 0.) N = -N;
      near *= .35;
    } else {
      N = normalize(vec3(-vGrad.x * uExag, 1., -vGrad.y * uExag));
    }
    // A much smoother second gradient for the rock mask, so rock forms coherent
    // faces instead of per-pixel confetti (CLAUDE.md "jaggedness").
    vec3 N2 = normalize(vec3(-vGrad2.x * uExag, 1., -vGrad2.y * uExag));
    float n = fbm(vW.xz * .28);
    float e = smoothstep(250., 1850., vH);
    vec3 base = mix(uGrassLo, uGrassHi, clamp(e + (n - .5) * uPatch * 2., 0., 1.));
    base = mix(base, uForest, smoothstep(.3, .7, mk.r) * .7);
    base *= 1. + (vnoise(vW.xz * 90.) - .5) * .3 * near;
    float slope = 1. - N.y;
    float slope2 = 1. - N2.y;
    base = mix(base, uRock, smoothstep(uRockSlope, uRockSlope + .12, slope2 + (n - .5) * .12));
    float snow = smoothstep(uSnowLine - 50., uSnowLine + 50., vH + (n - .5) * 260.) * (1. - smoothstep(.5, .7, slope));
    base = mix(base, uSnow, snow);
    if (uCliff > .5) {
      float c = smoothstep(.38, .52, slope);
      base = mix(base, uCliffCol * (.86 + .14 * step(.5, fract(vW.y * 7.))), c);
    }
    float ndl = dot(N, uSun);
    float sh = shadowAt(vW, N, ndl);
    col = shadeCol(base, lightTerm(ndl, sh));
    col += uSunCol * pow(1. - max(dot(N, V), 0.), 4.) * uRim * .3 * sh;
    if (lake > 0.) {
      vec3 wc = mix(uWater, uWaterDeep, smoothstep(0., .9, mk.b));
      float fr = pow(1. - max(V.y, 0.), 3.);
      wc = mix(wc, uWaterHi, fr * .5);
      wc = mix(wc, uWaterHi, waterPattern(vW.xz) * .7 * sh);
      float foam = smoothstep(.22, .34, lakeEdge) * (1. - smoothstep(.45, .62, lakeEdge));
      wc = mix(wc, uFoam, foam * uFoamAmt);
      col = mix(col, shadeCol(wc, mix(.55, 1., sh)), lake);
    }
  }
  gl_FragColor = vec4(fogIt(col, vW), 1.);
}`;

export interface TerrainUniforms {
  [k: string]: THREE.IUniform;
}

export function createTerrainUniforms(): TerrainUniforms {
  const c = () => new THREE.Color('#000');
  const [w, s, e, n] = SRI_LANKA_BBOX;
  const nw = lngLatToScene(w, n);
  const se = lngLatToScene(e, s);
  const tex = new THREE.TextureLoader().load(masksUrl);
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return {
    uExag: { value: 2.6 },
    uFlat: { value: 0 },
    uTerrace: { value: 0 },
    uTerraceStep: { value: 240 },
    uFogBands: { value: 0 },
    uTime: { value: 0 },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: c() }, uShade: { value: c() }, uFog: { value: c() },
    uFogDen: { value: 0.004 }, uFogStart: { value: 20 },
    uCel: { value: 1 }, uBands: { value: 3 }, uCelSoft: { value: 0.2 }, uWrap: { value: 0 }, uRim: { value: 0 },
    uGrassLo: { value: c() }, uGrassHi: { value: c() }, uPatch: { value: 0.3 },
    uForest: { value: c() }, uRock: { value: c() }, uRockSlope: { value: 0.4 },
    uSnow: { value: c() }, uSnowLine: { value: 99999 },
    uCliff: { value: 0 }, uCliffCol: { value: c() },
    uWater: { value: c() }, uWaterHi: { value: c() }, uWaterDeep: { value: c() }, uFoam: { value: c() },
    uFoamAmt: { value: 1 }, uWaterMode: { value: 0 },
    uMasks: { value: tex },
    uMaskBox: { value: new THREE.Vector4(nw.x, nw.z, 1 / (se.x - nw.x), 1 / (se.z - nw.z)) },
    tShadow: { value: null },
    uShadowMat: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
    uShadowBias: { value: 0.0005 },
    uShadowTexel: { value: 1 / 2048 },
    uShadowNormalOffset: { value: 0 },
  };
}

export function createTerrainMaterial(u: TerrainUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
    side: THREE.DoubleSide,
  });
}

/** Depth-only material for the sun's shadow pass (same displacement). */
export function createShadowDepthMaterial(u: TerrainUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uExag: u.uExag, uTerrace: u.uTerrace, uTerraceStep: u.uTerraceStep },
    vertexShader: TERRAIN_VERT,
    fragmentShader: 'void main() { gl_FragColor = vec4(1.); }',
    side: THREE.DoubleSide,
    colorWrite: false,
  });
}

/** The infinite sea beyond the DEM, a hair under the tile sea (y = 0). */
export function createOceanMaterial(u: TerrainUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uWater, uWaterDeep, uWaterHi; uniform float uTime;
      varying vec3 vW; ${NOISE_GLSL} ${LIGHT_GLSL}
      void main(){
        vec3 col = mix(uWater, uWaterDeep, .85);
        float sp = smoothstep(.74, .95, vnoise(vW.xz * 7. + vec2(uTime * .5, uTime * .31)));
        col = mix(col, uWaterHi, sp * .25);
        gl_FragColor = vec4(fogIt(shadeCol(col, .85), vW), 1.);
      }`,
  });
}

export function createSkyMaterial(u: TerrainUniforms, sky: { uZen: THREE.IUniform; uHor: THREE.IUniform; uLow: THREE.IUniform }) {
  return new THREE.ShaderMaterial({
    uniforms: { ...sky, uSun: u.uSun, uSunCol: u.uSunCol },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uZen,uHor,uLow,uSun,uSunCol; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float y = d.y;
        vec3 c = mix(uHor, uZen, pow(smoothstep(0.,.55,y),.8));
        c = mix(uLow, c, smoothstep(-.03,.04,y));
        float g = max(dot(d,uSun),0.);
        // A real disc (~2.5 deg across) plus a wide warm halo - the old disc
        // was only a couple of screen pixels wide (CLAUDE.md "no visible sun").
        float halo = pow(g, 9.) * .4;
        float disc = smoothstep(.99962, .9998, g);
        c += uSunCol * (halo + disc);
        gl_FragColor = vec4(c,1.); }`,
  });
}

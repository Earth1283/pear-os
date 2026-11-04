import type { Layer } from './shaderPresets'

export const MAX_OCCLUDERS = 24
export const LAMP_HEIGHT = 40

const COMMON = `
#define MAXO ${MAX_OCCLUDERS}
#define LAMPH ${LAMP_HEIGHT}.0
uniform int occN;
uniform vec4 occR[MAXO];
uniform vec2 occP[MAXO];
uniform float selfH;
uniform vec3 sun;
uniform vec3 moon;
uniform vec2 sunSd;
uniform vec2 moonSd;
uniform float night;
uniform float lampOn;
`

const SKY = `${COMMON}
vec4 glow(vec3 b, vec3 col, vec2 p, float asp) {
  float bx = 0.5 + 0.42 * b.x;
  float halo = exp(-(pow((p.x - bx) * asp, 2.0) + pow(p.y + 0.05, 2.0)) / 0.045);
  return vec4(col, halo * 0.35 * b.z);
}

vec4 shade(vec2 p) {
  float asp = css.x / css.y;
  float k = 0.4 + 0.8 * I;
  vec4 c = vec4(0.03, 0.05, 0.2, night * 0.5 * k);
  float golden = exp(-pow((sun.y - 0.08) / 0.12, 2.0));
  c = over(c, vec4(1.0, 0.55, 0.25, 0.2 * golden * k));
  vec3 sunCol = mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.92, 0.75), smoothstep(0.05, 0.5, sun.y));
  vec4 rs = glow(sun, sunCol, p, asp);
  rs.a *= k * (1.3 - 0.5 * clamp(sun.y, 0.0, 1.0));
  c = over(c, rs);
  vec4 rm = glow(moon, vec3(0.7, 0.8, 1.0), p, asp);
  rm.a *= k;
  return over(c, rm);
}`

const CAST = `${COMMON}
float sdBox(vec2 p, vec2 c, vec2 hb, float r) {
  vec2 q = abs(p - c) - hb + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float surfaceHeight(vec2 p) {
  float s = 0.0;
  for (int i = 0; i < MAXO; i++) {
    if (i >= occN) break;
    vec2 hb = occR[i].zw * 0.5;
    if (sdBox(p, occR[i].xy + hb, hb, occP[i].y) < 0.0) s = max(s, occP[i].x);
  }
  return s;
}

float castShadow(vec2 p, float s, vec2 sd, vec2 lamp, bool point) {
  float a = 0.0;
  for (int i = 0; i < MAXO; i++) {
    if (i >= occN) break;
    float hj = occP[i].x;
    if (hj <= s + 0.01) continue;
    vec2 hb = occR[i].zw * 0.5;
    vec2 c = occR[i].xy + hb;
    float dh = hj - s;
    vec2 off = point ? (c - lamp) * dh / max(LAMPH - hj, 1.0) : sd * dh;
    float strength = clamp(0.4 + dh * 0.05, 0.4, 0.62);
    for (int k = 0; k < 5; k++) {
      float f = float(k) / 4.0;
      float pen = 3.0 + dh * 5.0 * f;
      float cov = 1.0 - smoothstep(-pen, pen, sdBox(p, c + off * f, hb, occP[i].y));
      a = max(a, cov * strength * (1.0 - 0.6 * f));
    }
  }
  return a;
}

vec4 shade(vec2 p) {
  vec2 px = p * css;
  float s = selfH >= 0.0 ? selfH : surfaceHeight(px);
  vec2 lamp = mouse * css;
  float aSun = sun.z > 0.01 ? castShadow(px, s, sunSd, vec2(0.0), false) * sun.z : 0.0;
  float aMoon = moon.z > 0.01 ? castShadow(px, s, moonSd, vec2(0.0), false) * moon.z * 0.8 : 0.0;
  float aLamp = lampOn > 0.01 ? castShadow(px, s, vec2(0.0), lamp, true) * lampOn : 0.0;
  vec2 dl = px - lamp;
  float pool = (exp(-dot(dl, dl) / 57800.0) * 0.22 + exp(-dot(dl, dl) / 9000.0) * 0.3) * lampOn * (selfH >= 0.0 ? 0.3 : 1.0);
  vec4 c = vec4(1.0, 0.78, 0.45, pool);
  return over(c, vec4(0.01, 0.02, 0.1, 1.0 - (1.0 - aSun) * (1.0 - aMoon) * (1.0 - aLamp)));
}`

const layer = (id: string, frag: string, scale: number): Layer => ({ id, frag, blend: 'normal', scale })

export const LIGHT_LAYERS: Record<'sky' | 'shadow' | 'windows', Layer> = {
  sky: layer('light:sky', SKY, 0.5),
  shadow: layer('light:cast', CAST, 0.5),
  windows: layer('light:cast', CAST, 0.75),
}

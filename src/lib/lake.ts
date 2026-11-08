import { compile, cssSize, release } from './gpu'
import { skyAt } from './sky'
import { useShaders } from './shaders'
import { MAX_GUSTS, SLANT, windField } from './wind'

const LOW_H = 216

const COMMON = `#version 300 es
precision highp float;
precision highp int;
const float LH = 216.0;
const float HZ = 86.0 / 216.0;
const int HZT = 86;
const float SLANT = ${SLANT.toFixed(3)};
uniform vec2 low;
uniform vec4 gusts[${MAX_GUSTS}];
uniform float wBase;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(7.1, 3.7); a *= 0.5; }
  return s;
}
float bayer(ivec2 p) {
  const float M[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (M[(p.y & 3) * 4 + (p.x & 3)] + 0.5) / 16.0;
}
float ridge(float x, float seed, float base, float amp, float freq) {
  float n = fbm(vec2(x * freq + seed, seed * 1.7));
  return base + amp * pow(clamp((n - 0.15) / 0.7, 0.0, 1.0), 1.5);
}
float windAt(vec2 s) {
  float w = wBase;
  for (int i = 0; i < ${MAX_GUSTS}; i++) {
    vec4 g = gusts[i];
    float d = (s.x - g.x - SLANT * (s.y - 0.5)) / g.z;
    w += g.y * exp(-d * d);
  }
  return w;
}
vec3 pal(vec3 a, vec3 b, vec3 c, vec3 d, float v, float dith) {
  float s = clamp(v, 0.0, 0.999) * 4.0 + (dith - 0.5) * 0.9;
  return s < 1.0 ? a : (s < 2.0 ? b : (s < 3.0 ? c : d));
}
float landAt(float x) {
  float hl = 34.0 * exp(-pow(x / (0.3 * low.x), 2.0));
  float hr = 43.0 * exp(-pow((low.x - x) / (0.26 * low.x), 2.0));
  return floor(max(hl, hr) + 2.0 * vnoise(vec2(x * 0.1, 2.0)));
}
`

const SCENE_FRAG = `${COMMON}
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oD;

const float M_ROCK = 1.0;
const float M_SNOW = 2.0;
const float M_PINE = 3.0;
const float M_LAND = 4.0;
const float M_WATER = 5.0;

void put(vec3 alb, float mat, float depth, vec2 n) {
  oA = vec4(alb, 1.0);
  oD = vec4(mat / 8.0, depth, n * 0.5 + 0.5);
}

void mountain(vec2 q, ivec2 tx, float seed, float base, float amp, float freq, vec3 a, vec3 b, vec3 c, vec3 d, float depth, float snow) {
  float h = ridge(q.x, seed, base, amp, freq) + 0.004 * vnoise(vec2(q.x * 90.0 + seed, seed));
  if (q.y > h) return;
  float e = 2.0 / low.x;
  float s = (ridge(q.x + e, seed, base, amp, freq) - ridge(q.x - e, seed, base, amp, freq)) / (2.0 * e);
  vec2 n = normalize(vec2(-s * 0.5, 1.0));
  float strata = vnoise(vec2(q.x * 70.0 + seed, q.y * 200.0)) - 0.5;
  float v = 0.5 - n.x * 1.1 + strata * 0.55 + (q.y - base) / amp * 0.25;
  float dith = bayer(tx);
  float snowLine = base + amp * (0.58 + 0.1 * vnoise(vec2(q.x * 55.0, q.y * 55.0)));
  if (snow > 0.0 && q.y > snowLine) {
    put(pal(vec3(0.60, 0.68, 0.82), vec3(0.76, 0.83, 0.93), vec3(0.90, 0.94, 0.99), vec3(1.0), v + 0.15, dith), M_SNOW, depth, n);
  } else {
    put(pal(a, b, c, d, v, dith), M_ROCK, depth, n);
  }
}

void main() {
  ivec2 tx = ivec2(gl_FragCoord.xy);
  vec2 q = (vec2(tx) + 0.5) / vec2(low.x, LH);
  float dith = bayer(tx);
  oA = vec4(0.0);
  oD = vec4(0.0);

  if (q.y < HZ) {
    put(vec3(0.05, 0.2, 0.26), M_WATER, 1.0 - q.y / HZ, vec2(0.0, 1.0));
  } else {
    mountain(q, tx, 1.3, 0.43, 0.20, 3.2, vec3(0.28, 0.34, 0.52), vec3(0.37, 0.44, 0.64), vec3(0.47, 0.55, 0.76), vec3(0.58, 0.66, 0.86), 0.15, 1.0);
    mountain(q, tx, 7.1, 0.415, 0.16, 4.6, vec3(0.22, 0.30, 0.38), vec3(0.28, 0.38, 0.47), vec3(0.35, 0.46, 0.56), vec3(0.43, 0.55, 0.65), 0.35, 0.8);
    mountain(q, tx, 3.9, 0.405, 0.09, 6.5, vec3(0.06, 0.14, 0.12), vec3(0.09, 0.20, 0.16), vec3(0.12, 0.27, 0.21), vec3(0.16, 0.34, 0.26), 0.6, 0.0);
  }

  float fx = float(tx.x);
  float land = landAt(fx);
  if (float(tx.y) < land) {
    float rim = float(tx.y) >= land - 2.0 ? 1.0 : 0.0;
    float v = 0.3 + 0.4 * vnoise(vec2(fx * 0.2, float(tx.y) * 0.5)) + rim * 0.3;
    put(pal(vec3(0.04, 0.09, 0.06), vec3(0.06, 0.13, 0.08), vec3(0.09, 0.18, 0.10), vec3(0.14, 0.24, 0.12), v, dith), M_LAND, 1.0, vec2(0.0, 1.0));
  }

}`

const PINE_FRAG = `${COMMON}
uniform sampler2D uAlb;
uniform sampler2D uDat;
uniform float t;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oD;

void main() {
  ivec2 tx = ivec2(gl_FragCoord.xy);
  oA = texelFetch(uAlb, tx, 0);
  oD = texelFetch(uDat, tx, 0);
  float fx = float(tx.x);
  float dith = bayer(tx);
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float cluster = i < 6 ? 0.02 + 0.055 * fi : 0.8 + 0.04 * (fi - 6.0);
    float x0 = floor(low.x * (cluster + 0.03 * hash(vec2(fi, 1.0))));
    float ht = 26.0 + floor(hash(vec2(fi, 2.0)) * 20.0);
    float foot = landAt(x0) - 2.0;
    float dy = float(tx.y) - foot;
    if (dy >= 0.0 && dy < ht) {
      float w = windAt(vec2(x0 / low.x, 1.0 - (foot + ht * 0.5) / LH));
      float sway = clamp(w, -1.6, 1.6) * 4.5 + sin(t * (1.7 + hash(vec2(fi, 4.0))) + fi * 2.1) * min(abs(w), 1.0) * 0.9;
      float r = ht - 1.0 - dy;
      float hw = floor(1.0 + r * 0.28 + (mod(r, 5.0) < 2.0 ? 1.0 : 0.0));
      if (dy < 3.0) hw = min(hw, 1.0);
      float dx = fx - x0 - floor(sway * pow(dy / ht, 1.7) + 0.5);
      if (abs(dx) <= hw) {
        float side = dx < 0.0 ? 1.0 : 0.0;
        float v = 0.25 + 0.35 * side + 0.3 * vnoise(vec2(fx * 0.5, float(tx.y) * 0.4));
        oA = vec4(pal(vec3(0.02, 0.07, 0.05), vec3(0.04, 0.11, 0.07), vec3(0.06, 0.16, 0.10), vec3(0.10, 0.22, 0.13), v, dith), 1.0);
        oD = vec4(3.0 / 8.0, 1.0, vec2(dx < 0.0 ? -0.7 : 0.7, 0.7) * 0.5 + 0.5);
      }
    }
  }
}`

const LIGHT_FRAG = `${COMMON}
in vec2 uv;
out vec4 o;
uniform sampler2D uAlb;
uniform sampler2D uDat;
uniform vec2 res;
uniform float t;
uniform float cloud;
uniform vec3 sun;
uniform vec3 moon;
uniform float night;
uniform float phase;
uniform float hqWater;
uniform float hqSky;

float ASP;
vec3 SUNC;
vec3 SUNL;
vec3 MOONL;
vec3 AMB;
vec3 HZC;
vec2 LS;
vec2 LM;
float GOLD;

vec3 skyBase(vec2 q) {
  float h = clamp((q.y - HZ) / (1.0 - HZ), 0.0, 1.0);
  vec3 day = mix(vec3(0.68, 0.84, 1.0), vec3(0.16, 0.38, 0.82), pow(h, 0.55));
  vec3 nit = mix(vec3(0.16, 0.22, 0.42), vec3(0.015, 0.03, 0.12), pow(h, 0.45));
  vec3 col = mix(day, nit, night);
  float side = exp(-pow((q.x - (0.5 + 0.42 * sun.x)) * 1.6, 2.0));
  return col + vec3(1.0, 0.45, 0.2) * GOLD * (0.6 * side * exp(-h * 3.5) + 0.14 * exp(-h * 2.0));
}

vec2 bodyTexel(vec3 b) {
  return vec2(0.5 + 0.42 * b.x, HZ + b.y * 0.78 * (1.0 - HZ)) * low;
}

vec3 skyPix(ivec2 tx) {
  vec2 q = (vec2(tx) + 0.5) / low;
  vec3 col = skyBase(q);
  col = floor(col * 22.0 + bayer(tx)) / 22.0;

  float star = step(0.9935, hash(vec2(tx))) * (0.6 + 0.4 * sin(t * 2.0 + hash(vec2(tx) + 3.0) * 40.0));
  col += vec3(star) * pow(night, 2.0) * smoothstep(HZ + 0.02, 0.6, q.y);

  vec2 cp = vec2(q.x * ASP * 3.4 - cloud, q.y * 9.0);
  float band = smoothstep(0.5, 0.6, q.y) * (1.0 - smoothstep(0.82, 0.98, q.y));
  float th = 0.62 + (1.0 - band) * 0.4;
  float cl = fbm(cp);
  if (cl > th) {
    vec2 off = vec2(sun.x * 0.1, 0.06);
    vec3 body = (vec3(1.0) * AMB * 1.3 + SUNC * sun.z * 0.3) * mix(1.0, 0.5, night);
    float rim = fbm(cp + off) < th + 0.02 ? 1.0 : 0.0;
    float under = fbm(cp - off * 1.5) > th + 0.07 ? 1.0 : 0.0;
    col = rim > 0.5 ? body + SUNC * sun.z * 0.35 + 0.05 : (under > 0.5 ? body * 0.82 : body);
  }

  vec2 d = vec2(tx) + 0.5 - bodyTexel(sun);
  float vs = smoothstep(-0.05, 0.02, sun.y);
  if (length(d) < 7.0 && vs > 0.5) col = SUNC * 1.3 + 0.2;

  vec2 md = vec2(tx) + 0.5 - bodyTexel(moon);
  float vm = smoothstep(-0.05, 0.02, moon.y) * (0.35 + 0.65 * night);
  vec2 m = md / 6.0;
  float r2 = dot(m, m);
  if (r2 < 1.0 && vm > 0.3) {
    vec3 n = vec3(m, sqrt(1.0 - r2));
    float th2 = 6.2831853 * phase;
    float lit = dot(n, vec3(sin(th2), 0.0, -cos(th2))) > 0.0 ? 1.0 : 0.0;
    col = mix(col, mix(vec3(0.07, 0.08, 0.13), vec3(0.95, 0.95, 0.86), lit), vm);
  }
  return col;
}

vec3 skySmooth(vec2 q) {
  vec3 col = skyBase(q);
  vec2 g = fract(q * vec2(ASP * 220.0, 220.0)) - 0.5;
  float r = hash(floor(q * vec2(ASP * 220.0, 220.0)));
  float star = step(0.994, r) * smoothstep(0.35, 0.0, length(g)) * (0.6 + 0.4 * sin(t * 2.0 + r * 4000.0));
  col += vec3(star) * pow(night, 2.0) * smoothstep(HZ + 0.02, 0.6, q.y);

  vec2 cp = vec2(q.x * ASP * 3.4 - cloud, q.y * 9.0);
  float band = smoothstep(0.5, 0.6, q.y) * (1.0 - smoothstep(0.82, 0.98, q.y));
  float cl = fbm(cp);
  float dens = smoothstep(0.5, 0.8, cl) * band;
  vec2 off = vec2(sun.x * 0.1, 0.06);
  float edge = clamp((cl - fbm(cp + off)) * 5.0 + 0.5, 0.0, 1.0);
  vec3 body = (vec3(1.0) * AMB * 1.3 + SUNC * sun.z * 0.3) * mix(1.0, 0.5, night);
  col = mix(col, mix(body * 0.8, body + SUNC * sun.z * 0.4, edge), dens * 0.9);

  float ds = length((q - bodyTexel(sun) / low) * vec2(ASP, 1.0));
  float vs = smoothstep(-0.05, 0.02, sun.y);
  col = mix(col, SUNC * 1.3 + 0.2, smoothstep(0.034, 0.03, ds) * vs);

  vec2 md = (q * low - bodyTexel(moon)) / 6.0;
  float r2 = dot(md, md);
  float vm = smoothstep(-0.05, 0.02, moon.y) * (0.35 + 0.65 * night);
  if (r2 < 1.0) {
    vec3 n = vec3(md, sqrt(1.0 - r2));
    float th2 = 6.2831853 * phase;
    float lit = smoothstep(-0.04, 0.06, dot(n, vec3(sin(th2), 0.0, -cos(th2))));
    vec3 mc = mix(vec3(0.07, 0.08, 0.13), vec3(0.95, 0.95, 0.86) * (0.85 + 0.15 * vnoise(md * 4.0)), lit);
    col = mix(col, mc, smoothstep(1.0, 0.9, sqrt(r2)) * vm);
  }
  return col;
}

vec3 litAt(ivec2 tx, vec2 q, bool hq) {
  vec4 A = texelFetch(uAlb, tx, 0);
  vec4 D = texelFetch(uDat, tx, 0);
  if (D.r < 0.01) return hq ? skySmooth(q) : skyPix(tx);
  vec2 n = D.ba * 2.0 - 1.0;
  float litS = smoothstep(-0.3, 0.7, dot(n, LS));
  float litM = smoothstep(-0.3, 0.7, dot(n, LM));
  vec3 c = A.rgb * (AMB + SUNL * litS + MOONL * litM);
  float mist = (1.0 - D.g) * 0.3 + (1.0 - smoothstep(0.0, 0.1, q.y - HZ)) * 0.4 * step(D.g, 0.9);
  return mix(c, HZC, clamp(mist, 0.0, 1.0));
}

vec3 glitter(vec3 b, vec3 col, ivec2 tx, float d, float k, float seed, float paw) {
  float bx = bodyTexel(b).x;
  float w = 2.0 + 24.0 * k + 10.0 * paw;
  float path = exp(-pow((float(tx.x) - bx) / w, 2.0)) * (1.0 - 0.4 * k);
  float flick = hash(vec2(tx) + floor(t * (3.0 + 5.0 * paw) + hash(vec2(tx.y, seed)) * 6.0) * 7.0 + seed);
  float spark = step(1.0 - path * (0.45 + 0.35 * paw) * b.z, flick);
  return col * spark * 1.5;
}

float catsPaw(vec2 s, float wl, float k) {
  float blot = vnoise(vec2(s.x * ASP * 26.0 - wl * t * 1.4, (HZ - s.y) * 90.0 / (0.25 + k)));
  return smoothstep(0.12, 0.8, abs(wl)) * (0.45 + 0.55 * blot);
}

vec3 ruffle(vec3 col, vec3 deep, float paw, float k) {
  return mix(col, deep + vec3(0.04, 0.07, 0.1) * (AMB + SUNL * 0.4), 0.5 * paw * (1.0 - 0.4 * k));
}

vec3 water(ivec2 tx) {
  float d = float(HZT - 1 - tx.y);
  float k = d / float(HZT);
  vec2 sp = (vec2(tx) + 0.5) / low;
  float wl = windAt(vec2(sp.x, 1.0 - sp.y));
  float paw = catsPaw(sp, wl, k);
  float wob = (sin(d * 0.7 + t * 1.1) * (0.4 + 2.6 * k) + (vnoise(vec2(d * 0.4, t * 0.3)) - 0.5) * 6.0 * k) * (1.0 + 1.8 * paw);
  ivec2 m = ivec2(clamp(tx.x + int(floor(wob + 0.5)), 0, int(low.x) - 1), min(2 * HZT - 1 - tx.y, int(LH) - 1));
  vec3 refl = litAt(m, (vec2(m) + 0.5) / low, hqSky > 0.5);
  vec3 deep = mix(vec3(0.05, 0.2, 0.26), vec3(0.02, 0.09, 0.14), k) * (AMB * 1.3 + 0.05);
  vec3 col = mix(deep, refl * 0.95, mix(0.9, 0.4, pow(k, 0.6)));
  col = ruffle(col, deep, paw, k);
  float dash = step(0.8 - 0.22 * paw, vnoise(vec2(float(tx.x) * 0.09 + t * 0.25 * (1.0 + k) - wl * t * 0.6, d * 1.3)));
  col += dash * (SUNL * 0.12 + AMB * 0.12) * (0.3 + k);
  col += glitter(sun, SUNC, tx, d, k, 0.0, paw);
  col += glitter(moon, vec3(0.7, 0.8, 1.0), tx, d, k, 11.0, paw) * 1.2;
  if (d < 1.0) col = mix(col, HZC, 0.35);
  return col;
}

vec3 glitterHQ(vec3 b, vec3 col, vec2 q, float k, float seed) {
  float bx = 0.5 + 0.42 * b.x;
  float w = 0.02 + 0.16 * k;
  float path = exp(-pow((q.x - bx) / w, 2.0));
  float rip = vnoise(vec2(q.x * ASP * 150.0 + seed, q.y * 95.0 + t * 0.8)) * vnoise(vec2(q.x * ASP * 55.0 - seed, q.y * 30.0 - t * 0.5));
  return col * path * (0.1 + 0.75 * smoothstep(0.2, 0.75, rip * 2.0)) * b.z * (1.0 - 0.4 * k);
}

vec3 waterHQ(vec2 q) {
  float d = HZ - q.y;
  float k = d / HZ;
  float wl = windAt(vec2(q.x, 1.0 - q.y));
  float paw = catsPaw(q, wl, k);
  float rx = (vnoise(vec2(q.x * ASP * 10.0 - wl * t * 0.8, q.y * 140.0 + t * 0.35)) - 0.5) * 0.02 * (0.3 + k) * (1.0 + 2.2 * paw);
  float ry = (vnoise(vec2(q.x * ASP * 40.0 + 5.0, q.y * 60.0 - t * 0.25)) - 0.5) * 0.012 * k * (1.0 + 2.0 * paw);
  vec2 mq = clamp(vec2(q.x + rx, HZ + d + ry), 0.0, 0.999);
  vec3 refl = litAt(ivec2(mq * low), mq, hqSky > 0.5);
  vec3 deep = mix(vec3(0.05, 0.2, 0.26), vec3(0.02, 0.09, 0.14), k) * (AMB * 1.3 + 0.05);
  vec3 col = ruffle(mix(deep, refl * 0.95, mix(0.9, 0.4, pow(k, 0.6))), deep, paw, k);
  col += glitterHQ(sun, SUNC, q, k, 0.0);
  col += glitterHQ(moon, vec3(0.7, 0.8, 1.0), q, k, 11.0) * 1.2;
  col += exp(-d * 400.0) * 0.12 * (AMB + SUNL * 0.5);
  return col;
}

float rays(vec2 pos, vec2 target, float jitter) {
  float open = 0.0;
  for (int i = 0; i < 12; i++) {
    vec2 p = mix(pos, target, (float(i) + jitter) / 12.0);
    ivec2 tx = ivec2(clamp(p, 0.0, 0.999) * low);
    float m = texelFetch(uDat, tx, 0).r * 8.0;
    open += (m < 0.5 || m > 4.5) ? 1.0 : 0.0;
  }
  return open / 12.0;
}

void main() {
  ASP = res.x / res.y;
  GOLD = exp(-pow((sun.y - 0.08) / 0.14, 2.0));
  SUNC = mix(vec3(1.0, 0.55, 0.28), vec3(1.0, 0.93, 0.8), smoothstep(0.05, 0.5, sun.y));
  SUNL = SUNC * sun.z * 1.1;
  MOONL = vec3(0.5, 0.62, 1.0) * moon.z * 0.9;
  AMB = mix(vec3(0.62, 0.7, 0.85), vec3(0.16, 0.2, 0.36), night) + vec3(0.1, 0.13, 0.24) * moon.z + vec3(0.3, 0.12, 0.05) * GOLD * 0.5;
  HZC = skyBase(vec2(0.5, HZ + 0.01));
  LS = normalize(vec2(sun.x, max(sun.y, 0.1) + 0.15));
  LM = normalize(vec2(moon.x, max(moon.y, 0.1) + 0.15));

  ivec2 tx = clamp(ivec2(floor(uv * low)), ivec2(0), ivec2(low) - 1);
  float mat = texelFetch(uDat, tx, 0).r * 8.0;
  bool hqs = hqSky > 0.5;
  vec3 col = mat > 4.5 ? (hqWater > 0.5 ? waterHQ(uv) : water(tx)) : litAt(tx, hqs ? uv : (vec2(tx) + 0.5) / low, hqs);

  if (mat < 0.5) {
    vec2 sp = bodyTexel(sun) / low;
    vec2 mp = bodyTexel(moon) / low;
    float j = hash(gl_FragCoord.xy);
    float ds = length((uv - sp) * vec2(ASP, 1.0));
    float vs = smoothstep(-0.05, 0.02, sun.y);
    col += SUNC * (exp(-ds * 9.0) * 0.45 + exp(-ds * 38.0) * 0.5) * vs;
    col += SUNC * rays(uv, sp, j) * exp(-ds * 1.6) * 0.3 * sun.z * (0.6 + GOLD);
    float dm = length((uv - mp) * vec2(ASP, 1.0));
    float vm = smoothstep(-0.05, 0.02, moon.y) * (0.35 + 0.65 * night);
    float illum = 0.5 - 0.5 * cos(6.2831853 * phase);
    col += vec3(0.55, 0.65, 1.0) * exp(-dm * 14.0) * 0.28 * illum * vm;
    col += vec3(0.6, 0.72, 1.0) * rays(uv, mp, j) * exp(-dm * 1.6) * 0.1 * moon.z;
  }

  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.45;
  col += (hash(gl_FragCoord.xy + t) - 0.5) / 255.0;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

export class LakeRenderer {
  private gl: WebGL2RenderingContext
  private scene: ReturnType<typeof compile>
  private pines: ReturnType<typeof compile>
  private light: ReturnType<typeof compile>
  private textures: WebGLTexture[] = []
  private fbos: WebGLFramebuffer[] = []
  private lowW = 0
  private stillPines = false
  private raf = 0
  private timer = 0
  private last = 0
  private start = performance.now()
  private visible = () => this.loop()
  private unsub: () => void
  private size: ReturnType<typeof cssSize>

  constructor(
    private canvas: HTMLCanvasElement,
    private scale: number,
    private animate: boolean,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
    if (!gl) throw new Error('webgl2 unavailable')
    this.gl = gl
    this.scene = compile(gl, SCENE_FRAG)
    this.pines = compile(gl, PINE_FRAG)
    this.light = compile(gl, LIGHT_FRAG)
    this.size = cssSize(canvas, () => {
      if (!this.animate) this.draw(performance.now())
    })
    document.addEventListener('visibilitychange', this.visible)
    this.unsub = useShaders.subscribe(() => {
      if (!this.animate) this.draw(performance.now())
    })
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.scale
    const w = Math.max(1, Math.round(this.size.w * dpr))
    const h = Math.max(1, Math.round(this.size.h * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  private buildScene() {
    const { gl } = this
    const lowW = Math.max(64, Math.round((LOW_H * this.size.w) / Math.max(1, this.size.h)))
    if (lowW === this.lowW) return
    this.lowW = lowW
    this.stillPines = false
    this.textures.forEach((t) => gl.deleteTexture(t))
    this.fbos.forEach((f) => gl.deleteFramebuffer(f))
    this.textures = []
    this.fbos = [0, 1].map(() => {
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      for (const i of [0, 1]) {
        const tex = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lowW, LOW_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0)
        this.textures.push(tex)
      }
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
      return fbo
    })
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[0])
    gl.viewport(0, 0, lowW, LOW_H)
    gl.useProgram(this.scene.prog)
    gl.uniform2f(this.scene('low'), lowW, LOW_H)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private bind(a: number, d: number) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[a])
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[d])
  }

  private growPines(t: number) {
    const wind = windField()
    if (!wind.on && this.stillPines) return
    this.stillPines = !wind.on
    const { gl, pines: u } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[1])
    gl.viewport(0, 0, this.lowW, LOW_H)
    gl.useProgram(u.prog)
    this.bind(0, 1)
    gl.uniform1i(u('uAlb'), 0)
    gl.uniform1i(u('uDat'), 1)
    gl.uniform2f(u('low'), this.lowW, LOW_H)
    gl.uniform1f(u('t'), t)
    gl.uniform4fv(u('gusts'), wind.gusts)
    gl.uniform1f(u('wBase'), wind.base)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  draw(now: number) {
    this.resize()
    this.buildScene()
    const t = this.animate ? (now - this.start) / 1000 : 5
    this.growPines(t)
    const { gl, light: u } = this
    const wind = windField()
    const sky = skyAt(new Date(), useShaders.getState().hourOverride)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(u.prog)
    this.bind(2, 3)
    gl.uniform1i(u('uAlb'), 0)
    gl.uniform1i(u('uDat'), 1)
    gl.uniform2f(u('res'), this.canvas.width, this.canvas.height)
    gl.uniform2f(u('low'), this.lowW, LOW_H)
    gl.uniform1f(u('t'), t)
    gl.uniform1f(u('cloud'), wind.on ? wind.cloud : -t * 0.006)
    gl.uniform4fv(u('gusts'), wind.gusts)
    gl.uniform1f(u('wBase'), wind.base)
    gl.uniform3f(u('sun'), sky.sun.x, sky.sun.elev, sky.sun.strength)
    gl.uniform3f(u('moon'), sky.moon.x, sky.moon.elev, sky.moon.strength)
    gl.uniform1f(u('night'), sky.night)
    gl.uniform1f(u('phase'), sky.phase)
    const opts = useShaders.getState()
    gl.uniform1f(u('hqWater'), opts.hqWater ? 1 : 0)
    gl.uniform1f(u('hqSky'), opts.hqSky ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  loop() {
    cancelAnimationFrame(this.raf)
    clearInterval(this.timer)
    if (!this.animate || document.hidden) {
      this.draw(performance.now())
      if (!this.animate) this.timer = window.setInterval(() => this.draw(performance.now()), 60_000)
      return
    }
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      if (now - this.last < 33) return
      this.last = now
      this.draw(now)
    }
    this.raf = requestAnimationFrame(tick)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    clearInterval(this.timer)
    this.size.stop()
    this.unsub()
    document.removeEventListener('visibilitychange', this.visible)
    release(this.canvas, this.gl)
  }
}


export type ShaderTarget = 'desktop' | 'windows' | 'overlay'
export type PresetId = 'none' | 'crt' | 'film' | 'aurora' | 'vaporware' | 'juice'

export interface Layer {
  id: string
  frag: string
  blend: 'normal' | 'screen'
  scale: number
}

export interface Preset {
  id: PresetId
  name: string
  blurb: string
  swatch: string
  layers: Partial<Record<ShaderTarget, Layer>>
}

export const PRELUDE = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform vec2 css;
uniform float t;
uniform float I;
uniform float dark;
uniform float focus;
uniform vec2 mouse;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
vec4 over(vec4 d, vec4 s) {
  float a = s.a + d.a * (1.0 - s.a);
  vec3 c = a > 0.0 ? (s.rgb * s.a + d.rgb * d.a * (1.0 - s.a)) / a : vec3(0.0);
  return vec4(c, a);
}
float edgeDist() { vec2 cp = uv * css; return min(min(cp.x, css.x - cp.x), min(cp.y, css.y - cp.y)); }

vec4 shade(vec2 p);
void main() {
  vec4 c = shade(vec2(uv.x, 1.0 - uv.y));
  float a = clamp(c.a, 0.0, 1.0);
  o = vec4(clamp(c.rgb, 0.0, 1.0) * a, a);
}
`

const CAUSTIC = `
float caustic(vec2 q, float tm) {
  vec2 pp = mod(q * 6.2831853, 6.2831853) - 250.0;
  vec2 i = pp;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = tm * 0.5 * (1.0 - 3.5 / float(n + 1));
    i = pp + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(pp.x / (sin(i.x + tt) / 0.005), pp.y / (cos(i.y + tt) / 0.005)));
  }
  c /= 4.0;
  return pow(abs(1.17 - pow(c, 1.4)), 8.0);
}
`

const CRT_OVERLAY = `
vec4 shade(vec2 p) {
  vec2 px = p * css;
  vec4 c = vec4(0.0);
  float sl = 0.5 + 0.5 * cos(px.y * 2.0943951);
  c = over(c, vec4(0.0, 0.0, 0.0, (1.0 - sl) * 0.45 * I));
  float m = mod(px.x, 3.0);
  vec3 mask = m < 1.0 ? vec3(1.0, 0.1, 0.1) : (m < 2.0 ? vec3(0.1, 1.0, 0.1) : vec3(0.1, 0.1, 1.0));
  c = over(c, vec4(mask, 0.07 * I));
  float y = fract(p.y - t * 0.09);
  float bar = smoothstep(0.0, 0.2, y) * (1.0 - smoothstep(0.2, 0.45, y));
  c = over(c, vec4(1.0, 1.0, 1.0, bar * 0.05 * I));
  c = over(c, vec4(1.0, 1.0, 1.0, 0.015 * I * (0.5 + 0.5 * sin(t * 110.0))));
  float vg = smoothstep(0.55, 1.5, length(p * 2.0 - 1.0));
  c = over(c, vec4(0.0, 0.0, 0.0, vg * 0.65 * I));
  return c;
}`

const FILM_OVERLAY = `
vec4 shade(vec2 p) {
  vec2 px = p * css;
  float fr = floor(t * 24.0);
  vec4 c = vec4(1.0, 0.78, 0.48, 0.07 * I);
  float vg = smoothstep(0.45, 1.45, length(p * 2.0 - 1.0));
  c = over(c, vec4(0.0, 0.0, 0.0, vg * 0.55 * I));
  float n = hash(floor(px / 1.6) + fr * vec2(17.0, 31.0));
  c = over(c, vec4(n > 0.5 ? vec3(1.0) : vec3(0.0), abs(n - 0.5) * 0.3 * I));
  float gate = step(0.8, hash(vec2(floor(t * 12.0), 3.0)));
  c = over(c, vec4(1.0, 1.0, 1.0, gate * 0.04 * I));
  float k = floor(t * 6.0);
  float sx = hash(vec2(k, 9.0)) * css.x;
  float on = step(0.7, hash(vec2(k, 5.0))) * step(0.3, vnoise(vec2(p.y * 40.0, k)));
  c = over(c, vec4(1.0, 1.0, 1.0, on * (1.0 - smoothstep(0.2, 0.9, abs(px.x - sx))) * 0.3 * I));
  return c;
}`

const AURORA_DESKTOP = `
vec4 shade(vec2 p) {
  float asp = css.x / css.y;
  float qx = p.x * asp;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = qx * 1.2 + fi * 1.7;
    float ridge = 0.26 + 0.09 * fi + 0.10 * sin(x * 1.3 + t * 0.11 * (1.0 + fi * 0.3)) + 0.06 * sin(x * 2.9 - t * 0.17 + fi * 2.0);
    float d = p.y - ridge;
    float k = d < 0.0 ? exp(d * 3.5) : exp(-d * 16.0);
    float streak = 0.5 + 0.5 * vnoise(vec2(qx * 28.0 + fi * 5.0, t * 0.4));
    col += hsv(0.36 + 0.11 * fi + 0.05 * sin(t * 0.07), 0.65, 1.0) * k * streak * (0.55 - 0.08 * fi);
  }
  return vec4(col * I * mix(2.4, 1.6, dark), 1.0);
}`

const AURORA_WINDOW = `
vec4 shade(vec2 p) {
  float edge = edgeDist();
  float ang = atan(p.y - 0.5, (p.x - 0.5) * css.x / css.y);
  vec3 irid = hsv(ang / 6.2831853 + t * 0.04 + p.x * 0.3, 0.55, 1.0);
  vec4 c = vec4(irid, exp(-edge / 3.0) * (0.9 * focus + 0.25) * I);
  float s = p.x * 0.7 + p.y * 0.3 - fract(t * 0.06) * 2.2 + 0.6;
  c = over(c, vec4(1.0, 1.0, 1.0, exp(-pow(s * 5.0, 2.0)) * 0.18 * I * (0.4 + 0.6 * focus)));
  float g = length((p - mouse) * css);
  c = over(c, vec4(hsv(t * 0.05, 0.25, 1.0), exp(-g / 200.0) * 0.2 * I * (0.5 + 0.5 * focus)));
  return c;
}`

const VAPOR_DESKTOP = `
vec4 shade(vec2 p) {
  float asp = css.x / css.y;
  float hz = 0.62;
  vec2 q = vec2((p.x - 0.5) * asp, p.y);
  vec4 c = vec4(0.0);
  float dy = p.y - hz;
  float ady = max(abs(dy), 0.002);
  float wx = q.x / ady * 1.2;
  float wz = 0.12 / ady - t * 0.6;
  float lx = 1.0 - smoothstep(0.0, fwidth(wx) * 1.5, abs(fract(wx + 0.5) - 0.5));
  float lz = 1.0 - smoothstep(0.0, fwidth(wz) * 1.5, abs(fract(wz + 0.5) - 0.5));
  if (dy < 0.0) {
    c = vec4(mix(vec3(0.55, 0.2, 0.9), vec3(1.0, 0.35, 0.65), p.y / hz), 0.4 * I * smoothstep(0.0, hz, p.y));
    float sc = hz - 0.17;
    float yy = (p.y - sc) / 0.17;
    float disc = 1.0 - smoothstep(0.17 - 0.002, 0.17 + 0.002, length(q - vec2(0.0, sc)));
    float vis = step(clamp(yy * 0.9, 0.0, 1.0), fract(p.y * 38.0));
    c = over(c, vec4(mix(vec3(1.0, 0.92, 0.3), vec3(1.0, 0.2, 0.6), clamp((yy + 1.0) * 0.5, 0.0, 1.0)), disc * vis * min(1.0, I * 1.3)));
  } else {
    c = vec4(0.15, 0.0, 0.3, 0.35 * I);
    float fade = smoothstep(0.0, 0.25, dy);
    c = over(c, vec4(mix(vec3(1.0, 0.2, 0.8), vec3(0.2, 0.9, 1.0), clamp(dy * 3.0, 0.0, 1.0)), max(lx, lz) * fade * 1.1 * I));
  }
  return over(c, vec4(1.0, 0.4, 0.75, exp(-abs(dy) * 50.0) * 0.8 * I));
}`

const VAPOR_WINDOW = `
vec4 shade(vec2 p) {
  vec3 g = mix(vec3(1.0, 0.25, 0.8), vec3(0.2, 0.9, 1.0), clamp(p.x * 0.7 + p.y * 0.5 + 0.1 * sin(t * 0.3), 0.0, 1.0));
  vec4 c = vec4(g, 0.18 * I * pow(1.0 - p.y, 3.0));
  c = over(c, vec4(g, exp(-edgeDist() / 3.2) * (0.9 * focus + 0.3) * I));
  float line = step(1.0, mod(p.y * css.y, 3.0));
  return over(c, vec4(0.0, 0.0, 0.0, (1.0 - line) * 0.07 * I));
}`

const JUICE_DESKTOP = `${CAUSTIC}
vec4 shade(vec2 p) {
  float v = caustic(vec2(p.x * css.x / css.y, p.y), t);
  return vec4(vec3(0.72, 1.0, 0.35) * v * I * 2.6, 1.0);
}`

const JUICE_WINDOW = `${CAUSTIC}
vec4 shade(vec2 p) {
  float v = caustic(vec2(p.x * css.x / css.y, p.y) * 0.9, t);
  vec4 c = vec4(0.85, 1.0, 0.5, v * 0.34 * I * (0.4 + 0.6 * focus));
  return over(c, vec4(0.62, 0.9, 0.2, exp(-edgeDist() / 3.0) * (0.9 * focus + 0.25) * I));
}`

const layer = (id: string, frag: string, blend: Layer['blend'], scale: number): Layer => ({ id, frag, blend, scale })

export const PRESETS: Record<PresetId, Preset> = {
  aurora: {
    id: 'aurora',
    name: 'Aurora Glass',
    blurb: 'Northern lights over the desktop. Iridescent window rims, a slow sheen and a glare that follows your pointer.',
    swatch: 'linear-gradient(160deg, #06122b 0%, #0b3b4a 40%, #27d19b 62%, #8a5cff 85%)',
    layers: {
      desktop: layer('aurora:desktop', AURORA_DESKTOP, 'screen', 0.5),
      windows: layer('aurora:windows', AURORA_WINDOW, 'normal', 0.75),
    },
  },
  vaporware: {
    id: 'vaporware',
    name: 'Vaporware',
    blurb: 'A sunset, a scrolling grid and a feature announced in 1997 that never shipped.',
    swatch: 'linear-gradient(180deg, #2a0a5e 0%, #c3329a 52%, #ffd23f 60%, #14052e 62%, #ff2ec8 100%)',
    layers: {
      desktop: layer('vaporware:desktop', VAPOR_DESKTOP, 'normal', 0.5),
      windows: layer('vaporware:windows', VAPOR_WINDOW, 'normal', 0.75),
    },
  },
  juice: {
    id: 'juice',
    name: 'Pear Juice',
    blurb: 'Lime caustics, as if the desktop were the bottom of a fruit bowl filled with water.',
    swatch: 'radial-gradient(circle at 30% 30%, #f1ff9a 0%, #8bd12b 40%, #1f6f2a 100%)',
    layers: {
      desktop: layer('juice:desktop', JUICE_DESKTOP, 'screen', 0.5),
      windows: layer('juice:windows', JUICE_WINDOW, 'normal', 0.75),
    },
  },
  crt: {
    id: 'crt',
    name: 'Cathode',
    blurb: 'Scanlines, a phosphor mask, a rolling bar and tube vignette over the whole screen. Bezel not included.',
    swatch: 'repeating-linear-gradient(0deg, #0c1a10 0 2px, #17331f 2px 4px)',
    layers: { overlay: layer('crt:overlay', CRT_OVERLAY, 'normal', 1) },
  },
  film: {
    id: 'film',
    name: 'Film Stock',
    blurb: 'Grain, gate flicker, dust and a warm tint. Shot on 35mm Pear.',
    swatch: 'radial-gradient(circle at 50% 45%, #d9b98a 0%, #6d5538 70%, #1c140c 100%)',
    layers: { overlay: layer('film:overlay', FILM_OVERLAY, 'normal', 1) },
  },
  none: {
    id: 'none',
    name: 'None',
    blurb: 'No decoration. Pair it with Lighting for shadows and nothing else.',
    swatch: 'linear-gradient(135deg, #e9e9ee, #c9c9d2)',
    layers: {},
  },
}

export const PRESET_ORDER: PresetId[] = ['aurora', 'vaporware', 'juice', 'crt', 'film', 'none']

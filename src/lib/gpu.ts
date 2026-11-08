export interface GpuInfo {
  available: boolean
  renderer: string
  vendor: string
  maxTexture: number
}

let cached: GpuInfo | null = null

function tidy(renderer: string) {
  const angle = renderer.match(/^ANGLE \((.*)\)$/)
  if (!angle) return renderer
  const parts = angle[1].split(', ')
  return (parts.length >= 2 ? parts[1] : parts[0])
    .replace(/^ANGLE Metal Renderer:\s*/, '')
    .replace(/\s*\(0x[0-9a-f]+\)/i, '')
    .replace(/\s+(Direct3D|vs_|ps_).*$/, '')
    .trim()
}

export function gpuInfo(): GpuInfo {
  if (cached) return cached
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) throw new Error('no webgl2')
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string)
    const vendor = dbg ? (gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string) : (gl.getParameter(gl.VENDOR) as string)
    cached = { available: true, renderer: tidy(renderer), vendor, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number }
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    cached = { available: false, renderer: 'None (software rendering)', vendor: '', maxTexture: 0 }
  }
  return cached
}

export function cssSize(canvas: HTMLCanvasElement, onChange: () => void) {
  const size = { w: canvas.clientWidth, h: canvas.clientHeight, stop: () => ro.disconnect() }
  const ro = new ResizeObserver(([e]) => {
    const { width, height } = e.contentRect
    if (width === size.w && height === size.h) return
    size.w = width
    size.h = height
    onChange()
  })
  ro.observe(canvas)
  return size
}

export function release(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
  setTimeout(() => {
    if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }, 0)
}

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

export function compile(gl: WebGL2RenderingContext, frag: string) {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
    return s
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, make(gl.FRAGMENT_SHADER, frag))
  gl.bindAttribLocation(prog, 0, 'p')
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.useProgram(prog)
  const uniforms = new Map<string, WebGLUniformLocation | null>()
  const u = (name: string) => {
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(prog, name))
    return uniforms.get(name)!
  }
  return Object.assign(u, { prog })
}

const WAVES_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform float t;
uniform vec3 sky0, sky1;
uniform vec3 top[7], mid[7], bot[7];
uniform float crest[7];
uniform float dark;

float wave(int i, float x, float t) {
  float fi = float(i);
  return crest[i]
    + 0.075 * sin(x * 3.1 + fi * 1.7 + t * 0.21)
    + 0.045 * sin(x * 5.3 - fi * 0.9 + t * 0.33)
    + 0.022 * sin(x * 9.7 + fi * 2.3 - t * 0.47);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  float aspect = res.x / res.y;
  vec2 q = vec2(uv.x, 1.0 - uv.y);
  float x = (q.x - 0.5) * max(aspect, 1.0) * 1.6;
  vec3 col = mix(sky0, sky1, q.y);
  float px = 1.5 / res.y;
  for (int i = 0; i < 7; i++) {
    float h = wave(i, x, t);
    float d = q.y - h;
    float shadow = d < 0.0 ? exp(d * 22.0) * mix(0.32, 0.55, dark) : 0.0;
    col *= 1.0 - shadow;
    vec3 band = d < 0.22 ? mix(top[i], mid[i], smoothstep(-0.02, 0.22, d)) : mix(mid[i], bot[i], smoothstep(0.22, 0.6, d));
    float sheen = exp(-max(d, 0.0) * 90.0) * (0.55 - 0.35 * dark) * (0.6 + 0.4 * sin(x * 2.0 + t * 0.3 + float(i)));
    band += sheen;
    col = mix(col, band, smoothstep(-px, px, d));
  }
  vec2 v = q - vec2(0.5, 0.45);
  col *= 1.0 - smoothstep(0.45, 1.1, length(v * vec2(aspect, 1.0) / max(aspect, 1.0) * 1.4)) * mix(0.25, 0.5, dark);
  col += (hash(gl_FragCoord.xy + t) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

export interface WavePalette {
  sky: [string, string]
  bands: [string, string, string][]
}

export class WaveRenderer {
  private gl: WebGL2RenderingContext
  private u: ReturnType<typeof compile>
  private raf = 0
  private last = 0
  private start = performance.now()
  private visible = () => this.loop()
  private size: ReturnType<typeof cssSize>

  constructor(
    private canvas: HTMLCanvasElement,
    private scale: number,
    private animate: boolean,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })
    if (!gl) throw new Error('webgl2 unavailable')
    this.gl = gl
    this.u = compile(gl, WAVES_FRAG)
    this.size = cssSize(canvas, () => {
      if (!this.animate) this.draw(performance.now())
    })
    this.start -= Math.random() * 600_000
    document.addEventListener('visibilitychange', this.visible)
  }

  setPalette(p: WavePalette, dark: boolean) {
    const { gl, u } = this
    gl.uniform3fv(u('sky0'), hex(p.sky[0]))
    gl.uniform3fv(u('sky1'), hex(p.sky[1]))
    gl.uniform3fv(u('top'), p.bands.flatMap((b) => hex(b[0])))
    gl.uniform3fv(u('mid'), p.bands.flatMap((b) => hex(b[1])))
    gl.uniform3fv(u('bot'), p.bands.flatMap((b) => hex(b[2])))
    gl.uniform1fv(u('crest'), [0.13, 0.28, 0.42, 0.55, 0.68, 0.8, 0.92])
    gl.uniform1f(u('dark'), dark ? 1 : 0)
    if (!this.animate) this.draw(performance.now())
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.scale
    const w = Math.max(1, Math.round(this.size.w * dpr))
    const h = Math.max(1, Math.round(this.size.h * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.gl.viewport(0, 0, w, h)
    }
  }

  draw(now: number) {
    this.resize()
    const { gl, u } = this
    gl.uniform2f(u('res'), this.canvas.width, this.canvas.height)
    gl.uniform1f(u('t'), (now - this.start) / 1000)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  loop() {
    cancelAnimationFrame(this.raf)
    if (!this.animate || document.hidden) return this.draw(performance.now())
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
    this.size.stop()
    document.removeEventListener('visibilitychange', this.visible)
    release(this.canvas, this.gl)
  }
}

const MANDEL_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform vec2 res;
uniform vec2 center;
uniform float scale;
uniform int iter;
uniform int scheme;

vec3 palette(float t) {
  vec3 a, b, c = vec3(1.0), d;
  if (scheme == 1) { a = vec3(0.45, 0.55, 0.25); b = vec3(0.45, 0.45, 0.25); d = vec3(0.05, 0.10, 0.30); }
  else if (scheme == 2) { a = vec3(0.5); b = vec3(0.5); d = vec3(0.0, 0.33, 0.67); }
  else { a = vec3(0.35, 0.40, 0.65); b = vec3(0.35); d = vec3(0.55, 0.60, 0.70); }
  return clamp(a + b * cos(6.2831853 * (c * t + d)), 0.0, 1.0);
}

void main() {
  float aspect = res.x / res.y;
  vec2 c0 = center + vec2((uv.x - 0.5) * scale * aspect, (0.5 - uv.y) * scale);
  float q = (c0.x - 0.25) * (c0.x - 0.25) + c0.y * c0.y;
  if (q * (q + (c0.x - 0.25)) <= 0.25 * c0.y * c0.y || (c0.x + 1.0) * (c0.x + 1.0) + c0.y * c0.y <= 0.0625) {
    o = vec4(8.0 / 255.0, 10.0 / 255.0, 24.0 / 255.0, 1.0);
    return;
  }
  vec2 z = vec2(0.0);
  int n = 0;
  for (int i = 0; i < 20000; i++) {
    if (i >= iter || dot(z, z) > 256.0) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c0;
    n++;
  }
  if (n >= iter) { o = vec4(8.0 / 255.0, 10.0 / 255.0, 24.0 / 255.0, 1.0); return; }
  float mu = float(n) + 1.0 - log(log(dot(z, z)) * 0.5) / log(2.0);
  o = vec4(palette(mu * 0.025), 1.0);
}`

export const GPU_MIN_SCALE = 4e-5

export class MandelbrotGL {
  private gl: WebGL2RenderingContext
  private u: ReturnType<typeof compile>
  private px = new Uint8Array(4)

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
    if (!gl) throw new Error('webgl2 unavailable')
    this.gl = gl
    this.u = compile(gl, MANDEL_FRAG)
  }

  render(v: { cx: number; cy: number; scale: number; iter: number; scheme: number }) {
    const { gl, u, canvas } = this
    const t0 = performance.now()
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(u('res'), canvas.width, canvas.height)
    gl.uniform2f(u('center'), v.cx, v.cy)
    gl.uniform1f(u('scale'), v.scale)
    gl.uniform1i(u('iter'), v.iter)
    gl.uniform1i(u('scheme'), v.scheme)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px)
    return performance.now() - t0
  }

  dispose() {
    release(this.canvas, this.gl)
  }
}

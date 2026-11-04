// Preview's image engine.
//
// Bitmaps are plain 2D canvases and are treated as immutable: every operation returns a new canvas,
// which is what makes undo cheap (history entries just hold references).
//
// Hot path: one shared WebGL2 context runs a single shader that does geometry (quarter-turn
// rotation, flips, resampling) and the whole Adjust Color pipeline in one pass. Live slider previews
// render through it every frame. If WebGL2 is missing, the context is lost, or the image is bigger
// than the GPU's max texture, the work falls back to the Pearnel kernel (Rust → WASM, SIMD) for
// colour and canvas 2D for geometry. The colour maths in ADJUST_FRAG and kernel/src/imaging.rs are
// twins; change them together.

import { kernelAdjust, kernelApplyMask, kernelAutoLevels, kernelFloodMask, kernelHistogram, kernelReady, releaseResident } from '../kernel'

export interface Adjust {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  saturation: number
  temperature: number
  tint: number
  sepia: number
  sharpness: number
  black: number
  white: number
  gamma: number
}

export const NEUTRAL: Adjust = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, temperature: 0, tint: 0, sepia: 0, sharpness: 0, black: 0, white: 1, gamma: 1 }
const ORDER: (keyof Adjust)[] = ['exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'temperature', 'tint', 'sepia', 'sharpness', 'black', 'white', 'gamma']
export const isNeutral = (a: Adjust) => ORDER.every((k) => Math.abs(a[k] - NEUTRAL[k]) < 1e-4)
const pack = (a: Adjust) => new Float32Array(ORDER.map((k) => a[k]))

export type Quarter = 0 | 1 | 2 | 3

export interface Op {
  /** Clockwise quarter turns. */
  rotate?: Quarter
  flipH?: boolean
  flipV?: boolean
  /** Output size (after rotation). Defaults to the rotated source size. */
  width?: number
  height?: number
  adjust?: Adjust
}

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: false })!

// ---- GPU ----------------------------------------------------------------------------------------

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const ADJUST_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D img;
uniform mat3 xf;
uniform vec2 texel;
uniform float exposure, contrast, highlights, shadows, saturation, temperature, tint, sepia, sharpness, black, white, gamma;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec2 st = (xf * vec3(uv.x, 1.0 - uv.y, 1.0)).xy;
  vec4 s = texture(img, st);
  vec3 c = s.rgb;
  if (sharpness > 0.0) {
    vec3 avg = (texture(img, st + vec2(texel.x, 0.0)).rgb + texture(img, st - vec2(texel.x, 0.0)).rgb
              + texture(img, st + vec2(0.0, texel.y)).rgb + texture(img, st - vec2(0.0, texel.y)).rgb) * 0.25;
    c = clamp(c + sharpness * 1.5 * (c - avg), 0.0, 1.0);
  }
  float span = max(white - black, 1e-3);
  c = pow(clamp((c - black) / span, 0.0, 1.0), vec3(1.0 / max(gamma, 0.01))) * exp2(exposure);
  c.r *= 1.0 + 0.2 * temperature;
  c.b *= 1.0 - 0.2 * temperature;
  c.g *= 1.0 - 0.15 * tint;
  float l = dot(c, LUMA);
  float lift = shadows * (1.0 - smoothstep(0.0, 0.5, l)) * 0.35 + highlights * smoothstep(0.5, 1.0, l) * 0.35;
  c = (c + lift - 0.5) * (1.0 + contrast) + 0.5;
  l = dot(c, LUMA);
  c = l + (c - l) * (1.0 + saturation);
  vec3 sp = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  c = clamp(mix(c, sp, sepia), 0.0, 1.0);
  o = vec4(c * s.a, s.a);
}`

/** Affine map from output (u, v) to source (su, sv), both in 0..1 with a top-left origin. */
function geometry(rotate: Quarter, flipH: boolean, flipV: boolean) {
  // [a, b, c, d, e, f]: su = a·u + b·v + c, sv = d·u + e·v + f
  const R: Record<Quarter, number[]> = {
    0: [1, 0, 0, 0, 1, 0],
    1: [0, 1, 0, -1, 0, 1],
    2: [-1, 0, 1, 0, -1, 1],
    3: [0, -1, 1, 1, 0, 0],
  }
  let [a, b, c, d, e, f] = R[rotate]
  // Flips happen in output space, before the rotation lookup: u → 1 − u, v → 1 − v.
  if (flipH) [a, c, d, f] = [-a, a + c, -d, d + f]
  if (flipV) [b, c, e, f] = [-b, b + c, -e, e + f]
  return new Float32Array([a, d, 0, b, e, 0, c, f, 1])
}

class ImageGL {
  readonly canvas = document.createElement('canvas')
  readonly gl: WebGL2RenderingContext
  readonly maxTexture: number
  private loc = new Map<string, WebGLUniformLocation | null>()
  private tex: WebGLTexture
  private source: HTMLCanvasElement | null = null
  private mipmapped = false
  lost = false

  constructor() {
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' })
    if (!gl) throw new Error('webgl2 unavailable')
    this.gl = gl
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, ADJUST_FRAG))
    gl.bindAttribLocation(prog, 0, 'p')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.loc = new Map(['img', 'xf', 'texel', ...ORDER].map((n) => [n, gl.getUniformLocation(prog, n)]))
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.uniform1i(this.loc.get('img')!, 0)
  }

  fits(w: number, h: number) {
    return !this.lost && w <= this.maxTexture && h <= this.maxTexture
  }

  /** Renders `src` through `op` into this context's canvas; read it back synchronously with drawImage. */
  render(src: HTMLCanvasElement, op: Op, outW: number, outH: number) {
    const { gl } = this
    if (src !== this.source) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
      this.source = src
      this.mipmapped = false
    }
    const rot = op.rotate ?? 0
    const natW = rot % 2 ? src.height : src.width
    const natH = rot % 2 ? src.width : src.height
    const exact = outW === natW && outH === natH
    if (!exact && outW < natW && !this.mipmapped) {
      gl.generateMipmap(gl.TEXTURE_2D)
      this.mipmapped = true
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, exact ? gl.NEAREST : gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, exact ? gl.NEAREST : outW < natW ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    if (this.canvas.width !== outW || this.canvas.height !== outH) {
      this.canvas.width = outW
      this.canvas.height = outH
    }
    gl.viewport(0, 0, outW, outH)
    gl.uniformMatrix3fv(this.loc.get('xf')!, false, geometry(rot, !!op.flipH, !!op.flipV))
    gl.uniform2f(this.loc.get('texel')!, 1 / src.width, 1 / src.height)
    const a = op.adjust ?? NEUTRAL
    for (const k of ORDER) gl.uniform1f(this.loc.get(k)!, a[k])
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas
  }

  /** Drop the texture reference so a discarded bitmap can be garbage-collected. */
  forget(src: HTMLCanvasElement) {
    if (this.source === src) this.source = null
  }
}

let shared: ImageGL | null | undefined
function gpu(): ImageGL | null {
  if (shared === undefined) {
    try {
      shared = new ImageGL()
    } catch {
      shared = null
    }
  }
  if (shared?.lost) shared = null
  return shared
}

export function engineInfo() {
  const g = gpu()
  return g ? { backend: 'GPU' as const, maxTexture: g.maxTexture } : { backend: kernelReady() ? ('WASM' as const) : ('Canvas' as const), maxTexture: 0 }
}

// ---- CPU fallback -------------------------------------------------------------------------------

function geometryCPU(src: HTMLCanvasElement, op: Op, outW: number, outH: number) {
  const rot = op.rotate ?? 0
  const out = makeCanvas(outW, outH)
  const c = ctx2d(out)
  c.imageSmoothingQuality = 'high'
  c.translate(outW / 2, outH / 2)
  c.scale(op.flipH ? -1 : 1, op.flipV ? -1 : 1)
  c.rotate((rot * Math.PI) / 2)
  const [dw, dh] = rot % 2 ? [outH, outW] : [outW, outH]
  c.drawImage(src, -dw / 2, -dh / 2, dw, dh)
  return out
}

function adjustCPU(src: HTMLCanvasElement, a: Adjust) {
  const out = makeCanvas(src.width, src.height)
  const c = ctx2d(out)
  c.drawImage(src, 0, 0)
  if (!kernelReady()) return out
  const img = c.getImageData(0, 0, out.width, out.height)
  kernelAdjust(img, pack(a))
  c.putImageData(img, 0, 0)
  return out
}

// ---- Public API ---------------------------------------------------------------------------------

export function outputSize(src: { width: number; height: number }, op: Op) {
  const rot = op.rotate ?? 0
  return { w: Math.round(op.width ?? (rot % 2 ? src.height : src.width)), h: Math.round(op.height ?? (rot % 2 ? src.width : src.height)) }
}

/** Applies geometry + colour in a single pass and returns a fresh canvas. */
export function process(src: HTMLCanvasElement, op: Op): HTMLCanvasElement {
  const { w, h } = outputSize(src, op)
  const g = gpu()
  if (g && g.fits(src.width, src.height) && g.fits(w, h)) {
    const rendered = g.render(src, op, w, h)
    const out = makeCanvas(w, h)
    ctx2d(out).drawImage(rendered, 0, 0)
    return out
  }
  let out = op.rotate || op.flipH || op.flipV || w !== src.width || h !== src.height ? geometryCPU(src, op, w, h) : src
  if (op.adjust && !isNeutral(op.adjust)) out = adjustCPU(out, op.adjust)
  return out === src ? copy(src) : out
}

/**
 * Live preview for Adjust Color: draws `src` graded by `a` into `target` (which should match `src`'s
 * size). On the GPU this is a full-resolution render per frame; without one, it grades a downscaled
 * copy so dragging a slider stays interactive.
 */
export function previewInto(target: HTMLCanvasElement, src: HTMLCanvasElement, a: Adjust) {
  const c = ctx2d(target)
  const g = gpu()
  c.clearRect(0, 0, target.width, target.height)
  if (g && g.fits(src.width, src.height)) {
    c.drawImage(g.render(src, { adjust: a }, src.width, src.height), 0, 0, target.width, target.height)
    return
  }
  const scale = Math.min(1, 1024 / Math.max(src.width, src.height))
  const small = scale < 1 ? geometryCPU(src, {}, src.width * scale, src.height * scale) : src
  c.imageSmoothingQuality = 'high'
  c.drawImage(isNeutral(a) ? small : adjustCPU(small, a), 0, 0, target.width, target.height)
}

export function copy(src: HTMLCanvasElement) {
  const out = makeCanvas(src.width, src.height)
  ctx2d(out).drawImage(src, 0, 0)
  return out
}

export function crop(src: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }) {
  const x = Math.max(0, Math.round(r.x))
  const y = Math.max(0, Math.round(r.y))
  const w = Math.min(src.width - x, Math.round(r.w))
  const h = Math.min(src.height - y, Math.round(r.h))
  const out = makeCanvas(w, h)
  ctx2d(out).drawImage(src, x, y, w, h, 0, 0, w, h)
  return out
}

export function fromImage(img: CanvasImageSource, w: number, h: number) {
  const out = makeCanvas(w, h)
  ctx2d(out).drawImage(img, 0, 0, w, h)
  return out
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
  } catch {
    throw new Error('The file couldn’t be opened. It may be damaged or use a format Preview doesn’t recognize.')
  }
  return img
}

export function encode(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error(`This browser can’t write ${type.split('/')[1].toUpperCase()} files.`))), type, quality))
}

export const blobToDataURL = (b: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok(r.result as string)
    r.onerror = () => fail(r.error)
    r.readAsDataURL(b)
  })

export function thumbnail(src: HTMLCanvasElement, max = 240) {
  const s = Math.min(1, max / Math.max(src.width, src.height))
  const g = gpu()
  if (g && g.fits(src.width, src.height)) return process(src, { width: Math.max(1, Math.round(src.width * s)), height: Math.max(1, Math.round(src.height * s)) })
  return geometryCPU(src, {}, src.width * s, src.height * s)
}

/** Histogram (R, G, B, luma × 256) of a downsampled copy — plenty for a 200px-wide chart. */
export function histogram(src: HTMLCanvasElement) {
  const small = thumbnail(src, 512)
  const data = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height)
  return kernelHistogram(data)
}

/** Levels from the histogram most recently computed by `histogram`. */
export const autoLevels = kernelAutoLevels

// ---- Instant Alpha ------------------------------------------------------------------------------

const pixelCache = new WeakMap<HTMLCanvasElement, ImageData>()
function pixels(src: HTMLCanvasElement) {
  let d = pixelCache.get(src)
  if (!d) {
    d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, src.width, src.height)
    pixelCache.set(src, d)
  }
  return d
}

/** Paints the flood-fill selection (as a tinted overlay) into `overlay`, sized like `src`. */
export function alphaPreview(src: HTMLCanvasElement, x: number, y: number, tol: number, overlay: HTMLCanvasElement) {
  const { mask, count } = kernelFloodMask(pixels(src), Math.floor(x), Math.floor(y), tol)
  if (overlay.width !== src.width || overlay.height !== src.height) {
    overlay.width = src.width
    overlay.height = src.height
  }
  const out = new ImageData(src.width, src.height)
  const o = out.data
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const j = i * 4
    o[j] = 255
    o[j + 1] = 40
    o[j + 2] = 80
    o[j + 3] = 130
  }
  overlay.getContext('2d')!.putImageData(out, 0, 0)
  return count
}

/** Commits the last `alphaPreview` selection: those pixels become transparent. */
export function applyAlpha(src: HTMLCanvasElement) {
  const data = new ImageData(new Uint8ClampedArray(pixels(src).data), src.width, src.height)
  kernelApplyMask(data)
  releaseResident()
  const out = makeCanvas(src.width, src.height)
  out.getContext('2d')!.putImageData(data, 0, 0)
  gpu()?.forget(src)
  return out
}

export const cancelAlpha = releaseResident

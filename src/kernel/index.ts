import wasmUrl from './pearnel.wasm?url'

interface PearnelExports {
  memory: WebAssembly.Memory
  alloc(len: number): number
  dealloc(ptr: number, len: number): void
  calc(ptr: number, len: number): number
  render_mandelbrot(w: number, h: number, cx: number, cy: number, scale: number, maxIter: number, scheme: number): number
  kernel_task_cpu(t: number): number
  entropy(): number
  password_strength(ptr: number, len: number): number
  kernel_version_ptr(): number
  kernel_version_len(): number
  img_adjust(ptr: number, w: number, h: number, params: number): void
  img_histogram(ptr: number, len: number): number
  img_auto_levels(): number
  img_flood_mask(ptr: number, w: number, h: number, x: number, y: number, tol: number, countOut: number): number
  img_apply_mask(ptr: number, w: number, h: number): void
}

let k: PearnelExports | null = null
let booting: Promise<void> | null = null
const enc = new TextEncoder()
const dec = new TextDecoder()

export function bootKernel(): Promise<void> {
  if (k) return Promise.resolve()
  booting ??= (async () => {
    const res = await fetch(wasmUrl)
    const bytes = await res.arrayBuffer()
    const { instance } = await WebAssembly.instantiate(bytes, {})
    k = instance.exports as unknown as PearnelExports
  })()
  return booting
}

export const kernelReady = () => k !== null

function withString<T>(s: string, fn: (ptr: number, len: number) => T): T {
  if (!k) throw new Error('kernel not booted')
  const bytes = enc.encode(s)
  const ptr = k.alloc(bytes.length)
  new Uint8Array(k.memory.buffer, ptr, bytes.length).set(bytes)
  try {
    return fn(ptr, bytes.length)
  } finally {
    k.dealloc(ptr, bytes.length)
  }
}
export function normaliseExpr(s: string) {
  return s
    .replace(/[×x](?=\s*[\d(.])/g, '*')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .replace(/,/g, '')
}
export function calc(expr: string): number | null {
  if (!k || !expr.trim()) return null
  const v = withString(normaliseExpr(expr), (p, l) => k!.calc(p, l))
  return Number.isNaN(v) ? null : v
}

export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '-∞' : 'Error'
  if (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-9 && v !== 0)) return v.toExponential(6).replace(/\.?0+e/, 'e')
  return Number(v.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 10 })
}

export function passwordStrength(pw: string): number {
  if (!k) return 0
  return withString(pw, (p, l) => k!.password_strength(p, l))
}

export function kernelTaskCpu(t: number) {
  return k ? k.kernel_task_cpu(t) : 300
}

export function entropy() {
  return k ? k.entropy() : Math.random()
}

export function kernelVersion() {
  if (!k) return 'Pearnel (not booted)'
  return dec.decode(new Uint8Array(k.memory.buffer, k.kernel_version_ptr(), k.kernel_version_len()))
}

export type FractalScheme = 0 | 1 | 2

export interface FractalView {
  cx: number
  cy: number
  scale: number
  iter: number
  scheme: FractalScheme
}

export const DEFAULT_VIEW: FractalView = { cx: -0.745, cy: 0.11, scale: 0.12, iter: 400, scheme: 0 }
export function renderMandelbrot(canvas: HTMLCanvasElement, v: FractalView): number {
  if (!k) return 0
  const w = canvas.width
  const h = canvas.height
  const t0 = performance.now()
  const ptr = k.render_mandelbrot(w, h, v.cx, v.cy, v.scale, v.iter, v.scheme)
  const px = new Uint8ClampedArray(k.memory.buffer, ptr, w * h * 4)
  const img = new ImageData(new Uint8ClampedArray(px), w, h)
  canvas.getContext('2d')!.putImageData(img, 0, 0)
  return performance.now() - t0
}

// ---- Imaging (Preview) --------------------------------------------------------------------------
// Pixels are copied into linear memory, processed in place, and copied back out. The colour maths
// mirrors the WebGL shader in lib/imaging.ts; this path runs when there's no GPU (or the image is
// bigger than the GPU's max texture).

function withPixels<T>(data: Uint8ClampedArray, fn: (ptr: number) => T, writeBack = false): T {
  if (!k) throw new Error('kernel not booted')
  const ptr = k.alloc(data.length)
  new Uint8Array(k.memory.buffer, ptr, data.length).set(data)
  try {
    const out = fn(ptr)
    if (writeBack) data.set(new Uint8Array(k.memory.buffer, ptr, data.length))
    return out
  } finally {
    k.dealloc(ptr, data.length)
  }
}

export function kernelAdjust(img: ImageData, params: Float32Array) {
  if (!k) throw new Error('kernel not booted')
  const pp = k.alloc(params.byteLength)
  new Float32Array(k.memory.buffer, pp, params.length).set(params)
  try {
    withPixels(img.data, (ptr) => k!.img_adjust(ptr, img.width, img.height, pp), true)
  } finally {
    k.dealloc(pp, params.byteLength)
  }
}

/** 1024 bins: R, G, B and luma, 256 each. */
export function kernelHistogram(img: ImageData): Uint32Array {
  if (!k) return new Uint32Array(1024)
  const ptr = withPixels(img.data, (p) => k!.img_histogram(p, img.data.length))
  return new Uint32Array(k.memory.buffer, ptr, 1024).slice()
}

/** [black, white, gamma] for the most recent histogram. */
export function kernelAutoLevels(): [number, number, number] {
  if (!k) return [0, 1, 1]
  const v = new Float32Array(k.memory.buffer, k.img_auto_levels(), 3)
  return [v[0], v[1], v[2]]
}

// Instant Alpha re-runs the flood fill on every pointer move, so the image being worked on stays
// resident in linear memory instead of being copied in each time.
let resident: { img: ImageData; ptr: number } | null = null
function residentPtr(img: ImageData) {
  if (resident?.img === img) return resident.ptr
  releaseResident()
  const ptr = k!.alloc(img.data.length)
  new Uint8Array(k!.memory.buffer, ptr, img.data.length).set(img.data)
  resident = { img, ptr }
  return ptr
}
export function releaseResident() {
  if (resident && k) k.dealloc(resident.ptr, resident.img.data.length)
  resident = null
}

export function kernelFloodMask(img: ImageData, x: number, y: number, tol: number): { mask: Uint8Array; count: number } {
  if (!k) throw new Error('kernel not booted')
  const px = residentPtr(img)
  const cp = k.alloc(4)
  try {
    const ptr = k.img_flood_mask(px, img.width, img.height, x, y, tol, cp)
    const count = new Uint32Array(k.memory.buffer, cp, 1)[0]
    return { mask: new Uint8Array(k.memory.buffer, ptr, img.width * img.height), count }
  } finally {
    k.dealloc(cp, 4)
  }
}

/** Knocks out the pixels selected by the last kernelFloodMask call (on the same image). */
export function kernelApplyMask(img: ImageData) {
  withPixels(img.data, (p) => k!.img_apply_mask(p, img.width, img.height), true)
}

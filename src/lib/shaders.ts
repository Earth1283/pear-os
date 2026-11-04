import { create } from 'zustand'
import { useA11y } from './a11y'
import { gpuInfo } from './gpu'
import { LAMP_HEIGHT, LIGHT_LAYERS, MAX_OCCLUDERS } from './shaderLighting'
import { PRELUDE, PRESETS, type Layer, type PresetId, type ShaderTarget } from './shaderPresets'
import { skyAt, type SkyState } from './sky'
import { useOS } from '../store'

export type { PresetId, ShaderTarget }
export type SinkTarget = ShaderTarget | 'sky' | 'shadow'

export interface ShaderSettings {
  enabled: boolean
  preset: PresetId
  intensity: number
  targets: Record<ShaderTarget, boolean>
  lighting: boolean
  hourOverride: number | null
  hqWater: boolean
  hqSky: boolean
}

export const SHADER_DEFAULTS: ShaderSettings = {
  enabled: false,
  preset: 'aurora',
  intensity: 0.7,
  targets: { desktop: true, windows: true, overlay: true },
  lighting: true,
  hourOverride: null,
  hqWater: false,
  hqSky: false,
}

const KEY = 'pearos.shaders.v1'

function load(): ShaderSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      return {
        enabled: raw.enabled === true,
        preset: raw.preset in PRESETS ? raw.preset : SHADER_DEFAULTS.preset,
        intensity: typeof raw.intensity === 'number' ? Math.min(1, Math.max(0, raw.intensity)) : SHADER_DEFAULTS.intensity,
        targets: { ...SHADER_DEFAULTS.targets, ...(raw.targets ?? {}) },
        lighting: raw.lighting !== false,
        hourOverride: typeof raw.hourOverride === 'number' ? Math.min(24, Math.max(0, raw.hourOverride)) : null,
        hqWater: raw.hqWater === true,
        hqSky: raw.hqSky === true,
      }
    }
  } catch {
    return SHADER_DEFAULTS
  }
  return SHADER_DEFAULTS
}

interface ShaderState extends ShaderSettings {
  set<K extends keyof ShaderSettings>(k: K, v: ShaderSettings[K]): void
  setTarget(t: ShaderTarget, on: boolean): void
}

export const useShaders = create<ShaderState>((set, get) => ({
  ...load(),
  set(k, v) {
    set({ [k]: v } as Partial<ShaderState>)
    save(get())
  },
  setTarget(t, on) {
    set({ targets: { ...get().targets, [t]: on } })
    save(get())
  },
}))

function save(s: ShaderState) {
  const { enabled, preset, intensity, targets, lighting, hourOverride, hqWater, hqSky } = s
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled, preset, intensity, targets, lighting, hourOverride, hqWater, hqSky }))
  } catch {
    return
  }
}

export function layersFor(s: ShaderSettings, target: SinkTarget): Layer[] {
  if (!s.enabled || !gpuInfo().available) return []
  if (target === 'sky' || target === 'shadow') return s.lighting ? [LIGHT_LAYERS[target]] : []
  const out: Layer[] = []
  const preset = s.targets[target] ? PRESETS[s.preset].layers[target] : undefined
  if (preset) out.push(preset)
  if (target === 'windows' && s.lighting) out.push(LIGHT_LAYERS.windows)
  return out
}

const FPS = 30
const STILL_FRAME_MS = 125
const STILL_T = 7.3
const MAX_SIDE = 4096

interface Program {
  prog: WebGLProgram
  loc: Map<string, WebGLUniformLocation | null>
}

export interface SinkOptions {
  focus?: number
  paused?: boolean
}

interface Sink {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  target: SinkTarget
  focusTarget: number
  focus: number
  paused: boolean
  ro: ResizeObserver
}

export interface SinkHandle {
  set(o: SinkOptions): void
  detach(): void
}

export interface ShaderStats {
  fps: number
  ms: number
  layers: number
}

interface Occluder {
  el: Element
  x: number
  y: number
  w: number
  h: number
  height: number
  radius: number
}

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

function gather(): Occluder[] {
  const out: Occluder[] = []
  const push = (el: Element, height: number, radius: number) => {
    const r = el.getBoundingClientRect()
    if (r.width >= 2 && r.height >= 2) out.push({ el, x: r.left, y: r.top, w: r.width, h: r.height, height, radius })
  }
  const wins = [...document.querySelectorAll<HTMLElement>('.desktop .window:not(.minimized)')]
    .map((el) => ({ el, z: Number(el.style.zIndex) || 0 }))
    .sort((a, b) => b.z - a.z)
  const n = wins.length
  wins.forEach(({ el }, i) => push(el, 4 + Math.min(n - 1 - i, 10) * 1.5, 11))
  document.querySelectorAll('.desk-widgets .widget').forEach((el) => push(el, 2, 18))
  return out.slice(0, MAX_OCCLUDERS)
}

interface IconSilhouette {
  xml: string
  at: number
  pad: number
  img: HTMLImageElement | null
}

const ICON_HEIGHT = 1.5
const OFFSCREEN = 6000
const silhouettes = new WeakMap<Element, IconSilhouette>()
let shadowLayer: HTMLCanvasElement | null = null

function silhouette(el: Element, onReady: () => void): IconSilhouette {
  const now = performance.now()
  let entry = silhouettes.get(el)
  if (!entry || now - entry.at > 1000) {
    const xml = new XMLSerializer().serializeToString(el)
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0
    if (!entry || entry.xml !== xml) {
      const img = new Image()
      const next: IconSilhouette = { xml, at: now, pad, img: null }
      const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
      img.onload = () => {
        next.img = img
        URL.revokeObjectURL(url)
        onReady()
      }
      img.src = url
      entry = next
    } else {
      entry.at = now
      entry.pad = pad
    }
    silhouettes.set(el, entry)
  }
  return entry
}

function drawIconShadows(ctx: CanvasRenderingContext2D, k: number, origin: DOMRect, sky: SkyState, mouse: { x: number; y: number }, onReady: () => void) {
  const icons = document.querySelectorAll('.desk-icon > svg')
  if (!icons.length) return
  const lampOn = sky.night
  const layer = (shadowLayer ??= document.createElement('canvas'))
  if (layer.width !== ctx.canvas.width || layer.height !== ctx.canvas.height) {
    layer.width = ctx.canvas.width
    layer.height = ctx.canvas.height
  }
  const t = layer.getContext('2d')!
  t.setTransform(1, 0, 0, 1, 0, 0)
  t.clearRect(0, 0, layer.width, layer.height)
  t.scale(k, k)
  const cuts: { img: HTMLImageElement; x: number; y: number; w: number; h: number; label: DOMRect | null }[] = []
  for (const el of icons) {
    const sil = silhouette(el, onReady)
    if (!sil.img) continue
    const b = el.getBoundingClientRect()
    const x = b.left - origin.left + sil.pad
    const y = b.top - origin.top + sil.pad
    const w = b.width - sil.pad * 2
    const h = b.height - sil.pad * 2
    const cx = x + w / 2
    const cy = y + h / 2
    const labelBox = el.parentElement?.querySelector('span')?.getBoundingClientRect() ?? null
    cuts.push({ img: sil.img, x, y, w, h, label: labelBox })
    const lights = [
      { dx: sky.sun.shift[0] * ICON_HEIGHT, dy: sky.sun.shift[1] * ICON_HEIGHT, a: sky.sun.strength * 0.5 },
      { dx: sky.moon.shift[0] * ICON_HEIGHT, dy: sky.moon.shift[1] * ICON_HEIGHT, a: sky.moon.strength * 0.4 },
      {
        dx: ((cx - (mouse.x - origin.left)) * ICON_HEIGHT) / (LAMP_HEIGHT - ICON_HEIGHT),
        dy: ((cy - (mouse.y - origin.top)) * ICON_HEIGHT) / (LAMP_HEIGHT - ICON_HEIGHT),
        a: lampOn * 0.45,
      },
    ]
    for (const l of lights) {
      if (l.a < 0.02) continue
      for (const f of [0.2, 0.6, 1]) {
        t.shadowColor = `rgba(3, 5, 26, ${l.a * 0.55 * (1 - 0.5 * f)})`
        t.shadowBlur = (2 + 6 * f) * k
        t.shadowOffsetX = (l.dx * f + OFFSCREEN) * k
        t.shadowOffsetY = l.dy * f * k
        t.drawImage(sil.img, x - OFFSCREEN, y, w, h)
      }
    }
  }
  t.shadowColor = 'transparent'
  t.globalCompositeOperation = 'destination-out'
  for (const c of cuts) {
    t.drawImage(c.img, c.x, c.y, c.w, c.h)
    if (c.label) t.fillRect(c.label.left - origin.left - 2, c.label.top - origin.top - 1, c.label.width + 4, c.label.height + 2)
  }
  t.globalCompositeOperation = 'source-over'
  ctx.drawImage(layer, 0, 0)
}

class ShaderHub {
  private canvas = document.createElement('canvas')
  private gl: WebGL2RenderingContext | null = null
  private programs = new Map<string, Program | null>()
  private sinks = new Set<Sink>()
  private raf = 0
  private last = 0
  private t0 = performance.now()
  private mouse = { x: -1e4, y: -1e4 }
  private acc = { frames: 0, ms: 0, since: performance.now() }
  private occR = new Float32Array(MAX_OCCLUDERS * 4)
  private occP = new Float32Array(MAX_OCCLUDERS * 2)
  stats: ShaderStats = { fps: 0, ms: 0, layers: 0 }

  constructor() {
    this.initGl()
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.gl = null
      this.programs.clear()
    })
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.initGl()
      this.request()
    })
    window.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX
      this.mouse.y = e.clientY
    })
    document.addEventListener('visibilitychange', () => this.request())
    useShaders.subscribe(() => this.request())
    useA11y.subscribe(() => this.request())
    useOS.subscribe((s, p) => {
      if (s.theme !== p.theme) this.request()
    })
  }

  get ok() {
    return this.gl !== null
  }

  private initGl() {
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false })
    this.gl = gl
    if (!gl) return
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }

  private program(layer: Layer): Program | null {
    const cached = this.programs.get(layer.id)
    if (cached !== undefined) return cached
    const gl = this.gl!
    let out: Program | null = null
    try {
      const make = (type: number, src: string) => {
        const s = gl.createShader(type)!
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
        return s
      }
      const prog = gl.createProgram()!
      gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, make(gl.FRAGMENT_SHADER, PRELUDE + layer.frag))
      gl.bindAttribLocation(prog, 0, 'p')
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
      out = { prog, loc: new Map() }
    } catch (e) {
      console.warn(`shader ${layer.id} failed to build:`, e)
    }
    this.programs.set(layer.id, out)
    return out
  }

  attach(canvas: HTMLCanvasElement, target: SinkTarget): SinkHandle {
    const ctx = canvas.getContext('2d')!
    const sink: Sink = { canvas, ctx, target, focusTarget: 1, focus: 1, paused: false, ro: new ResizeObserver(() => this.request()) }
    sink.ro.observe(canvas)
    this.sinks.add(sink)
    this.request()
    return {
      set: (o) => {
        if (o.focus !== undefined) sink.focusTarget = o.focus
        if (o.paused !== undefined) sink.paused = o.paused
        this.request()
      },
      detach: () => {
        sink.ro.disconnect()
        this.sinks.delete(sink)
        if (!this.sinks.size) this.stats = { fps: 0, ms: 0, layers: 0 }
      },
    }
  }

  request() {
    if (!this.raf && this.sinks.size && !document.hidden) this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    if (!this.sinks.size || document.hidden || !this.gl) return
    const settings = useShaders.getState()
    const animate = !useA11y.getState().reduceMotion
    const live = animate || (settings.enabled && settings.lighting)
    const interval = animate ? 1000 / FPS - 1 : STILL_FRAME_MS
    if (live && now - this.last < interval) {
      this.raf = requestAnimationFrame(this.frame)
      return
    }
    this.last = now
    const t0 = performance.now()
    const layers = this.render(animate ? (now - this.t0) / 1000 : STILL_T, animate, settings)
    this.tally(performance.now() - t0, layers)
    if (live) this.raf = requestAnimationFrame(this.frame)
  }

  private tally(ms: number, layers: number) {
    const a = this.acc
    a.frames++
    a.ms += ms
    const now = performance.now()
    if (now - a.since >= 500) {
      this.stats = { fps: Math.round((a.frames * 1000) / (now - a.since)), ms: a.ms / a.frames, layers }
      this.acc = { frames: 0, ms: 0, since: now }
    }
  }

  private render(t: number, animate: boolean, settings: ShaderSettings) {
    const gl = this.gl!
    const dark = useOS.getState().theme === 'dark' ? 1 : 0
    const sky = skyAt(new Date(), settings.hourOverride)
    const occluders = settings.lighting ? gather() : []

    interface Job {
      s: Sink
      layers: Layer[]
      w: number
      h: number
      cw: number
      ch: number
    }
    const jobs: Job[] = []
    let maxW = 1
    let maxH = 1
    for (const s of this.sinks) {
      const layers = layersFor(settings, s.target)
      if (!layers.length || s.paused) continue
      const cw = s.canvas.offsetWidth
      const ch = s.canvas.offsetHeight
      if (cw < 2 || ch < 2) continue
      const r = s.canvas.getBoundingClientRect()
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
      const scale = Math.max(...layers.map((l) => l.scale))
      const w = Math.min(MAX_SIDE, Math.max(1, Math.round(cw * scale)))
      const h = Math.min(MAX_SIDE, Math.max(1, Math.round(ch * scale)))
      jobs.push({ s, layers, w, h, cw, ch })
      maxW = Math.max(maxW, w)
      maxH = Math.max(maxH, h)
    }
    if (!jobs.length) return 0

    if (this.canvas.width < maxW || this.canvas.height < maxH || this.canvas.width > maxW * 2 || this.canvas.height > maxH * 2) {
      this.canvas.width = maxW
      this.canvas.height = maxH
    }
    const H = this.canvas.height

    for (const j of jobs) {
      const { s } = j
      s.focus += (s.focusTarget - s.focus) * (animate ? 0.18 : 1)
      if (Math.abs(s.focus - s.focusTarget) < 0.005) s.focus = s.focusTarget
      const r = s.canvas.getBoundingClientRect()
      const owner = s.target === 'windows' ? s.canvas.closest('.window') : null
      const selfH = owner ? (occluders.find((o) => o.el === owner)?.height ?? 3) : -1
      const n = occluders.length
      for (let i = 0; i < n; i++) {
        const o = occluders[i]
        this.occR.set([o.x - r.left, o.y - r.top, o.w, o.h], i * 4)
        this.occP.set([o.height, o.radius], i * 2)
      }

      if (s.canvas.width !== j.w || s.canvas.height !== j.h) {
        s.canvas.width = j.w
        s.canvas.height = j.h
      }
      s.ctx.clearRect(0, 0, j.w, j.h)

      for (const layer of j.layers) {
        const p = this.program(layer)
        if (!p) continue
        const u = (name: string) => {
          if (!p.loc.has(name)) p.loc.set(name, gl.getUniformLocation(p.prog, name))
          return p.loc.get(name)!
        }
        gl.useProgram(p.prog)
        gl.viewport(0, 0, j.w, j.h)
        gl.uniform2f(u('res'), j.w, j.h)
        gl.uniform2f(u('css'), j.cw, j.ch)
        gl.uniform1f(u('t'), t)
        gl.uniform1f(u('I'), settings.intensity)
        gl.uniform1f(u('dark'), dark)
        gl.uniform1f(u('focus'), s.focus)
        gl.uniform2f(u('mouse'), (this.mouse.x - r.left) / r.width, (this.mouse.y - r.top) / r.height)
        gl.uniform3f(u('sun'), sky.sun.x, sky.sun.elev, sky.sun.strength)
        gl.uniform3f(u('moon'), sky.moon.x, sky.moon.elev, sky.moon.strength)
        gl.uniform2f(u('sunSd'), sky.sun.shift[0], sky.sun.shift[1])
        gl.uniform2f(u('moonSd'), sky.moon.shift[0], sky.moon.shift[1])
        gl.uniform1f(u('night'), sky.night)
        gl.uniform1f(u('lampOn'), sky.night)
        gl.uniform1f(u('selfH'), selfH)
        gl.uniform1i(u('occN'), n)
        gl.uniform4fv(u('occR'), this.occR)
        gl.uniform2fv(u('occP'), this.occP)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        s.ctx.drawImage(this.canvas, 0, H - j.h, j.w, j.h, 0, 0, j.w, j.h)
      }
      if (s.target === 'shadow') drawIconShadows(s.ctx, j.w / j.cw, r, sky, this.mouse, () => this.request())
    }
    return jobs.length
  }
}

let hub: ShaderHub | null = null

export function shaderHub(): ShaderHub | null {
  if (!gpuInfo().available) return null
  hub ??= new ShaderHub()
  return hub.ok ? hub : null
}

export function shaderStats(): ShaderStats | null {
  return hub?.stats ?? null
}

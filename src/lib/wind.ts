export const MAX_GUSTS = 4
export const SLANT = 0.35

interface Gust {
  start: number
  dur: number
  amp: number
  width: number
  from: number
  to: number
}

type Kind = 'icon' | 'folder' | 'heavy' | 'sticky' | 'widget' | 'window'

interface Spring {
  x: number
  v: number
}

interface Body {
  el: HTMLElement
  kind: Kind
  cx: number
  cy: number
  scale: number
  seed: number
  a: Spring
  b: Spring
  out: string
}

interface Dragged {
  el: Element
  x: number
  y: number
  w: number
  h: number
  vx: number
  vy: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const SPEC: Record<Kind, { fa: number; za: number; fb: number; zb: number }> = {
  icon: { fa: 2.4, za: 0.16, fb: 1, zb: 1 },
  folder: { fa: 2.2, za: 0.16, fb: 5.5, zb: 0.12 },
  heavy: { fa: 3.5, za: 0.3, fb: 1, zb: 1 },
  sticky: { fa: 1.1, za: 0.12, fb: 3.2, zb: 0.14 },
  widget: { fa: 2.8, za: 0.35, fb: 2.2, zb: 0.4 },
  window: { fa: 1.6, za: 0.45, fb: 2.4, zb: 0.5 },
}

const SELECTOR = '.desktop .desk-icon, .desk-stickies .sticky, .desk-widgets .widget, .desktop .window:not(.minimized)'
const MOVERS = '.desktop .window:not(.minimized), .desk-stickies .sticky.dragging, .desk-widgets .widget.dragging'
const WAKE_SPEED = 150

const hash1 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
const noise1 = (x: number) => {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash1(i) * (1 - u) + hash1(i + 1) * u
}

function spring(s: Spring, target: number, f: number, z: number, dt: number) {
  const w = 2 * Math.PI * f
  s.v += (w * w * (target - s.x) - 2 * z * w * s.v) * dt
  s.x += s.v * dt
}

function boxDist(px: number, py: number, r: Rect) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w))
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h))
  return Math.hypot(dx, dy)
}

export interface WindField {
  on: boolean
  gusts: Float32Array
  base: number
  cloud: number
}

class Wind {
  field: WindField = { on: false, gusts: idleGusts(), base: 0, cloud: 0 }
  private gusts: Gust[] = []
  private bodies = new Map<Element, Body>()
  private dragged = new Map<Element, Dragged>()
  private windows: Rect[] = []
  private raf = 0
  private last = 0
  private t = 0
  private nextGust = 2.5
  private prevailing = Math.random() < 0.75 ? 1 : -1
  private nextFlip = 120 + Math.random() * 180
  private lastScan = -1
  private visible = () => {
    if (!document.hidden) this.request()
  }

  start() {
    this.field.on = true
    this.last = performance.now()
    document.addEventListener('visibilitychange', this.visible)
    this.request()
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    document.removeEventListener('visibilitychange', this.visible)
    for (const b of this.bodies.values()) clear(b)
    this.bodies.clear()
    this.dragged.clear()
    this.gusts = []
    this.field = { on: false, gusts: idleGusts(), base: 0, cloud: 0 }
  }

  blow(amp = 1, dir = this.prevailing) {
    if (this.gusts.length >= MAX_GUSTS) this.gusts.shift()
    const width = 0.14 + Math.random() * 0.1
    const reach = width * 2 + SLANT * 0.5
    const speed = 0.3 + Math.random() * 0.14
    const [from, to] = dir > 0 ? [-reach, 1 + reach] : [1 + reach, -reach]
    this.gusts.push({ start: this.t, dur: (1 + 2 * reach) / speed, amp: amp * dir, width, from, to })
  }

  at(x: number, y: number) {
    let w = this.field.base
    for (const g of this.gusts) {
      const p = (this.t - g.start) / g.dur
      const c = g.from + (g.to - g.from) * p
      const d = (x - c - SLANT * (y - 0.5)) / g.width
      w += g.amp * Math.sqrt(Math.sin(Math.PI * p)) * Math.exp(-d * d)
    }
    return w
  }

  private request() {
    if (!this.raf && this.field.on && !document.hidden) this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    this.raf = 0
    if (!this.field.on || document.hidden) return
    const real = Math.min(1, (now - this.last) / 1000)
    const dt = Math.min(0.05, real)
    this.last = now
    this.t += real
    this.weather(real)
    this.sense(real)
    const steps = Math.max(1, Math.ceil(dt * 120))
    for (const b of this.bodies.values()) this.move(b, dt / steps, steps)
    for (const b of this.bodies.values()) write(b)
    this.request()
  }

  private weather(dt: number) {
    const t = this.t
    if (t >= this.nextFlip) {
      this.prevailing = -this.prevailing
      this.nextFlip = t + 120 + Math.random() * 180
    }
    if (t >= this.nextGust) {
      const big = Math.random() < 0.18
      this.blow((0.5 + Math.random() * 0.55) * (big ? 1.6 : 1), Math.random() < 0.85 ? this.prevailing : -this.prevailing)
      this.nextGust = t + 5 + Math.random() * 10
    }
    this.gusts = this.gusts.filter((g) => t - g.start < g.dur)
    this.field.base = this.prevailing * (0.05 + 0.06 * noise1(t * 0.08))
    let strength = 0
    this.field.gusts.set(idleGusts())
    this.gusts.forEach((g, i) => {
      const p = (t - g.start) / g.dur
      const env = Math.sqrt(Math.sin(Math.PI * p))
      this.field.gusts.set([g.from + (g.to - g.from) * p, g.amp * env, g.width, 0], i * 4)
      strength += Math.abs(g.amp) * env
    })
    this.field.cloud += dt * 0.006 * this.prevailing * (1 + 2.5 * Math.min(1, strength))
  }

  private sense(dt: number) {
    const now = this.t
    const nowDragged = new Set(document.querySelectorAll(MOVERS))
    for (const el of this.dragged.keys()) if (!nowDragged.has(el)) this.dragged.delete(el)
    for (const el of nowDragged) {
      const r = el.getBoundingClientRect()
      const prev = this.dragged.get(el)
      const d: Dragged = { el, x: r.left, y: r.top, w: r.width, h: r.height, vx: 0, vy: 0 }
      if (prev && dt > 0) {
        const k = 0.35
        d.vx = prev.vx * (1 - k) + ((r.left + r.width / 2 - (prev.x + prev.w / 2)) / dt) * k
        d.vy = prev.vy * (1 - k) + ((r.top + r.height / 2 - (prev.y + prev.h / 2)) / dt) * k
      }
      this.dragged.set(el, d)
    }

    if (now - this.lastScan < 0.4) return
    this.lastScan = now
    const W = innerWidth
    const H = innerHeight
    const seen = new Set<Element>()
    this.windows = []
    for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
      seen.add(el)
      const r = el.getBoundingClientRect()
      const kind: Kind = el.classList.contains('window')
        ? 'window'
        : el.classList.contains('sticky')
          ? 'sticky'
          : el.classList.contains('widget')
            ? 'widget'
            : el.dataset.heavy !== undefined
              ? 'heavy'
              : el.querySelector('.fold-front')
                ? 'folder'
                : 'icon'
      if (kind === 'window') this.windows.push({ x: r.left, y: r.top, w: r.width, h: r.height })
      let b = this.bodies.get(el)
      if (!b) {
        b = { el, kind, cx: 0, cy: 0, scale: 1, seed: Math.random() * 100, a: { x: 0, v: 0 }, b: { x: 0, v: 0 }, out: '' }
        this.bodies.set(el, b)
      }
      b.kind = kind
      b.cx = r.left + r.width / 2
      b.cy = r.top + r.height / 2
      b.scale = kind === 'window' ? (r.width >= W * 0.95 && r.height >= H * 0.85 ? 0 : Math.min(1.2, Math.max(0.35, Math.sqrt((420 * 320) / (r.width * r.height))))) : 1
    }
    for (const [el, b] of this.bodies) {
      if (!seen.has(el)) {
        clear(b)
        this.bodies.delete(el)
      }
    }
  }

  private force(b: Body) {
    const W = innerWidth
    const H = innerHeight
    let w = this.at(b.cx / W, b.cy / H)
    if (b.kind !== 'window') {
      for (const r of this.windows) {
        if (b.cy < r.y || b.cy > r.y + r.h) continue
        const lee = w > 0 ? b.cx - (r.x + r.w) : r.x - b.cx
        if (lee > 0) w *= 1 - 0.75 * Math.exp(-lee / 260)
      }
    }
    let gust = 0
    for (const d of this.dragged.values()) {
      if (Math.hypot(d.vx, d.vy) < WAKE_SPEED || d.el === b.el || d.el.contains(b.el)) continue
      const fall = Math.exp(-boxDist(b.cx, b.cy, d) / 140)
      w += Math.max(-1.6, Math.min(1.6, d.vx / 1100)) * fall
      gust += Math.min(1.4, Math.hypot(d.vx, d.vy) / 1600) * fall
    }
    const turb = (noise1(this.t * 2.3 + b.seed) - 0.5) * 0.9 * Math.abs(w)
    const flutter = (noise1(this.t * 7 + b.seed * 3) - 0.5) * 1.2
    const mag = Math.min(1.6, Math.abs(w) + gust)
    return { f: Math.max(-1.5, Math.min(1.5, w + turb)), mag, flutter: flutter * mag }
  }

  private move(b: Body, dt: number, steps: number) {
    const spec = SPEC[b.kind]
    const self = this.dragged.get(b.el)
    if (b.el.classList.contains('dragging') || (self && Math.hypot(self.vx, self.vy) >= WAKE_SPEED)) {
      b.a = { x: 0, v: 0 }
      b.b = { x: 0, v: 0 }
      return
    }
    const { f, mag, flutter } = this.force(b)
    const calm = b.el.contains(document.activeElement) && b.kind !== 'icon' && b.kind !== 'folder' ? 0.3 : 1
    let ta = 0
    let tb = 0
    switch (b.kind) {
      case 'icon':
        ta = f * 5.5
        break
      case 'folder':
        ta = f * 5
        tb = Math.min(1.2, mag * 1.1 + flutter)
        break
      case 'heavy':
        ta = f * 1.2
        break
      case 'sticky':
        ta = -f * 2.6
        tb = Math.min(24, Math.max(0, mag * 15 + flutter * 9))
        break
      case 'widget':
        ta = f * 0.3
        tb = f * 1
        break
      case 'window':
        ta = f * 1.8 * b.scale
        tb = -mag * 0.6 * b.scale
        break
    }
    ta *= calm
    tb *= calm
    for (let i = 0; i < steps; i++) {
      spring(b.a, ta, spec.fa, spec.za, dt)
      spring(b.b, tb, spec.fb, spec.zb, dt)
    }
  }
}

function idleGusts() {
  const g = new Float32Array(MAX_GUSTS * 4)
  for (let i = 0; i < MAX_GUSTS; i++) g[i * 4 + 2] = 1
  return g
}

const r2 = (n: number) => Math.round(n * 100) / 100

function write(b: Body) {
  const s = b.el.style
  const a = r2(b.a.x)
  const c = r2(b.b.x)
  let sig: string
  switch (b.kind) {
    case 'icon':
    case 'heavy':
      sig = Math.abs(a) < 0.05 ? '' : `${a}`
      if (sig === b.out) return
      if (sig) s.setProperty('--wr', `${a}deg`)
      else s.removeProperty('--wr')
      break
    case 'folder': {
      const flap = Math.max(0, c)
      sig = Math.abs(a) < 0.05 && flap < 0.01 ? '' : `${a} ${flap}`
      if (sig === b.out) return
      if (sig) {
        s.setProperty('--wr', `${a}deg`)
        s.setProperty('--flap', `${r2(flap)}`)
        s.setProperty('--lean', `${r2(Math.max(-1, Math.min(1, a / 5)))}`)
      } else {
        s.removeProperty('--wr')
        s.removeProperty('--flap')
        s.removeProperty('--lean')
      }
      break
    }
    case 'sticky': {
      const lift = Math.max(0, c)
      sig = Math.abs(a) < 0.03 && lift < 0.1 ? '' : `${a} ${lift}`
      if (sig === b.out) return
      s.transformOrigin = sig ? '50% 0' : ''
      s.transform = sig ? `perspective(700px) rotate(${a}deg) rotateX(${r2(lift)}deg)` : ''
      break
    }
    case 'widget':
      sig = Math.abs(a) < 0.02 && Math.abs(c) < 0.1 ? '' : `${a} ${c}`
      if (sig === b.out) return
      s.transformOrigin = sig ? '50% 100%' : ''
      s.rotate = sig ? `${a}deg` : ''
      s.translate = sig ? `${c}px 0` : ''
      break
    case 'window':
      sig = Math.abs(a) < 0.1 && Math.abs(c) < 0.1 ? '' : `${a} ${c}`
      if (sig === b.out) return
      s.translate = sig ? `${a}px ${c}px` : ''
      break
  }
  b.out = sig
}

function clear(b: Body) {
  b.a = { x: 0, v: 0 }
  b.b = { x: 0, v: 0 }
  write(b)
}

const wind = new Wind()
let users = 0

export function startWind() {
  if (users++ === 0) wind.start()
  return () => {
    if (--users === 0) wind.stop()
  }
}

export function windField(): WindField {
  return wind.field
}

export function blow(amp = 1, dir?: 1 | -1) {
  if (wind.field.on) wind.blow(amp, dir)
}

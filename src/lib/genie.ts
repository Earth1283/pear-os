export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }
export type Quad = [Pt, Pt, Pt, Pt]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) })
const ease = (t: number) => t * t * (3 - 2 * t)
const easeOut = (t: number) => 1 - (1 - t) ** 3

export const rectQuad = (b: Box): Quad => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]

export function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    if (Math.abs(m[p][c]) < 1e-12) return null
    ;[m[c], m[p]] = [m[p], m[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = m[r][c] / m[c][c]
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

/** CSS matrix3d that maps a w×h box (origin top-left) onto the quad (tl, tr, br, bl). */
export function quadMatrix(w: number, h: number, q: Quad): string | null {
  const src: Pt[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
  const rows: number[][] = []
  const rhs: number[] = []
  src.forEach((s, i) => {
    const d = q[i]
    rows.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y])
    rhs.push(d.x)
    rows.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y])
    rhs.push(d.y)
  })
  const k = solve(rows, rhs)
  if (!k) return null
  const [a, b, c, d, e, f, g, h2] = k
  return `matrix3d(${[a, d, 0, g, b, e, 0, h2, 0, 0, 1, 0, c, f, 0, 1].map((v) => +v.toPrecision(12)).join(',')})`
}

/** The bottom edge reaches the Dock first and the top edge follows, so the window pinches into a funnel. */
export function genieQuad(win: Box, target: Box, t: number): Quad {
  const tx = target.x + target.w / 2
  const ty = target.y + target.h * 0.55
  const tw = Math.max(6, target.w * 0.62)
  const bottom = ease(clamp01(t / 0.72))
  const top = ease(clamp01((t - 0.22) / 0.78))
  const squeeze = easeOut(clamp01(t / 0.6))
  const [tl, tr, br, bl] = rectQuad(win)
  const pinch = (p: Pt, side: -1 | 1, progress: number, widthProgress: number): Pt => ({
    x: lerp(p.x, tx + side * tw / 2, widthProgress),
    y: lerp(p.y, ty, progress),
  })
  const q: Quad = [
    pinch(tl, -1, top, ease(clamp01((t - 0.1) / 0.9))),
    pinch(tr, 1, top, ease(clamp01((t - 0.1) / 0.9))),
    pinch(br, 1, bottom, squeeze),
    pinch(bl, -1, bottom, squeeze),
  ]
  const floor = ty - 1
  q[0].y = Math.min(q[0].y, Math.min(q[3].y, floor) - 2)
  q[1].y = Math.min(q[1].y, Math.min(q[2].y, floor) - 2)
  return q
}

export function scaleQuad(win: Box, target: Box, t: number): Quad {
  const p = ease(clamp01(t))
  const s = lerp(1, 0.05, p)
  const cx = lerp(win.x + win.w / 2, target.x + target.w / 2, p)
  const cy = lerp(win.y + win.h / 2, target.y + target.h / 2, p)
  return rectQuad({ x: cx - (win.w * s) / 2, y: cy - (win.h * s) / 2, w: win.w * s, h: win.h * s })
}

export interface GenieFrame { transform: string; opacity: number; offset: number }

export function genieFrames(win: Box, target: Box, mode: 'genie' | 'scale', steps = 40): GenieFrame[] {
  const frames: GenieFrame[] = []
  const quad = mode === 'genie' ? genieQuad : scaleQuad
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 0.985
    const m = quadMatrix(win.w, win.h, quad(win, target, t))
    if (!m) continue
    frames.push({ transform: m, opacity: i / steps > 0.92 ? 1 - (i / steps - 0.92) / 0.08 : 1, offset: i / steps })
  }
  return frames
}

const rects = new Map<string, Box>()
export const rememberDockRect = (id: string, b: Box) => void rects.set(id, b)
export const forgetDockRect = (id: string) => void rects.delete(id)

const toBox = (r: DOMRect): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height })

export function dockTarget(win: { id: string; app: string }): Box {
  const own = document.querySelector<HTMLElement>(`[data-dock-win="${win.id}"]`)
  if (own) return toBox(own.getBoundingClientRect())
  const remembered = rects.get(win.id)
  if (remembered) return remembered
  const icon = document.querySelector<HTMLElement>(`[data-dock-app="${win.app}"]`)
  if (icon) return toBox(icon.getBoundingClientRect())
  return { x: window.innerWidth / 2 - 26, y: window.innerHeight - 70, w: 52, h: 52 }
}

export interface Box { x: number; y: number; w: number; h: number }

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const NNBSP = ' '

export function shotName(d: Date, kind: 'Screenshot' | 'Screen Recording', ext: string) {
  const p = (n: number) => String(n).padStart(2, '0')
  const h = d.getHours() % 12 || 12
  return `${kind} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${h}.${p(d.getMinutes())}.${p(d.getSeconds())}${NNBSP}${d.getHours() < 12 ? 'AM' : 'PM'}.${ext}`
}

export function spanBox(ax: number, ay: number, bx: number, by: number): Box {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }
}

export const clampBox = (b: Box, W: number, H: number): Box => {
  const w = Math.min(b.w, W)
  const h = Math.min(b.h, H)
  return { x: Math.max(0, Math.min(W - w, b.x)), y: Math.max(0, Math.min(H - h, b.y)), w, h }
}

export function resizeBox(b: Box, handle: Handle, dx: number, dy: number, W: number, H: number, min = 20): Box {
  let l = b.x
  let t = b.y
  let r = b.x + b.w
  let bt = b.y + b.h
  if (handle.includes('w')) l = Math.max(0, Math.min(r - min, l + dx))
  if (handle.includes('e')) r = Math.min(W, Math.max(l + min, r + dx))
  if (handle.includes('n')) t = Math.max(0, Math.min(bt - min, t + dy))
  if (handle.includes('s')) bt = Math.min(H, Math.max(t + min, bt + dy))
  return { x: l, y: t, w: r - l, h: bt - t }
}

export function centredBox(W: number, H: number, fx = 0.55, fy = 0.5): Box {
  const w = Math.round(W * fx)
  const h = Math.round(H * fy)
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h }
}

/** Source rectangle in video pixels for a viewport-space box. */
export function sourceBox(b: Box, scale: number): Box {
  return { x: Math.round(b.x * scale), y: Math.round(b.y * scale), w: Math.max(1, Math.round(b.w * scale)), h: Math.max(1, Math.round(b.h * scale)) }
}

export const SHADOW_MARGIN = 54
export const SHADOW_DROP = 12

export function windowShotSize(b: Box, scale: number) {
  const m = Math.round(SHADOW_MARGIN * scale)
  return { margin: m, w: Math.round(b.w * scale) + m * 2, h: Math.round(b.h * scale) + m * 2 }
}

export function thumbSize(w: number, h: number, maxW = 190, maxH = 150) {
  const s = Math.min(maxW / w, maxH / h, 1)
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

export function pickMime(supported: (t: string) => boolean): { mime: string; ext: string } {
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4']) if (supported(m)) return { mime: m, ext: 'mov' }
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (supported(m)) return { mime: m, ext: 'webm' }
  return { mime: '', ext: 'webm' }
}

export function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

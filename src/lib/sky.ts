export interface Body {
  x: number
  elev: number
  strength: number
  shift: [number, number]
}

export interface SkyState {
  hour: number
  night: number
  sun: Body
  moon: Body
  phase: number
  illum: number
}

const SYNODIC_DAYS = 29.530588853
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14)

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function arc(hour: number) {
  const a = ((hour - 6) / 12) * Math.PI
  return { x: -Math.cos(a), elev: Math.sin(a) }
}

function shadowShift(x: number, elev: number): [number, number] {
  const len = Math.min(2.6, 0.35 / Math.max(elev, 0.12))
  return [-x * len * 6, 0.5 * len * 6]
}

export function lunarPhase(date: Date) {
  const days = (date.getTime() - NEW_MOON_MS) / 86_400_000
  return (((days / SYNODIC_DAYS) % 1) + 1) % 1
}

export function skyAt(date: Date, hourOverride: number | null = null): SkyState {
  const hour = hourOverride ?? date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 + date.getMilliseconds() / 3_600_000
  const phase = lunarPhase(date)
  const illum = (1 - Math.cos(phase * 2 * Math.PI)) / 2
  const s = arc(hour)
  const m = arc(hour - 24 * phase)
  const night = 1 - smooth(-0.08, 0.25, s.elev)
  return {
    hour,
    night,
    phase,
    illum,
    sun: { ...s, strength: smooth(0, 0.12, s.elev), shift: shadowShift(s.x, s.elev) },
    moon: { ...m, strength: smooth(0, 0.12, m.elev) * (0.25 + 0.75 * illum) * (0.15 + 0.85 * night), shift: shadowShift(m.x, m.elev) },
  }
}

export function moonName(phase: number) {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent']
  return names[Math.round(phase * 8) % 8]
}

export function formatHour(hour: number) {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  const m = Math.round((hour - Math.floor(hour)) * 60) % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function altitudeDegrees(elev: number) {
  return Math.round((Math.asin(Math.max(-1, Math.min(1, elev))) * 180) / Math.PI)
}

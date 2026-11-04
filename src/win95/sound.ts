import { os } from '../store'

let ctx: AudioContext | null = null
function ac() {
  try {
    ctx ??= new AudioContext()
    void ctx.resume?.()
    return ctx
  } catch {
    return null
  }
}

function note(c: AudioContext, freq: number, at: number, dur: number, type: OscillatorType, peak: number) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.value = freq
  const t = c.currentTime + at
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * os().volume), t + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(c.destination)
  o.start(t)
  o.stop(t + dur + 0.05)
}

/** An original rising chord that feels like 1995 without being the 1995 one. */
export function startupSound() {
  const c = ac()
  if (!c) return
  const run = [293.66, 369.99, 440, 587.33, 739.99, 880]
  run.forEach((f, i) => note(c, f, i * 0.16, 2.6 - i * 0.2, 'triangle', 0.13))
  ;[146.83, 220, 293.66].forEach((f) => note(c, f, 0.5, 3.4, 'sine', 0.12))
}

/** The "something is wrong, please read this" sound. */
export function dingSound() {
  const c = ac()
  if (!c) return
  note(c, 659.25, 0, 0.35, 'square', 0.04)
  note(c, 493.88, 0.12, 0.45, 'square', 0.04)
}

export function errorSound() {
  const c = ac()
  if (!c) return
  note(c, 220, 0, 0.5, 'sawtooth', 0.05)
  note(c, 164.81, 0.05, 0.6, 'square', 0.04)
}

export function shutdownSound() {
  const c = ac()
  if (!c) return
  ;[587.33, 440, 369.99, 293.66].forEach((f, i) => note(c, f, i * 0.2, 1.6 - i * 0.2, 'triangle', 0.1))
}

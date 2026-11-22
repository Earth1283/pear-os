import { os } from '../store'

let audioCtx: AudioContext | null = null
let lastPop = 0

function ctx(): AudioContext | null {
  try {
    const s = os()
    if (!s.soundEffects || s.volume <= 0) return null
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    return audioCtx
  } catch {
    return null
  }
}

/** Soft macOS-style volume scrub pop. */
export function playPop() {
  const now = performance.now()
  if (now - lastPop < 75) return
  lastPop = now
  const c = ctx()
  if (!c) return
  const vol = os().volume
  const t = c.currentTime
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(520, t)
  osc.frequency.exponentialRampToValueAtTime(190, t + 0.045)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(0.16 * vol, t + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.06)
}

/** Subtle swoosh when moving an item to the Trash. */
export function playTrashMove() {
  const c = ctx()
  if (!c) return
  const vol = os().volume
  const t = c.currentTime
  const dur = 0.16
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = c.createBufferSource()
  src.buffer = buf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(1400, t)
  bp.frequency.exponentialRampToValueAtTime(420, t + dur)
  bp.Q.value = 1.6
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(0.22 * vol, t + 0.025)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(bp).connect(gain).connect(c.destination)
  src.start(t)
}

/** Crisp paper-crumple sound when emptying the Trash. */
export function playTrashEmpty() {
  const c = ctx()
  if (!c) return
  const vol = os().volume
  const t = c.currentTime
  const dur = 0.42
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const p = i / data.length
    const burst = Math.sin(p * Math.PI * 11) ** 2 * 0.65 + 0.35
    const env = Math.sin(p * Math.PI)
    data[i] = (Math.random() * 2 - 1) * burst * env
  }
  const src = c.createBufferSource()
  src.buffer = buf
  const hp = c.createBiquadFilter()
  hp.type = 'bandpass'
  hp.frequency.setValueAtTime(2400, t)
  hp.frequency.exponentialRampToValueAtTime(1100, t + dur)
  hp.Q.value = 0.9
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.24 * vol, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(hp).connect(gain).connect(c.destination)
  src.start(t)
}

/** Airy poof when removing an icon from the Dock. */
export function playPoof() {
  const c = ctx()
  if (!c) return
  const vol = os().volume
  const t = c.currentTime
  const dur = 0.22
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 1.5
  const src = c.createBufferSource()
  src.buffer = buf
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(1800, t)
  lp.frequency.exponentialRampToValueAtTime(300, t + dur)
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.22 * vol, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(lp).connect(gain).connect(c.destination)
  src.start(t)
}

/** Classic subtle macOS alert bonk (Funk/Sosumi inspired). */
export function playBonk() {
  const c = ctx()
  if (!c) return
  const vol = os().volume
  const t = c.currentTime
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(195, t)
  osc.frequency.exponentialRampToValueAtTime(115, t + 0.14)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(0.2 * vol, t + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.17)
}

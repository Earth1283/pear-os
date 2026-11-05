// Pear Radio: endless, procedurally generated stations. Everything is synthesised with WebAudio
// at play time (no samples, no assets), so Music works even without a PearDrive. The talk stations
// lay speech synthesis over a quiet bed.

import { dmesg, lkml, lkmlRaw, marine, news, numbers, startTalk, type Show } from './talk'

export type StationId = 'lofi' | 'panic' | 'arcade' | 'waltz' | 'numbers' | 'news' | 'dmesg' | 'marine' | 'lkml' | 'lkmlraw'
type BedId = 'lofi' | 'panic' | 'arcade' | 'waltz' | 'shortwave'

export interface Station {
  id: StationId
  title: string
  artist: string
  blurb: string
  hue: number
  /** Talk stations read this aloud over the bed. */
  show?: Show
  bed?: BedId
  /** Bed loudness, so the voice sits on top. */
  level?: number
}

export const STATIONS: Station[] = [
  { id: 'lofi', title: 'lofi beats to debug to', artist: 'Pear Radio', blurb: 'Dusty keys, lazy drums, one stubborn off-by-one error.', hue: 28 },
  { id: 'panic', title: 'Kernel Panic Ambient', artist: 'Pear Radio', blurb: 'Slow pads and distant beeps. Everything is fine.', hue: 262 },
  { id: 'arcade', title: 'Orchard Arcade', artist: 'Pear Radio', blurb: 'Square waves for the 8-bit pear in all of us.', hue: 142 },
  { id: 'waltz', title: 'Beach Ball Waltz', artist: 'Pear Radio', blurb: 'A music box in three-quarter time. It spins.', hue: 340 },
  { id: 'numbers', title: 'Lima Echo Four Seven', artist: 'Pear Radio', blurb: 'Groups of five digits. Nobody will say who they are for.', hue: 200, show: numbers, bed: 'shortwave', level: 1 },
  { id: 'news', title: 'Pear News Network', artist: 'Pear Radio', blurb: 'All the news that is fit to compile, over gentle panic.', hue: 8, show: news, bed: 'panic', level: 0.7 },
  { id: 'dmesg', title: 'Radio Free Kernel', artist: 'Pear Radio', blurb: 'The boot log, read aloud with feeling, over chiptunes.', hue: 100, show: dmesg, bed: 'arcade', level: 0.3 },
  { id: 'marine', title: 'The Marine Forecast', artist: 'Pear Radio', blurb: 'Gale 8 later. Segfaults at times. Visibility good, occasionally poor.', hue: 225, show: marine, bed: 'waltz', level: 0.55 },
  { id: 'lkml', title: 'LKML Radio', artist: 'Pear Radio', blurb: 'Real rants from the kernel mailing list, read aloud by a robot that has never had a merge conflict.', hue: 175, show: lkml, bed: 'lofi', level: 0.3 },
  { id: 'lkmlraw', title: 'LKML After Dark', artist: 'Pear Radio', blurb: 'The same list, nothing bleeped, nothing left out. Parental advisory: it is mostly Linus.', hue: 0, show: lkmlRaw, bed: 'panic', level: 0.45 },
]

export const stationById = (id: string) => STATIONS.find((s) => s.id === id)

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12)

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Rig {
  ctx: BaseAudioContext
  bus: GainNode
  reverbIn: GainNode
  noise: AudioBuffer
}

function makeRig(ctx: BaseAudioContext, out: AudioNode): Rig {
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -16
  comp.knee.value = 12
  comp.ratio.value = 3.5
  comp.attack.value = 0.01
  comp.release.value = 0.2
  comp.connect(out)

  const bus = ctx.createGain()
  bus.gain.value = 0.9
  bus.connect(comp)

  // A cheap but pleasant room: two seconds of exponentially decaying noise.
  const len = Math.floor(ctx.sampleRate * 2.2)
  const ir = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2
  }
  const conv = ctx.createConvolver()
  conv.buffer = ir
  const wet = ctx.createGain()
  wet.gain.value = 0.5
  const reverbIn = ctx.createGain()
  reverbIn.connect(conv)
  conv.connect(wet)
  wet.connect(bus)

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  return { ctx, bus, reverbIn, noise }
}

interface NoteOpts {
  t: number
  dur: number
  freq: number
  type?: OscillatorType
  wave?: PeriodicWave
  gain?: number
  attack?: number
  release?: number
  cutoff?: number
  detune?: number
  send?: number
}

function note(rig: Rig, o: NoteOpts) {
  const { ctx } = rig
  const osc = ctx.createOscillator()
  if (o.wave) osc.setPeriodicWave(o.wave)
  else osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, o.t)
  if (o.detune) osc.detune.value = o.detune

  const a = o.attack ?? 0.01
  const r = o.release ?? 0.15
  const peak = o.gain ?? 0.1
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, o.t)
  g.gain.linearRampToValueAtTime(peak, o.t + a)
  g.gain.setValueAtTime(peak, Math.max(o.t + a, o.t + o.dur))
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur + r)

  let tail: AudioNode = osc
  if (o.cutoff) {
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = o.cutoff
    f.Q.value = 0.6
    osc.connect(f)
    tail = f
  }
  tail.connect(g)
  g.connect(rig.bus)
  if (o.send) {
    const s = ctx.createGain()
    s.gain.value = o.send
    g.connect(s)
    s.connect(rig.reverbIn)
  }
  osc.start(o.t)
  osc.stop(o.t + o.dur + r + 0.05)
}

function noiseHit(rig: Rig, t: number, dur: number, gain: number, filter: BiquadFilterType, freq: number, q = 0.7) {
  const { ctx } = rig
  const src = ctx.createBufferSource()
  src.buffer = rig.noise
  const f = ctx.createBiquadFilter()
  f.type = filter
  f.frequency.value = freq
  f.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(f)
  f.connect(g)
  g.connect(rig.bus)
  src.start(t, Math.random() * 1.5, dur + 0.02)
}

function kick(rig: Rig, t: number, gain = 0.5, type: OscillatorType = 'sine') {
  const osc = rig.ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(150, t)
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.13)
  const g = rig.ctx.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38)
  osc.connect(g)
  g.connect(rig.bus)
  osc.start(t)
  osc.stop(t + 0.42)
}

function snare(rig: Rig, t: number, gain = 0.25) {
  noiseHit(rig, t, 0.17, gain, 'bandpass', 1900, 0.6)
  note(rig, { t, dur: 0.02, release: 0.08, freq: 190, type: 'triangle', gain: gain * 0.5, attack: 0.002 })
}

const hat = (rig: Rig, t: number, gain = 0.07, open = false) => noiseHit(rig, t, open ? 0.2 : 0.045, gain, 'highpass', 7200, 0.5)

function pulseWave(ctx: BaseAudioContext, duty: number) {
  const n = 48
  const real = new Float32Array(n)
  const imag = new Float32Array(n)
  for (let k = 1; k < n; k++) {
    real[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI)
    imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI)
  }
  return ctx.createPeriodicWave(real, imag)
}

interface StepCtx {
  rig: Rig
  t: number
  step: number
  bar: number
  sd: number
  r: () => number
  mem: Record<string, unknown>
}

interface Preset {
  bpm: number
  stepsPerBeat: number
  beats: number
  swing: number
  step(c: StepCtx): void
}

const pick = <T,>(arr: T[], r: () => number) => arr[Math.floor(r() * arr.length)]

// ───────────────────────── lofi ─────────────────────────

const LOFI_CHORDS = [
  { bass: 38, keys: [53, 57, 60, 64, 67] }, // Dm9
  { bass: 43, keys: [53, 59, 62, 64] }, // G13
  { bass: 36, keys: [52, 55, 59, 62] }, // Cmaj9
  { bass: 33, keys: [52, 55, 59, 60] }, // Am9
  { bass: 38, keys: [53, 57, 60, 64, 67] },
  { bass: 43, keys: [53, 59, 62, 64] },
  { bass: 36, keys: [52, 55, 59, 62] },
  { bass: 41, keys: [57, 60, 64, 67] }, // Fmaj9
]
const C_PENTA = [60, 62, 64, 67, 69, 72, 74]

function rhodes(rig: Rig, t: number, m: number, dur: number, gain: number) {
  note(rig, { t, dur, freq: midi(m), type: 'sine', gain, attack: 0.012, release: 0.9, cutoff: 2400, send: 0.35 })
  note(rig, { t, dur: dur * 0.5, freq: midi(m + 12), type: 'triangle', gain: gain * 0.28, attack: 0.004, release: 0.5, cutoff: 3200, send: 0.3 })
}

const lofi: Preset = {
  bpm: 78,
  stepsPerBeat: 4,
  beats: 4,
  swing: 0.58,
  step({ rig, t, step, bar, sd, r, mem }) {
    const chord = LOFI_CHORDS[bar % LOFI_CHORDS.length]
    const beat = sd * 4
    if (step === 0 || step === 10) {
      chord.keys.forEach((m, i) => rhodes(rig, t + i * 0.011 + r() * 0.006, m, beat * (step === 0 ? 2.6 : 1.4), 0.05 - i * 0.003))
    }
    if (step === 0 || step === 10) note(rig, { t, dur: beat * 1.6, freq: midi(chord.bass), type: 'sine', gain: 0.2, attack: 0.02, release: 0.3, cutoff: 260 })
    if (step === 0 || step === 10) kick(rig, t, step === 0 ? 0.55 : 0.4)
    if (step === 4 || step === 12) snare(rig, t, 0.2)
    if (step % 2 === 0) hat(rig, t, 0.03 + r() * 0.035, step === 14 && r() < 0.4)
    else if (r() < 0.18) hat(rig, t, 0.018)
    if (r() < 0.1) noiseHit(rig, t + r() * sd, 0.004, 0.05, 'highpass', 2500)

    // A shy pentatonic wander that rests more on odd bars.
    let idx = (mem.idx as number | undefined) ?? 2
    const density = bar % 2 === 0 ? 0.2 : 0.1
    if (step % 2 === 0 && r() < density) {
      idx = Math.max(0, Math.min(C_PENTA.length - 1, idx + pick([-2, -1, -1, 1, 1, 2], r)))
      mem.idx = idx
      note(rig, { t, dur: beat * 0.7, freq: midi(C_PENTA[idx] + (r() < 0.2 ? 12 : 0)), type: 'triangle', gain: 0.045, attack: 0.01, release: 0.7, cutoff: 1700, send: 0.55 })
    }
  },
}

// ───────────────────────── kernel panic ambient ─────────────────────────

const PANIC_CHORDS = [
  { bass: 38, pad: [50, 57, 62, 64, 69] }, // Dm9
  { bass: 34, pad: [46, 53, 57, 62, 65] }, // Bbmaj7
  { bass: 43, pad: [43, 50, 53, 58, 62] }, // Gm9
  { bass: 33, pad: [45, 52, 57, 62, 64] }, // Asus4
]

const panic: Preset = {
  bpm: 60,
  stepsPerBeat: 4,
  beats: 4,
  swing: 0.5,
  step({ rig, t, step, bar, sd, r }) {
    const chord = PANIC_CHORDS[bar % PANIC_CHORDS.length]
    const barLen = sd * 16
    if (step === 0) {
      chord.pad.forEach((m, i) => {
        note(rig, { t, dur: barLen * 0.8, freq: midi(m), type: 'sawtooth', gain: 0.018, attack: 1.8, release: 2.8, cutoff: 800, detune: (i - 2) * 6, send: 0.5 })
        note(rig, { t, dur: barLen * 0.8, freq: midi(m), type: 'triangle', gain: 0.03, attack: 1.4, release: 2.8, cutoff: 1100, detune: (2 - i) * 4, send: 0.5 })
      })
      note(rig, { t, dur: barLen, freq: midi(chord.bass - 12), type: 'sine', gain: 0.16, attack: 0.9, release: 2, cutoff: 200 })
    }
    if (r() < 0.2) {
      const m = pick(chord.pad, r) + pick([12, 12, 24], r)
      note(rig, { t, dur: 0.05, freq: midi(m), type: 'sine', gain: 0.05, attack: 0.004, release: 2.2, send: 0.95 })
    }
    // Every so often the kernel panics. Politely.
    if (step === 8 && r() < 0.12) {
      for (let i = 0; i < 2; i++) note(rig, { t: t + i * 0.22, dur: 0.07, freq: 880, type: 'square', gain: 0.012, attack: 0.002, release: 0.04, cutoff: 3000, send: 0.4 })
    }
  },
}

// ───────────────────────── orchard arcade ─────────────────────────

const ARCADE_CHORDS = [
  { root: 48, tones: [60, 64, 67] }, // C
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [53, 57, 60] }, // F
  { root: 43, tones: [55, 59, 62] }, // G
]
const C_MAJOR = [0, 2, 4, 5, 7, 9, 11]

const arcade: Preset = {
  bpm: 148,
  stepsPerBeat: 4,
  beats: 4,
  swing: 0.5,
  step({ rig, t, step, bar, sd, mem }) {
    const chord = ARCADE_CHORDS[bar % ARCADE_CHORDS.length]
    const pulse25 = (mem.p25 ??= pulseWave(rig.ctx, 0.25)) as PeriodicWave
    const pulse50 = (mem.p50 ??= pulseWave(rig.ctx, 0.5)) as PeriodicWave

    // Rapid-fire arpeggio, the signature sound of a chip with three channels and a dream.
    const arp = chord.tones[[0, 1, 2, 1][step % 4]] + (step % 8 >= 4 ? 12 : 0)
    note(rig, { t, dur: sd * 0.7, release: 0.03, freq: midi(arp), wave: pulse25, gain: 0.04, attack: 0.003 })

    if (step % 4 === 0) note(rig, { t, dur: sd * 3, release: 0.04, freq: midi(chord.root - 12), type: 'triangle', gain: 0.22, attack: 0.004 })
    else if (step % 4 === 2) note(rig, { t, dur: sd * 1.5, release: 0.04, freq: midi(chord.root), type: 'triangle', gain: 0.14, attack: 0.004 })

    if (step === 0 || step === 8) kick(rig, t, 0.28, 'square')
    if (step === 4 || step === 12) noiseHit(rig, t, 0.09, 0.14, 'bandpass', 3200, 0.9)
    if (step % 2 === 0) hat(rig, t, 0.035)

    // The tune repeats every eight bars because we seed it from the bar number.
    const r = mulberry32(7000 + (bar % 8) * 131 + step * 17)
    const strong = step % 4 === 0
    if (strong || r() < 0.38) {
      const tones = chord.tones.map((m) => m + 12)
      const m = strong && r() < 0.7 ? pick(tones, r) : 72 + C_MAJOR[Math.floor(r() * 7)] + (r() < 0.25 ? 12 : 0)
      note(rig, { t, dur: sd * (strong ? 1.8 : 0.9), release: 0.05, freq: midi(m), wave: pulse50, gain: 0.05, attack: 0.004, cutoff: 5200 })
    }
  },
}

// ───────────────────────── beach ball waltz ─────────────────────────

const WALTZ_CHORDS = [
  { bass: 45, keys: [57, 60, 64], scale: [57, 59, 60, 62, 64, 65, 68, 69, 72] },
  { bass: 45, keys: [57, 60, 64], scale: [57, 59, 60, 62, 64, 65, 68, 69, 72] },
  { bass: 40, keys: [56, 59, 62, 64], scale: [56, 59, 60, 62, 64, 68, 71, 72] },
  { bass: 40, keys: [56, 59, 62, 64], scale: [56, 59, 60, 62, 64, 68, 71, 72] },
  { bass: 45, keys: [57, 60, 64], scale: [57, 59, 60, 62, 64, 65, 68, 69, 72] },
  { bass: 38, keys: [53, 57, 62], scale: [57, 59, 60, 62, 64, 65, 69, 72] },
  { bass: 40, keys: [56, 59, 62, 64], scale: [56, 59, 60, 62, 64, 68, 71, 72] },
  { bass: 45, keys: [57, 60, 64], scale: [57, 60, 64, 69, 72] },
]

function musicBox(rig: Rig, t: number, m: number, gain: number) {
  const f = midi(m)
  note(rig, { t, dur: 0.02, release: 1.4, freq: f, type: 'sine', gain, attack: 0.002, send: 0.6 })
  note(rig, { t, dur: 0.01, release: 0.45, freq: f * 2.76, type: 'sine', gain: gain * 0.35, attack: 0.002, send: 0.5 })
  note(rig, { t, dur: 0.01, release: 0.2, freq: f * 5.4, type: 'sine', gain: gain * 0.12, attack: 0.002, send: 0.4 })
}

const waltz: Preset = {
  bpm: 96,
  stepsPerBeat: 4,
  beats: 3,
  swing: 0.5,
  step({ rig, t, step, bar, sd, mem }) {
    const chord = WALTZ_CHORDS[bar % WALTZ_CHORDS.length]
    if (step === 0) note(rig, { t, dur: sd * 3, release: 0.25, freq: midi(chord.bass), type: 'triangle', gain: 0.2, attack: 0.01, cutoff: 700 })
    if (step === 4 || step === 8) {
      chord.keys.forEach((m, i) => note(rig, { t: t + i * 0.006, dur: sd * 1.2, release: 0.3, freq: midi(m), type: 'triangle', gain: 0.045, attack: 0.008, cutoff: 1800, send: 0.2 }))
    }
    const r = mulberry32(31337 + (bar % 8) * 977 + step * 31)
    const onBeat = step % 4 === 0
    if (onBeat || (step % 2 === 0 && r() < 0.5)) {
      let i = (mem.i as number | undefined) ?? 4
      i = Math.max(0, Math.min(chord.scale.length - 1, i + pick([-2, -1, -1, 1, 1, 2], r)))
      mem.i = i
      musicBox(rig, t, chord.scale[i] + 12, onBeat ? 0.06 : 0.04)
    }
  },
}

// ───────────────────────── shortwave ─────────────────────────

const shortwave: Preset = {
  bpm: 60,
  stepsPerBeat: 4,
  beats: 4,
  swing: 0.5,
  step({ rig, t, step, bar, sd, r }) {
    noiseHit(rig, t, sd * 1.3, 0.02 + r() * 0.03, 'bandpass', 1200 + r() * 2800, 0.5)
    if (r() < 0.03) noiseHit(rig, t, 0.12, 0.12, 'bandpass', 600 + r() * 3000, 8)
    if (r() < 0.04) note(rig, { t, dur: 0.05 + r() * 0.2, freq: 700 + Math.floor(r() * 5) * 90, type: 'sine', gain: 0.025, attack: 0.004, release: 0.03 })
    // Every eighth bar the interval signal plays: four notes, a music box with a secret.
    if (bar % 8 === 7 && step % 4 === 0) musicBox(rig, t, [76, 72, 79, 67][step / 4], 0.05)
  },
}

const PRESETS: Record<BedId, Preset> = { lofi, panic, arcade, waltz, shortwave }

function stepTime(p: Preset, base: number, stepAbs: number, sd: number) {
  const step = stepAbs % (p.stepsPerBeat * p.beats)
  const delay = step % 2 === 1 ? (p.swing - 0.5) * 2 * sd : 0
  return base + stepAbs * sd + delay
}

/** Schedules every step whose start time is before `until`, starting from `state.next`. */
function run(rig: Rig, id: BedId, state: { next: number; t0: number; r: () => number; mem: Record<string, unknown> }, until: number) {
  const p = PRESETS[id]
  const sd = 60 / p.bpm / p.stepsPerBeat
  const perBar = p.stepsPerBeat * p.beats
  for (;;) {
    const abs = state.next
    const t = stepTime(p, state.t0, abs, sd)
    if (t >= until) break
    p.step({ rig, t, step: abs % perBar, bar: Math.floor(abs / perBar), sd, r: state.r, mem: state.mem })
    state.next++
  }
}

export interface StationHandle {
  stop(): void
}

export function startStation(ctx: AudioContext, out: AudioNode, id: StationId, getVolume: () => number = () => 1): StationHandle {
  const st = stationById(id)
  const bed = st?.bed ?? (id as BedId)
  const fade = ctx.createGain()
  fade.gain.value = st?.level ?? 1
  fade.connect(out)
  const rig = makeRig(ctx, fade)
  const state = { next: 0, t0: ctx.currentTime + 0.1, r: Math.random, mem: {} as Record<string, unknown> }
  const tick = () => run(rig, bed, state, ctx.currentTime + 0.8)
  tick()
  const timer = setInterval(tick, 150)
  const talk = st?.show ? startTalk(st.show, getVolume) : null
  return {
    stop() {
      clearInterval(timer)
      talk?.stop()
      const now = ctx.currentTime
      fade.gain.cancelScheduledValues(now)
      fade.gain.setValueAtTime(fade.gain.value, now)
      fade.gain.linearRampToValueAtTime(0, now + 0.12)
      setTimeout(() => fade.disconnect(), 400)
    },
  }
}

/** Renders a station offline. Used by tests and handy for exporting a loop. */
export async function renderStation(id: BedId, seconds: number, sampleRate = 44100) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate)
  const rig = makeRig(ctx, ctx.destination)
  const state = { next: 0, t0: 0.05, r: mulberry32(1234), mem: {} as Record<string, unknown> }
  run(rig, id, state, seconds)
  return ctx.startRendering()
}

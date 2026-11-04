// Accessibility settings. Persisted per browser; applied by <A11yLayer /> in components/Accessibility.

import { create } from 'zustand'

export type ColorFilter = 'off' | 'grayscale' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'tint'
export type Invert = 'off' | 'smart' | 'classic'
export type ZoomModifier = 'ctrl' | 'alt' | 'meta'

export interface A11ySettings {
  // Display
  reduceMotion: boolean
  reduceTransparency: boolean
  increaseContrast: boolean
  displayContrast: number
  invert: Invert
  colorFilter: ColorFilter
  filterIntensity: number
  tint: string
  // Pointer
  pointerSize: number
  shakeToLocate: boolean
  pointerOutline: string
  pointerFill: string
  // Zoom
  zoomKeys: boolean
  zoomScroll: boolean
  zoomModifier: ZoomModifier
  // Hover Text
  hoverText: boolean
  // Spoken content
  speakSelection: boolean
  speakPointer: boolean
  speakAnnouncements: boolean
  voice: string
  rate: number
  // Hearing
  flashAlerts: boolean
  monoAudio: boolean
  // Keyboard
  keyboardNav: boolean
}

export const A11Y_DEFAULTS: A11ySettings = {
  reduceMotion: false,
  reduceTransparency: false,
  increaseContrast: false,
  displayContrast: 1,
  invert: 'off',
  colorFilter: 'off',
  filterIntensity: 1,
  tint: '#ff9f0a',
  pointerSize: 1,
  shakeToLocate: true,
  pointerOutline: '#ffffff',
  pointerFill: '#000000',
  zoomKeys: false,
  zoomScroll: false,
  zoomModifier: 'alt',
  hoverText: false,
  speakSelection: false,
  speakPointer: false,
  speakAnnouncements: false,
  voice: '',
  rate: 1,
  flashAlerts: false,
  monoAudio: false,
  keyboardNav: false,
}

const KEY = 'pearos.a11y.v1'

function load(): A11ySettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...A11Y_DEFAULTS, ...JSON.parse(raw) }
  } catch {
    // Private mode or garbage in storage: fall back to defaults.
  }
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const contrast = typeof matchMedia === 'function' && matchMedia('(prefers-contrast: more)').matches
  return { ...A11Y_DEFAULTS, reduceMotion: reduce, increaseContrast: contrast }
}

interface A11yState extends A11ySettings {
  /** Full-screen zoom factor (1 = off). Not persisted, same as macOS after a restart. */
  zoom: number
  set<K extends keyof A11ySettings>(k: K, v: A11ySettings[K]): void
  reset(): void
}

export const useA11y = create<A11yState>((set, get) => ({
  ...load(),
  zoom: 1,
  set(k, v) {
    set({ [k]: v } as Partial<A11yState>)
    save(get())
  },
  reset() {
    set({ ...A11Y_DEFAULTS })
    save(get())
  },
}))

function save(s: A11yState) {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(A11Y_DEFAULTS)) out[k] = s[k as keyof A11ySettings]
  try {
    localStorage.setItem(KEY, JSON.stringify(out))
  } catch {
    // Storage full or blocked; settings still apply for this session.
  }
}

export const a11y = () => useA11y.getState()

/** Speaks `text` with the configured voice and rate. Returns false if the browser can't. */
export function speak(text: string, opts: { interrupt?: boolean } = {}) {
  if (!('speechSynthesis' in window) || !text.trim()) return false
  const s = a11y()
  if (opts.interrupt !== false) speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = s.voice ? speechSynthesis.getVoices().find((x) => x.voiceURI === s.voice) : undefined
  if (v) u.voice = v
  u.rate = s.rate
  speechSynthesis.speak(u)
  return true
}

// ---- Colour filter matrices ---------------------------------------------------------------------
// macOS's colour filters are corrective, not simulations: they shift the information a colour-blind
// viewer loses into channels they can see. This is the usual daltonize construction:
//   M = I + k · E · (I − S)
// where S simulates the deficiency (Machado et al. 2009, severity 1) and E redistributes the error.

type M3 = number[][]
const I3: M3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
const SIM: Record<'protanopia' | 'deuteranopia' | 'tritanopia', M3> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}
const SHIFT_RG: M3 = [
  [0, 0, 0],
  [0.7, 1, 0],
  [0.7, 0, 1],
]
const SHIFT_BY: M3 = [
  [1, 0, 0.7],
  [0, 1, 0.7],
  [0, 0, 0],
]
const mul = (a: M3, b: M3): M3 => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)))
const sub = (a: M3, b: M3): M3 => a.map((row, i) => row.map((v, j) => v - b[i][j]))

/** 20 numbers for an SVG feColorMatrix, or null when the filter is off / done with plain CSS. */
export function filterMatrix(f: ColorFilter, k: number, tint: string): number[] | null {
  let m: M3
  if (f === 'protanopia' || f === 'deuteranopia' || f === 'tritanopia') {
    const corr = mul(f === 'tritanopia' ? SHIFT_BY : SHIFT_RG, sub(I3, SIM[f]))
    m = I3.map((row, i) => row.map((v, j) => v + k * corr[i][j]))
  } else if (f === 'tint') {
    const t = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16) / 255)
    const lum = [0.2126, 0.7152, 0.0722]
    m = I3.map((row, i) => row.map((v, j) => (1 - k) * v + k * t[i] * lum[j] * 1.4))
  } else return null
  return [...m[0], 0, 0, ...m[1], 0, 0, ...m[2], 0, 0, 0, 0, 0, 1, 0]
}

// ---- Pointer ------------------------------------------------------------------------------------

export function cursorURL(size: number, fill: string, outline: string) {
  const px = Math.round(Math.min(120, 22 * size))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.2 14.2 L10 20.5 L12.8 19.3 L10.1 13.2 L15.8 13.2 Z" fill="${fill}" stroke="${outline}" stroke-width="1.4" stroke-linejoin="round"/></svg>`
  const hot = Math.round((3 / 22) * px)
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${hot} ${Math.round((2 / 22) * px)}, auto`
}

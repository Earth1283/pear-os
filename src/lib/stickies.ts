import { create } from 'zustand'
import { DOCK_ZONE, MENU_H } from '../store'

export const STICKY_COLORS = {
  yellow: { paper: '#fff3a0', bar: '#f6df5e', ink: '#4a3f10' },
  pink: { paper: '#ffd0e2', bar: '#f59ac0', ink: '#55223a' },
  blue: { paper: '#c4e4ff', bar: '#82bff2', ink: '#173a57' },
  green: { paper: '#ccf3bc', bar: '#8fd778', ink: '#254717' },
  purple: { paper: '#e3d3ff', bar: '#b99bf0', ink: '#38245e' },
  gray: { paper: '#e9e9ec', bar: '#c3c3c9', ink: '#2e2e33' },
} as const

export type StickyColor = keyof typeof STICKY_COLORS

export interface Sticky {
  id: string
  x: number
  y: number
  w: number
  h: number
  color: StickyColor
  text: string
  z: number
}

export const STICKY_MIN = { w: 130, h: 96 }
export const STICKIES_KEY = 'pearos.stickies.v1'

const colors = Object.keys(STICKY_COLORS) as StickyColor[]

export function parseStickies(v: unknown): Sticky[] | null {
  if (!Array.isArray(v)) return null
  const ok = v.every((s) => s && typeof s.id === 'string' && typeof s.text === 'string' && colors.includes(s.color) && [s.x, s.y, s.w, s.h, s.z].every(Number.isFinite))
  return ok ? (v as Sticky[]).map(({ id, x, y, w, h, color, text, z }) => ({ id, x, y, w: Math.max(STICKY_MIN.w, w), h: Math.max(STICKY_MIN.h, h), color, text, z })) : null
}

function load(): Sticky[] {
  try {
    return parseStickies(JSON.parse(localStorage.getItem(STICKIES_KEY) ?? 'null')) ?? []
  } catch {
    return []
  }
}

interface StickyState {
  list: Sticky[]
  add(at?: { x: number; y: number } | null): string
  patch(id: string, p: Partial<Pick<Sticky, 'x' | 'y' | 'w' | 'h' | 'color' | 'text'>>): void
  remove(id: string): void
  raise(id: string): void
}

let seq = 0
let justAdded: string | null = null
export const takeJustAdded = (id: string) => (justAdded === id ? ((justAdded = null), true) : false)

export const useStickies = create<StickyState>((set, get) => ({
  list: load(),
  add(at) {
    const { list } = get()
    const n = list.length
    const w = 210
    const h = 190
    const x = at ? at.x - 20 : 240 + (n % 8) * 28
    const y = at ? at.y - 14 : MENU_H + 70 + (n % 8) * 28
    const id = `s${Date.now().toString(36)}${seq++}`
    const color = colors[n % colors.length]
    const z = Math.max(0, ...list.map((s) => s.z)) + 1
    justAdded = id
    set({ list: [...list, { id, x: clampX(x, w), y: clampY(y, h), w, h, color, text: '', z }] })
    return id
  },
  patch(id, p) {
    set({ list: get().list.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  },
  remove(id) {
    set({ list: get().list.filter((s) => s.id !== id) })
  },
  raise(id) {
    const { list } = get()
    const top = Math.max(...list.map((s) => s.z))
    const cur = list.find((s) => s.id === id)
    if (!cur || cur.z === top) return
    set({ list: list.map((s) => (s.id === id ? { ...s, z: top + 1 } : s)) })
  },
}))

export const clampX = (x: number, w: number) => Math.round(Math.max(4, Math.min(window.innerWidth - w - 4, x)))
export const clampY = (y: number, h: number) => Math.round(Math.max(MENU_H + 2, Math.min(window.innerHeight - DOCK_ZONE + 40 - h, y)))

let lastContext: { x: number; y: number } | null = null
addEventListener(
  'contextmenu',
  (e) => {
    lastContext = { x: e.clientX, y: e.clientY }
  },
  true,
)
export const lastContextPoint = () => lastContext

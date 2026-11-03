import { create } from 'zustand'
import type { AppId } from './apps/ids'
import type { MenuEntry } from './lib/menu'

export type Phase = 'off' | 'booting' | 'login' | 'desktop' | 'sleep' | 'panic' | 'shuttingdown'
export type Tile = 'left' | 'right' | 'fill' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | null
export type Wallpaper = 'sequel' | 'sequel-dark' | 'orchard' | 'graphite' | 'fractal'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Win extends Rect {
  id: string
  app: AppId
  title: string
  z: number
  minimized: boolean
  tile: Tile
  restore: Rect | null
  props: Record<string, unknown>
}

export interface Note {
  id: string
  text: string
  updated: number
}

export interface Toast {
  id: string
  app: AppId
  title: string
  body: string
  actions?: { label: string; run?: () => void }[]
}

export interface Overlay {
  spotlight: boolean
  launchpad: boolean
  controlCenter: boolean
  menu: string | null
}

export const MENU_H = 26
export const DOCK_ZONE = 86

interface State {
  phase: Phase
  panicReason: string | null
  shutdownMode: 'off' | 'restart'
  windows: Win[]
  focused: string | null
  zTop: number
  tilePreview: Tile
  theme: 'light' | 'dark'
  wallpaper: Wallpaper
  brightness: number
  volume: number
  wifi: boolean
  bluetooth: boolean
  dockMagnify: boolean
  dockSize: number
  notes: Note[]
  toasts: Toast[]
  overlay: Overlay
  fsVersion: number
  launching: AppId[]
  fractalWallpaper: { cx: number; cy: number; scale: number; iter: number; scheme: 0 | 1 | 2 } | null
  contextMenu: { x: number; y: number; items: MenuEntry[] } | null
  dockAutohide: boolean
  liveWallpaper: boolean

  setPhase(p: Phase): void
  panic(reason: string): void
  openApp(app: AppId, opts?: { props?: Record<string, unknown>; forceNew?: boolean }): string
  closeWindow(id: string): void
  closeApp(app: AppId): void
  focus(id: string | null): void
  minimize(id: string): void
  setRect(id: string, r: Partial<Rect>): void
  tileWindow(id: string, t: Tile): void
  setTitle(id: string, title: string): void
  setOverlay(o: Partial<Overlay>): void
  closeOverlays(): void
  notify(t: Omit<Toast, 'id'>): void
  dismiss(id: string): void
  set<K extends keyof State>(k: K, v: State[K]): void
  bumpFs(): void
  saveNote(n: Note): void
  deleteNote(id: string): void
}

export interface AppSpec {
  name: string
  w: number
  h: number
  minW?: number
  minH?: number
  singleton?: boolean
  resizable?: boolean
}

let specs: Partial<Record<AppId, AppSpec>> = {}
export const registerSpecs = (s: Partial<Record<AppId, AppSpec>>) => {
  specs = s
}

const uid = () => Math.random().toString(36).slice(2, 10)
let cascade = 0

export function tileRect(t: Tile): Rect {
  const W = window.innerWidth
  const H = window.innerHeight - MENU_H
  const g = 6
  const half = (W - g * 3) / 2
  const halfH = (H - g * 3) / 2
  switch (t) {
    case 'left':
      return { x: g, y: MENU_H + g, w: half, h: H - g * 2 }
    case 'right':
      return { x: g * 2 + half, y: MENU_H + g, w: half, h: H - g * 2 }
    case 'top-left':
      return { x: g, y: MENU_H + g, w: half, h: halfH }
    case 'top-right':
      return { x: g * 2 + half, y: MENU_H + g, w: half, h: halfH }
    case 'bottom-left':
      return { x: g, y: MENU_H + g * 2 + halfH, w: half, h: halfH }
    case 'bottom-right':
      return { x: g * 2 + half, y: MENU_H + g * 2 + halfH, w: half, h: halfH }
    default:
      return { x: g, y: MENU_H + g, w: W - g * 2, h: H - g * 2 }
  }
}

const initialNotes: Note[] = [
  {
    id: 'math',
    text: 'Math Notes\n\nType an equation ending in = and the Rust kernel solves it.\n\nRAM I have = 8\nRAM it feels like = 8 * 2\nPearBook Pro = 1999 + 200 + 200 + 400\nmonthly cost = 2799 / 12 =\n',
    updated: Date.now() - 60_000,
  },
  { id: 'groceries', text: 'Groceries\n\npears\nmore pears\nan apple (for research)\n', updated: Date.now() - 86_400_000 },
  { id: 'ideas', text: 'App ideas\n\n- Calculator for iPad (2010–2024, RIP)\n- A dock that magnifies\n- Window tiling (revolutionary)\n', updated: Date.now() - 3 * 86_400_000 },
]

export const useOS = create<State>((set, get) => ({
  phase: 'off',
  panicReason: null,
  shutdownMode: 'restart',
  windows: [],
  focused: null,
  zTop: 10,
  tilePreview: null,
  theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  wallpaper: 'sequel',
  brightness: 1,
  volume: 0.6,
  wifi: true,
  bluetooth: true,
  dockMagnify: true,
  dockSize: 52,
  notes: initialNotes,
  toasts: [],
  overlay: { spotlight: false, launchpad: false, controlCenter: false, menu: null },
  fsVersion: 0,
  launching: [],
  fractalWallpaper: null,
  contextMenu: null,
  dockAutohide: false,
  liveWallpaper: true,

  setPhase: (phase) => set({ phase, overlay: { spotlight: false, launchpad: false, controlCenter: false, menu: null } }),
  panic: (reason) => set({ phase: 'panic', panicReason: reason, windows: [], focused: null, toasts: [] }),

  openApp(app, opts = {}) {
    const s = get()
    const spec = specs[app] ?? { name: app, w: 640, h: 440 }
    s.closeOverlays()
    if (!opts.forceNew && !opts.props) {
      const existing = s.windows.filter((w) => w.app === app)
      if (existing.length) {
        const top = existing.reduce((a, b) => (a.z > b.z ? a : b))
        const z = s.zTop + 1
        set({
          windows: s.windows.map((w) => (w.app === app ? { ...w, minimized: false, z: w.id === top.id ? z : w.z } : w)),
          focused: top.id,
          zTop: z,
        })
        return top.id
      }
    }
    if (spec.singleton) {
      const existing = s.windows.find((w) => w.app === app)
      if (existing) {
        s.focus(existing.id)
        if (opts.props) set({ windows: get().windows.map((w) => (w.id === existing.id ? { ...w, props: { ...w.props, ...opts.props } } : w)) })
        return existing.id
      }
    }
    const W = window.innerWidth
    const H = window.innerHeight
    const w = Math.min(spec.w, W - 40)
    const h = Math.min(spec.h, H - MENU_H - DOCK_ZONE - 20)
    const off = (cascade++ % 6) * 26
    const id = uid()
    const z = s.zTop + 1
    const win: Win = {
      id,
      app,
      title: spec.name,
      x: Math.max(10, Math.round((W - w) / 2 - 80 + off)),
      y: Math.max(MENU_H + 8, Math.round((H - DOCK_ZONE - h) / 2 - 20 + off)),
      w,
      h,
      z,
      minimized: false,
      tile: null,
      restore: null,
      props: opts.props ?? {},
    }
    const launching = s.launching.includes(app) || s.windows.some((x) => x.app === app) ? s.launching : [...s.launching, app]
    set({ windows: [...s.windows, win], focused: id, zTop: z, launching })
    if (launching !== s.launching) setTimeout(() => set({ launching: get().launching.filter((a) => a !== app) }), 1100)
    return id
  },

  closeWindow(id) {
    const rest = get().windows.filter((w) => w.id !== id)
    const next = rest.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0]
    set({ windows: rest, focused: get().focused === id ? next?.id ?? null : get().focused })
  },

  closeApp(app) {
    const rest = get().windows.filter((w) => w.app !== app)
    const next = rest.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0]
    set({ windows: rest, focused: next?.id ?? null })
  },

  focus(id) {
    if (!id) return set({ focused: null })
    const s = get()
    if (s.focused === id && s.windows.find((w) => w.id === id)?.z === s.zTop) return
    const z = s.zTop + 1
    set({ windows: s.windows.map((w) => (w.id === id ? { ...w, z, minimized: false } : w)), focused: id, zTop: z })
  },

  minimize(id) {
    const s = get()
    const windows = s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w))
    const next = windows.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0]
    set({ windows, focused: next?.id ?? null })
  },

  setRect(id, r) {
    set({ windows: get().windows.map((w) => (w.id === id ? { ...w, ...r } : w)) })
  },

  tileWindow(id, t) {
    set({
      windows: get().windows.map((w) => {
        if (w.id !== id) return w
        if (t === null) return w.restore ? { ...w, ...w.restore, tile: null, restore: null } : { ...w, tile: null }
        const restore = w.tile ? w.restore : { x: w.x, y: w.y, w: w.w, h: w.h }
        return { ...w, ...tileRect(t), tile: t, restore }
      }),
    })
  },

  setTitle(id, title) {
    const w = get().windows.find((x) => x.id === id)
    if (w && w.title !== title) set({ windows: get().windows.map((x) => (x.id === id ? { ...x, title } : x)) })
  },

  setOverlay: (o) => set({ overlay: { ...get().overlay, ...o } }),
  closeOverlays: () => {
    const o = get().overlay
    if (o.spotlight || o.launchpad || o.controlCenter || o.menu) set({ overlay: { spotlight: false, launchpad: false, controlCenter: false, menu: null } })
    if (get().contextMenu) set({ contextMenu: null })
  },

  notify(t) {
    const id = uid()
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.actions ? 12000 : 7000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  set: (k, v) => set({ [k]: v } as Partial<State>),
  bumpFs: () => set({ fsVersion: get().fsVersion + 1 }),

  saveNote(n) {
    const others = get().notes.filter((x) => x.id !== n.id)
    set({ notes: [n, ...others] })
  },
  deleteNote: (id) => set({ notes: get().notes.filter((n) => n.id !== id) }),
}))

export const os = () => useOS.getState()

import { create } from 'zustand'
import type { AppId } from './apps/ids'
import type { MenuEntry } from './lib/menu'
import type { QuickLookSession } from './lib/quickLook'

export type Phase = 'off' | 'booting' | 'bootpicker' | 'windows' | 'login' | 'desktop' | 'sleep' | 'panic' | 'shuttingdown'
export type Tile = 'left' | 'right' | 'fill' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | null
export type Wallpaper = 'sequel' | 'sequel-dark' | 'orchard' | 'graphite' | 'fractal' | 'lake'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Win extends Rect {
  id: string
  space: number
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

export interface HistoryItem {
  id: string
  app: AppId
  title: string
  body: string
  time: number
}

export interface Overlay {
  missionControl: boolean
  spotlight: boolean
  launchpad: boolean
  controlCenter: boolean
  notificationCenter: boolean
  widgetGallery: boolean
  menu: string | null
}

export const CLOSED: Overlay = { missionControl: false, spotlight: false, launchpad: false, controlCenter: false, notificationCenter: false, widgetGallery: false, menu: null }

export type WidgetKind = 'clock' | 'calendar' | 'weather' | 'system' | 'music' | 'notes'
export type WidgetSize = 'small' | 'medium' | 'large'
export type WidgetHome = 'desktop' | 'center'

export interface WidgetInst {
  id: string
  kind: WidgetKind
  size: WidgetSize
  x: number
  y: number
}

export interface Widgets {
  desktop: WidgetInst[]
  center: WidgetInst[]
}

export const WIDGET_PX: Record<WidgetSize, [number, number]> = { small: [158, 158], medium: [328, 158], large: [328, 328] }
const WIDGET_GAP = 12
const WIDGET_KEY = 'pearos.widgets.v1'

export const MENU_H = 26
export const DOCK_ZONE = 86
export const MAX_SPACES = 8

interface State {
  phase: Phase
  panicReason: string | null
  shutdownMode: 'off' | 'restart'
  windows: Win[]
  spaces: number[]
  activeSpace: number
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
  history: HistoryItem[]
  dnd: boolean
  widgets: Widgets
  overlay: Overlay
  fsVersion: number
  launching: AppId[]
  fractalWallpaper: { cx: number; cy: number; scale: number; iter: number; scheme: 0 | 1 | 2 } | null
  contextMenu: { x: number; y: number; items: MenuEntry[] } | null
  quickLook: QuickLookSession | null
  dockAutohide: boolean
  liveWallpaper: boolean

  setPhase(p: Phase): void
  panic(reason: string): void
  openApp(app: AppId, opts?: { props?: Record<string, unknown>; forceNew?: boolean }): string
  closeWindow(id: string): void
  closeApp(app: AppId): void
  focus(id: string | null): void
  minimize(id: string): void
  switchSpace(id: number): void
  addSpace(): number | null
  removeSpace(id: number): void
  moveWindowToSpace(id: string, space: number): void
  setRect(id: string, r: Partial<Rect>): void
  tileWindow(id: string, t: Tile): void
  setTitle(id: string, title: string): void
  setOverlay(o: Partial<Overlay>): void
  closeOverlays(): void
  notify(t: Omit<Toast, 'id'>): void
  dismiss(id: string): void
  clearHistory(app?: AppId): void
  removeHistory(id: string): void
  addWidget(home: WidgetHome, kind: WidgetKind, size: WidgetSize): void
  removeWidget(id: string): void
  resizeWidget(id: string, size: WidgetSize): void
  moveWidget(id: string, x: number, y: number): void
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

const SPACES_KEY = 'pearos.spaces.v1'
function loadSpaces(): { spaces: number[]; activeSpace: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(SPACES_KEY) ?? 'null')
    if (Array.isArray(raw?.spaces) && raw.spaces.length > 0 && raw.spaces.length <= MAX_SPACES &&
      raw.spaces.every((id: unknown) => Number.isSafeInteger(id) && (id as number) > 0) && new Set(raw.spaces).size === raw.spaces.length) {
      return { spaces: raw.spaces, activeSpace: raw.spaces.includes(raw.activeSpace) ? raw.activeSpace : raw.spaces[0] }
    }
  } catch { /* Unavailable storage: start with one desktop. */ }
  return { spaces: [1], activeSpace: 1 }
}

const frontWindow = (windows: Win[], space: number) => windows.filter((w) => !w.minimized && w.space === space).reduce<Win | undefined>((top, w) => !top || w.z > top.z ? w : top, undefined)

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

// Apps that need to clean up when they're really quit (as opposed to a window being closed).
const quitHooks: Partial<Record<AppId, () => void>> = {}
export const onQuit = (app: AppId, fn: () => void) => {
  quitHooks[app] = fn
}

let wid = 0
const widget = (kind: WidgetKind, size: WidgetSize, x = 0, y = 0): WidgetInst => ({ id: `w${Date.now().toString(36)}${wid++}`, kind, size, x, y })

const defaultWidgets = (): Widgets => ({
  desktop: [widget('clock', 'small', 18, MENU_H + 18), widget('weather', 'small', 18 + 158 + WIDGET_GAP, MENU_H + 18)],
  center: [widget('calendar', 'medium'), widget('music', 'medium'), widget('weather', 'small'), widget('system', 'small'), widget('notes', 'medium')],
})

const KINDS: WidgetKind[] = ['clock', 'calendar', 'weather', 'system', 'music', 'notes']
const SIZES: WidgetSize[] = ['small', 'medium', 'large']

function loadWidgets(): Widgets {
  try {
    const raw = JSON.parse(localStorage.getItem(WIDGET_KEY) ?? 'null')
    const clean = (list: unknown): WidgetInst[] =>
      Array.isArray(list)
        ? list.filter((w): w is WidgetInst => !!w && KINDS.includes(w.kind) && SIZES.includes(w.size) && typeof w.id === 'string' && Number.isFinite(w.x) && Number.isFinite(w.y))
        : []
    if (raw && Array.isArray(raw.desktop) && Array.isArray(raw.center)) return { desktop: clean(raw.desktop), center: clean(raw.center) }
  } catch {
    // Corrupt or unavailable storage: fall through to the defaults.
  }
  return defaultWidgets()
}

function saveWidgets(w: Widgets) {
  try {
    localStorage.setItem(WIDGET_KEY, JSON.stringify(w))
  } catch {
    // Private mode: widgets simply reset next visit.
  }
}

/** First free slot on the desktop, scanning rows from the top-left. Desktop icons live on the right. */
function freeSpot(existing: WidgetInst[], size: WidgetSize): { x: number; y: number } {
  const [w, h] = WIDGET_PX[size]
  const W = window.innerWidth - 130
  const H = window.innerHeight - DOCK_ZONE
  const hit = (x: number, y: number) => existing.some((e) => {
    const [ew, eh] = WIDGET_PX[e.size]
    return x < e.x + ew + WIDGET_GAP && x + w + WIDGET_GAP > e.x && y < e.y + eh + WIDGET_GAP && y + h + WIDGET_GAP > e.y
  })
  for (let y = MENU_H + 18; y + h <= H; y += 20) {
    for (let x = 18; x + w <= W; x += 20) if (!hit(x, y)) return { x, y }
  }
  return { x: 18 + (existing.length % 5) * 24, y: MENU_H + 18 + (existing.length % 5) * 24 }
}

const PREFS_KEY = 'pearos.prefs.v1'
const WALLPAPERS: Wallpaper[] = ['sequel', 'sequel-dark', 'orchard', 'graphite', 'fractal', 'lake']
const PREF_KEYS = ['theme', 'wallpaper', 'liveWallpaper', 'fractalWallpaper', 'brightness', 'volume', 'wifi', 'bluetooth', 'dnd', 'dockMagnify', 'dockSize', 'dockAutohide'] as const
type Prefs = Pick<State, (typeof PREF_KEYS)[number]>

function loadPrefs(): Partial<Prefs> {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return {}
    const out: Partial<Prefs> = {}
    const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined)
    if (raw.theme === 'light' || raw.theme === 'dark') out.theme = raw.theme
    const f = raw.fractalWallpaper
    if (f && [f.cx, f.cy, f.scale, f.iter].every(Number.isFinite) && f.scale > 0 && [0, 1, 2].includes(f.scheme))
      out.fractalWallpaper = { cx: f.cx, cy: f.cy, scale: f.scale, iter: Math.min(4000, Math.max(1, Math.round(f.iter))), scheme: f.scheme }
    if (WALLPAPERS.includes(raw.wallpaper) && (raw.wallpaper !== 'fractal' || out.fractalWallpaper)) out.wallpaper = raw.wallpaper
    out.brightness = num(raw.brightness, 0.25, 1)
    out.volume = num(raw.volume, 0, 1)
    out.dockSize = num(raw.dockSize, 36, 72)
    for (const k of ['liveWallpaper', 'wifi', 'bluetooth', 'dnd', 'dockMagnify', 'dockAutohide'] as const) if (typeof raw[k] === 'boolean') out[k] = raw[k]
    for (const k of Object.keys(out) as (keyof Prefs)[]) if (out[k] === undefined) delete out[k]
    return out
  } catch {
    return {}
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
  ...loadSpaces(),
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
  history: [],
  dnd: false,
  widgets: loadWidgets(),
  overlay: CLOSED,
  fsVersion: 0,
  launching: [],
  fractalWallpaper: null,
  contextMenu: null,
  quickLook: null,
  dockAutohide: false,
  liveWallpaper: true,
  ...loadPrefs(),

  setPhase: (phase) => set({ phase, overlay: CLOSED, quickLook: null }),
  panic: (reason) => set({ phase: 'panic', panicReason: reason, windows: [], focused: null, toasts: [], quickLook: null }),

  openApp(app, opts = {}) {
    const s = get()
    const spec = specs[app] ?? { name: app, w: 640, h: 440 }
    s.closeOverlays()
    if (!opts.forceNew && !opts.props) {
      const all = s.windows.filter((w) => w.app === app)
      const local = all.filter((w) => w.space === s.activeSpace)
      const existing = local.length ? local : all
      if (existing.length) {
        const top = existing.reduce((a, b) => (a.z > b.z ? a : b))
        const z = s.zTop + 1
        set({
          windows: s.windows.map((w) => (w.app === app && w.space === top.space ? { ...w, minimized: false, z: w.id === top.id ? z : w.z } : w)),
          focused: top.id,
          activeSpace: top.space,
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
      space: s.activeSpace,
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
    const next = frontWindow(rest, get().activeSpace)
    set({ windows: rest, focused: get().focused === id ? next?.id ?? null : get().focused })
  },

  closeApp(app) {
    quitHooks[app]?.()
    const rest = get().windows.filter((w) => w.app !== app)
    const next = frontWindow(rest, get().activeSpace)
    set({ windows: rest, focused: next?.id ?? null })
  },

  focus(id) {
    if (!id) return set({ focused: null })
    const s = get()
    const target = s.windows.find((w) => w.id === id)
    if (!target) return
    if (s.focused === id && s.windows.find((w) => w.id === id)?.z === s.zTop) return
    const z = s.zTop + 1
    set({ windows: s.windows.map((w) => (w.id === id ? { ...w, z, minimized: false } : w)), focused: id, zTop: z, activeSpace: target.space })
  },

  minimize(id) {
    const s = get()
    const windows = s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w))
    const next = frontWindow(windows, s.activeSpace)
    set({ windows, focused: s.focused === id ? next?.id ?? null : s.focused })
  },

  switchSpace(id) {
    const s = get()
    if (!s.spaces.includes(id) || id === s.activeSpace) return
    set({ activeSpace: id, focused: frontWindow(s.windows, id)?.id ?? null, contextMenu: null, tilePreview: null })
  },

  addSpace() {
    const s = get()
    if (s.spaces.length >= MAX_SPACES) return null
    const id = Math.max(...s.spaces) + 1
    set({ spaces: [...s.spaces, id], activeSpace: id, focused: null })
    return id
  },

  removeSpace(id) {
    const s = get()
    const index = s.spaces.indexOf(id)
    if (index < 0 || s.spaces.length === 1) return
    const spaces = s.spaces.filter((space) => space !== id)
    const destination = spaces[Math.max(0, index - 1)]
    const windows = s.windows.map((w) => w.space === id ? { ...w, space: destination } : w)
    const activeSpace = s.activeSpace === id ? destination : s.activeSpace
    set({ spaces, windows, activeSpace, focused: s.activeSpace === id ? frontWindow(windows, activeSpace)?.id ?? null : s.focused })
  },

  moveWindowToSpace(id, space) {
    const s = get()
    if (!s.spaces.includes(space)) return
    const windows = s.windows.map((w) => w.id === id && w.space !== space ? { ...w, space } : w)
    const focused = windows.find((w) => w.id === s.focused)
    set({ windows, focused: focused?.space === s.activeSpace ? s.focused : frontWindow(windows, s.activeSpace)?.id ?? null })
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

  setOverlay: (o) => set({ overlay: o.missionControl ? { ...CLOSED, ...o } : { ...get().overlay, ...(Object.values(o).some(Boolean) ? { missionControl: false } : {}), ...o }, contextMenu: null, ...(Object.values(o).some(Boolean) ? { quickLook: null } : {}) }),
  closeOverlays: () => {
    const o = get().overlay
    if (Object.values(o).some(Boolean)) set({ overlay: CLOSED })
    if (get().contextMenu) set({ contextMenu: null })
    if (get().quickLook) set({ quickLook: null })
  },

  notify(t) {
    const id = uid()
    const history = [{ id, app: t.app, title: t.title, body: t.body, time: Date.now() }, ...get().history].slice(0, 60)
    // Do Not Disturb keeps the banner away but still files the notification for later.
    if (get().dnd) return set({ history })
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }], history })
    setTimeout(() => get().dismiss(id), t.actions ? 12000 : 7000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  clearHistory: (app) => set({ history: app ? get().history.filter((h) => h.app !== app) : [] }),
  removeHistory: (id) => set({ history: get().history.filter((h) => h.id !== id) }),

  addWidget(home, kind, size) {
    const w = get().widgets
    const inst = home === 'desktop' ? { ...widget(kind, size), ...freeSpot(w.desktop, size) } : widget(kind, size)
    const next = { ...w, [home]: [...w[home], inst] }
    saveWidgets(next)
    set({ widgets: next })
  },
  removeWidget(id) {
    const w = get().widgets
    const next = { desktop: w.desktop.filter((x) => x.id !== id), center: w.center.filter((x) => x.id !== id) }
    saveWidgets(next)
    set({ widgets: next })
  },
  resizeWidget(id, size) {
    const w = get().widgets
    const map = (l: WidgetInst[]) => l.map((x) => (x.id === id ? { ...x, size } : x))
    const next = { desktop: map(w.desktop), center: map(w.center) }
    saveWidgets(next)
    set({ widgets: next })
  },
  moveWidget(id, x, y) {
    const w = get().widgets
    const next = { ...w, desktop: w.desktop.map((e) => (e.id === id ? { ...e, x, y } : e)) }
    saveWidgets(next)
    set({ widgets: next })
  },

  set: (k, v) => set({ [k]: v } as Partial<State>),
  bumpFs: () => set({ fsVersion: get().fsVersion + 1 }),

  saveNote(n) {
    const others = get().notes.filter((x) => x.id !== n.id)
    set({ notes: [n, ...others] })
  },
  deleteNote: (id) => set({ notes: get().notes.filter((n) => n.id !== id) }),
}))

export const os = () => useOS.getState()

useOS.subscribe((s, prev) => {
  if (s.spaces !== prev.spaces || s.activeSpace !== prev.activeSpace) {
    try { localStorage.setItem(SPACES_KEY, JSON.stringify({ spaces: s.spaces, activeSpace: s.activeSpace })) } catch { /* Desktops still work without storage. */ }
  }
  if (PREF_KEYS.every((k) => s[k] === prev[k])) return
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(PREF_KEYS.map((k) => [k, s[k]]))))
  } catch {
    return
  }
})

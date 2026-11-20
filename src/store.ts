import { create } from 'zustand'
import type { AppId } from './apps/ids'
import type { MenuEntry } from './lib/menu'
import type { QuickLookSession } from './lib/quickLook'
import { defaultCorners, parseCorners, type HotCorners } from './lib/hotCornerConfig.ts'
import { DEFAULT_DOCK } from './apps/dockDefaults.ts'
import { MENU_BAR_DEFAULTS, parseMenuBarPrefs, type StatusMenu } from './lib/menuBarConfig.ts'

export type Phase = 'off' | 'booting' | 'bootpicker' | 'windows' | 'login' | 'desktop' | 'sleep' | 'panic' | 'shuttingdown'
export type Tile = 'left' | 'right' | 'fill' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | null
export type Wallpaper = 'grove' | 'grove-dark' | 'orchard' | 'graphite' | 'fractal' | 'lake'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Win extends Rect {
  angle?: number
  gravityScale?: number
  id: string
  space: number
  app: AppId
  fullscreen?: { space: number; side?: 'left' | 'right' }
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
  statusMenu: StatusMenu | null
}

export const CLOSED: Overlay = { missionControl: false, spotlight: false, launchpad: false, controlCenter: false, notificationCenter: false, widgetGallery: false, menu: null, statusMenu: null }

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

export type DockMinimize = 'genie' | 'scale'
export type AppSwitchShortcut = 'alt-tab' | 'ctrl-shift-space' | 'alt-backquote'
export type Assignment = 'all' | number
export type Assignments = Partial<Record<AppId, Assignment>>

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
  activeApp: AppId
  runningApps: AppId[]
  hiddenApps: AppId[]
  appSwitchShortcut: AppSwitchShortcut
  zTop: number
  tilePreview: Tile
  theme: 'light' | 'dark'
  wallpaper: Wallpaper
  brightness: number
  volume: number
  wifi: boolean
  bluetooth: boolean
  menuBar: typeof MENU_BAR_DEFAULTS
  cameraInUse: boolean
  dockMagnify: boolean
  dockSize: number
  dockZoom: number
  dockApps: AppId[]
  dockMinimize: DockMinimize
  dockIndicators: boolean
  dockBounce: boolean
  hotCorners: HotCorners
  spaceFollowApp: boolean
  assign: Assignments
  spaceSlide: { dir: -1 | 0 | 1; seq: number }
  desktopRevealed: boolean
  mcApp: AppId | null
  appSeen: Partial<Record<AppId, number>>
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
  activateApp(app: AppId): void
  hideApp(app: AppId): void
  cycleWindows(backward: boolean): void
  resetSession(): void
  focus(id: string | null): void
  minimize(id: string): void
  switchSpace(id: number): void
  addSpace(): number | null
  removeSpace(id: number): void
  moveWindowToSpace(id: string, space: number): void
  assignApp(app: AppId, mode: 'all' | 'this' | null): void
  toggleDesktop(): void
  setRect(id: string, r: Partial<Rect>): void
  tileWindow(id: string, t: Tile): void
  toggleFullscreen(id: string): void
  splitFullscreen(id: string, other: string, side: 'left' | 'right'): void
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
  systemPanel?: boolean
}

let specs: Partial<Record<AppId, AppSpec>> = {}
export const registerSpecs = (s: Partial<Record<AppId, AppSpec>>) => {
  specs = s
}

const uid = () => Math.random().toString(36).slice(2, 10)
let cascade = 0

const SPACES_KEY = 'pearos.spaces.v1'
function loadSpaces(): { spaces: number[]; activeSpace: number; assign: Assignments } {
  try {
    const raw = JSON.parse(localStorage.getItem(SPACES_KEY) ?? 'null')
    if (Array.isArray(raw?.spaces) && raw.spaces.length > 0 && raw.spaces.length <= MAX_SPACES &&
      raw.spaces.every((id: unknown) => Number.isSafeInteger(id) && (id as number) > 0) && new Set(raw.spaces).size === raw.spaces.length) {
      const assign: Assignments = {}
      if (raw.assign && typeof raw.assign === 'object') {
        for (const [app, v] of Object.entries(raw.assign)) if (v === 'all' || (typeof v === 'number' && raw.spaces.includes(v))) assign[app as AppId] = v as Assignment
      }
      return { spaces: raw.spaces, activeSpace: raw.spaces.includes(raw.activeSpace) ? raw.activeSpace : raw.spaces[0], assign }
    }
  } catch { /* Unavailable storage: start with one desktop. */ }
  return { spaces: [1], activeSpace: 1, assign: {} }
}

export const onSpace = (w: Win, space: number, assign: Assignments) =>
  w.fullscreen ? w.fullscreen.space === space : space > 0 && (assign[w.app] === 'all' || w.space === space)

export const spaceOrder = (s: Pick<State, 'spaces' | 'windows'>) => [
  ...s.spaces,
  ...[...new Set(s.windows.flatMap((w) => w.fullscreen ? [w.fullscreen.space] : []))].sort((a, b) => b - a),
]

const windowSpace = (w: Win) => w.fullscreen?.space ?? w.space
const desktopFor = (s: Pick<State, 'windows' | 'activeSpace' | 'spaces' | 'focused'>) => {
  if (s.activeSpace > 0) return s.activeSpace
  const group = s.windows.filter((w) => windowSpace(w) === s.activeSpace)
  return (group.find((w) => w.id === s.focused) ?? group[0])?.space ?? s.spaces[0]
}
const frontWindow = (s: Pick<State, 'windows' | 'assign' | 'hiddenApps'>, space: number, app?: AppId) => s.windows
  .filter((w) => !w.minimized && !s.hiddenApps.includes(w.app) && onSpace(w, space, s.assign) && (!app || w.app === app))
  .reduce<Win | undefined>((top, w) => !top || w.z > top.z ? w : top, undefined)

function appForWindow(s: Pick<State, 'windows' | 'assign' | 'hiddenApps'>, space: number, win?: Win) {
  if (!win || !specs[win.app]?.systemPanel) return win?.app
  return frontWindow({ ...s, windows: s.windows.filter((w) => !specs[w.app]?.systemPanel) }, space)?.app
}

const appFocus = (s: Pick<State, 'activeApp' | 'runningApps'>, app: AppId) => specs[app]?.systemPanel ? {
  activeApp: s.activeApp,
  runningApps: s.runningApps,
} : {
  activeApp: app,
  runningApps: s.runningApps[0] === app ? s.runningApps : [app, ...s.runningApps.filter((a) => a !== app)],
}
const initialSession = () => ({ windows: [], focused: null, activeApp: 'finder' as const, runningApps: ['finder' as const], hiddenApps: [], launching: [], desktopRevealed: false, mcApp: null })

function slideTo(s: Pick<State, 'spaces' | 'windows' | 'activeSpace' | 'spaceSlide'>, to: number): State['spaceSlide'] {
  const order = spaceOrder(s)
  const destination = order.indexOf(to)
  const origin = order.indexOf(s.activeSpace)
  return { dir: destination < 0 || destination >= origin ? 1 : -1, seq: s.spaceSlide.seq + 1 }
}

function raiseWindow(s: State, target: Win, windows = s.windows, scope: 'window' | 'app' = 'window') {
  const activeSpace = onSpace(target, s.activeSpace, s.assign) ? s.activeSpace : windowSpace(target)
  let zTop = s.zTop
  const order = new Map<string, number>()
  if (scope !== 'window') {
    const others = windows.filter((w) => w.id !== target.id && w.app === target.app && !w.minimized && onSpace(w, activeSpace, s.assign))
    others.sort((a, b) => a.z - b.z).forEach((w) => order.set(w.id, ++zTop))
  }
  order.set(target.id, ++zTop)
  return {
    ...appFocus(s, target.app),
    hiddenApps: s.hiddenApps.filter((app) => app !== target.app),
    windows: windows.map((w) => {
      const z = order.get(w.id)
      return z === undefined ? w : { ...w, z, minimized: false }
    }),
    focused: target.id, zTop, activeSpace, desktopRevealed: false,
    spaceSlide: activeSpace === s.activeSpace ? s.spaceSlide : slideTo(s, activeSpace),
  }
}

function normalizeSplit(windows: Win[]) {
  return windows.map((w) => w.fullscreen?.side && !windows.some((other) => other.id !== w.id && other.fullscreen?.space === w.fullscreen?.space)
    ? { ...w, fullscreen: { space: w.fullscreen.space } } : w)
}

export function fullscreenRect(side: 'left' | 'right' | undefined, { width, height }: { width: number; height: number }): Rect {
  const half = Math.floor(width / 2)
  return { x: side === 'right' ? half : 0, y: 0, w: side === 'left' ? half : side === 'right' ? width - half : width, h: height }
}

export function fullscreenSide(w: Win, s: Pick<State, 'windows' | 'hiddenApps'>) {
  if (!w.fullscreen?.side) return undefined
  return s.windows.some((other) => other.id !== w.id && other.fullscreen?.space === w.fullscreen?.space && !s.hiddenApps.includes(other.app))
    ? w.fullscreen.side : undefined
}

const homeSpace = (assign: Assignments, spaces: number[], app: AppId) => {
  const a = assign[app]
  return typeof a === 'number' && spaces.includes(a) ? a : null
}

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
const WALLPAPERS: Wallpaper[] = ['grove', 'grove-dark', 'orchard', 'graphite', 'fractal', 'lake']
const PREF_KEYS = ['theme', 'wallpaper', 'liveWallpaper', 'fractalWallpaper', 'brightness', 'volume', 'wifi', 'bluetooth', 'menuBar', 'dnd', 'dockMagnify', 'dockSize', 'dockAutohide', 'dockZoom', 'dockApps', 'dockMinimize', 'dockIndicators', 'dockBounce', 'hotCorners', 'spaceFollowApp', 'appSwitchShortcut'] as const
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
    // Preserve wallpaper choices saved before the Grove rename.
    const wallpaper = raw.wallpaper === 'sequel' ? 'grove' : raw.wallpaper === 'sequel-dark' ? 'grove-dark' : raw.wallpaper
    if (WALLPAPERS.includes(wallpaper) && (wallpaper !== 'fractal' || out.fractalWallpaper)) out.wallpaper = wallpaper
    out.brightness = num(raw.brightness, 0.25, 1)
    out.volume = num(raw.volume, 0, 1)
    out.menuBar = parseMenuBarPrefs(raw.menuBar)
    out.dockSize = num(raw.dockSize, 36, 72)
    out.dockZoom = num(raw.dockZoom, 0.2, 1)
    if (raw.dockMinimize === 'genie' || raw.dockMinimize === 'scale') out.dockMinimize = raw.dockMinimize
    if (raw.appSwitchShortcut === 'alt-tab' || raw.appSwitchShortcut === 'ctrl-shift-space' || raw.appSwitchShortcut === 'alt-backquote') out.appSwitchShortcut = raw.appSwitchShortcut
    if (Array.isArray(raw.dockApps) && raw.dockApps.length <= 40 && raw.dockApps.every((a: unknown) => typeof a === 'string')) out.dockApps = [...new Set<string>(raw.dockApps)] as AppId[]
    const corners = parseCorners(raw.hotCorners)
    if (corners) out.hotCorners = corners
    for (const k of ['liveWallpaper', 'wifi', 'bluetooth', 'dnd', 'dockMagnify', 'dockAutohide', 'dockIndicators', 'dockBounce', 'spaceFollowApp'] as const) if (typeof raw[k] === 'boolean') out[k] = raw[k]
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
  ...initialSession(),
  ...loadSpaces(),
  zTop: 10,
  tilePreview: null,
  theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  wallpaper: 'grove',
  brightness: 1,
  volume: 0.6,
  wifi: true,
  bluetooth: true,
  menuBar: MENU_BAR_DEFAULTS,
  cameraInUse: false,
  dockMagnify: true,
  dockSize: 52,
  dockZoom: 0.75,
  dockApps: DEFAULT_DOCK,
  dockMinimize: 'genie',
  dockIndicators: true,
  dockBounce: true,
  hotCorners: defaultCorners(),
  spaceFollowApp: true,
  appSwitchShortcut: 'ctrl-shift-space',
  spaceSlide: { dir: 0, seq: 0 },
  appSeen: {},
  notes: initialNotes,
  toasts: [],
  history: [],
  dnd: false,
  widgets: loadWidgets(),
  overlay: CLOSED,
  fsVersion: 0,
  fractalWallpaper: null,
  contextMenu: null,
  quickLook: null,
  dockAutohide: false,
  liveWallpaper: true,
  ...loadPrefs(),

  setPhase: (phase) => set({ phase, overlay: CLOSED, quickLook: null }),
  resetSession() {
    const s = get()
    for (const app of s.runningApps) quitHooks[app]?.()
    set({ ...initialSession(), activeSpace: desktopFor(s), toasts: [], overlay: CLOSED, contextMenu: null, quickLook: null })
  },
  panic(reason) {
    get().resetSession()
    set({ phase: 'panic', panicReason: reason })
  },

  openApp(app, opts = {}) {
    const s = get()
    const spec = specs[app] ?? { name: app, w: 640, h: 440 }
    s.closeOverlays()
    if (app === 'screenshot') {
      import('./lib/screenshot').then((m) => m.openToolbar())
      return ''
    }
    const seen = spec.systemPanel ? s.appSeen : { ...s.appSeen, [app]: Date.now() }
    const activation = { ...appFocus(s, app), hiddenApps: s.hiddenApps.filter((a) => a !== app) }
    const home = homeSpace(s.assign, s.spaces, app)
    if (!opts.forceNew && !opts.props) {
      const all = s.windows.filter((w) => w.app === app && (app !== 'finder' || !w.props.infoPath))
      const local = all.filter((w) => onSpace(w, s.activeSpace, s.assign))
      const existing = local.length ? local : s.spaceFollowApp ? all : all.filter((w) => w.fullscreen)
      if (existing.length) {
        const top = existing.reduce((a, b) => a.minimized !== b.minimized ? a.minimized ? b : a : a.z > b.z ? a : b)
        set({ ...raiseWindow(s, top, s.windows, 'app'), appSeen: seen })
        return top.id
      }
      if (all.length && spec.singleton) {
        const top = all.reduce((a, b) => (a.z > b.z ? a : b))
        const space = home ?? desktopFor(s)
        set({ windows: s.windows.map((w) => (w.id === top.id ? { ...w, space } : w)) })
        if (space !== s.activeSpace) get().switchSpace(space)
        return get().openApp(app)
      }
    }
    if (spec.singleton) {
      const existing = s.windows.find((w) => w.app === app)
      if (existing) {
        s.focus(existing.id)
        if (opts.props) set({ windows: get().windows.map((w) => (w.id === existing.id ? { ...w, props: { ...w.props, ...opts.props } } : w)), appSeen: seen })
        return existing.id
      }
    }
    const W = window.innerWidth
    const H = window.innerHeight
    const inspector = app === 'finder' && opts.props?.infoPath
    const w = Math.min(inspector ? 335 : spec.w, W - 40)
    const h = Math.min(inspector ? 390 : spec.h, H - MENU_H - DOCK_ZONE - 20)
    const off = (cascade++ % 6) * 26
    const id = uid()
    const z = s.zTop + 1
    const space = home ?? desktopFor(s)
    const win: Win = {
      id,
      space,
      app,
      title: spec.name,
      x: Math.max(10, Math.min(W - w - 10, Math.round((W - w) / 2 - 80 + off))),
      y: Math.max(MENU_H + 8, Math.min(H - h - 10, Math.round((H - DOCK_ZONE - h) / 2 - 20 + off))),
      w,
      h,
      z,
      minimized: false,
      tile: null,
      restore: null,
      props: opts.props ?? {},
    }
    const launching = spec.systemPanel || s.launching.includes(app) || s.runningApps.includes(app) ? s.launching : [...s.launching, app]
    set({ ...activation, windows: [...s.windows, win], focused: id, zTop: z, launching, activeSpace: space, desktopRevealed: false, appSeen: seen, spaceSlide: space === s.activeSpace ? s.spaceSlide : slideTo(s, space) })
    if (launching !== s.launching) setTimeout(() => set({ launching: get().launching.filter((a) => a !== app) }), 1100)
    return id
  },

  closeWindow(id) {
    const s = get()
    const windows = normalizeSplit(s.windows.filter((w) => w.id !== id))
    const activeSpace = spaceOrder({ ...s, windows }).includes(s.activeSpace) ? s.activeSpace : desktopFor(s)
    const next = frontWindow({ ...s, windows }, activeSpace, activeSpace > 0 ? s.activeApp : undefined)
    const replaceFocus = s.focused === id || activeSpace !== s.activeSpace
    if (replaceFocus && next) return set({ ...raiseWindow(s, next, windows), activeSpace, spaceSlide: activeSpace === s.activeSpace ? s.spaceSlide : slideTo(s, activeSpace) })
    set({
      windows, activeSpace, focused: replaceFocus ? null : s.focused,
      spaceSlide: activeSpace === s.activeSpace ? s.spaceSlide : slideTo(s, activeSpace),
    })
  },

  closeApp(app) {
    const s = get()
    quitHooks[app]?.()
    const windows = normalizeSplit(s.windows.filter((w) => w.app !== app))
    const activeSpace = spaceOrder({ ...s, windows }).includes(s.activeSpace) ? s.activeSpace : desktopFor(s)
    const hiddenApps = s.hiddenApps.filter((a) => a !== app)
    const runningApps = s.runningApps.filter((a) => a !== app || a === 'finder')
    const visible = { ...s, windows, hiddenApps }
    const next = frontWindow(visible, activeSpace)
    const nextApp = appForWindow(visible, activeSpace, next) ?? runningApps.find((a) => !hiddenApps.includes(a)) ?? 'finder'
    set({
      windows, hiddenApps, runningApps, activeSpace, launching: s.launching.filter((a) => a !== app),
      ...(s.activeApp === app ? { ...appFocus({ ...s, runningApps }, nextApp), focused: next?.id ?? null } : {}),
      spaceSlide: activeSpace === s.activeSpace ? s.spaceSlide : slideTo(s, activeSpace),
    })
  },

  activateApp(app) {
    const s = get()
    if (!s.runningApps.includes(app)) return
    s.closeOverlays()
    const hiddenApps = s.hiddenApps.filter((a) => a !== app)
    const visible = { ...s, hiddenApps }
    const local = frontWindow(visible, s.activeSpace, app)
    const remote = s.windows.filter((w) => w.app === app && !w.minimized && (s.spaceFollowApp || w.fullscreen)).sort((a, b) => b.z - a.z)[0]
    const target = local ?? remote
    if (target) set(raiseWindow(s, target, s.windows, 'app'))
    else {
      const activeSpace = desktopFor(s)
      set({ ...appFocus(s, app), hiddenApps, activeSpace, focused: null, desktopRevealed: false, spaceSlide: activeSpace === s.activeSpace ? s.spaceSlide : slideTo(s, activeSpace) })
    }
  },

  hideApp(app) {
    const s = get()
    if (!s.runningApps.includes(app) || s.hiddenApps.includes(app) || (app === 'finder' && !s.windows.some((w) => w.app === app))) return
    const hiddenApps = [...s.hiddenApps, app]
    const visible = { ...s, hiddenApps }
    const activeSpace = s.activeSpace < 0 && !frontWindow(visible, s.activeSpace) ? desktopFor(s) : s.activeSpace
    const next = frontWindow(visible, activeSpace)
    const nextApp = appForWindow(visible, activeSpace, next) ?? 'finder'
    set({
      hiddenApps, activeSpace,
      ...(s.activeApp === app ? { ...appFocus(s, nextApp), focused: next?.id ?? null } : {}),
      spaceSlide: activeSpace === s.activeSpace ? s.spaceSlide : slideTo(s, activeSpace),
    })
  },

  cycleWindows(backward) {
    const s = get()
    const windows = s.windows.filter((w) => w.app === s.activeApp && !w.minimized && !s.hiddenApps.includes(w.app) && onSpace(w, s.activeSpace, s.assign))
    if (!windows.length) return
    const index = windows.findIndex((w) => w.id === s.focused)
    const next = index < 0 ? (backward ? windows.length - 1 : 0) : (index + (backward ? -1 : 1) + windows.length) % windows.length
    s.focus(windows[next].id)
  },

  focus(id) {
    const s = get()
    if (!id) return set({ focused: null, ...appFocus(s, 'finder') })
    const target = s.windows.find((w) => w.id === id)
    if (!target) return
    const space = onSpace(target, s.activeSpace, s.assign) ? s.activeSpace : windowSpace(target)
    if (s.focused === id && (s.activeApp === target.app || specs[target.app]?.systemPanel) && target.z === s.zTop && !s.desktopRevealed && space === s.activeSpace && !target.minimized && !s.hiddenApps.includes(target.app)) return
    set(raiseWindow(s, target))
  },

  minimize(id) {
    const s = get()
    if (!s.windows.some((w) => w.id === id && !w.fullscreen && !specs[w.app]?.systemPanel)) return
    const windows = s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w))
    const next = frontWindow({ ...s, windows }, s.activeSpace, s.activeApp)
    if (s.focused === id && next) return set(raiseWindow(s, next, windows))
    set({ windows, focused: s.focused === id ? null : s.focused })
  },

  switchSpace(id) {
    const s = get()
    if (!spaceOrder(s).includes(id) || id === s.activeSpace) return
    const next = frontWindow(s, id)
    const hidden = id < 0 && !next ? s.windows.find((w) => windowSpace(w) === id) : undefined
    if (hidden) return s.focus(hidden.id)
    set({ ...appFocus(s, appForWindow(s, id, next) ?? 'finder'), activeSpace: id, focused: next?.id ?? null, contextMenu: null, tilePreview: null, desktopRevealed: false, spaceSlide: slideTo(s, id) })
  },

  addSpace() {
    const s = get()
    if (s.spaces.length >= MAX_SPACES) return null
    const id = Math.max(...s.spaces) + 1
    set({ ...appFocus(s, 'finder'), spaces: [...s.spaces, id], activeSpace: id, focused: null, spaceSlide: { dir: s.activeSpace < 0 ? -1 : 1, seq: s.spaceSlide.seq + 1 } })
    return id
  },

  removeSpace(id) {
    const s = get()
    const index = s.spaces.indexOf(id)
    if (index < 0 || s.spaces.length === 1) return
    const spaces = s.spaces.filter((space) => space !== id)
    const destination = spaces[Math.max(0, index - 1)]
    const windows = s.windows.map((w) => w.space === id ? { ...w, space: destination } : w)
    const assign = Object.fromEntries(Object.entries(s.assign).map(([app, v]) => [app, v === id ? destination : v])) as Assignments
    const activeSpace = s.activeSpace === id ? destination : s.activeSpace
    const destinationState = { ...s, windows, assign }
    const next = frontWindow(destinationState, activeSpace)
    set({ spaces, windows, assign, activeSpace, ...(s.activeSpace === id ? { ...appFocus(s, appForWindow(destinationState, activeSpace, next) ?? 'finder'), focused: next?.id ?? null } : {}) })
  },

  moveWindowToSpace(id, space) {
    const s = get()
    if (!s.spaces.includes(space)) return
    const windows = normalizeSplit(s.windows.map((w) => {
      if (w.id !== id) return w
      const { fullscreen, ...rest } = w
      return { ...rest, space }
    }))
    const activeSpace = spaceOrder({ ...s, windows }).includes(s.activeSpace) ? s.activeSpace : space
    const focused = windows.find((w) => w.id === s.focused)
    const destinationState = { ...s, windows }
    const next = focused && onSpace(focused, activeSpace, s.assign) ? focused : frontWindow(destinationState, activeSpace)
    set({
      ...appFocus(s, appForWindow(destinationState, activeSpace, next) ?? 'finder'), windows, activeSpace, focused: next?.id ?? null,
      spaceSlide: activeSpace === s.activeSpace ? s.spaceSlide : slideTo(s, activeSpace),
    })
  },

  assignApp(app, mode) {
    const s = get()
    const assign = { ...s.assign }
    if (mode === null) delete assign[app]
    else assign[app] = mode === 'all' ? 'all' : desktopFor(s)
    const windows = mode === 'this' ? s.windows.map((w) => (w.app === app ? { ...w, space: desktopFor(s) } : w)) : s.windows
    set({ assign, windows })
  },

  toggleDesktop() {
    const s = get()
    if (s.activeSpace < 0) return s.switchSpace(desktopFor(s))
    const next = s.desktopRevealed ? frontWindow(s, s.activeSpace) : undefined
    set({ ...appFocus(s, appForWindow(s, s.activeSpace, next) ?? 'finder'), desktopRevealed: !s.desktopRevealed, focused: next?.id ?? null })
  },

  setRect(id, r) {
    set({ windows: get().windows.map((w) => (w.id === id ? { ...w, ...r } : w)) })
  },

  tileWindow(id, t) {
    set({
      windows: get().windows.map((w) => {
        if (w.id !== id || w.fullscreen || specs[w.app]?.resizable === false || w.props.infoPath) return w
        if (t === null) return w.restore ? { ...w, ...w.restore, tile: null, restore: null, angle: 0, gravityScale: 1 } : { ...w, tile: null, angle: 0, gravityScale: 1 }
        const restore = w.tile ? w.restore : { x: w.x, y: w.y, w: w.w, h: w.h }
        return { ...w, ...tileRect(t), tile: t, restore, angle: 0, gravityScale: 1 }
      }),
    })
  },

  toggleFullscreen(id) {
    const s = get()
    const win = s.windows.find((w) => w.id === id)
    if (!win || specs[win.app]?.resizable === false || win.props.infoPath) return
    const { fullscreen, ...rest } = win
    const next = fullscreen ? rest : {
      ...win, space: onSpace(win, s.activeSpace, s.assign) ? desktopFor(s) : win.space,
      fullscreen: { space: Math.min(0, ...spaceOrder(s)) - 1 },
    }
    const windows = normalizeSplit(s.windows.map((w) => w.id === id ? next : w))
    set({ ...raiseWindow(s, next, windows), overlay: CLOSED, contextMenu: null, quickLook: null, tilePreview: null, mcApp: null })
  },

  splitFullscreen(id, other, side) {
    const s = get()
    const eligible = (w: Win) => !w.fullscreen?.side && !w.minimized && !w.props.infoPath && !s.hiddenApps.includes(w.app) && specs[w.app]?.resizable !== false
    const first = s.windows.find((w) => w.id === id && eligible(w))
    const second = s.windows.find((w) => w.id === other && !w.fullscreen && eligible(w))
    if (!first || !second || first.id === second.id) return
    const space = first.fullscreen?.space ?? Math.min(0, ...spaceOrder(s)) - 1
    const desktop = first.fullscreen ? first.space : desktopFor(s)
    const next = { ...first, space: onSpace(first, desktop, s.assign) ? desktop : first.space, fullscreen: { space, side } }
    const windows = s.windows.map<Win>((w) => {
      if (w.id === id) return next
      if (w.id === other) return { ...w, space: onSpace(w, desktop, s.assign) ? desktop : w.space, fullscreen: { space, side: side === 'left' ? 'right' : 'left' } }
      return w
    })
    set({ ...raiseWindow(s, next, windows), overlay: CLOSED, contextMenu: null, quickLook: null, tilePreview: null, mcApp: null })
  },

  setTitle(id, title) {
    const w = get().windows.find((x) => x.id === id)
    if (w && w.title !== title) set({ windows: get().windows.map((x) => (x.id === id ? { ...x, title } : x)) })
  },

  setOverlay: (o) => {
    const opening = Object.values(o).some(Boolean)
    set({
      overlay: { ...(opening ? CLOSED : get().overlay), ...o },
      contextMenu: null,
      ...(o.missionControl ? { desktopRevealed: false } : { mcApp: null }),
      ...(opening ? { quickLook: null } : {}),
    })
  },
  closeOverlays: () => {
    const o = get().overlay
    if (Object.values(o).some(Boolean)) set({ overlay: CLOSED, mcApp: null })
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
  if (s.spaces !== prev.spaces || s.activeSpace !== prev.activeSpace || s.assign !== prev.assign || (s.activeSpace < 0 && s.focused !== prev.focused)) {
    try { localStorage.setItem(SPACES_KEY, JSON.stringify({ spaces: s.spaces, activeSpace: desktopFor(s), assign: s.assign })) } catch { /* Desktops still work without storage. */ }
  }
  if (PREF_KEYS.every((k) => s[k] === prev[k])) return
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(PREF_KEYS.map((k) => [k, s[k]]))))
  } catch {
    return
  }
})

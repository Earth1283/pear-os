import { create } from 'zustand'

export type AppKey =
  | 'explorer'
  | 'notepad'
  | 'mines'
  | 'paint'
  | 'dos'
  | 'pnet'
  | 'welcome'
  | 'msgbox'
  | 'winver'
  | 'display'
  | 'system'
  | 'run'
  | 'shutdown'
  | 'closeprog'

export type IconName =
  | 'computer' | 'folder' | 'folderOpen' | 'drive' | 'floppy' | 'cdrom' | 'recycle' | 'recycleFull'
  | 'notepad' | 'mines' | 'paint' | 'dos' | 'globe' | 'doc' | 'exe' | 'control' | 'display' | 'system'
  | 'hardware' | 'flag' | 'help' | 'run' | 'find' | 'docs' | 'settings' | 'programs' | 'shutdown'
  | 'warn' | 'error' | 'info' | 'question' | 'printer' | 'sound' | 'mouse' | 'keyboard' | 'fonts' | 'dll' | 'bulb'

export interface Spec {
  title: string
  icon: IconName
  w: number
  h: number
  minW?: number
  minH?: number
  resizable?: boolean
  /** Dialogs sit above everything and have no taskbar button. */
  dialog?: boolean
  singleton?: boolean
}

export const SPECS: Record<AppKey, Spec> = {
  explorer: { title: 'My Computer', icon: 'computer', w: 440, h: 320, minW: 260, minH: 180, resizable: true },
  notepad: { title: 'Untitled - Notepad', icon: 'notepad', w: 480, h: 340, minW: 240, minH: 140, resizable: true },
  mines: { title: 'Minesweeper', icon: 'mines', w: 0, h: 0, singleton: true },
  paint: { title: 'untitled - Paint', icon: 'paint', w: 600, h: 440, minW: 360, minH: 280, resizable: true },
  dos: { title: 'MS-DOS Prompt', icon: 'dos', w: 560, h: 340, minW: 280, minH: 160, resizable: true },
  pnet: { title: 'The Pear Network', icon: 'globe', w: 560, h: 400, minW: 300, minH: 200, resizable: true, singleton: true },
  welcome: { title: 'Welcome', icon: 'flag', w: 468, h: 286, dialog: true, singleton: true },
  msgbox: { title: 'Windows', icon: 'info', w: 330, h: 0, dialog: true },
  winver: { title: 'About Windows 95', icon: 'flag', w: 380, h: 330, dialog: true, singleton: true },
  display: { title: 'Display Properties', icon: 'display', w: 360, h: 380, dialog: true, singleton: true },
  system: { title: 'System Properties', icon: 'system', w: 360, h: 400, dialog: true, singleton: true },
  run: { title: 'Run', icon: 'run', w: 360, h: 168, dialog: true, singleton: true },
  shutdown: { title: 'Shut Down Windows', icon: 'shutdown', w: 340, h: 296, dialog: true, singleton: true },
  closeprog: { title: 'Close Program', icon: 'warn', w: 300, h: 250, dialog: true, singleton: true },
}

export interface W95Win {
  id: string
  app: AppKey
  title: string
  x: number
  y: number
  w: number
  h: number
  z: number
  min: boolean
  max: boolean
  props: Record<string, unknown>
}

export type Power = 'shutdown' | 'restart' | 'dos' | 'mac'

interface State {
  windows: W95Win[]
  focused: string | null
  zTop: number
  startOpen: boolean
  bsod: boolean
  power: Power | null
  /** Desktop colour, changed in Display Properties. */
  desk: string
  computer: string
  open(app: AppKey, props?: Record<string, unknown>): string
  close(id: string): void
  focus(id: string | null): void
  minimize(id: string): void
  toggleMax(id: string): void
  setRect(id: string, r: Partial<Pick<W95Win, 'x' | 'y' | 'w' | 'h'>>): void
  setTitle(id: string, title: string): void
  setStart(open: boolean): void
  crash(): void
  uncrash(): void
  requestPower(p: Power | null): void
  set<K extends 'desk' | 'computer'>(k: K, v: State[K]): void
  reset(): void
}

let n = 0
let cascade = 0

export interface MsgOpts {
  title?: string
  icon?: 'error' | 'warn' | 'info' | 'question'
  buttons?: { label: string; run?: () => void }[]
}

export const useW95 = create<State>((set, get) => ({
  windows: [],
  focused: null,
  zTop: 1,
  startOpen: false,
  bsod: false,
  power: null,
  desk: '#008080',
  computer: 'PEARBOOK',

  open(app, props = {}) {
    const s = get()
    const spec = SPECS[app]
    if (spec.singleton) {
      const ex = s.windows.find((w) => w.app === app)
      if (ex) {
        s.focus(ex.id)
        if (Object.keys(props).length) set({ windows: get().windows.map((w) => (w.id === ex.id ? { ...w, props: { ...w.props, ...props } } : w)) })
        return ex.id
      }
    }
    const W = window.innerWidth
    const H = window.innerHeight - 28
    // 0 means "fit the content" (message boxes, Minesweeper); centre using a rough guess.
    const w = spec.w ? Math.min(spec.w, W - 8) : 0
    const h = spec.h ? Math.min(spec.h, H - 8) : 0
    const gw = w || 330
    const gh = h || 130
    const off = (cascade++ % 7) * 22
    const center = spec.dialog
    const id = `w${++n}`
    const z = s.zTop + 1
    const win: W95Win = {
      id,
      app,
      title: (props.title as string | undefined) ?? spec.title,
      x: center ? Math.round((W - gw) / 2) + (cascade % 3) * 12 : Math.max(4, Math.min(W - gw - 4, 70 + off)),
      y: center ? Math.round((H - gh) / 2) - 20 + (cascade % 3) * 12 : Math.max(4, Math.min(H - gh - 4, 40 + off)),
      w,
      h,
      z,
      min: false,
      max: false,
      props,
    }
    set({ windows: [...s.windows, win], focused: id, zTop: z, startOpen: false })
    return id
  },

  close(id) {
    const rest = get().windows.filter((w) => w.id !== id)
    const next = rest.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0]
    set({ windows: rest, focused: get().focused === id ? next?.id ?? null : get().focused })
  },

  focus(id) {
    if (!id) return set({ focused: null })
    const s = get()
    const cur = s.windows.find((w) => w.id === id)
    if (!cur) return
    if (s.focused === id && cur.z === s.zTop && !cur.min) return
    const z = s.zTop + 1
    set({ windows: s.windows.map((w) => (w.id === id ? { ...w, z, min: false } : w)), focused: id, zTop: z })
  },

  minimize(id) {
    const windows = get().windows.map((w) => (w.id === id ? { ...w, min: true } : w))
    const next = windows.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0]
    set({ windows, focused: next?.id ?? null })
  },

  toggleMax: (id) => set({ windows: get().windows.map((w) => (w.id === id ? { ...w, max: !w.max } : w)) }),
  setRect: (id, r) => set({ windows: get().windows.map((w) => (w.id === id ? { ...w, ...r } : w)) }),
  setTitle(id, title) {
    const w = get().windows.find((x) => x.id === id)
    if (w && w.title !== title) set({ windows: get().windows.map((x) => (x.id === id ? { ...x, title } : x)) })
  },
  setStart: (startOpen) => set({ startOpen }),
  crash: () => set({ bsod: true, startOpen: false }),
  uncrash() {
    // "Press any key to terminate the current application."
    const s = get()
    const victim = s.windows.filter((w) => !SPECS[w.app].dialog && !w.min).sort((a, b) => b.z - a.z)[0]
    set({ bsod: false })
    if (victim) s.close(victim.id)
  },
  requestPower: (power) => set({ power, startOpen: false }),
  set: (k, v) => set({ [k]: v } as Partial<State>),
  reset: () => set({ windows: [], focused: null, zTop: 1, startOpen: false, bsod: false, power: null }),
}))

/** A classic message box. */
export function msgbox(text: string, o: MsgOpts = {}) {
  return useW95.getState().open('msgbox', { text, icon: o.icon ?? 'info', title: o.title ?? 'Windows', buttons: o.buttons ?? [{ label: 'OK' }] })
}
export const w95 = () => useW95.getState()

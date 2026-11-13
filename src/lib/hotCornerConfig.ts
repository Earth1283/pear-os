export type Corner = 'tl' | 'tr' | 'bl' | 'br'
export type HotAction = 'none' | 'missionControl' | 'appWindows' | 'desktop' | 'notificationCenter' | 'launchpad' | 'quickNote' | 'lock' | 'sleep'
export type HotMod = 'none' | 'meta' | 'alt' | 'ctrl' | 'shift'
export interface HotCorner { action: HotAction; mod: HotMod }
export type HotCorners = Record<Corner, HotCorner>

export const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']

export const CORNER_NAMES: Record<Corner, string> = { tl: 'Top Left', tr: 'Top Right', bl: 'Bottom Left', br: 'Bottom Right' }

export const HOT_ACTIONS: { id: HotAction; label: string }[] = [
  { id: 'none', label: '–' },
  { id: 'missionControl', label: 'Mission Control' },
  { id: 'appWindows', label: 'Application Windows' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'notificationCenter', label: 'Notification Center' },
  { id: 'launchpad', label: 'Launchpad' },
  { id: 'quickNote', label: 'Quick Note' },
  { id: 'lock', label: 'Lock Screen' },
  { id: 'sleep', label: 'Put Display to Sleep' },
]

export const HOT_MODS: { id: HotMod; label: string }[] = [
  { id: 'none', label: 'No modifier' },
  { id: 'meta', label: '⌘ Command' },
  { id: 'alt', label: '⌥ Option' },
  { id: 'ctrl', label: '⌃ Control' },
  { id: 'shift', label: '⇧ Shift' },
]

const off = (): HotCorner => ({ action: 'none', mod: 'none' })
export const defaultCorners = (): HotCorners => ({ tl: off(), tr: off(), bl: off(), br: off() })

export const CORNER_ZONE = 6
export const CORNER_EXIT = 18
export const CORNER_DWELL = 140

export function cornerAt(x: number, y: number, width: number, height: number, zone = CORNER_ZONE): Corner | null {
  const left = x < zone
  const right = x > width - 1 - zone
  const top = y < zone
  const bottom = y > height - 1 - zone
  if (top) return left ? 'tl' : right ? 'tr' : null
  if (bottom) return left ? 'bl' : right ? 'br' : null
  return null
}

export function modifierHeld(mod: HotMod, e: { metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean }) {
  switch (mod) {
    case 'meta': return e.metaKey
    case 'alt': return e.altKey
    case 'ctrl': return e.ctrlKey
    case 'shift': return e.shiftKey
    default: return true
  }
}

export function parseCorners(raw: unknown): HotCorners | null {
  if (!raw || typeof raw !== 'object') return null
  const actions = new Set<string>(HOT_ACTIONS.map((a) => a.id))
  const mods = new Set<string>(HOT_MODS.map((m) => m.id))
  const out = defaultCorners()
  for (const c of CORNERS) {
    const v = (raw as Record<string, { action?: unknown; mod?: unknown } | undefined>)[c]
    if (typeof v?.action === 'string' && actions.has(v.action)) out[c].action = v.action as HotAction
    if (typeof v?.mod === 'string' && mods.has(v.mod)) out[c].mod = v.mod as HotMod
  }
  return out
}

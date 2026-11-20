export type StatusMenu = 'wifi' | 'bluetooth' | 'battery' | 'focus' | 'sound' | 'nowPlaying' | 'privacy'

export const MENU_BAR_DEFAULTS = {
  wifi: true,
  bluetooth: false,
  battery: true,
  batteryPercentage: false,
  sound: false,
  spotlight: true,
  date: true,
  clock24Hour: false,
  clockSeconds: false,
}

export function parseMenuBarPrefs(raw: unknown) {
  const prefs = { ...MENU_BAR_DEFAULTS }
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(prefs) as (keyof typeof prefs)[]) {
      const value = (raw as Record<string, unknown>)[key]
      if (typeof value === 'boolean') prefs[key] = value
    }
  }
  return prefs
}

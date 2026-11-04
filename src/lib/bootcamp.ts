import { create } from 'zustand'
import { os } from '../store'

/** none: no Windows partition. pending: files copied, Setup still has to run. installed: it boots. */
export type WindowsState = 'none' | 'pending' | 'installed'
export type Disk = 'mac' | 'windows'
/** 95 is the React/CSS parody. 98 is real Windows running in the v86 emulator from the user's own ISO. */
export type Version = '95' | '98'

interface BootCamp {
  windows: WindowsState
  /** What the Startup Manager picks if you do nothing. */
  startup: Disk
  /** Size of the Windows partition in GB. */
  sizeGB: number
  version: Version
  /** "Show this Welcome Screen next time you start Windows". */
  welcome: boolean
  set(patch: Partial<Pick<BootCamp, 'windows' | 'startup' | 'sizeGB' | 'welcome' | 'version'>>): void
}

const KEY = 'pearos.bootcamp.v1'

type Saved = Pick<BootCamp, 'windows' | 'startup' | 'sizeGB' | 'welcome' | 'version'>
const DEFAULTS: Saved = { windows: 'none', startup: 'mac', sizeGB: 0.5, welcome: true, version: '95' }

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      return {
        windows: raw.windows === 'pending' || raw.windows === 'installed' ? raw.windows : 'none',
        startup: raw.startup === 'windows' ? 'windows' : 'mac',
        sizeGB: Number.isFinite(raw.sizeGB) ? Math.min(7, Math.max(0.1, raw.sizeGB)) : DEFAULTS.sizeGB,
        welcome: raw.welcome !== false,
        version: raw.version === '98' ? '98' : '95',
      }
    }
  } catch {
    // Unavailable or corrupt storage: start from a clean disk.
  }
  return DEFAULTS
}

export const useBootCamp = create<BootCamp>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch)
    const { windows, startup, sizeGB, welcome, version } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ windows, startup, sizeGB, welcome, version }))
    } catch {
      // Private mode: Windows is gone next visit, which is also how real Windows 95 felt.
    }
  },
}))

/** Restart the (parody) Mac. The Startup Manager decides where it lands. */
export function restartMac() {
  os().set('shutdownMode', 'restart')
  os().setPhase('shuttingdown')
}

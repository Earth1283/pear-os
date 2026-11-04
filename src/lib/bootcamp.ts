import { create } from 'zustand'
import { os } from '../store'

/** none: no Windows partition. pending: files copied, Setup still has to run. installed: it boots. */
export type WindowsState = 'none' | 'pending' | 'installed'
export type Disk = 'mac' | 'windows'

interface BootCamp {
  windows: WindowsState
  /** What the Startup Manager picks if you do nothing. */
  startup: Disk
  /** Size of the Windows partition in GB. */
  sizeGB: number
  /** "Show this Welcome Screen next time you start Windows". */
  welcome: boolean
  set(patch: Partial<Pick<BootCamp, 'windows' | 'startup' | 'sizeGB' | 'welcome'>>): void
}

const KEY = 'pearos.bootcamp.v1'

type Saved = Pick<BootCamp, 'windows' | 'startup' | 'sizeGB' | 'welcome'>
const DEFAULTS: Saved = { windows: 'none', startup: 'mac', sizeGB: 0.5, welcome: true }

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      return {
        windows: raw.windows === 'pending' || raw.windows === 'installed' ? raw.windows : 'none',
        startup: raw.startup === 'windows' ? 'windows' : 'mac',
        sizeGB: Number.isFinite(raw.sizeGB) ? Math.min(7, Math.max(0.1, raw.sizeGB)) : DEFAULTS.sizeGB,
        welcome: raw.welcome !== false,
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
    const { windows, startup, sizeGB, welcome } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ windows, startup, sizeGB, welcome }))
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

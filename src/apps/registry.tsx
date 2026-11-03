import type { AppId } from './ids'
import type { AppDef } from './types'
import { registerSpecs } from '../store'
import { Finder } from './Finder'
import { Terminal } from './Terminal'
import { Calculator, Notes, TextEdit } from './Productivity'
import { Intelligence, Mirroring, Passwords, Safari } from './Sequel'
import { About, ActivityMonitor, Fractals, Settings } from './System'
import { Preview } from './Drive'

const Nothing = () => null

export const APPS: Record<AppId, AppDef> = {
  finder: { name: 'Finder', component: Finder, w: 860, h: 520, minW: 520, minH: 300, chrome: 'overlay' },
  launchpad: { name: 'Launchpad', component: Nothing, w: 0, h: 0, hidden: true },
  safari: { name: 'Sapphari', component: Safari, w: 1040, h: 680, minW: 480, chrome: 'overlay' },
  notes: { name: 'Notes', component: Notes, w: 820, h: 540, minW: 520, singleton: true, chrome: 'overlay' },
  textedit: { name: 'TextEdit', component: TextEdit, w: 620, h: 520 },
  calculator: { name: 'Calculator', component: Calculator, w: 236, h: 392, singleton: true, resizable: false, chrome: 'overlay' },
  terminal: { name: 'Terminal', component: Terminal, w: 700, h: 440, minW: 360 },
  intelligence: { name: 'Pear Intelligence', component: Intelligence, w: 440, h: 600, minW: 360, minH: 420, singleton: true, chrome: 'overlay' },
  passwords: { name: 'Passwords', component: Passwords, w: 900, h: 560, minW: 640, singleton: true, chrome: 'overlay' },
  mirroring: { name: 'pPhone Mirroring', component: Mirroring, w: 330, h: 680, singleton: true, resizable: false, chrome: 'overlay' },
  activity: { name: 'Activity Monitor', component: ActivityMonitor, w: 820, h: 560, minW: 560, singleton: true, chrome: 'overlay' },
  fractals: { name: 'Fractals', component: Fractals, w: 820, h: 560, minW: 400, chrome: 'overlay' },
  settings: { name: 'System Settings', component: Settings, w: 780, h: 580, minW: 640, minH: 400, singleton: true, chrome: 'overlay' },
  preview: { name: 'Preview', component: Preview, w: 760, h: 540, minW: 240, minH: 180 },
  about: { name: 'About This Pear', component: About, w: 300, h: 580, singleton: true, resizable: false, chrome: 'overlay' },
  trash: { name: 'Trash', component: Nothing, w: 0, h: 0, hidden: true },
}

registerSpecs(APPS)

export const DOCK_APPS: AppId[] = ['finder', 'launchpad', 'safari', 'notes', 'calculator', 'terminal', 'intelligence', 'passwords', 'mirroring', 'activity', 'fractals', 'settings']
export const LAUNCHPAD_APPS: AppId[] = ['finder', 'safari', 'notes', 'textedit', 'calculator', 'terminal', 'intelligence', 'passwords', 'mirroring', 'activity', 'fractals', 'settings']

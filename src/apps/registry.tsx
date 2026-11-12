import { lazy, type ComponentType } from 'react'
import { create } from 'zustand'
import type { AppId } from './ids'
import type { AppDef } from './types'
import { registerSpecs, type Win } from '../store'

export const useAppModules = create<{ loaded: number }>(() => ({ loaded: 0 }))

const loaders: (() => Promise<unknown>)[] = []

function chunk<M>(importer: () => Promise<M>) {
  let mod: M | undefined
  let pending: Promise<M> | undefined
  const get = () =>
    (pending ??= importer().then((m) => {
      mod = m
      useAppModules.setState((s) => ({ loaded: s.loaded + 1 }))
      return m
    }))
  loaders.push(get)
  return {
    now: () => mod,
    part: (k: keyof M) => lazy(() => get().then((m) => ({ default: m[k] as ComponentType<{ win: Win }> }))),
  }
}

export function preloadApps() {
  for (const get of loaders) get().catch(() => undefined)
}

const finder = chunk(() => import('./Finder'))
const airpear = chunk(() => import('./AirPear'))
const terminal = chunk(() => import('./Terminal'))
const productivity = chunk(() => import('./Productivity'))
const sequel = chunk(() => import('./Sequel'))
const system = chunk(() => import('./System'))
const preview = chunk(() => import('./Preview'))
const music = chunk(() => import('./Music'))
const chess = chunk(() => import('./Chess'))
const tetris = chunk(() => import('./Tetris'))
const bootcamp = chunk(() => import('./BootCamp'))
const photobooth = chunk(() => import('./PhotoBooth'))
const mail = chunk(() => import('./Mail'))
const diskutility = chunk(() => import('./DiskUtility'))
const softwareupdate = chunk(() => import('./SoftwareUpdate'))

const Finder = finder.part('Finder')
const AirPear = airpear.part('AirPearApp')
const Terminal = terminal.part('Terminal')
const Calculator = productivity.part('Calculator')
const Notes = productivity.part('Notes')
const TextEdit = productivity.part('TextEdit')
const Intelligence = sequel.part('Intelligence')
const Mirroring = sequel.part('Mirroring')
const Passwords = sequel.part('Passwords')
const Safari = sequel.part('Safari')
const About = system.part('About')
const ActivityMonitor = system.part('ActivityMonitor')
const Fractals = system.part('Fractals')
const Settings = system.part('Settings')
const Preview = preview.part('Preview')
const Music = music.part('Music')
const ChessGame = chess.part('ChessGame')
const TetrisGame = tetris.part('TetrisGame')
const BootCamp = bootcamp.part('BootCamp')
const PhotoBooth = photobooth.part('PhotoBooth')
const Mail = mail.part('Mail')
const DiskUtility = diskutility.part('DiskUtility')
const SoftwareUpdate = softwareupdate.part('SoftwareUpdate')

const Nothing = () => null

export const APPS: Record<AppId, AppDef> = {
  airpear: { name: 'AirPear', component: AirPear, w: 820, h: 620, minW: 520, minH: 380, singleton: true, chrome: 'overlay' },
  finder: { name: 'Finder', component: Finder, w: 860, h: 520, minW: 520, minH: 300, chrome: 'overlay' },
  launchpad: { name: 'Launchpad', component: Nothing, w: 0, h: 0, hidden: true },
  safari: { name: 'Sapphari', component: Safari, w: 1040, h: 680, minW: 480, chrome: 'overlay' },
  music: { name: 'Music', component: Music, w: 980, h: 620, minW: 640, minH: 420, singleton: true, chrome: 'overlay' },
  chess: {
    name: 'Chess',
    component: ChessGame,
    w: 880,
    h: 640,
    minW: 640,
    minH: 480,
    chrome: 'overlay',
    get menus() {
      return chess.now()?.chessMenus()
    },
  },
  tetris: {
    name: 'Tetris',
    component: TetrisGame,
    w: 580,
    h: 660,
    minW: 460,
    minH: 540,
    singleton: true,
    chrome: 'overlay',
    get menus() {
      return tetris.now()?.tetrisMenus()
    },
  },
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
  preview: {
    name: 'Preview',
    component: Preview,
    w: 860,
    h: 620,
    minW: 460,
    minH: 320,
    chrome: 'overlay',
    get menus() {
      return preview.now()?.previewMenus()
    },
  },
  bootcamp: { name: 'Boot Camp Assistant', component: BootCamp, w: 640, h: 470, singleton: true, resizable: false },
  photobooth: { name: 'Photo Booth', component: PhotoBooth, w: 780, h: 600, minW: 560, minH: 460, singleton: true },
  mail: { name: 'Mail', component: Mail, w: 1040, h: 640, minW: 760, minH: 420, singleton: true, chrome: 'overlay' },
  diskutility: { name: 'Disk Utility', component: DiskUtility, w: 860, h: 560, minW: 640, minH: 420, singleton: true, chrome: 'overlay' },
  softwareupdate: { name: 'Software Update', component: SoftwareUpdate, w: 580, h: 460, minW: 480, minH: 380, singleton: true },
  about: { name: 'About This Pear', component: About, w: 300, h: 580, singleton: true, resizable: false, chrome: 'overlay' },
  trash: { name: 'Trash', component: Nothing, w: 0, h: 0, hidden: true },
}

registerSpecs(APPS)

export const DOCK_APPS: AppId[] = ['finder', 'launchpad', 'safari', 'mail', 'music', 'chess', 'tetris', 'notes', 'calculator', 'terminal', 'intelligence', 'passwords', 'mirroring', 'activity', 'fractals', 'settings']
export const LAUNCHPAD_APPS: AppId[] = ['finder', 'airpear', 'safari', 'music', 'chess', 'tetris', 'notes', 'textedit', 'preview', 'calculator', 'terminal', 'intelligence', 'passwords', 'mirroring', 'activity', 'fractals', 'photobooth', 'mail', 'diskutility', 'softwareupdate', 'bootcamp', 'settings']

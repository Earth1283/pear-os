import { HOME, normalise, parentOf, resolve } from '../lib/fs'
import type { QuickLookItem } from '../lib/quickLook'
import { os } from '../store'

export type FinderView = 'grid' | 'list' | 'columns' | 'gallery'

export const FINDER_VIEWS: { id: FinderView; label: string; shortcut: string }[] = [
  { id: 'grid', label: 'Icons', shortcut: '⌘1' },
  { id: 'list', label: 'List', shortcut: '⌘2' },
  { id: 'columns', label: 'Columns', shortcut: '⌘3' },
  { id: 'gallery', label: 'Gallery', shortcut: '⌘4' },
]

export interface FinderCommands {
  hasTabs: boolean
  closeTab: () => boolean
  newTab: () => void
  goToFolder: () => void
  getInfo: () => void
  setView: (view: FinderView) => void
}

export const finderCommands = new Map<string, FinderCommands>()

export function closeFinderTab(id: string) {
  return finderCommands.get(id)?.closeTab() ?? false
}

export function goToFinderFolder(id?: string) {
  const commands = id && finderCommands.get(id)
  if (commands) commands.goToFolder()
  else os().openApp('finder', { forceNew: true, props: { goToFolder: true } })
}

export function showFileInfo(path: string | QuickLookItem) {
  const infoPath = typeof path === 'string' ? normalise(path) : `drive:${path.path}`
  if (typeof path === 'string' && !resolve(infoPath)) return
  const s = os()
  s.closeOverlays()
  const existing = s.windows.find((w) => w.app === 'finder' && w.props.infoPath === infoPath)
  if (existing) return s.focus(existing.id)
  s.openApp('finder', { forceNew: true, props: { infoPath, ...(typeof path === 'string' ? {} : { infoItem: path }) } })
}

export function revealInFinder(path: string) {
  const abs = normalise(path)
  if (!resolve(abs)) return
  return os().openApp('finder', { forceNew: true, props: { path: parentOf(abs).dir || HOME, reveal: abs } })
}

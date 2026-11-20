import { useOS, os, type Win } from '../store'
import { MenuList } from './ContextMenu'
import type { MenuEntry } from '../lib/menu'
import { openPath } from '../apps/open'
import { logout } from '../lib/backend'
import { APPS, useAppModules } from '../apps/registry'
import type { MenuDef, MenuItem } from '../apps/types'
import { PearLogo } from './icons'
import { MenuBarStatus } from './MenuBarStatus'
import { usePlayer } from '../lib/player'
import { closeFinderTab, FINDER_VIEWS, finderCommands, goToFinderFolder } from '../apps/finderCommands'

function toEntries(items: MenuItem[], win: Win | null): MenuEntry[] {
  return items.map((it) =>
    it === 'sep'
      ? 'sep'
      : { label: it.label, shortcut: it.shortcut, disabled: it.disabled, checked: it.checked, submenu: it.submenu && toEntries(it.submenu, win), run: it.action && (() => it.action!(win)) },
  )
}

function Dropdown({ items, close }: { items: MenuItem[]; close: () => void }) {
  const focusedWin = useOS((s) => s.windows.find((w) => w.id === s.focused && !APPS[w.app].systemPanel) ?? null)
  return <MenuList items={toEntries(items, focusedWin)} onDone={close} />
}

const pearMenu: MenuItem[] = [
  { label: 'About This Pear', action: () => os().openApp('about') },
  'sep',
  { label: 'System Settings…', action: () => os().openApp('settings') },
  { label: 'Mission Control', shortcut: '⌃↑', action: () => os().setOverlay({ missionControl: true }) },
  { label: 'App Store…', action: () => os().notify({ app: 'settings', title: 'App Store', body: 'The App Store is closed for renovations. Please enjoy the apps you already have.' }) },
  'sep',
  {
    label: 'Recent Items',
    submenu: [
      { label: 'Terminal', action: () => os().openApp('terminal') },
      { label: 'Notes', action: () => os().openApp('notes') },
      { label: 'Fractals', action: () => os().openApp('fractals') },
      'sep',
      { label: 'TODO.txt', action: () => openPath('/Users/pear/Desktop/TODO.txt') },
      { label: 'taxes.txt', action: () => openPath('/Users/pear/Documents/taxes.txt') },
      'sep',
      { label: 'Clear Menu', disabled: true },
    ],
  },
  'sep',
  {
    label: 'Force Quit…',
    shortcut: '⌥⌘⎋',
    action: () => os().openApp('activity'),
  },
  'sep',
  { label: 'Sleep', action: () => os().setPhase('sleep') },
  {
    label: 'Restart…',
    action: () => {
      os().set('shutdownMode', 'restart')
      os().setPhase('shuttingdown')
    },
  },
  {
    label: 'Shut Down…',
    action: () => {
      os().set('shutdownMode', 'off')
      os().setPhase('shuttingdown')
    },
  },
  'sep',
  {
    label: 'Lock Screen',
    shortcut: '⌃⌘Q',
    action: () => {
      logout()
      os().setPhase('login')
    },
  },
  {
    label: 'Log Out Pear User…',
    shortcut: '⇧⌘Q',
    action: () => {
      usePlayer.getState().stop()
      logout()
      os().resetSession()
      os().setPhase('login')
    },
  },
]

export function defaultMenus(appName: string): MenuDef[] {
  return [
    {
      title: 'File',
      items: [
        { label: 'New Window', shortcut: '⌘N', action: () => os().openApp(os().activeApp, { forceNew: true }) },
        { label: 'Close Window', shortcut: '⌘W', action: (w) => w && os().closeWindow(w.id) },
      ],
    },
    {
      title: 'Edit',
      items: [
        { label: 'Undo', shortcut: '⌘Z', disabled: true },
        { label: 'Redo', shortcut: '⇧⌘Z', disabled: true },
        'sep',
        { label: 'Cut', shortcut: '⌘X', action: () => document.execCommand('cut') },
        { label: 'Copy', shortcut: '⌘C', action: () => document.execCommand('copy') },
        { label: 'Paste', shortcut: '⌘V', disabled: true },
        'sep',
        { label: 'Writing Tools', action: () => os().openApp('intelligence') },
        { label: 'Emoji & Symbols', shortcut: 'fn E', disabled: true },
      ],
    },
    { title: 'View', items: [] },
    {
      title: 'Window',
      items: [
        { label: 'Minimize', shortcut: '⌘M', action: (w) => w && os().minimize(w.id) },
        { label: 'Zoom', action: (w) => w && os().tileWindow(w.id, w.tile === 'fill' ? null : 'fill') },
        'sep',
        { label: 'Move & Resize: Left', shortcut: '⌃⌥←', action: (w) => w && os().tileWindow(w.id, 'left') },
        { label: 'Move & Resize: Right', shortcut: '⌃⌥→', action: (w) => w && os().tileWindow(w.id, 'right') },
        { label: 'Fill', shortcut: '⌃⌥F', action: (w) => w && os().tileWindow(w.id, 'fill') },
        { label: 'Return to Previous Size', action: (w) => w && os().tileWindow(w.id, null) },
        'sep',
        { label: 'Bring All to Front' },
      ],
    },
    {
      title: 'Help',
      items: [
        {
          label: `${appName} Help`,
          action: () => os().notify({ app: 'about', title: 'Help', body: 'Have you tried turning it off and on again?' }),
        },
      ],
    },
  ]
}

export function MenuBar() {
  const focusedApp = useOS((s) => s.activeApp)
  const focusedWin = useOS((s) => s.windows.find((w) => w.id === s.focused && !APPS[w.app].systemPanel))
  const fullscreenSpace = useOS((s) => s.activeSpace < 0 && !s.overlay.missionControl)
  const openMenu = useOS((s) => s.overlay.menu)
  const statusOpen = useOS((s) => s.overlay.statusMenu !== null || s.overlay.controlCenter || s.overlay.notificationCenter)
  useAppModules((s) => s.loaded)
  const { setOverlay } = useOS.getState()
  const app = APPS[focusedApp]
  const appMenus = app.menus ?? defaultMenus(app.name)
  if (focusedApp === 'finder') {
    const file = appMenus.find((m) => m.title === 'File')!
    if (focusedWin && finderCommands.get(focusedWin.id)?.hasTabs) {
      file.items[1] = { label: 'Close Window', shortcut: '⇧⌘W', action: (w) => w && os().closeWindow(w.id) }
      file.items.splice(1, 0, { label: 'Close Tab', shortcut: '⌘W', action: (w) => w && closeFinderTab(w.id) })
    }
    file.items.splice(1, 0, { label: 'New Tab', shortcut: '⌘T', action: (w) => {
      const commands = w && finderCommands.get(w.id)
      if (commands) commands.newTab()
      else os().openApp('finder', { forceNew: true })
    } })
    file.items.push('sep', { label: 'Get Info', shortcut: '⌘I', action: (w) => w && finderCommands.get(w.id)?.getInfo() })
    appMenus.find((m) => m.title === 'View')!.items = FINDER_VIEWS.map(({ id, label, shortcut }) => (
      { label: `as ${label}`, shortcut, disabled: !focusedWin || !!focusedWin.props.infoPath, action: (w) => w && finderCommands.get(w.id)?.setView(id) }
    ))
    appMenus.splice(appMenus.findIndex((m) => m.title === 'Window'), 0, {
      title: 'Go',
      items: [{ label: 'Go to Folder…', shortcut: '⇧⌘G', action: (w) => goToFinderFolder(w?.id) }],
    })
  }
  const menus: { key: string; label: React.ReactNode; items: MenuItem[]; bold?: boolean }[] = [
    { key: 'pear', label: <PearLogo size={15} />, items: pearMenu },
    {
      key: 'app',
      label: app.name,
      bold: true,
      items: [
        { label: `About ${app.name}`, action: () => os().openApp('about') },
        'sep',
        { label: 'Settings…', shortcut: '⌘,', action: () => os().openApp('settings') },
        'sep',
        { label: `Hide ${app.name}`, shortcut: '⌘H', action: () => os().hideApp(focusedApp) },
        ...(focusedApp === 'finder' ? [] : [{ label: `Quit ${app.name}`, shortcut: '⌘Q', action: () => os().closeApp(focusedApp) }]),
      ],
    },
    ...appMenus.map((m) => ({ key: m.title, label: m.title, items: m.items })),
  ]
  if (focusedWin && app.resizable !== false && !focusedWin.props.infoPath) {
    const item: MenuItem = { label: focusedWin.fullscreen ? 'Exit Full Screen' : 'Enter Full Screen', shortcut: '⌃⌘F', action: (w) => w && os().toggleFullscreen(w.id) }
    const view = menus.find((m) => m.key === 'View')
    if (view) view.items = [...view.items, ...(view.items.length ? ['sep' as const] : []), item]
    else menus.push({ key: 'View', label: 'View', items: [item] })
  }
  const visibleMenus = menus.filter((m) => m.items.length)

  const toggle = (k: string) => setOverlay({ menu: openMenu === k ? null : k })

  return (
    <div className={`menubar ${fullscreenSpace ? 'fullscreen-menubar' : ''} ${statusOpen ? 'mb-panel-open' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-left">
        {visibleMenus.map((m) => (
          <div key={m.key} className="mb-menu" data-menu={m.key}>
            <button
              aria-label={m.key === 'pear' ? 'Pear menu' : undefined}
              className={`mb-item ${m.bold ? 'bold' : ''} ${openMenu === m.key ? 'active' : ''} ${m.key === 'pear' ? 'pear' : ''}`}
              onPointerDown={() => toggle(m.key)}
              onClick={(e) => { if (e.detail === 0) toggle(m.key) }}
              onPointerEnter={() => openMenu && openMenu !== m.key && setOverlay({ menu: m.key })}
            >
              {m.label}
            </button>
            {openMenu === m.key && <Dropdown items={m.items} close={() => setOverlay({ menu: null })} />}
          </div>
        ))}
      </div>
      <MenuBarStatus />
    </div>
  )
}

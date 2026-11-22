import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
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

function buildPearMenu(alt: boolean): MenuItem[] {
  return [
    alt
      ? { label: 'System Information…', action: () => os().openApp('settings', { props: { pane: 'about' } }) }
      : { label: 'About This Pear', action: () => os().openApp('about') },
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
      action: () => os().openDialog({ kind: 'force-quit' }),
    },
    'sep',
    { label: 'Sleep', action: () => os().setPhase('sleep') },
    alt
      ? {
          label: 'Restart',
          action: () => {
            os().set('shutdownMode', 'restart')
            os().setPhase('shuttingdown')
          },
        }
      : {
          label: 'Restart…',
          action: () => os().openDialog({ kind: 'power', mode: 'restart' }),
        },
    alt
      ? {
          label: 'Shut Down',
          action: () => {
            os().set('shutdownMode', 'off')
            os().setPhase('shuttingdown')
          },
        }
      : {
          label: 'Shut Down…',
          action: () => os().openDialog({ kind: 'power', mode: 'shutdown' }),
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
    alt
      ? {
          label: 'Log Out Pear User',
          shortcut: '⌥⇧⌘Q',
          action: () => {
            usePlayer.getState().stop()
            logout()
            os().resetSession()
            os().setPhase('login')
          },
        }
      : {
          label: 'Log Out Pear User…',
          shortcut: '⇧⌘Q',
          action: () => os().openDialog({ kind: 'power', mode: 'logout' }),
        },
  ]
}

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
        { label: 'Bring All to Front', action: () => os().bringAllToFront() },
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

type VisibleMenu = { key: string; label: React.ReactNode; title: string; items: MenuItem[]; bold?: boolean }

function Dropdown({
  menu,
  allMenus,
  close,
  onStepMenu,
}: {
  menu: VisibleMenu
  allMenus: VisibleMenu[]
  close: () => void
  onStepMenu: (dir: -1 | 1) => void
}) {
  const focusedWin = useOS((s) => s.windows.find((w) => w.id === s.focused && !APPS[w.app].systemPanel) ?? null)
  const [helpQuery, setHelpQuery] = useState('')
  const isHelp = menu.key === 'Help'

  const entries = useMemo(() => {
    const base = toEntries(menu.items, focusedWin)
    if (!isHelp || !helpQuery.trim()) return base
    const q = helpQuery.trim().toLowerCase()
    const matches: MenuEntry[] = []
    const walk = (list: MenuItem[], trail: string[]) => {
      for (const it of list) {
        if (it === 'sep') continue
        if (it.label.toLowerCase().includes(q) && !it.disabled) {
          matches.push({
            label: `${trail.join(' › ')} › ${it.label}`,
            shortcut: it.shortcut,
            run: it.action ? () => it.action!(focusedWin) : undefined,
          })
        }
        if (it.submenu) walk(it.submenu, [...trail, it.label])
      }
    }
    for (const m of allMenus) {
      if (m.key === 'pear' || m.key === 'Help') continue
      walk(m.items, [m.title])
    }
    return matches.length
      ? [{ header: 'Menu Items' }, ...matches.slice(0, 8), 'sep' as const, ...base]
      : [{ header: 'No Menu Items Found' }, 'sep' as const, ...base]
  }, [menu.items, focusedWin, isHelp, helpQuery, allMenus])

  const helpHeader = isHelp ? (
    <div className="mb-help-search" onPointerDown={(e) => e.stopPropagation()}>
      <Search size={12} opacity={0.55} />
      <input
        autoFocus
        value={helpQuery}
        placeholder="Search"
        aria-label="Search menus"
        onChange={(e) => setHelpQuery(e.target.value)}
      />
    </div>
  ) : undefined

  return <MenuList items={entries} onDone={close} onStepMenu={onStepMenu} headerSlot={helpHeader} />
}

export function MenuBar() {
  const focusedApp = useOS((s) => s.activeApp)
  const windows = useOS((s) => s.windows)
  const focusedId = useOS((s) => s.focused)
  const focusedWin = windows.find((w) => w.id === focusedId && !APPS[w.app].systemPanel)
  const fullscreenSpace = useOS((s) => s.activeSpace < 0 && !s.overlay.missionControl)
  const openMenu = useOS((s) => s.overlay.menu)
  const menuFlash = useOS((s) => s.menuFlash)
  const finderPathBar = useOS((s) => s.finderPathBar)
  const finderStatusBar = useOS((s) => s.finderStatusBar)
  const statusOpen = useOS((s) => s.overlay.statusMenu !== null || s.overlay.controlCenter || s.overlay.notificationCenter)
  const [altHeld, setAltHeld] = useState(false)
  useAppModules((s) => s.loaded)
  const { setOverlay } = useOS.getState()

  useEffect(() => {
    if (!openMenu) {
      setAltHeld(false)
      return
    }
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false) }
    const blur = () => setAltHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [openMenu])

  const app = APPS[focusedApp]
  const appMenus = (app.menus ?? defaultMenus(app.name)).map((m) => ({ ...m, items: [...m.items] }))

  if (focusedApp === 'finder') {
    const file = appMenus.find((m) => m.title === 'File')
    if (file) {
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
    }
    const view = appMenus.find((m) => m.title === 'View')
    if (view) {
      view.items = [
        ...FINDER_VIEWS.map(({ id, label, shortcut }): MenuItem => (
          { label: `as ${label}`, shortcut, disabled: !focusedWin || !!focusedWin.props.infoPath, action: (w) => w && finderCommands.get(w.id)?.setView(id) }
        )),
        'sep',
        { label: finderPathBar ? 'Hide Path Bar' : 'Show Path Bar', shortcut: '⌥⌘P', action: () => os().set('finderPathBar', !os().finderPathBar) },
        { label: finderStatusBar ? 'Hide Status Bar' : 'Show Status Bar', shortcut: '⌘/', action: () => os().set('finderStatusBar', !os().finderStatusBar) },
      ]
    }
    const winIdx = appMenus.findIndex((m) => m.title === 'Window')
    appMenus.splice(winIdx >= 0 ? winIdx : appMenus.length, 0, {
      title: 'Go',
      items: [{ label: 'Go to Folder…', shortcut: '⇧⌘G', action: (w) => goToFinderFolder(w?.id) }],
    })
  }

  // Option-key alternates for File and Window menus
  if (altHeld) {
    const file = appMenus.find((m) => m.title === 'File')
    if (file) {
      const idx = file.items.findIndex((it) => it !== 'sep' && it.label === 'Close Window')
      if (idx >= 0) file.items[idx] = { label: 'Close All', shortcut: '⌥⌘W', action: () => os().closeAllWindows(focusedApp) }
    }
    const winMenu = appMenus.find((m) => m.title === 'Window')
    if (winMenu) {
      const minIdx = winMenu.items.findIndex((it) => it !== 'sep' && it.label === 'Minimize')
      if (minIdx >= 0) {
        winMenu.items[minIdx] = {
          label: 'Minimize All',
          shortcut: '⌥⌘M',
          action: () => os().windows.filter((w) => w.app === focusedApp && !w.minimized).forEach((w) => os().minimize(w.id)),
        }
      }
    }
  }

  // Append active app's open windows to Window menu
  const windowMenu = appMenus.find((m) => m.title === 'Window')
  const appWindows = windows.filter((w) => w.app === focusedApp)
  if (windowMenu && appWindows.length > 0) {
    windowMenu.items.push(
      'sep',
      ...appWindows.map((w) => ({
        label: w.title || app.name,
        checked: (w.minimized ? 'diamond' : w.id === focusedId) as boolean | 'diamond',
        action: () => os().focus(w.id),
      })),
    )
  }

  const menus: VisibleMenu[] = [
    { key: 'pear', title: 'Pear', label: <PearLogo size={15} />, items: buildPearMenu(altHeld) },
    {
      key: 'app',
      title: app.name,
      label: app.name,
      bold: true,
      items: [
        { label: `About ${app.name}`, action: () => os().openApp('about') },
        'sep',
        { label: 'Settings…', shortcut: '⌘,', action: () => os().openApp('settings') },
        'sep',
        altHeld
          ? { label: 'Hide Others', shortcut: '⌥⌘H', action: () => os().hideOtherApps(focusedApp) }
          : { label: `Hide ${app.name}`, shortcut: '⌘H', action: () => os().hideApp(focusedApp) },
        ...(focusedApp === 'finder' ? [] : [{ label: `Quit ${app.name}`, shortcut: '⌘Q', action: () => os().closeApp(focusedApp) }]),
      ],
    },
    ...appMenus.map((m) => ({ key: m.title, title: m.title, label: m.title, items: m.items })),
  ]
  if (focusedWin && app.resizable !== false && !focusedWin.props.infoPath) {
    const item: MenuItem = { label: focusedWin.fullscreen ? 'Exit Full Screen' : 'Enter Full Screen', shortcut: '⌃⌘F', action: (w) => w && os().toggleFullscreen(w.id) }
    const view = menus.find((m) => m.key === 'View')
    if (view) view.items = [...view.items, ...(view.items.length ? ['sep' as const] : []), item]
    else menus.push({ key: 'View', title: 'View', label: 'View', items: [item] })
  }
  const visibleMenus = menus.filter((m) => m.items.length)

  const toggle = (k: string) => setOverlay({ menu: openMenu === k ? null : k })
  const stepMenu = (dir: -1 | 1) => {
    const idx = visibleMenus.findIndex((m) => m.key === openMenu)
    if (idx < 0) return
    const next = visibleMenus[(idx + dir + visibleMenus.length) % visibleMenus.length]
    if (next) setOverlay({ menu: next.key })
  }

  return (
    <div className={`menubar ${fullscreenSpace ? 'fullscreen-menubar' : ''} ${statusOpen ? 'mb-panel-open' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-left">
        {visibleMenus.map((m) => (
          <div key={m.key} className="mb-menu" data-menu={m.key}>
            <button
              aria-label={m.key === 'pear' ? 'Pear menu' : undefined}
              className={`mb-item ${m.bold ? 'bold' : ''} ${openMenu === m.key || menuFlash === m.key ? 'active' : ''} ${m.key === 'pear' ? 'pear' : ''}`}
              onPointerDown={() => toggle(m.key)}
              onClick={(e) => { if (e.detail === 0) toggle(m.key) }}
              onPointerEnter={() => openMenu && openMenu !== m.key && setOverlay({ menu: m.key })}
            >
              {m.label}
            </button>
            {openMenu === m.key && <Dropdown menu={m} allMenus={visibleMenus} close={() => setOverlay({ menu: null })} onStepMenu={stepMenu} />}
          </div>
        ))}
      </div>
      <MenuBarStatus />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { AudioLines, Moon, Search, SlidersHorizontal, Wifi, WifiOff } from 'lucide-react'
import { useOS, os, type Win } from '../store'
import { MenuList } from './ContextMenu'
import type { MenuEntry } from '../lib/menu'
import { openPath } from '../apps/open'
import { logout } from '../lib/backend'
import { APPS } from '../apps/registry'
import type { MenuDef, MenuItem } from '../apps/types'
import { PearLogo, IntelOrb } from './icons'
import { useCurrent, usePlayer } from '../lib/player'

function Battery() {
  const [pct, setPct] = useState(100)
  useEffect(() => {
    const t = setInterval(() => setPct((p) => (p <= 3 ? 100 : p - 1)), 45_000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="mb-item battery" title={`Battery: ${pct}%. Condition: Service Recommended`}>
      <span className="pct">{pct}%</span>
      <svg width="25" height="12" viewBox="0 0 25 12">
        <rect x=".5" y=".5" width="21" height="11" rx="3" fill="none" stroke="currentColor" opacity=".45" />
        <rect x="2" y="2" width={(18 * pct) / 100} height="8" rx="1.6" fill="currentColor" />
        <path d="M23 4v4c.8-.3 1.3-1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity=".45" />
      </svg>
    </span>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const open = useOS((s) => s.overlay.notificationCenter)
  return (
    <button
      className={`mb-item clock ${open ? 'active' : ''}`}
      title="Notification Center"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => os().setOverlay({ notificationCenter: !open, controlCenter: false, spotlight: false, menu: null })}
    >
      {date.replace(',', '')}&nbsp;&nbsp;{time}
    </button>
  )
}

function toEntries(items: MenuItem[], win: Win | null): MenuEntry[] {
  return items.map((it) =>
    it === 'sep'
      ? 'sep'
      : { label: it.label, shortcut: it.shortcut, disabled: it.disabled, checked: it.checked, submenu: it.submenu && toEntries(it.submenu, win), run: it.action && (() => it.action!(win)) },
  )
}

function Dropdown({ items, close }: { items: MenuItem[]; close: () => void }) {
  const focusedWin = useOS((s) => s.windows.find((w) => w.id === s.focused) ?? null)
  return <MenuList items={toEntries(items, focusedWin)} onDone={close} />
}

const pearMenu: MenuItem[] = [
  { label: 'About This Pear', action: () => os().openApp('about') },
  'sep',
  { label: 'System Settings…', action: () => os().openApp('settings') },
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
      useOS.setState({ windows: [], focused: null, phase: 'login' })
    },
  },
]

export function defaultMenus(appName: string): MenuDef[] {
  return [
    {
      title: 'File',
      items: [
        { label: 'New Window', shortcut: '⌘N', action: (w) => w && os().openApp(w.app, { forceNew: true }) },
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
    { title: 'View', items: [{ label: 'Enter Full Screen', shortcut: '⌃⌘F', action: (w) => w && os().tileWindow(w.id, 'fill') }] },
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
  const focusedApp = useOS((s) => s.windows.find((w) => w.id === s.focused)?.app ?? 'finder')
  const openMenu = useOS((s) => s.overlay.menu)
  const wifi = useOS((s) => s.wifi)
  const dnd = useOS((s) => s.dnd)
  const cur = useCurrent()
  const playing = usePlayer((s) => s.playing)
  const { setOverlay } = useOS.getState()
  const app = APPS[focusedApp]
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
        { label: `Hide ${app.name}`, shortcut: '⌘H', action: () => os().windows.filter((w) => w.app === focusedApp).forEach((w) => os().minimize(w.id)) },
        { label: `Quit ${app.name}`, shortcut: '⌘Q', action: () => os().closeApp(focusedApp) },
      ],
    },
    ...(app.menus ?? defaultMenus(app.name)).map((m) => ({ key: m.title, label: m.title, items: m.items })),
  ]

  const toggle = (k: string) => setOverlay({ menu: openMenu === k ? null : k, controlCenter: false, notificationCenter: false, spotlight: false })

  return (
    <div className="menubar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-left">
        {menus.map((m) => (
          <div key={m.key} className="mb-menu">
            <button
              className={`mb-item ${m.bold ? 'bold' : ''} ${openMenu === m.key ? 'active' : ''} ${m.key === 'pear' ? 'pear' : ''}`}
              onPointerDown={() => toggle(m.key)}
              onPointerEnter={() => openMenu && openMenu !== m.key && setOverlay({ menu: m.key })}
            >
              {m.label}
            </button>
            {openMenu === m.key && <Dropdown items={m.items} close={() => setOverlay({ menu: null })} />}
          </div>
        ))}
      </div>
      <div className="mb-right">
        {dnd && (
          <span className="mb-item icon" title="Do Not Disturb is on">
            <Moon size={13} strokeWidth={2.4} fill="currentColor" />
          </span>
        )}
        {cur && (
          <button className="mb-item icon" title={`${playing ? 'Playing' : 'Paused'}: ${cur.title}`} onClick={() => setOverlay({ controlCenter: !os().overlay.controlCenter, notificationCenter: false, menu: null })}>
            <AudioLines size={14} strokeWidth={2.4} className={playing ? 'mb-playing' : ''} />
          </button>
        )}
        <Battery />
        <button className="mb-item icon" title={wifi ? 'Wi-Fi: PearNet (5 bars of nothing)' : 'Wi-Fi: Off'} onClick={() => os().set('wifi', !wifi)}>
          {wifi ? <Wifi size={15} strokeWidth={2.2} /> : <WifiOff size={15} strokeWidth={2.2} />}
        </button>
        <button className="mb-item icon" title="Spotlight" onClick={() => setOverlay({ spotlight: true, menu: null, controlCenter: false, notificationCenter: false })}>
          <Search size={14} strokeWidth={2.4} />
        </button>
        <button className="mb-item icon" title="Control Center" onClick={() => setOverlay({ controlCenter: !os().overlay.controlCenter, notificationCenter: false, menu: null })}>
          <SlidersHorizontal size={14} strokeWidth={2.4} />
        </button>
        <button className="mb-item icon" title="Pear Intelligence" onClick={() => os().openApp('intelligence')}>
          <IntelOrb size={16} />
        </button>
        <Clock />
      </div>
    </div>
  )
}

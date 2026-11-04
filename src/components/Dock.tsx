import { useRef, useState } from 'react'
import { useOS, os } from '../store'
import { APPS, DOCK_APPS } from '../apps/registry'
import type { AppId } from '../apps/ids'
import { AppIcon } from './icons'
import { HOME } from '../lib/fs'
import { menu } from '../lib/menu'
import { dockMenu, dockSeparatorMenu } from '../lib/menus'

function activate(app: AppId) {
  if (app === 'launchpad') return os().setOverlay({ launchpad: !os().overlay.launchpad })
  if (app === 'trash') return os().openApp('finder', { props: { path: HOME + '/.Trash' }, forceNew: true })
  os().openApp(app)
}

export function Dock() {
  const size = useOS((s) => s.dockSize)
  const magnify = useOS((s) => s.dockMagnify)
  const running = useOS((s) => s.windows.map((w) => w.app).join(','))
  const launching = useOS((s) => s.launching)
  const autohide = useOS((s) => s.dockAutohide)
  const menuOpen = useOS((s) => s.contextMenu !== null)
  const [peek, setPeek] = useState(false)
  const leave = useRef<number | undefined>(undefined)
  const show = () => {
    clearTimeout(leave.current)
    setPeek(true)
  }
  const hide = () => {
    clearTimeout(leave.current)
    leave.current = window.setTimeout(() => setPeek(false), 500)
  }
  const [mouseX, setMouseX] = useState<number | null>(null)
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const centers = useRef<Record<string, number>>({})
  const capture = () => {
    for (const [k, el] of Object.entries(refs.current)) if (el) centers.current[k] = el.getBoundingClientRect().left + el.offsetWidth / 2
  }
  const runningSet = new Set(running.split(','))
  // Running apps that aren't kept in the Dock get their own section, like on the real thing.
  const extras = [...runningSet].filter((id): id is AppId => !!id && id in APPS && !DOCK_APPS.includes(id as AppId) && !APPS[id as AppId].hidden && id !== 'trash')

  const scaleFor = (id: string) => {
    if (!magnify || mouseX === null) return 1
    const center = centers.current[id]
    if (center === undefined) return 1
    const d = Math.abs(mouseX - center)
    const range = size * 3
    if (d > range) return 1
    return 1 + 0.75 * Math.cos((d / range) * (Math.PI / 2)) ** 2
  }

  const item = (id: AppId) => {
    const s = scaleFor(id)
    return (
      <button
        key={id}
        ref={(el) => {
          refs.current[id] = el
        }}
        className={`dock-item ${launching.includes(id) ? 'bounce' : ''}`}
        style={{ width: size * s, height: size }}
        onClick={() => activate(id)}
        onContextMenu={menu(() => dockMenu(id))}
        aria-label={APPS[id].name}
      >
        <span className="dock-label glass">{APPS[id].name}</span>
        <span className="dock-icon" style={{ transform: `scale(${s})` }}>
          <AppIcon app={id} size={size} />
        </span>
        {runningSet.has(id) && <span className="dock-dot" />}
      </button>
    )
  }

  return (
    <>
    {autohide && <div className="dock-trigger" onPointerEnter={show} onPointerLeave={hide} />}
    <div
      className={`dock-wrap ${autohide && !peek && !menuOpen ? 'hidden' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerEnter={show}
      onPointerLeave={hide}
    >
      <div className="dock glass" onPointerEnter={() => mouseX === null && capture()} onPointerMove={(e) => setMouseX(e.clientX)} onPointerLeave={() => setMouseX(null)} style={{ height: size + 16 }}>
        {DOCK_APPS.map(item)}
        {extras.length > 0 && <div className="dock-sep" onContextMenu={menu(dockSeparatorMenu)} />}
        {extras.map(item)}
        <div className="dock-sep" onContextMenu={menu(dockSeparatorMenu)} />
        {item('trash')}
      </div>
    </div>
    </>
  )
}

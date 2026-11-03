import { useRef, useState } from 'react'
import { useOS, os } from '../store'
import { APPS, DOCK_APPS } from '../apps/registry'
import type { AppId } from '../apps/ids'
import { AppIcon } from './icons'
import { HOME } from '../lib/fs'

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
  const [mouseX, setMouseX] = useState<number | null>(null)
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const centers = useRef<Record<string, number>>({})
  const capture = () => {
    for (const [k, el] of Object.entries(refs.current)) if (el) centers.current[k] = el.getBoundingClientRect().left + el.offsetWidth / 2
  }
  const runningSet = new Set(running.split(','))

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
    <div className="dock-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dock glass" onPointerEnter={() => mouseX === null && capture()} onPointerMove={(e) => setMouseX(e.clientX)} onPointerLeave={() => setMouseX(null)} style={{ height: size + 16 }}>
        {DOCK_APPS.map(item)}
        <div className="dock-sep" />
        {item('trash')}
      </div>
    </div>
  )
}

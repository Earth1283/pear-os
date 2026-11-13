import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useOS, os } from '../store'
import { APPS } from '../apps/registry'
import { DOCK_PINNED } from '../apps/dockDefaults'
import type { AppId } from '../apps/ids'
import { AppIcon } from './icons'
import { HOME } from '../lib/fs'
import { menu } from '../lib/menu'
import { dockMenu, dockSeparatorMenu, miniWindowMenu } from '../lib/menus'
import { dropIndex, insertAt, normaliseDock } from '../lib/dockOrder'
import { rememberDockRect } from '../lib/genie'
import { useFlights } from '../lib/flights'
import './Dock.css'

function activate(app: AppId) {
  if (app === 'launchpad') return os().setOverlay({ launchpad: !os().overlay.launchpad })
  if (app === 'trash') return os().openApp('finder', { props: { path: HOME + '/.Trash' }, forceNew: true })
  os().openApp(app)
}

const validApp = (id: AppId) => id in APPS && id !== 'trash' && (!APPS[id].hidden || id === 'launchpad')

interface Mini { id: string; app: AppId; title: string; ratio: number }

interface Drag { id: AppId; extra: boolean; x: number; y: number; out: boolean; index: number }

function MiniWindow({ app, w, h }: { app: AppId; w: number; h: number }) {
  return (
    <span className="dock-mini" style={{ width: w, height: h }}>
      <span className="dock-mini-bar"><i /><i /><i /></span>
      <span className="dock-mini-body"><AppIcon app={app} size={h * 0.5} /></span>
      <span className="dock-mini-badge"><AppIcon app={app} size={h * 0.46} /></span>
    </span>
  )
}

export function Dock() {
  const size = useOS((s) => s.dockSize)
  const magnify = useOS((s) => s.dockMagnify)
  const zoom = useOS((s) => s.dockZoom)
  const dockApps = useOS((s) => s.dockApps)
  const indicators = useOS((s) => s.dockIndicators)
  const bounceOn = useOS((s) => s.dockBounce)
  const running = useOS((s) => s.windows.map((w) => w.app).join(','))
  const minimizedKey = useOS((s) => s.windows.filter((w) => w.minimized).map((w) => `${w.id}\t${w.app}\t${w.title}\t${(w.w / w.h).toFixed(3)}`).join('\n'))
  const launching = useOS((s) => s.launching)
  const history = useOS((s) => s.history)
  const seen = useOS((s) => s.appSeen)
  const autohide = useOS((s) => s.dockAutohide)
  const menuOpen = useOS((s) => s.contextMenu !== null)
  const flying = useFlights((s) => s.ids)
  const [peek, setPeek] = useState(false)
  const leave = useRef<number | undefined>(undefined)
  const dragRef = useRef<Drag | null>(null)
  const show = () => {
    clearTimeout(leave.current)
    setPeek(true)
  }
  const hide = () => {
    clearTimeout(leave.current)
    leave.current = window.setTimeout(() => {
      if (!dragRef.current) setPeek(false)
    }, 500)
  }
  const [mouseX, setMouseX] = useState<number | null>(null)
  const pendingX = useRef<number | null>(null)
  const frame = useRef(0)
  const trackX = (x: number | null) => {
    pendingX.current = x
    if (x === null) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      return setMouseX(null)
    }
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        setMouseX(pendingX.current)
      })
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const centers = useRef<Record<string, number>>({})
  const dockEl = useRef<HTMLDivElement>(null)
  const capture = () => {
    for (const [k, el] of Object.entries(refs.current)) if (el) centers.current[k] = el.getBoundingClientRect().left + el.offsetWidth / 2
  }

  const apps = useMemo(() => normaliseDock(dockApps, validApp, DOCK_PINNED), [dockApps])
  const runningSet = new Set(running.split(','))
  const extras = [...runningSet].filter((id): id is AppId => !!id && id in APPS && !apps.includes(id as AppId) && !APPS[id as AppId].hidden && id !== 'trash')
  const minis: Mini[] = minimizedKey ? minimizedKey.split('\n').map((row) => {
    const [id, app, title, ratio] = row.split('\t')
    return { id, app: app as AppId, title, ratio: Math.min(1.7, Math.max(1, +ratio)) }
  }) : []

  const [drag, setDrag] = useState<Drag | null>(null)
  const [poof, setPoof] = useState<{ x: number; y: number; k: number } | null>(null)
  const moved = useRef(false)

  const [attention, setAttention] = useState<AppId | null>(null)
  const lastNote = useRef(history[0]?.id)
  useEffect(() => {
    const top = history[0]
    if (!top || top.id === lastNote.current) return
    lastNote.current = top.id
    if (!bounceOn || top.app === 'trash') return
    const win = os().windows.find((w) => w.id === os().focused)
    if (win?.app === top.app) return
    setAttention(top.app)
    const t = setTimeout(() => setAttention(null), 1500)
    return () => clearTimeout(t)
  }, [history, bounceOn])

  const badge = (id: AppId) => {
    if (id === 'trash' || id === 'launchpad') return 0
    const since = seen[id] ?? 0
    return history.reduce((n, h) => (h.app === id && h.time > since ? n + 1 : n), 0)
  }

  const scaleFor = (id: string) => {
    if (!magnify || mouseX === null || drag) return 1
    const center = centers.current[id]
    if (center === undefined) return 1
    const d = Math.abs(mouseX - center)
    const range = size * 3
    if (d > range) return 1
    return 1 + zoom * Math.cos((d / range) * (Math.PI / 2)) ** 2
  }

  useLayoutEffect(() => {
    for (const m of minis) {
      const el = refs.current[`win:${m.id}`]
      if (el) {
        const r = el.getBoundingClientRect()
        rememberDockRect(m.id, { x: r.left, y: r.top, w: r.width, h: r.height })
      }
    }
  })

  const beginDrag = (id: AppId, extra: boolean) => (e: React.PointerEvent) => {
    if (e.button !== 0 || id === 'finder' || id === 'trash' || (extra && id === 'launchpad')) return
    const sx = e.clientX
    const sy = e.clientY
    capture()
    let active = false
    const others = () => apps.filter((a) => a !== id).map((a) => centers.current[a]).filter((c): c is number => c !== undefined)
    const read = (ev: PointerEvent): Drag => {
      const rect = dockEl.current!.getBoundingClientRect()
      const out = ev.clientY < rect.top - 56
      const ok = !extra || (ev.clientX > rect.left && ev.clientX < rect.right)
      return { id, extra, x: ev.clientX, y: ev.clientY, out: out || !ok, index: dropIndex(others(), ev.clientX) }
    }
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
        active = true
        moved.current = true
        trackX(null)
        show()
      }
      dragRef.current = read(ev)
      setDrag(dragRef.current)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const d = active ? read(ev) : null
      dragRef.current = null
      setDrag(null)
      setTimeout(() => (moved.current = false), 0)
      if (!d) return
      if (d.out) {
        if (!extra && id !== 'launchpad') {
          os().set('dockApps', apps.filter((a) => a !== id))
          setPoof({ x: d.x, y: d.y, k: Date.now() })
          setTimeout(() => setPoof(null), 700)
        }
      } else {
        os().set('dockApps', insertAt(apps, id, d.index))
      }
      hide()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const item = (id: AppId, extra = false) => {
    const s = scaleFor(id)
    const n = badge(id)
    const dragging = drag?.id === id
    return (
      <button
        key={id}
        ref={(el) => {
          refs.current[id] = el
        }}
        data-dock-app={id}
        className={`dock-item ${launching.includes(id) && bounceOn ? 'bounce' : ''} ${attention === id ? 'bounce attention' : ''} ${dragging ? 'lifted' : ''}`}
        style={{ width: size * s, height: size }}
        onPointerDown={beginDrag(id, extra)}
        onClick={() => !moved.current && activate(id)}
        onContextMenu={menu(() => dockMenu(id))}
        aria-label={APPS[id].name}
      >
        <span className="dock-label glass">{APPS[id].name}</span>
        <span className="dock-icon" style={{ transform: `scale(${s})` }}>
          <AppIcon app={id} size={size} />
          {n > 0 && <span className="dock-badge">{n > 99 ? '99+' : n}</span>}
        </span>
        {indicators && runningSet.has(id) && <span className="dock-dot" />}
      </button>
    )
  }

  const gap = <div key="gap" className="dock-gap" style={{ width: size }} />
  let ordered: (AppId | 'gap')[] = apps
  if (drag && !drag.extra) ordered = drag.out ? apps.filter((a) => a !== drag.id) : insertAt<AppId | 'gap'>(apps.filter((a) => a !== drag.id), 'gap', drag.index)
  else if (drag && drag.extra && !drag.out) ordered = insertAt<AppId | 'gap'>(apps, 'gap', drag.index)

  const miniH = Math.round(size * 0.74)
  const miniItem = (m: Mini) => {
    const key = `win:${m.id}`
    const s = scaleFor(key)
    const w = Math.round(miniH * m.ratio)
    return (
      <button
        key={key}
        ref={(el) => {
          refs.current[key] = el
        }}
        data-dock-win={m.id}
        className={`dock-item mini ${flying.includes(m.id) ? 'flying' : ''}`}
        style={{ width: (w + 8) * s, height: size }}
        onClick={() => os().focus(m.id)}
        onContextMenu={menu(() => miniWindowMenu(m.id))}
        aria-label={`${m.title}, minimized`}
      >
        <span className="dock-label glass">{m.title}</span>
        <span className="dock-icon" style={{ transform: `scale(${s})` }}>
          <MiniWindow app={m.app} w={w} h={miniH} />
        </span>
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
        <div ref={dockEl} className="dock glass" onPointerEnter={() => mouseX === null && capture()} onPointerMove={(e) => magnify && !drag && trackX(e.clientX)} onPointerLeave={() => trackX(null)} style={{ height: size + 16 }}>
          {ordered.map((id) => (id === 'gap' ? gap : item(id)))}
          {extras.length > 0 && <div className="dock-sep" onContextMenu={menu(dockSeparatorMenu)} />}
          {extras.map((id) => item(id, true))}
          <div className="dock-sep" onContextMenu={menu(dockSeparatorMenu)} />
          {minis.map(miniItem)}
          {item('trash')}
        </div>
      </div>
      {drag && (
        <div className="dock-drag" style={{ left: drag.x - size / 2, top: drag.y - size / 2, width: size, height: size }}>
          <AppIcon app={drag.id} size={size} />
          {drag.out && !drag.extra && drag.id !== 'launchpad' && <span className="dock-remove glass">Remove</span>}
        </div>
      )}
      {poof && (
        <div key={poof.k} className="dock-poof" style={{ left: poof.x, top: poof.y }}>
          {Array.from({ length: 7 }, (_, i) => <i key={i} style={{ '--a': `${i * 51.4}deg`, '--d': `${i % 2 ? 1 : 0.7}` } as React.CSSProperties} />)}
        </div>
      )}
    </>
  )
}

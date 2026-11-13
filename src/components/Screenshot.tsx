import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { os } from '../store'
import { useShots, cancel, capture, dismissThumb, quickWindow, quickSelect, setOptions, setRegion, setTool, startRecording, trashThumb, wantsCopy, windowAt, type Thumb, type Tool } from '../lib/screenshot'
import { resizeBox, spanBox, type Box, type Handle } from '../lib/screenshotCore'
import { menu, openContextMenu, type MenuEntry } from '../lib/menu'
import { openPath } from '../apps/open'
import { openVirtualQuickLook } from '../lib/quickLook'
import './Screenshot.css'

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function ToolIcon({ tool }: { tool: Tool }) {
  const rec = tool === 'record-screen' || tool === 'record-selection'
  return (
    <svg width="30" height="24" viewBox="0 0 30 24" aria-hidden>
      {(tool === 'screen' || tool === 'record-screen') && (
        <>
          <rect x="4" y="4" width="22" height="15" rx="3" {...stroke} />
          <path d="M8 8.5V8h.5M21.5 8h.5v.5M8 14.5v.5h.5M21.5 15h.5v-.5" {...stroke} strokeWidth={1.2} />
        </>
      )}
      {tool === 'window' && (
        <>
          <rect x="4" y="4" width="22" height="15" rx="3" {...stroke} />
          <path d="M4 8.6h22" {...stroke} />
          <circle cx="7.4" cy="6.3" r=".7" fill="currentColor" />
          <circle cx="9.9" cy="6.3" r=".7" fill="currentColor" />
        </>
      )}
      {(tool === 'selection' || tool === 'record-selection') && (
        <>
          <rect x="4" y="4" width="22" height="15" rx="1.5" {...stroke} strokeDasharray="2.6 2.6" />
          <rect x="2.6" y="2.6" width="3" height="3" rx=".7" fill="currentColor" />
          <rect x="24.4" y="2.6" width="3" height="3" rx=".7" fill="currentColor" />
          <rect x="2.6" y="17.4" width="3" height="3" rx=".7" fill="currentColor" />
          <rect x="24.4" y="17.4" width="3" height="3" rx=".7" fill="currentColor" />
        </>
      )}
      {rec && (
        <>
          <circle cx="23.5" cy="17.5" r="5.4" fill="rgb(30 30 32)" />
          <circle cx="23.5" cy="17.5" r="3.6" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'screen', label: 'Capture Entire Screen' },
  { id: 'window', label: 'Capture Selected Window' },
  { id: 'selection', label: 'Capture Selected Portion' },
  { id: 'record-screen', label: 'Record Entire Screen' },
  { id: 'record-selection', label: 'Record Selected Portion' },
]

function optionsMenu(): MenuEntry[] {
  const o = useShots.getState().options
  const save = (to: typeof o.saveTo) => () => setOptions({ saveTo: to })
  const timer = (t: 0 | 5 | 10) => () => setOptions({ timer: t })
  return [
    { header: 'Save to' },
    { label: 'Desktop', checked: o.saveTo === 'desktop', run: save('desktop') },
    { label: 'Documents', checked: o.saveTo === 'documents', run: save('documents') },
    { label: 'Pictures', checked: o.saveTo === 'pictures', run: save('pictures') },
    { label: 'Clipboard', checked: o.saveTo === 'clipboard', run: save('clipboard') },
    'sep',
    { header: 'Timer' },
    { label: 'None', checked: o.timer === 0, run: timer(0) },
    { label: '5 Seconds', checked: o.timer === 5, run: timer(5) },
    { label: '10 Seconds', checked: o.timer === 10, run: timer(10) },
    'sep',
    { header: 'Options' },
    { label: 'Show Floating Thumbnail', checked: o.thumbnail, run: () => setOptions({ thumbnail: !o.thumbnail }) },
    { label: 'Remember Last Selection', checked: o.remember, run: () => setOptions({ remember: !o.remember }) },
    { label: 'Show Mouse Pointer', checked: o.pointer, run: () => setOptions({ pointer: !o.pointer }) },
  ]
}

function go() {
  const s = useShots.getState()
  if (s.tool === 'screen') return capture({ kind: 'screen' }, true)
  if (s.tool === 'selection' && s.region) return capture({ kind: 'region', box: s.region }, true)
  if (s.tool === 'record-screen') return startRecording(null)
  if (s.tool === 'record-selection' && s.region) return startRecording(s.region)
}

function Toolbar() {
  const tool = useShots((s) => s.tool)
  const timer = useShots((s) => s.options.timer)
  const recording = tool === 'record-screen' || tool === 'record-selection'
  const button = (t: (typeof TOOLS)[number]) => (
    <button key={t.id} className={`st-tool ${tool === t.id ? 'on' : ''}`} aria-label={t.label} aria-pressed={tool === t.id} title={t.label} onClick={() => setTool(t.id)}>
      <ToolIcon tool={t.id} />
    </button>
  )
  return (
    <div className="shot-toolbar" role="toolbar" aria-label="Screenshot" onPointerDown={(e) => e.stopPropagation()}>
      <button className="st-close" aria-label="Close" title="Close (Esc)" onClick={cancel}><X size={13} strokeWidth={2.6} /></button>
      <i className="st-sep" />
      <div className="st-group">{TOOLS.slice(0, 3).map(button)}</div>
      <i className="st-sep" />
      <div className="st-group">{TOOLS.slice(3).map(button)}</div>
      <i className="st-sep" />
      <button
        className="st-options"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          openContextMenu(r.left, r.top - 358, optionsMenu())
        }}
      >
        Options <ChevronDown size={11} strokeWidth={2.6} />
      </button>
      {tool !== 'window' && (
        <button className={`st-go ${recording ? 'rec' : ''}`} onClick={go}>
          {recording ? 'Record' : 'Capture'}
          {timer > 0 && <small>{timer}s</small>}
        </button>
      )}
    </div>
  )
}

function ScreenTarget() {
  const [over, setOver] = useState(false)
  return (
    <div className="shot-overlay camera" onPointerEnter={() => setOver(true)} onPointerLeave={() => setOver(false)} onPointerDown={(e) => e.stopPropagation()}
      onClick={() => capture({ kind: 'screen', copy: wantsCopy() }, useShots.getState().mode === 'toolbar')}>
      {over && <div className="shot-hl screen" />}
    </div>
  )
}

function WindowTarget() {
  const [hit, setHit] = useState<{ id: string; box: Box } | null>(null)
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  return (
    <div className="shot-overlay camera"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => {
        const { clientX: x, clientY: y } = e
        cancelAnimationFrame(raf.current)
        raf.current = requestAnimationFrame(() => {
          const overlay = document.querySelector<HTMLElement>('.shot-overlay')
          if (overlay) overlay.style.pointerEvents = 'none'
          const found = windowAt(x, y)
          if (overlay) overlay.style.pointerEvents = ''
          setHit((p) => (p?.id === found?.id ? p : found))
        })
      }}
      onPointerLeave={() => setHit(null)}
      onClick={() => hit && capture({ kind: 'window', box: hit.box, windowId: hit.id, copy: wantsCopy() }, useShots.getState().mode === 'toolbar')}>
      {hit && <div className="shot-hl window" style={{ left: hit.box.x, top: hit.box.y, width: hit.box.w, height: hit.box.h }} />}
    </div>
  )
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function RegionEditor() {
  const region = useShots((s) => s.region)!
  const begin = (kind: 'move' | Handle | 'new') => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const W = window.innerWidth
    const H = window.innerHeight
    const sx = e.clientX
    const sy = e.clientY
    const o = { ...region }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (kind === 'new') setRegion(spanBox(sx, sy, Math.max(0, Math.min(W, ev.clientX)), Math.max(0, Math.min(H, ev.clientY))))
      else if (kind === 'move') setRegion({ ...o, x: Math.max(0, Math.min(W - o.w, o.x + dx)), y: Math.max(0, Math.min(H - o.h, o.y + dy)) })
      else setRegion(resizeBox(o, kind, dx, dy, W, H))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const r = useShots.getState().region
      if (r && (r.w < 20 || r.h < 20)) setRegion(o)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="shot-overlay region-layer" onPointerDown={begin('new')}>
      <div className="shot-region" style={{ left: region.x, top: region.y, width: region.w, height: region.h }} onPointerDown={begin('move')}>
        {HANDLES.map((h) => <i key={h} className={`rh rh-${h}`} onPointerDown={begin(h)} />)}
      </div>
    </div>
  )
}

function QuickSelect() {
  const [p, setP] = useState<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const moving = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.type === 'keydown' && !e.repeat) {
        if (drag) moving.current = true
        else quickWindow()
      }
      if (e.type === 'keyup') moving.current = false
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
    }
  }, [drag])
  const box = drag ? spanBox(drag.a.x, drag.a.y, drag.b.x, drag.b.y) : null
  const label = box ? [Math.round(box.w), Math.round(box.h)] : p ? [Math.round(p.x), Math.round(p.y)] : null
  const flipX = p && p.x > window.innerWidth - 90
  const flipY = p && p.y > window.innerHeight - 70
  return (
    <div className="shot-overlay crosshair"
      onPointerDown={(e) => {
        e.stopPropagation()
        const pt = { x: e.clientX, y: e.clientY }
        last.current = pt
        setDrag({ a: pt, b: pt })
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const pt = { x: e.clientX, y: e.clientY }
        setP(pt)
        if (!drag) return
        if (moving.current) {
          const dx = pt.x - last.current.x
          const dy = pt.y - last.current.y
          setDrag({ a: { x: drag.a.x + dx, y: drag.a.y + dy }, b: { x: drag.b.x + dx, y: drag.b.y + dy } })
        } else if (e.altKey) {
          setDrag({ a: drag.a, b: { x: drag.a.x + (pt.x - drag.a.x), y: drag.a.y + (pt.y - drag.a.y) } })
        } else setDrag({ a: drag.a, b: pt })
        last.current = pt
      }}
      onPointerUp={(e) => {
        if (!box || box.w < 3 || box.h < 3) return setDrag(null)
        e.currentTarget.releasePointerCapture(e.pointerId)
        capture({ kind: 'region', box, copy: wantsCopy() })
      }}>
      {box && <div className="shot-region live" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      {p && label && (
        <div className="shot-readout" style={{ left: flipX ? p.x - 18 : p.x + 18, top: flipY ? p.y - 38 : p.y + 16, textAlign: flipX ? 'right' : 'left', transform: flipX ? 'translateX(-100%)' : undefined }}>
          <span>{label[0]}</span>
          <span>{label[1]}</span>
        </div>
      )}
    </div>
  )
}

function Layer() {
  const mode = useShots((s) => s.mode)
  const tool = useShots((s) => s.tool)
  const eff = mode === 'quick-select' ? 'quick-select' : mode === 'quick-window' ? 'window' : tool
  useEffect(() => {
    if (mode === 'idle') return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && mode === 'toolbar') {
        e.preventDefault()
        e.stopImmediatePropagation()
        go()
      } else if (e.code === 'Space' && mode === 'quick-window') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (!e.repeat) quickSelect(wantsCopy())
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [mode])
  if (eff === 'screen') return <ScreenTarget />
  if (eff === 'window') return <WindowTarget />
  if (eff === 'quick-select') return <QuickSelect />
  return <RegionEditor />
}

function ThumbCard({ t }: { t: Thumb }) {
  const [leaving, setLeaving] = useState(false)
  const [hover, setHover] = useState(false)
  const [dx, setDx] = useState(0)
  const menuOpen = useRef(false)
  useEffect(() => {
    if (hover || dx !== 0) return
    const id = setTimeout(() => setLeaving(true), 6000)
    return () => clearTimeout(id)
  }, [hover, dx])
  useEffect(() => {
    if (!leaving) return
    const id = setTimeout(() => dismissThumb(t.id), 320)
    return () => clearTimeout(id)
  }, [leaving, t.id])
  const open = () => {
    if (!t.path) return
    if (t.kind === 'video') openVirtualQuickLook(t.path, [t.path])
    else openPath(t.path)
    setLeaving(true)
  }
  const reveal = () => t.path && os().openApp('finder', { props: { path: t.path.slice(0, t.path.lastIndexOf('/')) }, forceNew: true })
  const items = (): MenuEntry[] => [
    { label: 'Open', disabled: !t.path, run: open },
    { label: 'Show in Finder', disabled: !t.path, run: reveal },
    'sep',
    { label: 'Delete', disabled: !t.path, run: () => trashThumb(t) },
    { label: 'Close', run: () => setLeaving(true) },
  ]
  return (
    <div
      className={`shot-thumb ${leaving ? 'leaving' : ''}`}
      style={{ width: t.w, height: t.h, transform: leaving ? undefined : `translateX(${dx}px)`, transition: dx ? 'none' : undefined, opacity: leaving ? undefined : 1 - Math.min(0.6, dx / 300) }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => !menuOpen.current && setHover(false)}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (e.button !== 0) return
        const sx = e.clientX
        let dragged = false
        const move = (ev: PointerEvent) => {
          const d = Math.max(0, ev.clientX - sx)
          if (d > 4) dragged = true
          setDx(d)
        }
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          if (ev.clientX - sx > 70) return setLeaving(true)
          setDx(0)
          if (!dragged) open()
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onContextMenu={(e) => {
        menuOpen.current = true
        setHover(true)
        menu(items)(e)
        const off = () => { menuOpen.current = false; setHover(false); window.removeEventListener('pointerdown', off, true) }
        setTimeout(() => window.addEventListener('pointerdown', off, true), 0)
      }}
    >
      <img src={t.poster} alt={t.name} draggable={false} />
      {t.kind === 'video' && <span className="shot-play" aria-hidden><svg width="9" height="10" viewBox="0 0 9 10"><path d="M1 .8v8.4L8 5z" fill="currentColor" /></svg></span>}
      <button className="shot-x" aria-label="Close" onPointerDown={(e) => e.stopPropagation()} onClick={() => setLeaving(true)}><X size={9} strokeWidth={3.2} /></button>
    </div>
  )
}

export function ScreenshotUI() {
  const mode = useShots((s) => s.mode)
  useEffect(() => {
    document.body.classList.toggle('shot-toolbar-open', mode === 'toolbar')
    return () => document.body.classList.remove('shot-toolbar-open')
  }, [mode])
  const hiding = useShots((s) => s.hiding)
  const thumbs = useShots((s) => s.thumbs)
  return (
    <>
      {!hiding && mode !== 'idle' && <Layer />}
      {!hiding && mode === 'toolbar' && <Toolbar />}
      {thumbs.length > 0 && (
        <div className={`shot-thumbs ${hiding ? 'hiding' : ''}`}>
          {thumbs.map((t) => <ThumbCard key={t.id} t={t} />)}
        </div>
      )}
    </>
  )
}

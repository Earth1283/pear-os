import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useOS, MENU_H, fullscreenRect, onSpace, tileRect, type Tile, type Win } from '../store'
import { APPS } from '../apps/registry'
import { WindowShader } from './ShaderLayers'
import type { OverviewRect } from '../lib/missionControl'
import { useA11y } from '../lib/a11y'
import { dockTarget, genieFrames } from '../lib/genie'
import { endFlight, startFlight } from '../lib/flights'
import { grabGravityWindow, holdDesktopGravity, registerGravityWindow, repaintGravityWindow, useGravity, windowTransform } from '../lib/gravity'

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function edgeTile(x: number, y: number): Tile {
  const W = window.innerWidth
  const H = window.innerHeight
  const m = 6
  if (y <= MENU_H + 2) return 'fill'
  if (x <= m) return y < H * 0.2 ? 'top-left' : y > H * 0.8 ? 'bottom-left' : 'left'
  if (x >= W - m) return y < H * 0.2 ? 'top-right' : y > H * 0.8 ? 'bottom-right' : 'right'
  return null
}

function TileMenu({ win, onClose }: { win: Win; onClose: () => void }) {
  const tileWindow = useOS((s) => s.tileWindow)
  const windows = useOS((s) => s.windows)
  const hidden = useOS((s) => s.hiddenApps)
  const activeSpace = useOS((s) => s.activeSpace)
  const assign = useOS((s) => s.assign)
  const [splitSide, setSplitSide] = useState<'left' | 'right' | null>(null)
  const partners = windows.filter((w) => w.id !== win.id && !w.minimized && !hidden.includes(w.app) && !w.fullscreen && !w.props.infoPath
    && APPS[w.app].resizable !== false && onSpace(w, win.fullscreen ? win.space : activeSpace, assign))
  const pick = (t: Tile) => {
    tileWindow(win.id, t)
    onClose()
  }
  const opt = (t: Tile, label: string, cells: [number, number, number, number]) => (
    <button className="tile-opt" title={label} onClick={() => pick(t)}>
      <svg viewBox="0 0 30 20" width="30" height="20">
        <rect x=".5" y=".5" width="29" height="19" rx="3" fill="none" stroke="currentColor" opacity=".5" />
        <rect x={cells[0]} y={cells[1]} width={cells[2]} height={cells[3]} rx="2" fill="currentColor" />
      </svg>
    </button>
  )
  return (
    <div className="tile-menu glass" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tile-menu-label">Full Screen</div>
      <button className="tile-text" onClick={() => { useOS.getState().toggleFullscreen(win.id); onClose() }}>
        {win.fullscreen ? 'Exit Full Screen' : 'Enter Full Screen'}
      </button>
      {!win.fullscreen?.side && partners.length > 0 && <>
        <div className="tile-row">
          <button className="tile-text" aria-pressed={splitSide === 'left'} onClick={() => setSplitSide('left')}>Split Left</button>
          <button className="tile-text" aria-pressed={splitSide === 'right'} onClick={() => setSplitSide('right')}>Split Right</button>
        </div>
        {splitSide && <div className="tile-partners" aria-label="Split View window">
          {partners.map((partner) => <button key={partner.id} className="tile-text" title={partner.title}
            onClick={() => { useOS.getState().splitFullscreen(win.id, partner.id, splitSide); onClose() }}>{partner.title}</button>)}
        </div>}
      </>}
      {!win.fullscreen && <>
        <div className="tile-menu-label">Move &amp; Resize</div>
        <div className="tile-row">
          {opt('left', 'Left', [2, 2, 12.5, 16])}
          {opt('right', 'Right', [15.5, 2, 12.5, 16])}
          {opt('top-left', 'Top Left', [2, 2, 12.5, 7.5])}
          {opt('top-right', 'Top Right', [15.5, 2, 12.5, 7.5])}
          {opt('bottom-left', 'Bottom Left', [2, 10.5, 12.5, 7.5])}
          {opt('bottom-right', 'Bottom Right', [15.5, 10.5, 12.5, 7.5])}
        </div>
        <div className="tile-menu-label">Fill &amp; Arrange</div>
        <div className="tile-row">
          {opt('fill', 'Fill', [2, 2, 26, 16])}
          <button className="tile-text" disabled={!win.tile} onClick={() => pick(null)}>Return to Previous Size</button>
        </div>
      </>}
    </div>
  )
}

function TrafficLights({ win }: { win: Win }) {
  const { closeWindow, minimize, tileWindow, toggleFullscreen } = useOS.getState()
  const [menu, setMenu] = useState(false)
  const [altHover, setAltHover] = useState(false)
  const [hovering, setHovering] = useState(false)
  const hover = useRef<number | undefined>(undefined)
  const resizable = APPS[win.app].resizable !== false && !win.props.infoPath
  useEffect(() => () => clearTimeout(hover.current), [])
  useEffect(() => {
    if (!hovering) {
      setAltHover(false)
      return
    }
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHover(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHover(false) }
    const blur = () => setAltHover(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [hovering])
  const showPlus = altHover && !win.fullscreen && resizable
  return (
    <div
      className="traffic"
      data-nodrag
      onPointerEnter={(e) => { setHovering(true); setAltHover(e.altKey) }}
      onPointerLeave={() => { setHovering(false); setAltHover(false) }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button className="tl tl-close" aria-label="Close" onClick={() => closeWindow(win.id)}>
        <svg viewBox="0 0 10 10"><path d="M3 3l4 4M7 3l-4 4" /></svg>
      </button>
      <button className="tl tl-min" aria-label="Minimize" disabled={!!win.fullscreen || APPS[win.app].systemPanel} onClick={() => minimize(win.id)}>
        <svg viewBox="0 0 10 10"><path d="M2.5 5h5" /></svg>
      </button>
      <span
        className="tl-wrap"
        onPointerEnter={() => {
          if (resizable) hover.current = window.setTimeout(() => setMenu(true), 550)
        }}
        onPointerLeave={() => {
          clearTimeout(hover.current)
          setMenu(false)
        }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMenu(false) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && menu) {
            setMenu(false)
            e.currentTarget.querySelector<HTMLButtonElement>('.tl-max')?.focus()
          }
        }}
      >
        <button
          className={`tl tl-max ${showPlus ? 'tl-zoom' : ''}`}
          aria-label={showPlus ? 'Zoom' : win.fullscreen ? 'Exit Full Screen' : 'Enter Full Screen'}
          aria-expanded={menu}
          disabled={!resizable}
          onClick={(e) => {
            if (e.altKey && !win.fullscreen) tileWindow(win.id, win.tile === 'fill' ? null : 'fill')
            else toggleFullscreen(win.id)
            setMenu(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMenu(true) }
          }}
        >
          {showPlus
            ? <svg viewBox="0 0 10 10" className="tl-plus"><path d="M5 2.4v5.2M2.4 5h5.2" /></svg>
            : <svg viewBox="0 0 10 10"><path d="M3 3.2h3.8v3.8zM7 6.8H3.2V3z" /></svg>}
        </button>
        {menu && <TileMenu win={win} onClose={() => setMenu(false)} />}
      </span>
    </div>
  )
}

interface WindowProps {
  win: Win
  focused: boolean
  inactive: boolean
  hidden: boolean
  displaySide?: 'left' | 'right'
  viewport: { width: number; height: number }
  overviewRect?: OverviewRect
  slide: { dir: -1 | 0 | 1; seq: number }
  revealed: boolean
  dimmed: boolean
}

// Overview transforms change the frame, not the running app's inputs.
const WindowContents = memo(function WindowContents({ win }: { win: Win }) {
  const App = APPS[win.app].component
  return <Suspense fallback={null}><App win={win} /></Suspense>
})

function WindowFrame({ win, focused, inactive, hidden, displaySide, viewport, overviewRect, slide, revealed, dimmed }: WindowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const interactionCleanup = useRef<(() => void) | null>(null)
  const gravityEnabled = useGravity((s) => s.enabled)
  const spec = APPS[win.app]
  const resizable = spec.resizable !== false && !win.props.infoPath
  const frame = win.fullscreen ? fullscreenRect(displaySide, viewport) : win
  const transform = windowTransform(frame)
  const { focus, setRect, tileWindow, set } = useOS.getState()

  useLayoutEffect(() => registerGravityWindow(win.id, ref.current!), [win.id])
  useLayoutEffect(() => { repaintGravityWindow(win.id) })
  useEffect(() => () => { interactionCleanup.current?.() }, [])

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      useOS.getState().closeOverlays()
      if (e.button !== 0) return focus(win.id)
      const t = e.target as HTMLElement
      focus(win.id)
      if (win.fullscreen) return
      if (!t.closest('[data-drag]') || t.closest('button, input, textarea, select, a, [data-nodrag]')) return
      const el = ref.current!
      interactionCleanup.current?.()
      const release = grabGravityWindow(win.id, el, e)
      if (release) {
        e.preventDefault()
        interactionCleanup.current = release
        return
      }
      const sx = e.clientX
      const sy = e.clientY
      let { x, y, w } = win
      const h = win.h
      let detached = false
      let preview: Tile = null
      let lastPointer = { x: sx, y: sy }
      let finished = false
      el.setPointerCapture(e.pointerId)
      el.classList.add('dragging')
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        lastPointer = { x: ev.clientX, y: ev.clientY }
        let nx = x + ev.clientX - sx
        let ny = y + ev.clientY - sy
        if (win.tile && !detached) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return
          detached = true
          const r = win.restore ?? { w: 720, h: 480 }
          const ratio = (sx - win.x) / win.w
          x = sx - r.w * ratio
          w = r.w
          el.style.width = `${r.w}px`
          el.style.height = `${r.h}px`
          nx = x + ev.clientX - sx
          ny = y + ev.clientY - sy
        }
        if (!win.angle && (win.gravityScale ?? 1) === 1) ny = Math.max(MENU_H, ny)
        el.style.transform = windowTransform({ ...win, x: nx, y: ny })
        const p = edgeTile(ev.clientX, ev.clientY)
        if (p !== preview) {
          preview = p
          set('tilePreview', p)
        }
      }
      const up = (ev?: PointerEvent) => {
        if (finished || (ev && ev.pointerId !== e.pointerId)) return
        finished = true
        interactionCleanup.current = null
        el.classList.remove('dragging')
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        el.removeEventListener('lostpointercapture', up)
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
        set('tilePreview', null)
        const point = ev?.type === 'pointerup' ? { x: ev.clientX, y: ev.clientY } : lastPointer
        const moved = Math.hypot(point.x - sx, point.y - sy) > 2
        if (!moved) {
          el.style.transform = windowTransform(win)
          return
        }
        const nx = x + point.x - sx
        const targetY = y + point.y - sy
        const ny = !win.angle && (win.gravityScale ?? 1) === 1 ? Math.max(MENU_H, targetY) : targetY
        if (preview) {
          if (detached || !win.tile) setRect(win.id, { x: nx, y: ny, w, h: detached ? win.restore?.h ?? h : h })
          tileWindow(win.id, preview)
        } else if (detached) {
          const r = win.restore!
          useOS.setState((s) => ({
            windows: s.windows.map((ww) => (ww.id === win.id ? { ...ww, x: nx, y: ny, w: r.w, h: r.h, tile: null, restore: null } : ww)),
          }))
        } else {
          setRect(win.id, { x: nx, y: ny })
        }
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
      el.addEventListener('lostpointercapture', up)
      interactionCleanup.current = up
    },
    [win, focus, setRect, tileWindow, set],
  )

  const startResize = (edge: Edge) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    focus(win.id)
    interactionCleanup.current?.()
    const resumeGravity = holdDesktopGravity()
    const current = useOS.getState().windows.find((w) => w.id === win.id) ?? win
    const el = ref.current!
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    const o = { x: current.x, y: current.y, w: current.w, h: current.h, angle: current.angle ?? 0, gravityScale: current.gravityScale ?? 1 }
    const cos = Math.cos(o.angle)
    const sin = Math.sin(o.angle)
    const minW = spec.minW ?? 320
    const minH = spec.minH ?? 200
    let r = { ...o }
    let finished = false
    el.classList.add('dragging')
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const px = (ev.clientX - sx) / o.gravityScale
      const py = (ev.clientY - sy) / o.gravityScale
      const dx = cos * px + sin * py
      const dy = -sin * px + cos * py
      r = { ...o }
      if (edge.includes('e')) r.w = Math.max(minW, o.w + dx)
      if (edge.includes('s')) r.h = Math.max(minH, o.h + dy)
      if (edge.includes('w')) {
        r.w = Math.max(minW, o.w - dx)
      }
      if (edge.includes('n')) {
        r.h = Math.max(minH, o.h - dy)
      }
      const shiftX = (r.w - o.w) / 2 * (edge.includes('w') ? -1 : 1)
      const shiftY = (r.h - o.h) / 2 * (edge.includes('n') ? -1 : 1)
      r.x = o.x + o.w / 2 + (cos * shiftX - sin * shiftY) * o.gravityScale - r.w / 2
      r.y = o.y + o.h / 2 + (sin * shiftX + cos * shiftY) * o.gravityScale - r.h / 2
      if (!o.angle && o.gravityScale === 1 && edge.includes('n') && r.y < MENU_H) {
        r.h -= MENU_H - r.y
        r.y = MENU_H
      }
      el.style.transform = windowTransform(r)
      el.style.width = `${r.w}px`
      el.style.height = `${r.h}px`
    }
    const up = (ev?: PointerEvent) => {
      if (finished || (ev && ev.pointerId !== e.pointerId)) return
      finished = true
      interactionCleanup.current = null
      el.classList.remove('dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      handle.removeEventListener('lostpointercapture', up)
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      useOS.setState((s) => ({ windows: s.windows.map((w) => (w.id === win.id ? { ...w, ...r, tile: null, restore: null } : w)) }))
      resumeGravity()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
    handle.addEventListener('lostpointercapture', up)
    interactionCleanup.current = up
  }

  useEffect(() => {
    const el = ref.current
    if (!el || overviewRect) return
    el.style.transform = transform
    el.style.width = `${frame.w}px`
    el.style.height = `${frame.h}px`
    repaintGravityWindow(win.id)
  }, [transform, frame.w, frame.h, overviewRect])

  useEffect(() => {
    if (!win.tile) return
    const onResize = () => setRect(win.id, tileRect(win.tile))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [win.tile, win.id, setRect])

  const [phase, setPhase] = useState<'in' | 'out' | null>(null)
  const [sliding, setSliding] = useState(false)
  const wasInactive = useRef(inactive)
  const slideTimer = useRef(0)
  useLayoutEffect(() => {
    if (wasInactive.current === inactive) return
    wasInactive.current = inactive
    clearTimeout(slideTimer.current)
    setSliding(false)
    if (!slide.dir || overviewRect || useA11y.getState().reduceMotion) return
    setPhase(inactive ? 'out' : 'in')
    if (inactive) {
      setSliding(true)
      slideTimer.current = window.setTimeout(() => setSliding(false), 420)
    }
  }, [inactive, slide.seq, overviewRect])
  useEffect(() => () => clearTimeout(slideTimer.current), [])
  const wasMinimized = useRef(win.minimized)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || wasMinimized.current === win.minimized) return
    wasMinimized.current = win.minimized
    if (inactive || overviewRect || useA11y.getState().reduceMotion || gravityEnabled || win.angle || (win.gravityScale ?? 1) !== 1) return
    const mode = useOS.getState().dockMinimize
    const frames = genieFrames({ x: win.x, y: win.y, w: win.w, h: win.h }, dockTarget(win), mode)
    if (frames.length < 2) return
    if (win.minimized) startFlight(win.id)
    const anim = el.animate(
      frames.map((f) => ({ transform: f.transform, opacity: f.opacity, offset: f.offset, transformOrigin: '0 0', visibility: 'visible' })),
      { duration: mode === 'genie' ? 520 : 320, easing: 'linear', direction: win.minimized ? 'normal' : 'reverse', fill: 'both' },
    )
    const finish = () => {
      anim.cancel()
      endFlight(win.id)
    }
    anim.onfinish = finish
    return () => {
      anim.onfinish = null
      finish()
    }
  }, [win.minimized])
  const leaving = inactive && sliding
  const peek = revealed && !inactive ? (win.x + win.w / 2 < window.innerWidth / 2 ? -(win.x + win.w - 44) : window.innerWidth - win.x - 44) : 0

  const chrome = spec.chrome ?? 'standard'
  return (
    <div
      ref={ref}
      data-win={win.id}
      tabIndex={-1}
      inert={inactive || hidden || !!overviewRect || win.minimized}
      className={`window ${focused ? 'focused' : 'blurred'} chrome-${chrome} ${win.minimized ? 'minimized' : ''} ${hidden || (inactive && !leaving) ? 'space-hidden' : ''} ${phase ? `space-${phase}` : ''} ${revealed && !inactive ? 'revealed' : ''} ${dimmed ? 'mc-dim' : ''} ${overviewRect ? 'mc-window' : ''} ${win.tile ? 'tiled' : ''} ${win.fullscreen ? 'fullscreen-window' : ''} ${gravityEnabled && !inactive && !win.fullscreen && !win.tile && !overviewRect && !revealed && !win.minimized ? 'gravity-body' : ''} app-${win.app}`}
      style={{ '--slide': slide.dir, '--reveal': `${peek}px`, zIndex: overviewRect ? 48000 : win.z, transform: overviewRect ? `translate(${overviewRect.x}px, ${overviewRect.y}px) scale(${overviewRect.scale})` : transform, width: frame.w, height: frame.h } as React.CSSProperties}
      onPointerDown={startDrag}
      onDoubleClick={(e) => {
        const t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) ?? (e.target as HTMLElement)
        if (t.closest('[data-drag]') && !t.closest('button, input, [data-nodrag]') && resizable && !win.fullscreen) tileWindow(win.id, win.tile === 'fill' ? null : 'fill')
      }}
    >
      <TrafficLights win={win} />
      <WindowShader focused={focused} minimized={win.minimized || inactive || hidden} />
      {chrome === 'standard' && (
        <div className="titlebar" data-drag>
          <span className="title">{win.title}</span>
        </div>
      )}
      <div className="window-body">
        <WindowContents win={win} />
      </div>
      {resizable && !win.fullscreen && EDGES.map((edge) => <div key={edge} className={`rz rz-${edge}`} onPointerDown={startResize(edge)} />)}
    </div>
  )
}

export const Window = memo(WindowFrame, (a, b) => a.win === b.win && a.focused === b.focused && a.inactive === b.inactive && a.hidden === b.hidden
  && (!a.win.fullscreen || (a.viewport === b.viewport && a.displaySide === b.displaySide))
  && a.overviewRect === b.overviewRect && a.slide === b.slide && a.revealed === b.revealed && a.dimmed === b.dimmed)

import { memo, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useOS, MENU_H, tileRect, type Tile, type Win } from '../store'
import { APPS } from '../apps/registry'
import { WindowShader } from './ShaderLayers'

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
      <div className="tile-menu-label">Move &amp; Resize</div>
      <div className="tile-row">
        {opt('left', 'Left', [2, 2, 12.5, 16])}
        {opt('right', 'Right', [15.5, 2, 12.5, 16])}
        {opt('top-left', 'Top Left', [2, 2, 12.5, 7.5])}
        {opt('bottom-right', 'Bottom Right', [15.5, 10.5, 12.5, 7.5])}
      </div>
      <div className="tile-menu-label">Fill &amp; Arrange</div>
      <div className="tile-row">
        {opt('fill', 'Fill', [2, 2, 26, 16])}
        <button className="tile-text" onClick={() => pick(null)}>
          Return to Previous Size
        </button>
      </div>
    </div>
  )
}

function TrafficLights({ win }: { win: Win }) {
  const { closeWindow, minimize, tileWindow } = useOS.getState()
  const [menu, setMenu] = useState(false)
  const hover = useRef<number | undefined>(undefined)
  const resizable = APPS[win.app].resizable !== false
  return (
    <div className="traffic" data-nodrag onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button className="tl tl-close" aria-label="Close" onClick={() => closeWindow(win.id)}>
        <svg viewBox="0 0 10 10"><path d="M3 3l4 4M7 3l-4 4" /></svg>
      </button>
      <button className="tl tl-min" aria-label="Minimize" onClick={() => minimize(win.id)}>
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
      >
        <button
          className="tl tl-max"
          aria-label="Zoom"
          disabled={!resizable}
          onClick={() => tileWindow(win.id, win.tile === 'fill' ? null : 'fill')}
        >
          <svg viewBox="0 0 10 10"><path d="M3 3.2h3.8v3.8zM7 6.8H3.2V3z" /></svg>
        </button>
        {menu && <TileMenu win={win} onClose={() => setMenu(false)} />}
      </span>
    </div>
  )
}

function WindowFrame({ win, focused }: { win: Win; focused: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const spec = APPS[win.app]
  const App = spec.component
  const { focus, setRect, tileWindow, set } = useOS.getState()

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      useOS.getState().closeOverlays()
      if (e.button !== 0) return focus(win.id)
      const t = e.target as HTMLElement
      focus(win.id)
      if (!t.closest('[data-drag]') || t.closest('button, input, textarea, select, a, [data-nodrag]')) return
      const el = ref.current!
      const sx = e.clientX
      const sy = e.clientY
      let { x, y, w } = win
      const h = win.h
      let detached = false
      let preview: Tile = null
      el.setPointerCapture(e.pointerId)
      el.classList.add('dragging')
      const move = (ev: PointerEvent) => {
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
        ny = Math.max(MENU_H, ny)
        el.style.transform = `translate(${nx}px, ${ny}px)`
        const p = edgeTile(ev.clientX, ev.clientY)
        if (p !== preview) {
          preview = p
          set('tilePreview', p)
        }
      }
      const up = (ev: PointerEvent) => {
        el.releasePointerCapture(e.pointerId)
        el.classList.remove('dragging')
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        set('tilePreview', null)
        const moved = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 2
        if (!moved) {
          el.style.transform = `translate(${win.x}px, ${win.y}px)`
          return
        }
        const nx = x + ev.clientX - sx
        const ny = Math.max(MENU_H, y + ev.clientY - sy)
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
    },
    [win, focus, setRect, tileWindow, set],
  )

  const startResize = (edge: Edge) => (e: React.PointerEvent) => {
    e.stopPropagation()
    focus(win.id)
    const el = ref.current!
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    const o = { x: win.x, y: win.y, w: win.w, h: win.h }
    const minW = spec.minW ?? 320
    const minH = spec.minH ?? 200
    let r = { ...o }
    el.classList.add('dragging')
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      r = { ...o }
      if (edge.includes('e')) r.w = Math.max(minW, o.w + dx)
      if (edge.includes('s')) r.h = Math.max(minH, o.h + dy)
      if (edge.includes('w')) {
        r.w = Math.max(minW, o.w - dx)
        r.x = o.x + o.w - r.w
      }
      if (edge.includes('n')) {
        r.h = Math.max(minH, o.h - dy)
        r.y = Math.max(MENU_H, o.y + o.h - r.h)
        r.h = o.y + o.h - r.y
      }
      el.style.transform = `translate(${r.x}px, ${r.y}px)`
      el.style.width = `${r.w}px`
      el.style.height = `${r.h}px`
    }
    const up = () => {
      el.classList.remove('dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      useOS.setState((s) => ({ windows: s.windows.map((w) => (w.id === win.id ? { ...w, ...r, tile: null, restore: null } : w)) }))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.transform = `translate(${win.x}px, ${win.y}px)`
    el.style.width = `${win.w}px`
    el.style.height = `${win.h}px`
  }, [win.x, win.y, win.w, win.h])

  useEffect(() => {
    if (!win.tile) return
    const onResize = () => setRect(win.id, tileRect(win.tile))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [win.tile, win.id, setRect])

  const chrome = spec.chrome ?? 'standard'
  return (
    <div
      ref={ref}
      data-win={win.id}
      className={`window ${focused ? 'focused' : 'blurred'} chrome-${chrome} ${win.minimized ? 'minimized' : ''} ${win.tile ? 'tiled' : ''} app-${win.app}`}
      style={{ zIndex: win.z, transform: `translate(${win.x}px, ${win.y}px)`, width: win.w, height: win.h }}
      onPointerDown={startDrag}
      onDoubleClick={(e) => {
        const t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) ?? (e.target as HTMLElement)
        if (t.closest('[data-drag]') && !t.closest('button, input, [data-nodrag]') && spec.resizable !== false) tileWindow(win.id, win.tile === 'fill' ? null : 'fill')
      }}
    >
      <TrafficLights win={win} />
      <WindowShader focused={focused} minimized={win.minimized} />
      {chrome === 'standard' && (
        <div className="titlebar" data-drag>
          <span className="title">{win.title}</span>
        </div>
      )}
      <div className="window-body">
        <Suspense fallback={null}>
          <App win={win} />
        </Suspense>
      </div>
      {spec.resizable !== false && EDGES.map((edge) => <div key={edge} className={`rz rz-${edge}`} onPointerDown={startResize(edge)} />)}
    </div>
  )
}

export const Window = memo(WindowFrame, (a, b) => a.win === b.win && a.focused === b.focused)

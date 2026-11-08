import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SPECS, useW95, type W95Win } from './store'
import { Icon } from './icons'

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export function Frame({ win, children }: { win: W95Win; children: ReactNode }) {
  const focused = useW95((s) => s.focused === win.id)
  const { focus, close, minimize, toggleMax, setRect } = useW95.getState()
  const spec = SPECS[win.app]
  const canSize = !!spec.resizable
  const canMin = !spec.dialog
  const canMax = canSize && !spec.dialog

  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0 || win.max || (e.target as HTMLElement).closest('button')) return
    const el = (e.currentTarget as HTMLElement).closest('.w95-win') as HTMLElement
    const sx = e.clientX
    const sy = e.clientY
    const ox = win.x
    const oy = win.y
    let last: { x: number; y: number } | null = null
    const move = (m: PointerEvent) => {
      const maxX = window.innerWidth - 40
      const maxY = window.innerHeight - 28 - 20
      last = { x: Math.max(-win.w + 60, Math.min(maxX, ox + m.clientX - sx)), y: Math.max(0, Math.min(maxY, oy + m.clientY - sy)) }
      el.style.left = `${last.x}px`
      el.style.top = `${last.y}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (last) setRect(win.id, last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const resize = (edge: Edge) => (e: React.PointerEvent) => {
    if (e.button !== 0 || win.max) return
    e.stopPropagation()
    const el = (e.currentTarget as HTMLElement).closest('.w95-win') as HTMLElement
    const r0 = { x: win.x, y: win.y, w: el.offsetWidth, h: el.offsetHeight }
    const sx = e.clientX
    const sy = e.clientY
    const minW = spec.minW ?? 160
    const minH = spec.minH ?? 100
    let last: { x: number; y: number; w: number; h: number } | null = null
    const move = (m: PointerEvent) => {
      const dx = m.clientX - sx
      const dy = m.clientY - sy
      let { x, y, w, h } = r0
      if (edge.includes('e')) w = Math.max(minW, r0.w + dx)
      if (edge.includes('s')) h = Math.max(minH, r0.h + dy)
      if (edge.includes('w')) {
        w = Math.max(minW, r0.w - dx)
        x = r0.x + (r0.w - w)
      }
      if (edge.includes('n')) {
        h = Math.max(minH, r0.h - dy)
        y = Math.max(0, r0.y + (r0.h - h))
      }
      last = { x, y, w, h }
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.width = `${w}px`
      el.style.height = `${h}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (last) setRect(win.id, last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const style: React.CSSProperties = win.max
    ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: win.z + (spec.dialog ? 10000 : 0) }
    : { left: win.x, top: win.y, width: win.w || 'fit-content', height: win.h || 'auto', zIndex: win.z + (spec.dialog ? 10000 : 0) }

  return (
    <div
      className={`w95-win ${focused ? 'on' : 'off'}`}
      style={{ ...style, display: win.min ? 'none' : undefined }}
      onPointerDownCapture={() => focus(win.id)}
      role="dialog"
      aria-label={win.title}
    >
      <div className="w95-title" onPointerDown={drag} onDoubleClick={() => canMax && toggleMax(win.id)}>
        <Icon name={spec.icon} size={16} />
        <span>{win.title}</span>
        <div className="w95-caps">
          {canMin && (
            <button aria-label="Minimize" onClick={() => minimize(win.id)}>
              <svg width="8" height="8" viewBox="0 0 8 8"><rect x="0" y="6" width="6" height="2" fill="#000" /></svg>
            </button>
          )}
          {canMax && (
            <button aria-label={win.max ? 'Restore' : 'Maximize'} onClick={() => toggleMax(win.id)}>
              {win.max ? (
                <svg width="8" height="8" viewBox="0 0 8 8"><path d="M2 0h6v5H6v1H0V2h2zM3 1v1h4v3H6V2H3z" fill="#000" fillRule="evenodd" /></svg>
              ) : (
                <svg width="9" height="9" viewBox="0 0 9 9"><path d="M0 0h9v9H0zM1 3v5h7V3z" fill="#000" fillRule="evenodd" /></svg>
              )}
            </button>
          )}
          <button className="x" aria-label="Close" onClick={() => close(win.id)}>
            <svg width="8" height="7" viewBox="0 0 8 7"><path d="M0 0h2l2 2 2-2h2L5 3.5 8 7H6L4 5 2 7H0l3-3.5z" fill="#000" /></svg>
          </button>
        </div>
      </div>
      <div className="w95-client">{children}</div>
      {canSize && !win.max && EDGES.map((e) => <div key={e} className={`w95-rz ${e}`} onPointerDown={resize(e)} />)}
    </div>
  )
}

export interface MItem {
  label: string
  run?: () => void
  disabled?: boolean
  checked?: boolean
  keys?: string
}
export interface MDef {
  label: string
  items: (MItem | 'sep')[]
}

export function MenuBar95({ menus }: { menus: MDef[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open === null) return
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])
  return (
    <div className="w95-menubar" ref={ref}>
      {menus.map((m, i) => (
        <div key={m.label} className="w95-mb">
          <button className={open === i ? 'on' : ''} onClick={() => setOpen(open === i ? null : i)} onPointerEnter={() => open !== null && setOpen(i)}>
            {m.label}
          </button>
          {open === i && (
            <div className="w95-drop">
              {m.items.map((it, k) =>
                it === 'sep' ? (
                  <hr key={k} />
                ) : (
                  <button
                    key={it.label}
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null)
                      it.run?.()
                    }}
                  >
                    <span className="chk">{it.checked ? '✓' : ''}</span>
                    <span className="lab">{it.label}</span>
                    <span className="key">{it.keys}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

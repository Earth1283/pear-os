import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid, Plus, X } from 'lucide-react'
import { MAX_SPACES, fullscreenRect, os, spaceOrder, useOS, onSpace } from '../store'
import { AppIcon } from './icons'
import { APPS } from '../apps/registry'
import type { OverviewRect } from '../lib/missionControl'
import './MissionControl.css'

const WINDOW_TYPE = 'application/x-pearos-window'

export function MissionControl({ layout, viewport }: { layout: Map<string, OverviewRect>; viewport: { width: number; height: number } }) {
  const desktops = useOS((s) => s.spaces)
  const activeSpace = useOS((s) => s.activeSpace)
  const windows = useOS((s) => s.windows)
  const assign = useOS((s) => s.assign)
  const hiddenApps = useOS((s) => s.hiddenApps)
  const mcApp = useOS((s) => s.mcApp)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropSpace, setDropSpace] = useState<number | 'new' | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const spaces = useMemo(() => spaceOrder({ spaces: desktops, windows }), [desktops, windows])
  const label = (space: number) => space > 0 ? `Desktop ${desktops.indexOf(space) + 1}`
    : windows.filter((w) => w.fullscreen?.space === space).sort((a, b) => Number(a.fullscreen?.side === 'right') - Number(b.fullscreen?.side === 'right')).map((w) => APPS[w.app].name).join(' & ')
  const index = spaces.indexOf(activeSpace)
  const visible = windows.filter((w) => layout.has(w.id))
  const visibleIds = visible.map((w) => w.id).join(',')

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => {
      requestAnimationFrame(() => {
        if (os().phase !== 'desktop' || os().overlay.missionControl) return
        const win = document.querySelector<HTMLElement>(`.window[data-win="${os().focused}"]`)
        if (previous?.isConnected && win?.contains(previous)) previous.focus({ preventScroll: true })
        else win?.focus({ preventScroll: true })
      })
    }
  }, [])

  useEffect(() => {
    const target = root.current?.querySelector<HTMLButtonElement>('.mc-window-target') ?? strip.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')
    target?.focus({ preventScroll: true })
    strip.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeSpace, visibleIds])

  const close = () => os().setOverlay({ missionControl: false })
  const pick = (id: string) => { os().focus(id); close() }
  const accept = (e: DragEvent, space: number | 'new') => {
    if (!e.dataTransfer.types.includes(WINDOW_TYPE)) return
    if (typeof space === 'number' && space < 0) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropSpace(space)
  }
  const drop = (e: DragEvent, space: number | 'new') => {
    if (typeof space === 'number' && space < 0) return
    e.preventDefault()
    const id = e.dataTransfer.getData(WINDOW_TYPE)
    if (os().windows.some((w) => w.id === id)) {
      const target = space === 'new' ? os().addSpace() : space
      if (target !== null) os().moveWindowToSpace(id, target)
    }
    setDragging(null)
    setDropSpace(null)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Tab') {
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = (current + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length
      if (buttons[next]) { e.preventDefault(); buttons[next].focus() }
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.mc-window-target') ?? [])
      if (!buttons.length) return
      e.preventDefault()
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const offset = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
      buttons[(current + offset + buttons.length) % buttons.length]?.focus()
    }
  }

  return (
    <>
      <div className="mc-backdrop" onPointerDown={(e) => e.stopPropagation()} onClick={close} />
      <div ref={root} className={`mission-control ${dragging ? 'mc-dragging' : ''}`} role="dialog" aria-modal="true" aria-label="Mission Control" onKeyDown={onKeyDown} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        <header className="mc-header glass">
          <div className="mc-heading"><LayoutGrid size={16} /><span>{mcApp ? `${APPS[mcApp].name} Windows` : 'Mission Control'}</span></div>
          <div ref={strip} className="mc-spaces" aria-label="Spaces">
            {spaces.map((space) => (
              <div key={space} className={`mc-space ${space === activeSpace ? 'active' : ''} ${dropSpace === space ? 'drop-target' : ''}`}
                onDragOver={(e) => accept(e, space)} onDragLeave={() => setDropSpace(null)} onDrop={(e) => drop(e, space)}>
                <button className="mc-space-pick" aria-label={space < 0 ? `${label(space)}, full screen` : label(space)} aria-current={space === activeSpace} onClick={() => os().switchSpace(space)}>
                  <span className="mc-mini-desktop" aria-hidden="true">
                    {windows.filter((w) => onSpace(w, space, assign) && !w.minimized && (space < 0 || !hiddenApps.includes(w.app))).map((w) => {
                      const r = w.fullscreen ? fullscreenRect(w.fullscreen.side, viewport) : w
                      return <span key={w.id} className="mc-mini-window" style={{ left: `${r.x / viewport.width * 100}%`, top: `${r.y / viewport.height * 100}%`, width: `${r.w / viewport.width * 100}%`, height: `${r.h / viewport.height * 100}%`, zIndex: w.z }}>
                        <AppIcon app={w.app} size={space < 0 ? 26 : 16} />
                      </span>
                    })}
                  </span>
                  <span className="mc-space-label" title={label(space)}>{label(space)}</span>
                </button>
                {space > 0 && desktops.length > 1 && <button className="mc-space-remove" aria-label={`Remove ${label(space)}`} title="Move its windows to the adjacent desktop" onClick={() => os().removeSpace(space)}><X size={11} /></button>}
              </div>
            ))}
            <button className={`mc-space-add ${dropSpace === 'new' ? 'drop-target' : ''}`} aria-label="Add Desktop" disabled={desktops.length >= MAX_SPACES} title={desktops.length >= MAX_SPACES ? 'Maximum of 8 desktops' : 'Add a desktop, or drop a window here'}
              onClick={() => os().addSpace()} onDragOver={(e) => desktops.length < MAX_SPACES && accept(e, 'new')} onDragLeave={() => setDropSpace(null)} onDrop={(e) => desktops.length < MAX_SPACES && drop(e, 'new')}><Plus size={25} strokeWidth={1.5} /></button>
          </div>
          <button className="mc-close" aria-label="Close Mission Control" title="Close (Esc)" onClick={close}><X size={18} /></button>
        </header>
        <div className="mc-stage" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
          {visible.map((w) => {
            const rect = layout.get(w.id)!
            return <button key={w.id} className={`mc-window-target ${dragging === w.id ? 'dragging' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              aria-label={`${w.title}, ${APPS[w.app].name}`} draggable onClick={() => pick(w.id)}
              onDragStart={(e) => { e.dataTransfer.setData(WINDOW_TYPE, w.id); e.dataTransfer.effectAllowed = 'move'; setDragging(w.id) }}
              onDragEnd={() => { setDragging(null); setDropSpace(null) }}>
              <span className="mc-window-label"><AppIcon app={w.app} size={20} /><span>{w.title}</span></span>
            </button>
          })}
          {visible.length === 0 && <div className="mc-empty"><LayoutGrid size={34} strokeWidth={1} /><span>No open windows</span><small>{windows.some((w) => onSpace(w, activeSpace, assign) && w.minimized) ? 'Your windows are minimized in the Dock.' : 'A little room to think. Suspicious.'}</small><button className="btn" onClick={close}>Return to Desktop</button></div>}
        </div>
        <footer className="mc-footer">
          <button aria-label="Previous Space" disabled={index === 0} onClick={() => os().switchSpace(spaces[index - 1])}><ChevronLeft size={16} /></button>
          <span aria-live="polite">{label(activeSpace)}</span>
          <button aria-label="Next Space" disabled={index === spaces.length - 1} onClick={() => os().switchSpace(spaces[index + 1])}><ChevronRight size={16} /></button>
          <span className="mc-hint">Drag a window to a desktop <span>·</span> Esc to return</span>
        </footer>
      </div>
    </>
  )
}

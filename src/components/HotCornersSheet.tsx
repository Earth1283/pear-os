import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useOS, os } from '../store'
import { CORNERS, CORNER_NAMES, HOT_ACTIONS, type Corner, type HotAction, type HotMod } from '../lib/hotCornerConfig'
import './HotCornersSheet.css'

const SYMBOL: Record<HotMod, string> = { none: '', meta: '⌘', alt: '⌥', ctrl: '⌃', shift: '⇧' }
const GROUPS: HotAction[][] = [
  ['none'],
  ['missionControl', 'appWindows', 'desktop', 'notificationCenter', 'launchpad', 'quickNote'],
  ['sleep', 'lock'],
]
const label = (a: HotAction) => HOT_ACTIONS.find((x) => x.id === a)!.label

function modOf(e: { metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean }): HotMod {
  return e.metaKey ? 'meta' : e.altKey ? 'alt' : e.ctrlKey ? 'ctrl' : e.shiftKey ? 'shift' : 'none'
}

function PopUp({ corner }: { corner: Corner }) {
  const value = useOS((s) => s.hotCorners[corner])
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])
  const pick = (action: HotAction, mod: HotMod) => {
    const next = { ...os().hotCorners, [corner]: { action, mod: action === 'none' ? 'none' : mod } }
    os().set('hotCorners', next)
    setOpen(false)
  }
  const text = value.action === 'none' ? '–' : `${SYMBOL[value.mod]} ${label(value.action)}`.trim()
  return (
    <div ref={root} className={`hc-pop hc-${corner}`}>
      <button className="hc-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`${CORNER_NAMES[corner]} hot corner`} onClick={() => setOpen(!open)}>
        <span>{text}</span>
        <i><ChevronsUpDown size={10} strokeWidth={3} /></i>
      </button>
      {open && (
        <div className="hc-menu" role="menu">
          {GROUPS.map((g, gi) => (
            <div key={gi} className="hc-group">
              {g.map((a) => (
                <button key={a} role="menuitemradio" aria-checked={value.action === a} className="hc-item" onClick={(e) => pick(a, modOf(e))}>
                  <span className="hc-check">{value.action === a && <Check size={11} strokeWidth={3} />}</span>
                  {label(a)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function HotCornersSheet({ wp, onDone }: { wp: string; onDone: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.stopPropagation()
        onDone()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onDone])
  return (
    <div className="hc-backdrop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="hc-sheet" role="dialog" aria-label="Hot Corners">
        <div className="hc-screen">
          <div className={`hc-wall ${wp}`}>
            <div className="hc-bar" />
            <div className="hc-dock" />
          </div>
          {CORNERS.map((c) => <PopUp key={c} corner={c} />)}
        </div>
        <p className="hc-note">Hold ⌘, ⌥, ⌃ or ⇧ while choosing an action to make a corner wait for that key.</p>
        <div className="hc-foot">
          <button className="hc-help" aria-label="Help" onClick={() => os().notify({ app: 'settings', title: 'Hot Corners', body: 'Push the pointer into a corner of the screen. That is the whole feature. It took Apple a decade to ship.' })}>?</button>
          <button className="btn primary" onClick={onDone}>Done</button>
        </div>
      </div>
    </div>
  )
}

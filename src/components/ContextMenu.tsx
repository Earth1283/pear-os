import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { useOS } from '../store'
import { closeContextMenu, type MenuEntry } from '../lib/menu'

export const TAG_COLORS: Record<string, string> = {
  Red: '#ff453a',
  Orange: '#ff9f0a',
  Yellow: '#ffd60a',
  Green: '#30d158',
  Blue: '#0a84ff',
  Purple: '#bf5af2',
  Gray: '#98989d',
}

function place(el: HTMLElement, x: number, y: number, anchor?: DOMRect) {
  const r = el.getBoundingClientRect()
  const W = window.innerWidth
  const H = window.innerHeight
  let left = x
  let top = y
  if (anchor) {
    left = anchor.right - 2
    top = anchor.top - 5
    if (left + r.width > W - 4) left = anchor.left - r.width + 2
  } else if (left + r.width > W - 4) left = Math.max(4, x - r.width)
  if (top + r.height > H - 4) top = Math.max(30, H - r.height - 4)
  el.style.left = `${left}px`
  el.style.top = `${top}px`
  el.style.visibility = 'visible'
}

export function MenuList({ items, x, y, anchor, onDone, className = '' }: { items: MenuEntry[]; x?: number; y?: number; anchor?: DOMRect; onDone: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<{ i: number; rect: DOMRect } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const floating = x !== undefined || anchor !== undefined

  useLayoutEffect(() => {
    if (floating && ref.current) place(ref.current, x ?? 0, y ?? 0, anchor)
  }, [x, y, anchor, floating])

  const hoverItem = (i: number, el: HTMLElement, hasSub: boolean) => {
    clearTimeout(timer.current)
    if (hasSub) {
      const rect = el.getBoundingClientRect()
      timer.current = window.setTimeout(() => setOpen({ i, rect }), open ? 60 : 140)
    } else if (open) timer.current = window.setTimeout(() => setOpen(null), 120)
  }

  return (
    <div
      ref={ref}
      className={`dropdown glass ${floating ? 'floating' : ''} ${className}`}
      style={floating ? { visibility: 'hidden' } : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="dd-sep" />
        if ('header' in it)
          return (
            <div key={i} className="dd-header">
              {it.header}
            </div>
          )
        if ('tags' in it)
          return (
            <div key={i} className="dd-tags" onPointerEnter={() => open && setOpen(null)}>
              {Object.entries(TAG_COLORS).map(([name, c]) => (
                <button
                  key={name}
                  title={name}
                  className={`dd-tag ${it.tags.includes(name) ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    it.onPick(name)
                    onDone()
                  }}
                />
              ))}
            </div>
          )
        const hasSub = !!it.submenu?.length
        return (
          <button
            key={i}
            role="menuitem"
            className={`dd-item ${open?.i === i ? 'sub-open' : ''}`}
            disabled={it.disabled}
            onPointerEnter={(e) => !it.disabled && hoverItem(i, e.currentTarget, hasSub)}
            onClick={(e) => {
              if (hasSub) return setOpen({ i, rect: e.currentTarget.getBoundingClientRect() })
              onDone()
              it.run?.()
            }}
          >
            <span className="dd-check">{it.checked ? '✓' : ''}</span>
            <span className="dd-label">{it.label}</span>
            {it.shortcut && <span className="dd-sc">{it.shortcut}</span>}
            {hasSub && <ChevronRight className="dd-arrow" size={12} strokeWidth={2.6} />}
          </button>
        )
      })}
      {open && (() => {
        const it = items[open.i]
        return typeof it === 'object' && 'submenu' in it && it.submenu ? createPortal(<MenuList items={it.submenu} anchor={open.rect} onDone={onDone} className="sub" />, document.body) : null
      })()}
    </div>
  )
}

export function GlobalContextMenu() {
  const cm = useOS((s) => s.contextMenu)
  if (!cm) return null
  return (
    <div
      className="overlay-catch ctx-catch"
      onPointerDown={closeContextMenu}
      onContextMenu={(e) => {
        e.preventDefault()
        closeContextMenu()
      }}
    >
      <MenuList key={`${cm.x},${cm.y}`} items={cm.items} x={cm.x} y={cm.y} onDone={closeContextMenu} className="ctx" />
    </div>
  )
}

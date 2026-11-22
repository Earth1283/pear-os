import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

function isSelectable(it: MenuEntry): it is Exclude<MenuEntry, 'sep' | { header: string } | { tags: string[]; onPick: (tag: string) => void }> {
  return typeof it === 'object' && 'label' in it && !it.disabled
}

export function MenuList({
  items,
  x,
  y,
  anchor,
  onDone,
  onStepMenu,
  onCloseSub,
  headerSlot,
  className = '',
}: {
  items: MenuEntry[]
  x?: number
  y?: number
  anchor?: DOMRect
  onDone: () => void
  onStepMenu?: (dir: -1 | 1) => void
  onCloseSub?: () => void
  headerSlot?: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const [open, setOpen] = useState<{ i: number; rect: DOMRect } | null>(null)
  const [active, setActive] = useState<number>(-1)
  const timer = useRef<number | undefined>(undefined)
  const floating = x !== undefined || anchor !== undefined

  useLayoutEffect(() => {
    if (floating && ref.current) place(ref.current, x ?? 0, y ?? 0, anchor)
  }, [x, y, anchor, floating])

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    if (open) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape' && e.key !== 'Enter') return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (onCloseSub) onCloseSub()
        else onDone()
        return
      }
      const selectable = items.map((it, idx) => (isSelectable(it) ? idx : -1)).filter((idx) => idx >= 0)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!selectable.length) return
        e.preventDefault()
        e.stopPropagation()
        const pos = selectable.indexOf(active)
        const next = pos < 0 ? (e.key === 'ArrowDown' ? selectable[0] : selectable[selectable.length - 1]) : selectable[(pos + (e.key === 'ArrowDown' ? 1 : -1) + selectable.length) % selectable.length]
        setActive(next)
        return
      }
      if (e.key === 'ArrowRight') {
        const cur = active >= 0 ? items[active] : undefined
        if (cur && isSelectable(cur) && cur.submenu?.length) {
          const btn = itemRefs.current[active]
          if (btn) {
            e.preventDefault()
            e.stopPropagation()
            setOpen({ i: active, rect: btn.getBoundingClientRect() })
            return
          }
        }
        if (onStepMenu) {
          e.preventDefault()
          e.stopPropagation()
          onStepMenu(1)
        }
        return
      }
      if (e.key === 'ArrowLeft') {
        if (onCloseSub) {
          e.preventDefault()
          e.stopPropagation()
          onCloseSub()
          return
        }
        if (onStepMenu) {
          e.preventDefault()
          e.stopPropagation()
          onStepMenu(-1)
        }
        return
      }
      if (e.key === 'Enter' && active >= 0) {
        const cur = items[active]
        if (cur && isSelectable(cur)) {
          e.preventDefault()
          e.stopPropagation()
          if (cur.submenu?.length) {
            const btn = itemRefs.current[active]
            if (btn) setOpen({ i: active, rect: btn.getBoundingClientRect() })
          } else {
            onDone()
            cur.run?.()
          }
        }
        return
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && target?.tagName !== 'INPUT') {
        const ch = e.key.toLowerCase()
        const match = selectable.find((idx) => {
          const it = items[idx]
          return isSelectable(it) && it.label.toLowerCase().startsWith(ch)
        })
        if (match !== undefined) {
          e.preventDefault()
          setActive(match)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [items, active, open, onDone, onStepMenu, onCloseSub])

  const hoverItem = (i: number, el: HTMLElement, hasSub: boolean) => {
    setActive(i)
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
      {headerSlot}
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
            ref={(el) => { itemRefs.current[i] = el }}
            role="menuitem"
            className={`dd-item ${open?.i === i ? 'sub-open' : ''} ${active === i ? 'kbd-active' : ''}`}
            disabled={it.disabled}
            onPointerEnter={(e) => !it.disabled && hoverItem(i, e.currentTarget, hasSub)}
            onClick={(e) => {
              if (hasSub) return setOpen({ i, rect: e.currentTarget.getBoundingClientRect() })
              onDone()
              it.run?.()
            }}
          >
            <span className="dd-check">{it.checked === 'diamond' ? '♦' : it.checked ? '✓' : ''}</span>
            <span className="dd-label">{it.label}</span>
            {it.shortcut && <span className="dd-sc">{it.shortcut}</span>}
            {hasSub && <ChevronRight className="dd-arrow" size={12} strokeWidth={2.6} />}
          </button>
        )
      })}
      {open && (() => {
        const it = items[open.i]
        return typeof it === 'object' && 'submenu' in it && it.submenu
          ? createPortal(<MenuList items={it.submenu} anchor={open.rect} onDone={onDone} onCloseSub={() => setOpen(null)} className="sub" />, document.body)
          : null
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

import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { menu, type MenuEntry } from '../lib/menu'
import { STICKY_COLORS, STICKY_MIN, clampX, clampY, takeJustAdded, useStickies, type Sticky, type StickyColor } from '../lib/stickies'

type Drag = { kind: 'move' | 'size'; px: number; py: number; s: Sticky; x: number; y: number; w: number; h: number }

function stickyMenu(s: Sticky): MenuEntry[] {
  const st = useStickies.getState()
  return [
    ...(Object.keys(STICKY_COLORS) as StickyColor[]).map((c): MenuEntry => ({ label: c[0].toUpperCase() + c.slice(1), checked: s.color === c, run: () => st.patch(s.id, { color: c }) })),
    'sep',
    { label: 'New Sticky', run: () => st.add({ x: s.x + 40, y: s.y + 40 }) },
    { label: 'Delete Sticky', run: () => st.remove(s.id) },
  ]
}

function StickyNote({ s }: { s: Sticky }) {
  const { patch, raise, remove, add } = useStickies.getState()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [armed, setArmed] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const c = STICKY_COLORS[s.color]
  const x = drag?.x ?? s.x
  const y = drag?.y ?? s.y
  const w = drag?.w ?? s.w
  const h = drag?.h ?? s.h

  useEffect(() => {
    if (takeJustAdded(s.id)) area.current?.focus()
  }, [])

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 2200)
    return () => clearTimeout(t)
  }, [armed])

  const begin = (kind: Drag['kind']) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    raise(s.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind, px: e.clientX, py: e.clientY, s, x: s.x, y: s.y, w: s.w, h: s.h })
  }
  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const dx = e.clientX - drag.px
    const dy = e.clientY - drag.py
    if (drag.kind === 'move') setDrag({ ...drag, x: clampX(drag.s.x + dx, s.w), y: clampY(drag.s.y + dy, s.h) })
    else setDrag({ ...drag, w: Math.max(STICKY_MIN.w, Math.min(520, Math.round(drag.s.w + dx))), h: Math.max(STICKY_MIN.h, Math.min(560, Math.round(drag.s.h + dy))) })
  }
  const end = () => {
    if (drag) patch(s.id, { x: drag.x, y: drag.y, w: drag.w, h: drag.h })
    setDrag(null)
  }

  const close = () => {
    if (!s.text.trim() || armed) return remove(s.id)
    setArmed(true)
  }

  return (
    <div
      className={`sticky ${drag ? 'dragging' : ''}`}
      style={{ left: x, top: y, width: w, height: h, zIndex: s.z, ['--paper' as string]: c.paper, ['--bar' as string]: c.bar, ['--ink' as string]: c.ink }}
      onPointerDown={() => raise(s.id)}
      onContextMenu={menu(() => stickyMenu(s))}
    >
      <div className="sticky-bar" onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <button className="sticky-btn" data-nodrag title="Delete Sticky" onPointerDown={(e) => e.stopPropagation()} onClick={close}>
          {armed ? <b>Delete?</b> : <X size={11} strokeWidth={3} />}
        </button>
        <button className="sticky-btn add" data-nodrag title="New Sticky" onPointerDown={(e) => e.stopPropagation()} onClick={() => add({ x: s.x + 36, y: s.y + 36 })}>
          <Plus size={12} strokeWidth={3} />
        </button>
      </div>
      <textarea ref={area} value={s.text} spellCheck={false} placeholder="Take a note…" onChange={(e) => patch(s.id, { text: e.target.value })} />
      <i className="sticky-grip" onPointerDown={begin('size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </div>
  )
}

export function Stickies() {
  const list = useStickies((s) => s.list)
  return (
    <div className="desk-stickies">
      {list.map((s) => (
        <StickyNote key={s.id} s={s} />
      ))}
    </div>
  )
}

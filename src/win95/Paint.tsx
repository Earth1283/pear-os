import { useEffect, useRef, useState } from 'react'
import { MenuBar95 } from './ui'
import { msgbox, useW95, w95, type W95Win } from './store'

type Tool = 'pencil' | 'brush' | 'eraser' | 'spray' | 'fill' | 'line' | 'rect' | 'ellipse'

const PALETTE = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080', '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000',
  '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040',
]

const TOOLS: { id: Tool; label: string; glyph: string }[] = [
  { id: 'pencil', label: 'Pencil', glyph: 'M3 13l1-4 7-7 3 3-7 7zM9 4l3 3' },
  { id: 'brush', label: 'Brush', glyph: 'M3 13c0-3 2-3 3-3l1 1c0 1 0 3-4 2zM7 10l6-7 1 1-6 7z' },
  { id: 'eraser', label: 'Eraser', glyph: 'M2 10l6-7 6 5-5 6H5zM6 6l6 5' },
  { id: 'spray', label: 'Airbrush', glyph: 'M3 8h5v6H3zM4 8V6h3v2M10 3h1M12 5h1M11 7h1M13 3h1M12 9h1M14 7h1' },
  { id: 'fill', label: 'Fill With Color', glyph: 'M3 8l5-5 5 5-5 5zM13 10c1 2 1 3 0 4-1-1-1-2 0-4z' },
  { id: 'line', label: 'Line', glyph: 'M2 14L14 2' },
  { id: 'rect', label: 'Rectangle', glyph: 'M2 4h12v8H2z' },
  { id: 'ellipse', label: 'Ellipse', glyph: 'M8 3a6 4.5 0 1 0 .01 0z' },
]

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, hex: string) {
  const { width: w, height: h } = ctx.canvas
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const at = (px: number, py: number) => (py * w + px) * 4
  const s = at(x, y)
  const target = [d[s], d[s + 1], d[s + 2]]
  const [r, g, b] = hexToRgb(hex)
  if (target[0] === r && target[1] === g && target[2] === b) return
  const stack = [[x, y]]
  while (stack.length) {
    const [px, py] = stack.pop()!
    if (px < 0 || py < 0 || px >= w || py >= h) continue
    const i = at(px, py)
    if (d[i] !== target[0] || d[i + 1] !== target[1] || d[i + 2] !== target[2]) continue
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
    d[i + 3] = 255
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1])
  }
  ctx.putImageData(img, 0, 0)
}

export function Paint({ win }: { win: W95Win }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pencil')
  const [fg, setFg] = useState('#000000')
  const [bg, setBg] = useState('#ffffff')
  const [size, setSize] = useState(2)
  const [name] = useState('untitled')
  const snapshot = useRef<ImageData | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const color = useRef(fg)

  const clear = () => {
    const c = cv.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }

  useEffect(clear, [])
  useEffect(() => {
    useW95.getState().setTitle(win.id, `${name} - Paint`)
  }, [name, win.id])

  const pos = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect()
    return { x: Math.floor(e.clientX - r.left), y: Math.floor(e.clientY - r.top) }
  }

  const dab = (ctx: CanvasRenderingContext2D, x: number, y: number, t: Tool, col: string) => {
    ctx.fillStyle = col
    if (t === 'spray') {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * size * 4
        ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1)
      }
    } else {
      const s = t === 'eraser' ? size * 3 + 4 : t === 'brush' ? size * 2 + 2 : size
      ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s)
    }
  }

  const stroke = (ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, t: Tool, col: string) => {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1)
    for (let i = 0; i <= steps; i++) dab(ctx, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, t, col)
  }

  const shape = (ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, t: Tool, col: string) => {
    ctx.strokeStyle = col
    ctx.lineWidth = size
    ctx.beginPath()
    if (t === 'line') {
      ctx.moveTo(a.x + 0.5, a.y + 0.5)
      ctx.lineTo(b.x + 0.5, b.y + 0.5)
    } else if (t === 'rect') ctx.rect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    else ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  const down = (e: React.PointerEvent) => {
    const ctx = cv.current?.getContext('2d')
    if (!ctx || (e.button !== 0 && e.button !== 2)) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const p = pos(e)
    color.current = e.button === 2 ? bg : fg
    if (tool === 'fill') return floodFill(ctx, p.x, p.y, color.current)
    start.current = p
    last.current = p
    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') snapshot.current = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
    else dab(ctx, p.x, p.y, tool, tool === 'eraser' ? '#ffffff' : color.current)
  }

  const move = (e: React.PointerEvent) => {
    const ctx = cv.current?.getContext('2d')
    if (!ctx || !start.current || !last.current) return
    const p = pos(e)
    if (snapshot.current) {
      ctx.putImageData(snapshot.current, 0, 0)
      shape(ctx, start.current, p, tool, color.current)
    } else {
      stroke(ctx, last.current, p, tool, tool === 'eraser' ? '#ffffff' : color.current)
      last.current = p
    }
  }

  const up = () => {
    start.current = null
    last.current = null
    snapshot.current = null
  }

  const save = () => {
    const c = cv.current
    if (!c) return
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = `${name}.png`
    a.click()
  }

  return (
    <div className="w95-col paint">
      <MenuBar95
        menus={[
          {
            label: 'File',
            items: [
              { label: 'New', run: clear },
              { label: 'Save As…', run: save },
              'sep',
              { label: 'Exit', run: () => w95().close(win.id) },
            ],
          },
          { label: 'Edit', items: [{ label: 'Clear Image', run: clear }, { label: 'Undo', disabled: true, keys: 'Ctrl+Z' }] },
          { label: 'Image', items: [{ label: 'Flip/Rotate…', disabled: true }, { label: 'Attributes…', run: () => msgbox('Width: 480\nHeight: 300\nUnits: pixels\nColors: all of them, but 28 at a time.', { title: 'Attributes' }) }] },
          { label: 'Help', items: [{ label: 'About Paint', run: () => msgbox('Paint\nVersion 4.00\nUndo is a rumour.', { title: 'About Paint' }) }] },
        ]}
      />
      <div className="paint-body">
        <div className="paint-tools">
          <div className="paint-grid">
            {TOOLS.map((t) => (
              <button key={t.id} className={`w95-btn tool ${tool === t.id ? 'on' : ''}`} title={t.label} onClick={() => setTool(t.id)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#000" strokeWidth="1">
                  <path d={t.glyph} />
                </svg>
              </button>
            ))}
          </div>
          <div className="paint-sizes sunken">
            {[1, 2, 4, 6].map((s) => (
              <button key={s} className={size === s ? 'on' : ''} onClick={() => setSize(s)} aria-label={`Size ${s}`}>
                <i style={{ height: s }} />
              </button>
            ))}
          </div>
        </div>
        <div className="paint-canvas sunken">
          <canvas
            ref={cv}
            width={480}
            height={300}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>
      <div className="paint-colors">
        <div className="paint-cur sunken">
          <i className="b" style={{ background: bg }} />
          <i className="f" style={{ background: fg }} />
        </div>
        <div className="paint-pal">
          {PALETTE.map((c) => (
            <button
              key={c}
              className="sunken"
              style={{ background: c }}
              aria-label={c}
              onPointerDown={(e) => {
                if (e.button === 2) setBg(c)
                else setFg(c)
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
          ))}
        </div>
      </div>
      <div className="w95-status"><span className="sunken">For Help, click Help Topics on the Help Menu.</span></div>
    </div>
  )
}

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ALargeSmall,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  FolderOpen,
  Highlighter,
  Info,
  Minus,
  MoveUpRight,
  PanelLeft,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Scaling,
  Share,
  Signature,
  SlidersHorizontal,
  Square,
  SquareDashed,
  Type,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { os, useOS, type Win } from '../store'
import { HOME, addNode, formatBytes, listDir, parentOf, resolve, type FileNode } from '../lib/fs'
import { bumpDrive, drive, useBackend } from '../lib/backend'
import { openContextMenu, type MenuEntry } from '../lib/menu'
import { nodeImageURL } from '../lib/samples'
import {
  NEUTRAL,
  alphaPreview,
  applyAlpha,
  autoLevels,
  blobToDataURL,
  cancelAlpha,
  copy as copyCanvas,
  crop,
  encode,
  engineInfo,
  fromImage,
  histogram,
  isNeutral,
  loadImage,
  previewInto,
  process,
  thumbnail,
  type Adjust,
} from '../lib/imaging'
import { kindFor } from './Drive'
import type { MenuDef } from './types'

// ---- Model --------------------------------------------------------------------------------------

type Source = { kind: 'fs'; path: string } | { kind: 'drive'; rel: string } | { kind: 'local' }

export interface Item {
  key: string
  name: string
  url: string
  size?: number
  modified?: number
  where: string
  src: Source
}

type ShapeKind = 'line' | 'arrow' | 'rect' | 'oval'
type StrokeAnn = { id: string; kind: 'sketch' | 'highlight'; pts: number[]; color: string; width: number }
type ShapeAnn = { id: string; kind: ShapeKind; x1: number; y1: number; x2: number; y2: number; color: string; fill: string | null; width: number }
type TextAnn = { id: string; kind: 'text'; x: number; y: number; text: string; color: string; size: number; script?: boolean }
type Ann = StrokeAnn | ShapeAnn | TextAnn
const isStroke = (a: Ann): a is StrokeAnn => a.kind === 'sketch' || a.kind === 'highlight'

interface Snap {
  base: HTMLCanvasElement
  anns: Ann[]
}

interface Doc extends Snap {
  undo: Snap[]
  redo: Snap[]
  dirty: boolean
  thumb?: string
  hasAlpha: boolean
}

type Tool = 'select' | 'alpha' | 'sketch' | 'highlight' | ShapeKind | 'text'
type Rect = { x: number; y: number; w: number; h: number }
type Sheet = null | 'size' | { kind: 'export'; note?: string }

const ZOOMS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32]
const COLORS = ['#000000', '#ffffff', '#8e8e93', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55']
const MAX_UNDO = 40
const SCRIPT_FONT = `'Snell Roundhand', 'Savoye LET', 'Brush Script MT', 'Segoe Script', cursive`
const SANS_FONT = `-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif`

const uid = () => Math.random().toString(36).slice(2, 10)
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 60))
const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')
const baseName = (name: string) => (name.lastIndexOf('.') > 0 ? name.slice(0, name.lastIndexOf('.')) : name)
const mimeFor = (ext: string) => (ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : null)
const KIND_LABEL: Record<string, string> = { png: 'PNG image', jpg: 'JPEG image', jpeg: 'JPEG image', gif: 'GIF image', webp: 'WebP image', heic: 'HEIF image', svg: 'SVG document', bmp: 'Windows BMP image', avif: 'AVIF image', ico: 'Windows icon image' }
const fail = (e: unknown) => os().notify({ app: 'preview', title: 'Preview', body: e instanceof Error ? e.message : String(e) })

function fsItem(path: string): Item | null {
  const node = resolve(path)
  if (!node || node.type !== 'file' || node.kind !== 'image') return null
  const { dir, name } = parentOf(path)
  return { key: path, name, url: nodeImageURL(name, node), size: node.size, modified: node.modified, where: dir.replace(HOME, '~'), src: { kind: 'fs', path } }
}

function driveItem(rel: string, size?: number, modified?: number): Item {
  const { dir, name } = parentOf(rel)
  return { key: 'drive:' + rel, name, url: drive.url(rel), size, modified, where: `PearDrive ${dir}`, src: { kind: 'drive', rel } }
}

export function localItems(files: File[]): Item[] {
  return files
    .filter((f) => f.type.startsWith('image/') || kindFor(f.name) === 'image')
    .map((f) => ({ key: 'local:' + uid(), name: f.name || 'Pasted Image.png', url: URL.createObjectURL(f), size: f.size, modified: f.lastModified || Date.now(), where: 'Your computer', src: { kind: 'local' as const } }))
}

function allFsImages(): Item[] {
  const out: Item[] = []
  const walk = (dir: string) => {
    const n = resolve(dir)
    if (!n || n.type !== 'dir') return
    for (const [name, c] of listDir(n)) {
      const p = `${dir}/${name}`
      if (c.type === 'dir') walk(p)
      else if (c.kind === 'image') {
        const it = fsItem(p)
        if (it) out.push(it)
      }
    }
  }
  walk(HOME)
  return out
}

// ---- Annotation geometry & rendering ------------------------------------------------------------

function smoothPath(pts: number[]) {
  if (pts.length < 4) return pts.length === 2 ? `M${pts[0]} ${pts[1]}l0.01 0` : ''
  let d = `M${pts[0]} ${pts[1]}`
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2
    const my = (pts[i + 1] + pts[i + 3]) / 2
    d += `Q${pts[i]} ${pts[i + 1]} ${mx} ${my}`
  }
  return d + `L${pts[pts.length - 2]} ${pts[pts.length - 1]}`
}

function arrowHead(a: { x1: number; y1: number; x2: number; y2: number; width: number }) {
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1)
  const len = Math.max(10, a.width * 4.5)
  const spread = 0.42
  return [a.x2, a.y2, a.x2 - len * Math.cos(ang - spread), a.y2 - len * Math.sin(ang - spread), a.x2 - len * Math.cos(ang + spread), a.y2 - len * Math.sin(ang + spread)]
}

const measurer = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d')! : null
const textFont = (a: { size: number; script?: boolean }) => `${a.script ? '' : '500 '}${a.size}px ${a.script ? SCRIPT_FONT : SANS_FONT}`

function textBox(a: TextAnn) {
  const lines = (a.text || ' ').split('\n')
  measurer!.font = textFont(a)
  const w = Math.max(a.size * 0.6, ...lines.map((l) => measurer!.measureText(l).width))
  return { x: a.x, y: a.y, w, h: lines.length * a.size * 1.2 }
}

function bbox(a: Ann): Rect {
  if (a.kind === 'text') return textBox(a)
  if (isStroke(a)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < a.pts.length; i += 2) {
      x0 = Math.min(x0, a.pts[i])
      x1 = Math.max(x1, a.pts[i])
      y0 = Math.min(y0, a.pts[i + 1])
      y1 = Math.max(y1, a.pts[i + 1])
    }
    const pad = (a.kind === 'highlight' ? a.width * 3 : a.width) / 2
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }
  }
  const pad = a.width / 2
  return { x: Math.min(a.x1, a.x2) - pad, y: Math.min(a.y1, a.y2) - pad, w: Math.abs(a.x2 - a.x1) + pad * 2, h: Math.abs(a.y2 - a.y1) + pad * 2 }
}

function moveAnn(a: Ann, dx: number, dy: number): Ann {
  if (a.kind === 'text') return { ...a, x: a.x + dx, y: a.y + dy }
  if (isStroke(a)) return { ...a, pts: a.pts.map((v, i) => v + (i % 2 ? dy : dx)) }
  return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
}

function drawAnn(c: CanvasRenderingContext2D, a: Ann) {
  c.save()
  c.lineCap = 'round'
  c.lineJoin = 'round'
  if (a.kind === 'text') {
    c.font = textFont(a)
    c.fillStyle = a.color
    c.textBaseline = 'alphabetic'
    a.text.split('\n').forEach((l, i) => c.fillText(l, a.x, a.y + a.size * (0.9 + i * 1.2)))
  } else if (isStroke(a)) {
    c.strokeStyle = a.color
    c.lineWidth = a.kind === 'highlight' ? a.width * 3 : a.width
    if (a.kind === 'highlight') {
      c.globalAlpha = 0.45
      c.globalCompositeOperation = 'multiply'
      c.lineCap = 'butt'
    }
    c.stroke(new Path2D(smoothPath(a.pts)))
  } else {
    c.strokeStyle = a.color
    c.lineWidth = a.width
    const p = new Path2D()
    if (a.kind === 'rect') p.rect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1))
    else if (a.kind === 'oval') p.ellipse((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2, Math.abs(a.x2 - a.x1) / 2, Math.abs(a.y2 - a.y1) / 2, 0, 0, Math.PI * 2)
    else {
      p.moveTo(a.x1, a.y1)
      p.lineTo(a.x2, a.y2)
    }
    if (a.fill && (a.kind === 'rect' || a.kind === 'oval')) {
      c.fillStyle = a.fill
      c.fill(p)
    }
    c.stroke(p)
    if (a.kind === 'arrow') {
      const h = arrowHead(a)
      c.beginPath()
      c.moveTo(h[0], h[1])
      c.lineTo(h[2], h[3])
      c.lineTo(h[4], h[5])
      c.closePath()
      c.fillStyle = a.color
      c.fill()
      c.stroke()
    }
  }
  c.restore()
}

const AnnSvg = memo(function AnnSvg({ a, hit, hidden }: { a: Ann; hit: number; hidden?: boolean }) {
  let el: React.ReactNode
  let hitEl: React.ReactNode
  if (a.kind === 'text') {
    const b = textBox(a)
    el = (
      <text x={a.x} y={a.y} fill={a.color} style={{ font: textFont(a) }} visibility={hidden ? 'hidden' : undefined}>
        {a.text.split('\n').map((l, i) => (
          <tspan key={i} x={a.x} y={a.y + a.size * (0.9 + i * 1.2)}>
            {l || ' '}
          </tspan>
        ))}
      </text>
    )
    hitEl = <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" />
  } else if (isStroke(a)) {
    const d = smoothPath(a.pts)
    el = <path d={d} fill="none" stroke={a.color} strokeWidth={a.kind === 'highlight' ? a.width * 3 : a.width} strokeLinecap={a.kind === 'highlight' ? 'butt' : 'round'} strokeLinejoin="round" opacity={a.kind === 'highlight' ? 0.45 : 1} style={a.kind === 'highlight' ? { mixBlendMode: 'multiply' } : undefined} />
    hitEl = <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(a.width * (a.kind === 'highlight' ? 3 : 1), hit)} />
  } else {
    const common = { stroke: a.color, strokeWidth: a.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
    const x = Math.min(a.x1, a.x2)
    const y = Math.min(a.y1, a.y2)
    const w = Math.abs(a.x2 - a.x1)
    const h = Math.abs(a.y2 - a.y1)
    const fill = a.fill ?? 'none'
    if (a.kind === 'rect') {
      el = <rect x={x} y={y} width={w} height={h} fill={fill} {...common} />
      hitEl = <rect x={x} y={y} width={w} height={h} fill={a.fill ? 'transparent' : 'none'} stroke="transparent" strokeWidth={Math.max(a.width, hit)} />
    } else if (a.kind === 'oval') {
      el = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={fill} {...common} />
      hitEl = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={a.fill ? 'transparent' : 'none'} stroke="transparent" strokeWidth={Math.max(a.width, hit)} />
    } else {
      const head = a.kind === 'arrow' ? arrowHead(a) : null
      el = (
        <>
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} {...common} />
          {head && <polygon points={head.join(' ')} fill={a.color} {...common} />}
        </>
      )
      hitEl = <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={Math.max(a.width, hit)} />
    }
  }
  return (
    <g data-ann={a.id} className="pv-ann">
      {el}
      {hitEl}
    </g>
  )
})

function flatten(d: Snap) {
  if (!d.anns.length) return d.base
  const out = copyCanvas(d.base)
  const c = out.getContext('2d')!
  for (const a of d.anns) drawAnn(c, a)
  return out
}

// ---- Controllers (menu bar ↔ window) ------------------------------------------------------------

interface Ctl {
  ready: boolean
  dirty: boolean
  sidebar: boolean
  markup: boolean
  canUndo: boolean
  canRedo: boolean
  hasSel: boolean
  run(cmd: Cmd): void
}

type Cmd =
  | 'open' | 'clipboard' | 'save' | 'export' | 'print' | 'close'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'delete' | 'selectAll' | 'deselect'
  | 'actual' | 'fit' | 'zoomIn' | 'zoomOut' | 'sidebar' | 'markup' | 'slideshow' | 'next' | 'prev'
  | 'inspector' | 'adjustColor' | 'adjustSize' | 'rotL' | 'rotR' | 'flipH' | 'flipV' | 'crop' | 'autoLevels' | 'alpha' | 'sign'

const ctls = new Map<string, Ctl>()

export function previewMenus(): MenuDef[] {
  const id = os().focused ?? ''
  const c = ctls.get(id)
  const run = (cmd: Cmd) => () => c?.run(cmd)
  const img = !!c?.ready
  return [
    {
      title: 'File',
      items: [
        { label: 'New from Clipboard', shortcut: '⌘N', action: run('clipboard') },
        { label: 'Open…', shortcut: '⌘O', action: run('open') },
        'sep',
        { label: 'Close Window', shortcut: '⌘W', action: run('close') },
        { label: 'Save', shortcut: '⌘S', disabled: !img, action: run('save') },
        { label: 'Export…', shortcut: '⇧⌘S', disabled: !img, action: run('export') },
        'sep',
        { label: 'Print…', shortcut: '⌘P', disabled: !img, action: run('print') },
      ],
    },
    {
      title: 'Edit',
      items: [
        { label: 'Undo', shortcut: '⌘Z', disabled: !c?.canUndo, action: run('undo') },
        { label: 'Redo', shortcut: '⇧⌘Z', disabled: !c?.canRedo, action: run('redo') },
        'sep',
        { label: 'Cut', shortcut: '⌘X', disabled: !c?.hasSel, action: run('cut') },
        { label: 'Copy', shortcut: '⌘C', disabled: !img, action: run('copy') },
        { label: 'Delete', shortcut: '⌫', disabled: !c?.hasSel, action: run('delete') },
        { label: 'Select All', shortcut: '⌘A', disabled: !img, action: run('selectAll') },
        { label: 'Deselect All', shortcut: '⌥⌘A', disabled: !c?.hasSel, action: run('deselect') },
        'sep',
        { label: 'Insert', submenu: [{ label: 'Signature', disabled: !img, action: run('sign') }] },
      ],
    },
    {
      title: 'View',
      items: [
        { label: 'Thumbnails', shortcut: '⌥⌘2', checked: c?.sidebar, action: run('sidebar') },
        'sep',
        { label: 'Actual Size', shortcut: '⌘0', disabled: !img, action: run('actual') },
        { label: 'Zoom to Fit', shortcut: '⌘9', disabled: !img, action: run('fit') },
        { label: 'Zoom In', shortcut: '⌘+', disabled: !img, action: run('zoomIn') },
        { label: 'Zoom Out', shortcut: '⌘−', disabled: !img, action: run('zoomOut') },
        'sep',
        { label: c?.markup ? 'Hide Markup Toolbar' : 'Show Markup Toolbar', shortcut: '⇧⌘A', disabled: !img, action: run('markup') },
        'sep',
        { label: 'Slideshow', shortcut: '⇧⌘F', disabled: !img, action: run('slideshow') },
      ],
    },
    {
      title: 'Go',
      items: [
        { label: 'Previous', shortcut: '↑', action: run('prev') },
        { label: 'Next', shortcut: '↓', action: run('next') },
      ],
    },
    {
      title: 'Tools',
      items: [
        { label: 'Show Inspector', shortcut: '⌘I', disabled: !img, action: run('inspector') },
        'sep',
        { label: 'Adjust Color…', shortcut: '⌥⌘C', disabled: !img, action: run('adjustColor') },
        { label: 'Adjust Size…', disabled: !img, action: run('adjustSize') },
        { label: 'Auto Levels', disabled: !img, action: run('autoLevels') },
        'sep',
        { label: 'Rotate Left', shortcut: '⌘L', disabled: !img, action: run('rotL') },
        { label: 'Rotate Right', shortcut: '⌘R', disabled: !img, action: run('rotR') },
        { label: 'Flip Horizontal', disabled: !img, action: run('flipH') },
        { label: 'Flip Vertical', disabled: !img, action: run('flipV') },
        'sep',
        { label: 'Crop', shortcut: '⌘K', disabled: !c?.hasSel, action: run('crop') },
        { label: 'Instant Alpha', disabled: !img, action: run('alpha') },
      ],
    },
    {
      title: 'Window',
      items: [
        { label: 'Minimize', shortcut: '⌘M', action: () => id && os().minimize(id) },
        { label: 'Zoom', action: (w) => w && os().tileWindow(w.id, w.tile === 'fill' ? null : 'fill') },
      ],
    },
    { title: 'Help', items: [{ label: 'Preview Help', action: () => os().notify({ app: 'preview', title: 'Preview Help', body: 'Drag to select, ⌘K to crop, ⇧⌘A for Markup. Everything else is a button with a picture on it.' }) }] },
  ]
}

// ---- Small UI pieces ----------------------------------------------------------------------------

function Popover({ anchor, onClose, children }: { anchor: DOMRect; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const down = (e: PointerEvent) => !(e.target as Element).closest('.pv-pop') && onClose()
    const t = setTimeout(() => window.addEventListener('pointerdown', down, true))
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', down, true)
    }
  }, [onClose])
  return createPortal(
    <div className="pv-pop glass" style={{ left: Math.max(8, anchor.left + anchor.width / 2 - 100), top: anchor.bottom + 6 }} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  )
}

function Swatches({ value, onPick, allowNone }: { value: string | null; onPick: (c: string | null) => void; allowNone?: boolean }) {
  return (
    <div className="pv-swatches">
      {allowNone && (
        <button className={`pv-sw none ${value === null ? 'on' : ''}`} onClick={() => onPick(null)} aria-label="No fill">
          <span />
        </button>
      )}
      {COLORS.map((c) => (
        <button key={c} className={`pv-sw ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onPick(c)} aria-label={c} />
      ))}
      <label className="pv-sw custom" title="Other colors…">
        <input type="color" value={value ?? '#000000'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

function Slider({ label, value, min, max, onChange, center = 0 }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; center?: number }) {
  const pct = ((value - min) / (max - min)) * 100
  const c = ((center - min) / (max - min)) * 100
  return (
    <label className="pv-slider" onDoubleClick={() => onChange(center)}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 400}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ background: `linear-gradient(to right, var(--line) ${Math.min(pct, c)}%, var(--accent) ${Math.min(pct, c)}%, var(--accent) ${Math.max(pct, c)}%, var(--line) ${Math.max(pct, c)}%)` }}
      />
    </label>
  )
}

function Levels({ hist, a, set }: { hist: Uint32Array | null; a: Adjust; set: (p: Partial<Adjust>) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const paths = useMemo(() => {
    if (!hist) return null
    let max = 1
    const sm = (o: number) => Array.from({ length: 256 }, (_, i) => hist[o + i])
    const ch = [0, 256, 512].map(sm)
    for (const c of ch) for (const v of c) max = Math.max(max, v)
    max = Math.sqrt(max)
    return ch.map((c) => 'M0 64 ' + c.map((v, i) => `L${(i / 255) * 200} ${64 - (Math.sqrt(v) / max) * 62}`).join(' ') + ' L200 64Z')
  }, [hist])
  const mid = a.black + Math.pow(0.5, a.gamma) * (a.white - a.black)
  const drag = (which: 'black' | 'mid' | 'white') => (e: React.PointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const r = track.current!.getBoundingClientRect()
      const t = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      if (which === 'black') set({ black: Math.min(t, a.white - 0.02) })
      else if (which === 'white') set({ white: Math.max(t, a.black + 0.02) })
      else {
        const n = Math.min(0.97, Math.max(0.03, (t - a.black) / (a.white - a.black)))
        set({ gamma: Math.log(n) / Math.log(0.5) })
      }
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div className="pv-levels">
      <svg viewBox="0 0 200 64" preserveAspectRatio="none">
        {paths?.map((d, i) => (
          <path key={i} d={d} fill={['#ff3b30', '#34c759', '#0a84ff'][i]} opacity=".55" style={{ mixBlendMode: 'screen' }} />
        ))}
      </svg>
      <div className="pv-levels-track" ref={track}>
        <i className="lv black" style={{ left: `${a.black * 100}%` }} onPointerDown={drag('black')} />
        <i className="lv mid" style={{ left: `${mid * 100}%` }} onPointerDown={drag('mid')} />
        <i className="lv white" style={{ left: `${a.white * 100}%` }} onPointerDown={drag('white')} />
      </div>
    </div>
  )
}

function Slideshow({ items, start, onClose }: { items: Item[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  const [playing, setPlaying] = useState(true)
  const [chrome, setChrome] = useState(true)
  const idle = useRef<number | undefined>(undefined)
  const n = items.length
  useEffect(() => {
    if (!playing || n < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % n), 4000)
    return () => clearInterval(t)
  }, [playing, n])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setI((x) => (x + 1) % n)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setI((x) => (x - 1 + n) % n)
      else if (e.key === ' ') setPlaying((p) => !p)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', k, true)
    document.documentElement.requestFullscreen?.().catch(() => {})
    return () => {
      window.removeEventListener('keydown', k, true)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [n, onClose])
  const poke = () => {
    setChrome(true)
    clearTimeout(idle.current)
    idle.current = window.setTimeout(() => setChrome(false), 2200)
  }
  return createPortal(
    <div className={`pv-show ${chrome ? '' : 'idle'}`} onPointerMove={poke} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((it, k) => (
        <img key={it.key} src={it.url} alt={it.name} className={k === i ? 'on' : ''} draggable={false} />
      ))}
      <div className="pv-show-bar glass" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => setI((i - 1 + n) % n)} aria-label="Previous">
          <ChevronLeft size={20} />
        </button>
        <button onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <button onClick={() => setI((i + 1) % n)} aria-label="Next">
          <ChevronRight size={20} />
        </button>
        <span className="pv-show-count">
          {i + 1} of {n}
        </span>
        <button onClick={onClose} aria-label="Exit slideshow">
          <X size={18} />
        </button>
      </div>
    </div>,
    document.body,
  )
}

function OpenPanel({ onPick, onBrowse }: { onPick: (it: Item) => void; onBrowse: () => void }) {
  useOS((s) => s.fsVersion)
  const items = allFsImages()
  return (
    <div className="pv-open">
      <div className="pv-open-card">
        <h2>Open an image</h2>
        <p>Drop images anywhere in this window, paste one with ⌘V, or pick something below.</p>
        <div className="pv-open-grid">
          {items.map((it) => (
            <button key={it.key} className="pv-open-item" onDoubleClick={() => onPick(it)} onClick={() => onPick(it)}>
              <span className="pv-open-thumb">
                <img src={it.url} alt="" draggable={false} />
              </span>
              <span className="pv-open-name">{it.name}</span>
              <small>{it.where}</small>
            </button>
          ))}
        </div>
        <div className="pv-open-actions">
          <button className="btn primary" onClick={onBrowse}>
            <FolderOpen size={14} /> Choose from Your Computer…
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- The app ------------------------------------------------------------------------------------

export function Preview({ win }: { win: Win }) {
  const authed = useBackend((s) => s.authed)
  const [items, setItems] = useState<Item[]>(() => {
    const p = win.props
    if (typeof p.path === 'string') {
      const { dir } = parentOf(p.path)
      const n = resolve(dir)
      const sibs = n?.type === 'dir' ? listDir(n).map(([name]) => fsItem(`${dir}/${name}`)).filter((x): x is Item => !!x) : []
      return sibs.length ? sibs : [fsItem(p.path)].filter((x): x is Item => !!x)
    }
    if (typeof p.drive === 'string') return [driveItem(p.drive)]
    if (Array.isArray(p.items)) return p.items as Item[]
    return []
  })
  const [cur, setCur] = useState<string | null>(() => (typeof win.props.path === 'string' ? win.props.path : typeof win.props.drive === 'string' ? 'drive:' + win.props.drive : ((win.props.items as Item[] | undefined)?.[0]?.key ?? null)))
  const docs = useRef(new Map<string, Doc>())
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const [error, setError] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState(items.length > 1)
  const [markup, setMarkup] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<ShapeKind>('rect')
  const [color, setColor] = useState('#ff3b30')
  const [fill, setFill] = useState<string | null>(null)
  const [weight, setWeight] = useState(3)
  const [textSize, setTextSize] = useState(1)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [view, setView] = useState({ w: 600, h: 400 })
  const [sel, setSel] = useState<Rect | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [draft, setDraft] = useState<Ann | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adjust, setAdjust] = useState<Adjust | null>(null)
  const [hist, setHist] = useState<Uint32Array | null>(null)
  const [inspector, setInspector] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [pop, setPop] = useState<{ kind: 'stroke' | 'fill' | 'text'; rect: DOMRect } | null>(null)
  const [show, setShow] = useState(false)
  const [dropping, setDropping] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  // Mounts the bitmap. Canvases are immutable, so swapping the element is the whole "render".
  const host = (el: HTMLDivElement | null) => {
    if (el && doc && el.firstChild !== doc.base) el.replaceChildren(doc.base)
  }
  const live = useRef<HTMLCanvasElement>(null)
  const alphaLayer = useRef<HTMLCanvasElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const anchor = useRef<{ ix: number; iy: number; cx: number; cy: number } | null>(null)

  const item = items.find((i) => i.key === cur) ?? null
  const doc = cur ? docs.current.get(cur) : undefined
  const idx = item ? items.indexOf(item) : -1
  const isVideo = item ? kindFor(item.name) === 'video' : false
  const W = doc?.base.width ?? 0
  const H = doc?.base.height ?? 0
  const unit = Math.max(1, Math.max(W, H) / 900)
  const fitScale = W ? Math.min(1, (view.w - 48) / W, (view.h - 48) / H) : 1
  const s = zoom === 'fit' ? Math.max(0.02, fitScale) : zoom

  // Load the current item into a bitmap the first time it's shown.
  useEffect(() => {
    if (!item || isVideo || docs.current.has(item.key)) return
    let live = true
    setError(null)
    loadImage(item.url)
      .then((img) => {
        if (!live) return
        const w = img.naturalWidth || 1024
        const h = img.naturalHeight || 768
        const ext = extOf(item.name)
        docs.current.set(item.key, { base: fromImage(img, w, h), anns: [], undo: [], redo: [], dirty: false, hasAlpha: ['png', 'gif', 'webp', 'svg', 'ico', 'avif'].includes(ext) })
        rerender()
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [item?.key, item?.url, isVideo])

  // PearDrive: fill the sidebar with the other images in the same folder.
  useEffect(() => {
    const rel = win.props.drive
    if (typeof rel !== 'string') return
    const { dir } = parentOf(rel)
    drive
      .list(dir)
      .then((entries) => {
        const imgs = entries.filter((e) => !e.dir && kindFor(e.name) === 'image').map((e) => driveItem(`${dir === '/' ? '' : dir}/${e.name}`, e.size, e.modified))
        if (imgs.length > 1) {
          setItems((prev) => [...imgs, ...prev.filter((p) => !imgs.some((i) => i.key === p.key))])
          setSidebar(true)
        }
      })
      .catch(() => {})
  }, [])

  // Title follows the document.
  useEffect(() => {
    os().setTitle(win.id, item ? `${item.name}${doc?.dirty ? ' — Edited' : ''}` : 'Preview')
  }, [item?.name, doc?.dirty])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [!!doc])

  // Keep the point under the cursor fixed while zooming.
  useLayoutEffect(() => {
    const a = anchor.current
    const el = scroller.current
    if (!a || !el || !wrap.current) return
    anchor.current = null
    const r = wrap.current.getBoundingClientRect()
    const c = el.getBoundingClientRect()
    el.scrollLeft += r.left + a.ix * s - (c.left + a.cx)
    el.scrollTop += r.top + a.iy * s - (c.top + a.cy)
  }, [s])

  // Reset transient state when switching images.
  useEffect(() => {
    setSel(null)
    setPicked(null)
    setEditing(null)
    setAdjust(null)
    setZoom('fit')
  }, [cur])

  // Live Adjust Color preview on the GPU.
  useEffect(() => {
    if (!adjust || !doc || !live.current) return
    const c = live.current
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    const raf = requestAnimationFrame(() => previewInto(c, doc.base, adjust))
    return () => cancelAnimationFrame(raf)
  }, [adjust, doc?.base])

  // ---- document mutations ----

  const commit = useCallback(
    (next: Partial<Snap>, opts: { keepSel?: boolean } = {}) => {
      if (!cur) return
      const d = docs.current.get(cur)
      if (!d) return
      d.undo = [...d.undo.slice(-MAX_UNDO + 1), { base: d.base, anns: d.anns }]
      d.redo = []
      if (next.base) d.base = next.base
      if (next.anns) d.anns = next.anns
      d.dirty = true
      if (next.base && !opts.keepSel) setSel(null)
      const key = cur
      idle(() => {
        const dd = docs.current.get(key)
        if (dd) {
          dd.thumb = thumbnail(flatten(dd), 200).toDataURL()
          rerender()
        }
      })
      rerender()
    },
    [cur],
  )

  const step = (dir: 'undo' | 'redo') => {
    if (!doc) return
    const from = dir === 'undo' ? doc.undo : doc.redo
    const to = dir === 'undo' ? doc.redo : doc.undo
    const snap = from.pop()
    if (!snap) return
    to.push({ base: doc.base, anns: doc.anns })
    doc.base = snap.base
    doc.anns = snap.anns
    doc.dirty = true
    doc.thumb = thumbnail(flatten(doc), 200).toDataURL()
    setPicked(null)
    setSel(null)
    rerender()
  }

  const bake = () => (doc ? flatten(doc) : null)

  const geometry = (op: Parameters<typeof process>[1]) => {
    const flat = bake()
    if (!flat) return
    commit({ base: process(flat, op), anns: [] })
    setPicked(null)
  }

  const updateAnn = (id: string, fn: (a: Ann) => Ann, record = true) => {
    if (!doc) return
    const anns = doc.anns.map((a) => (a.id === id ? fn(a) : a))
    if (record) commit({ anns })
    else {
      doc.anns = anns
      rerender()
    }
  }

  const removeAnn = (id: string) => doc && commit({ anns: doc.anns.filter((a) => a.id !== id) })

  const styleChanged = (p: { color?: string; fill?: string | null; weight?: number; textSize?: number }) => {
    if (p.color !== undefined) setColor(p.color)
    if (p.fill !== undefined) setFill(p.fill)
    if (p.weight !== undefined) setWeight(p.weight)
    if (p.textSize !== undefined) setTextSize(p.textSize)
    if (!picked) return
    updateAnn(picked, (a) => {
      if (a.kind === 'text') return { ...a, color: p.color ?? a.color, size: p.textSize !== undefined ? Math.round(unit * 28 * p.textSize) : a.size }
      if (isStroke(a)) return { ...a, color: p.color ?? a.color, width: p.weight !== undefined ? unit * p.weight : a.width }
      return { ...a, color: p.color ?? a.color, fill: p.fill !== undefined ? p.fill : a.fill, width: p.weight !== undefined ? unit * p.weight : a.width }
    })
  }

  // ---- selection, clipboard ----

  const copyImage = async () => {
    const flat = bake()
    if (!flat) return
    const out = sel ? crop(flat, sel) : flat
    try {
      const blob = await encode(out)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      os().notify({ app: 'preview', title: 'Copied', body: `${out.width} × ${out.height} image copied to the clipboard.` })
    } catch {
      fail('Your browser wouldn’t let Preview touch the clipboard.')
    }
  }

  const clearSelection = () => {
    if (!doc || !sel) return
    const out = copyCanvas(doc.base)
    out.getContext('2d')!.clearRect(sel.x, sel.y, sel.w, sel.h)
    doc.hasAlpha = true
    commit({ base: out })
  }

  const addItems = (list: Item[]) => {
    if (!list.length) return
    setItems((prev) => [...prev, ...list])
    setCur(list[0].key)
    if (items.length + list.length > 1) setSidebar(true)
  }

  const fromClipboard = async () => {
    try {
      const entries = await navigator.clipboard.read()
      for (const e of entries) {
        const type = e.types.find((t) => t.startsWith('image/'))
        if (type) {
          const blob = await e.getType(type)
          addItems(localItems([new File([blob], `Clipboard ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.png`, { type })]))
          return
        }
      }
      fail('There’s no image on the clipboard. There is, however, a sense of anticipation.')
    } catch {
      fail('Your browser wouldn’t let Preview read the clipboard. Try pasting with ⌘V instead.')
    }
  }

  // ---- saving ----

  const save = async () => {
    if (!item || !doc) return
    const mime = mimeFor(extOf(item.name))
    if (item.src.kind === 'local') return setSheet({ kind: 'export', note: 'This image came from your computer. Export a copy to keep your changes.' })
    if (!mime) return setSheet({ kind: 'export', note: `Preview can’t write ${extOf(item.name).toUpperCase()} files. Export a copy in another format instead.` })
    try {
      const blob = await encode(flatten(doc), mime, 0.92)
      if (item.src.kind === 'fs') {
        const node = resolve(item.src.path) as FileNode | null
        if (!node) throw new Error('The original file has been moved or deleted.')
        node.content = await blobToDataURL(blob)
        node.size = blob.size
        node.modified = Date.now()
        os().bumpFs()
      } else {
        await drive.write(item.src.rel, blob)
        bumpDrive()
      }
      doc.dirty = false
      rerender()
    } catch (e) {
      fail(e)
    }
  }

  // ---- tools ----

  const runAutoLevels = () => {
    if (!doc) return
    setHist(histogram(doc.base))
    const [black, white, gamma] = autoLevels()
    if (adjust) setAdjust({ ...adjust, black, white, gamma })
    else commit({ base: process(doc.base, { adjust: { ...NEUTRAL, black, white, gamma } }) })
  }

  const openAdjust = () => {
    if (!doc) return
    setHist(histogram(doc.base))
    setAdjust(adjust ?? { ...NEUTRAL })
  }

  const closeAdjust = (apply: boolean) => {
    if (apply && adjust && doc && !isNeutral(adjust)) commit({ base: process(doc.base, { adjust }) }, { keepSel: true })
    setAdjust(null)
  }

  const insertSignature = () => {
    if (!doc) return
    const size = Math.round(unit * 64)
    const a: Ann = { id: uid(), kind: 'text', text: 'Pear User', script: true, color: '#1d3b8f', size, x: W / 2 - size * 2.2, y: H / 2 - size / 2 }
    commit({ anns: [...doc.anns, a] })
    setMarkup(true)
    setTool('select')
    setPicked(a.id)
  }

  // ---- pointer interaction on the canvas ----

  const toImage = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }
  }
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))

  const onCanvasDown = (e: React.PointerEvent) => {
    if (!doc || e.button !== 0 || adjust) return
    e.stopPropagation()
    os().focus(win.id)
    const target = e.currentTarget as HTMLElement
    const start = toImage(e)
    const annEl = (e.target as Element).closest('[data-ann]')
    if (editing) return
    target.setPointerCapture(e.pointerId)
    let moved = false
    const listen = (move: (p: { x: number; y: number }, ev: PointerEvent) => void, up: (p: { x: number; y: number }, ev: PointerEvent) => void) => {
      const m = (ev: PointerEvent) => {
        moved = true
        move(toImage(ev), ev)
      }
      const u = (ev: PointerEvent) => {
        target.removeEventListener('pointermove', m)
        target.removeEventListener('pointerup', u)
        up(toImage(ev), ev)
      }
      target.addEventListener('pointermove', m)
      target.addEventListener('pointerup', u)
    }

    if (tool === 'select' && annEl) {
      const id = annEl.getAttribute('data-ann')!
      setPicked(id)
      setSel(null)
      const orig = doc.anns.find((a) => a.id === id)!
      const before = doc.anns
      if (e.detail === 2 && orig.kind === 'text') return setEditing(id)
      listen(
        (p) => updateAnn(id, () => moveAnn(orig, p.x - start.x, p.y - start.y), false),
        () => {
          if (!moved) return
          const after = doc.anns
          doc.anns = before
          commit({ anns: after })
        },
      )
      return
    }

    if (tool === 'select') {
      setPicked(null)
      if (sel && start.x >= sel.x && start.x <= sel.x + sel.w && start.y >= sel.y && start.y <= sel.y + sel.h && e.detail < 2) {
        // Drag an existing selection around.
        const o = sel
        listen(
          (p) => setSel({ ...o, x: clamp(o.x + p.x - start.x, W - o.w), y: clamp(o.y + p.y - start.y, H - o.h) }),
          () => {},
        )
        return
      }
      const sx = clamp(start.x, W)
      const sy = clamp(start.y, H)
      setSel(null)
      listen(
        (p, ev) => {
          let x = clamp(p.x, W)
          let y = clamp(p.y, H)
          if (ev.shiftKey) {
            const d = Math.min(Math.abs(x - sx), Math.abs(y - sy))
            x = sx + Math.sign(x - sx) * d
            y = sy + Math.sign(y - sy) * d
          }
          setSel({ x: Math.round(Math.min(sx, x)), y: Math.round(Math.min(sy, y)), w: Math.round(Math.abs(x - sx)), h: Math.round(Math.abs(y - sy)) })
        },
        (p) => {
          if (Math.abs(p.x - start.x) * s < 3 && Math.abs(p.y - start.y) * s < 3) setSel(null)
        },
      )
      return
    }

    if (tool === 'alpha') {
      const layer = alphaLayer.current!
      const sx = Math.floor(clamp(start.x, W - 1))
      const sy = Math.floor(clamp(start.y, H - 1))
      let tol = 20
      try {
        alphaPreview(doc.base, sx, sy, tol, layer)
      } catch (err) {
        return fail(err)
      }
      layer.hidden = false
      let pending = 0
      listen(
        (_p, ev) => {
          tol = Math.min(255, Math.max(0, 20 + Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) * 0.5))
          cancelAnimationFrame(pending)
          pending = requestAnimationFrame(() => alphaPreview(doc.base, sx, sy, tol, layer))
        },
        () => {
          cancelAnimationFrame(pending)
          alphaPreview(doc.base, sx, sy, tol, layer)
          layer.hidden = true
          doc.hasAlpha = true
          commit({ base: applyAlpha(doc.base) })
          setTool('select')
        },
      )
      return
    }

    if (tool === 'text') {
      e.preventDefault()
      const a: Ann = { id: uid(), kind: 'text', x: start.x, y: start.y - unit * 14 * textSize, text: '', color, size: Math.round(unit * 28 * textSize) }
      doc.anns = [...doc.anns, a]
      setEditing(a.id)
      setPicked(a.id)
      rerender()
      return
    }

    const width = unit * weight
    if (tool === 'sketch' || tool === 'highlight') {
      const pts = [start.x, start.y]
      const a = { id: uid(), kind: tool, pts, color: tool === 'highlight' && color === '#ff3b30' ? '#ffcc00' : color, width } as Ann
      setDraft(a)
      listen(
        (p) => {
          pts.push(p.x, p.y)
          setDraft({ ...a, pts: [...pts] } as Ann)
        },
        () => {
          setDraft(null)
          commit({ anns: [...doc.anns, { ...a, pts } as Ann] })
        },
      )
      return
    }

    const kind = tool as ShapeKind
    const base: ShapeAnn = { id: uid(), kind, x1: start.x, y1: start.y, x2: start.x, y2: start.y, color, fill: kind === 'rect' || kind === 'oval' ? fill : null, width }
    setDraft(base)
    let last = base
    listen(
      (p, ev) => {
        let { x, y } = p
        if (ev.shiftKey) {
          if (kind === 'line' || kind === 'arrow') {
            const ang = Math.round(Math.atan2(y - start.y, x - start.x) / (Math.PI / 4)) * (Math.PI / 4)
            const len = Math.hypot(x - start.x, y - start.y)
            x = start.x + Math.cos(ang) * len
            y = start.y + Math.sin(ang) * len
          } else {
            const d = Math.max(Math.abs(x - start.x), Math.abs(y - start.y))
            x = start.x + Math.sign(x - start.x || 1) * d
            y = start.y + Math.sign(y - start.y || 1) * d
          }
        }
        last = { ...base, x2: x, y2: y }
        setDraft(last)
      },
      () => {
        setDraft(null)
        if (!moved) return
        commit({ anns: [...doc.anns, last] })
        setPicked(last.id)
      },
    )
  }

  const onWheel = useCallback(
    (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !W) return
      e.preventDefault()
      const c = scroller.current!.getBoundingClientRect()
      const p = toImage(e)
      anchor.current = { ix: p.x, iy: p.y, cx: e.clientX - c.left, cy: e.clientY - c.top }
      setZoom(Math.min(32, Math.max(0.02, s * Math.exp(-e.deltaY * 0.01))))
    },
    [s, W],
  )
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const zoomBy = (dir: 1 | -1) => {
    const el = scroller.current
    if (el && wrap.current) {
      const c = el.getBoundingClientRect()
      const p = toImage({ clientX: c.left + c.width / 2, clientY: c.top + c.height / 2 })
      anchor.current = { ix: clamp(p.x, W), iy: clamp(p.y, H), cx: c.width / 2, cy: c.height / 2 }
    }
    const next = dir > 0 ? ZOOMS.find((z) => z > s + 1e-3) ?? 32 : [...ZOOMS].reverse().find((z) => z < s - 1e-3) ?? 0.05
    setZoom(next)
  }

  const go = (d: 1 | -1) => {
    if (items.length < 2 || idx < 0) return
    setCur(items[(idx + d + items.length) % items.length].key)
  }

  // ---- commands ----

  const run = (cmd: Cmd) => {
    const needDoc: Cmd[] = ['save', 'export', 'print', 'copy', 'selectAll', 'actual', 'fit', 'zoomIn', 'zoomOut', 'markup', 'slideshow', 'inspector', 'adjustColor', 'adjustSize', 'rotL', 'rotR', 'flipH', 'flipV', 'autoLevels', 'alpha', 'sign']
    if (needDoc.includes(cmd) && !doc) return
    switch (cmd) {
      case 'open': return picker.current?.click()
      case 'clipboard': return void fromClipboard()
      case 'save': return void save()
      case 'export': return setSheet({ kind: 'export' })
      case 'print': return os().notify({ app: 'preview', title: 'Print', body: 'No printers found. There never were. (Try Export… and print it from your actual computer.)' })
      case 'close': return os().closeWindow(win.id)
      case 'undo': return step('undo')
      case 'redo': return step('redo')
      case 'cut':
        void copyImage().then(clearSelection)
        return
      case 'copy': return void copyImage()
      case 'delete':
        if (picked) {
          removeAnn(picked)
          setPicked(null)
        } else clearSelection()
        return
      case 'selectAll': return setSel({ x: 0, y: 0, w: W, h: H })
      case 'deselect':
        setSel(null)
        setPicked(null)
        return
      case 'actual': return setZoom(1)
      case 'fit': return setZoom('fit')
      case 'zoomIn': return zoomBy(1)
      case 'zoomOut': return zoomBy(-1)
      case 'sidebar': return setSidebar(!sidebar)
      case 'markup':
        setMarkup(!markup)
        if (markup) setTool('select')
        return
      case 'slideshow': return setShow(true)
      case 'next': return go(1)
      case 'prev': return go(-1)
      case 'inspector': return setInspector(!inspector)
      case 'adjustColor': return adjust ? closeAdjust(true) : openAdjust()
      case 'adjustSize': return setSheet('size')
      case 'rotL': return geometry({ rotate: 3 })
      case 'rotR': return geometry({ rotate: 1 })
      case 'flipH': return geometry({ flipH: true })
      case 'flipV': return geometry({ flipV: true })
      case 'crop':
        if (sel && sel.w > 0 && sel.h > 0) {
          const flat = bake()!
          commit({ base: crop(flat, sel), anns: [] })
          setZoom('fit')
        }
        return
      case 'autoLevels': return runAutoLevels()
      case 'alpha':
        setMarkup(true)
        return setTool('alpha')
      case 'sign': return insertSignature()
    }
  }

  const runRef = useRef(run)
  runRef.current = run
  const state = { ready: !!doc, dirty: !!doc?.dirty, sidebar, markup, canUndo: !!doc?.undo.length, canRedo: !!doc?.redo.length, hasSel: !!sel || !!picked }
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    const c: Ctl = {
      get ready() { return stateRef.current.ready },
      get dirty() { return stateRef.current.dirty },
      get sidebar() { return stateRef.current.sidebar },
      get markup() { return stateRef.current.markup },
      get canUndo() { return stateRef.current.canUndo },
      get canRedo() { return stateRef.current.canRedo },
      get hasSel() { return stateRef.current.hasSel },
      run: (cmd) => runRef.current(cmd),
    }
    ctls.set(win.id, c)
    return () => {
      ctls.delete(win.id)
      cancelAlpha()
    }
  }, [win.id])

  // Keyboard shortcuts, paste and drop — only for the focused Preview window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (os().focused !== win.id || show) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      const cmd = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      let c: Cmd | null = null
      if (cmd && e.altKey && e.code === 'KeyC') c = 'adjustColor'
      else if (cmd && e.altKey && e.code === 'KeyA') c = 'deselect'
      else if (cmd && e.altKey && e.code === 'Digit2') c = 'sidebar'
      else if (cmd && e.shiftKey && k === 'a') c = 'markup'
      else if (cmd && e.shiftKey && k === 'f') c = 'slideshow'
      else if (cmd && e.shiftKey && k === 's') c = 'export'
      else if (cmd && e.shiftKey && k === 'z') c = 'redo'
      else if (cmd && !e.altKey) {
        const map: Record<string, Cmd> = { o: 'open', s: 'save', p: 'print', z: 'undo', c: 'copy', x: 'cut', a: 'selectAll', k: 'crop', l: 'rotL', r: 'rotR', i: 'inspector', '0': 'actual', '9': 'fit', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', n: 'clipboard' }
        c = map[k] ?? null
        if (k === 'c' && window.getSelection()?.toString()) c = null
      } else if (!e.altKey) {
        if (k === 'backspace' || k === 'delete') c = 'delete'
        else if (k === 'escape') {
          if (adjust) closeAdjust(false)
          else if (tool !== 'select') setTool('select')
          else c = 'deselect'
        } else if ((k === 'arrowdown' || k === 'arrowright') && !picked) c = 'next'
        else if ((k === 'arrowup' || k === 'arrowleft') && !picked) c = 'prev'
        else if (picked && k.startsWith('arrow') && doc) {
          const d = (e.shiftKey ? 10 : 1) * unit
          const [dx, dy] = k === 'arrowleft' ? [-d, 0] : k === 'arrowright' ? [d, 0] : k === 'arrowup' ? [0, -d] : [0, d]
          updateAnn(picked, (a) => moveAnn(a, dx, dy))
          e.preventDefault()
        }
      }
      if (c) {
        e.preventDefault()
        e.stopPropagation()
        runRef.current(c)
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (os().focused !== win.id || isTextTarget(e.target)) return
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        addItems(localItems(files))
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  })

  // ---- render ----

  const ShapeIcon = { line: Minus, arrow: MoveUpRight, rect: Square, oval: Circle }[shape]
  const tb = (t: Tool, label: string, Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>) => (
    <button className={`pv-tool ${tool === t ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={tool === t} onClick={() => setTool(tool === t ? 'select' : t)}>
      <Icon size={16} strokeWidth={1.8} />
    </button>
  )
  const pickedAnn = picked ? doc?.anns.find((a) => a.id === picked) : undefined
  const editingAnn = editing ? (doc?.anns.find((a) => a.id === editing) as TextAnn | undefined) : undefined
  const subtitle = !item ? '' : isVideo ? item.where : doc ? `${items.length > 1 ? `${idx + 1} of ${items.length} · ` : ''}${W.toLocaleString()} × ${H.toLocaleString()}${s !== 1 ? ` · ${Math.round(s * 100)}%` : ''}` : error ? 'Couldn’t open' : 'Opening…'

  const shareMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const name = item?.name ?? 'image'
    const toast = (title: string, body: string) => os().notify({ app: 'preview', title, body })
    const items: MenuEntry[] = [
      { label: 'Copy Image', run: () => run('copy') },
      'sep',
      { label: 'AirDrop', run: () => toast('AirDrop', `Offering “${name}” to 14 strangers on this train. Three accepted.`) },
      { label: 'Mail', run: () => toast('Mail', 'Mail needs an account. Mail has needed an account since 2003.') },
      { label: 'Messages', run: () => toast('Messages', 'Sent as a green bubble, compressed to 12 pixels. Everyone is judging you.') },
      { label: 'Notes', run: () => os().saveNote({ id: 'n' + Date.now(), text: `📎 ${name}\n(Notes can’t hold pictures yet. Imagine it here.)`, updated: Date.now() }) },
      { label: 'Add to Photos', run: () => setSheet({ kind: 'export', note: 'Photos is ~/Pictures. It always was.' }) },
      'sep',
      { label: 'Edit Extensions…', disabled: true },
    ]
    openContextMenu(r.left, r.bottom + 4, items)
  }

  const slides = useMemo(
    () =>
      show
        ? items.map((it) => {
            const d = docs.current.get(it.key)
            return d?.dirty ? { ...it, url: flatten(d).toDataURL('image/jpeg', 0.92) } : it
          })
        : [],
    [show],
  )

  const popRect = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).getBoundingClientRect()

  return (
    <div
      className={`pv ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        const list = localItems(Array.from(e.dataTransfer.files))
        if (list.length) addItems(list)
        else if (e.dataTransfer.files.length) fail('Preview only opens images. It’s in the name. Sort of.')
      }}
    >
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addItems(localItems(Array.from(e.target.files ?? [])))
          e.target.value = ''
        }}
      />
      <div className="toolbar pv-toolbar" data-drag>
        <button className={`tb-btn pv-sb-btn ${sidebar ? 'on' : ''}`} title="Thumbnails" aria-label="Toggle thumbnails" onClick={() => setSidebar(!sidebar)}>
          <PanelLeft size={16} />
          <ChevronDown size={10} strokeWidth={2.6} />
        </button>
        <div className="toolbar-title left pv-title">
          <span>{item?.name ?? 'Preview'}{doc?.dirty && <em> — Edited</em>}</span>
          <small>{subtitle}</small>
        </div>
        <div className="pv-tb-group">
          <button className={`tb-btn ${inspector ? 'on' : ''}`} disabled={!doc} title="Inspector" aria-label="Inspector" onClick={() => run('inspector')}>
            <Info size={16} />
          </button>
          <div className="pv-zoom">
            <button className="tb-btn" disabled={!doc} title="Zoom Out" aria-label="Zoom out" onClick={() => run('zoomOut')}>
              <ZoomOut size={16} />
            </button>
            <button className="tb-btn" disabled={!doc} title="Zoom In" aria-label="Zoom in" onClick={() => run('zoomIn')}>
              <ZoomIn size={16} />
            </button>
          </div>
          <button className="tb-btn" disabled={!doc} title="Share" aria-label="Share" onClick={shareMenu}>
            <Share size={16} />
          </button>
          <button className="tb-btn" disabled={!doc} title="Rotate Left (⌘L)" aria-label="Rotate left" onClick={(e) => run(e.altKey ? 'rotR' : 'rotL')}>
            <RotateCcw size={16} />
          </button>
          <button className={`tb-btn pv-markup-btn ${markup ? 'on' : ''}`} disabled={!doc} title="Show Markup Toolbar (⇧⌘A)" aria-label="Markup" aria-pressed={markup} onClick={() => run('markup')}>
            <PenLine size={13} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {markup && doc && (
        <div className="pv-markup" data-drag>
          {tb('select', 'Rectangular Selection', SquareDashed)}
          {tb('alpha', 'Instant Alpha — drag to widen the selection', WandSparkles)}
          <span className="pv-div" />
          {tb('sketch', 'Sketch', PenLine)}
          {tb('highlight', 'Highlight', Highlighter)}
          <span className="pv-split">
            {tb(shape, 'Shapes', ShapeIcon)}
            <button
              className="pv-tool caret"
              aria-label="Choose shape"
              onClick={(e) => {
                const r = popRect(e)
                const opt = (k: ShapeKind, label: string): MenuEntry => ({ label, checked: shape === k, run: () => (setShape(k), setTool(k)) })
                openContextMenu(r.left - 20, r.bottom + 4, [opt('line', 'Line'), opt('arrow', 'Arrow'), opt('rect', 'Rectangle'), opt('oval', 'Oval')])
              }}
            >
              <ChevronDown size={10} strokeWidth={2.6} />
            </button>
          </span>
          {tb('text', 'Text', Type)}
          <button className="pv-tool" title="Sign" aria-label="Insert signature" onClick={insertSignature}>
            <Signature size={16} strokeWidth={1.8} />
          </button>
          <span className="pv-div" />
          <button className={`pv-tool ${adjust ? 'on' : ''}`} title="Adjust Color (⌥⌘C)" aria-label="Adjust color" onClick={() => run('adjustColor')}>
            <SlidersHorizontal size={16} strokeWidth={1.8} />
          </button>
          <button className="pv-tool" title="Adjust Size" aria-label="Adjust size" onClick={() => run('adjustSize')}>
            <Scaling size={16} strokeWidth={1.8} />
          </button>
          <span className="pv-div" />
          <button className="pv-tool" title="Shape Style" aria-label="Line width" onClick={(e) => setPop({ kind: 'stroke', rect: popRect(e) })}>
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M2 3.5h12M2 8h12M2 12.5h12" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
              <path d="M2 8h12" stroke="currentColor" strokeWidth="2" />
              <path d="M2 12.5h12" stroke="currentColor" strokeWidth="3" />
            </svg>
          </button>
          <button className="pv-tool" title="Border Color" aria-label="Border color" onClick={(e) => setPop({ kind: 'stroke', rect: popRect(e) })}>
            <span className="pv-chip border" style={{ borderColor: color }} />
          </button>
          <button className="pv-tool" title="Fill Color" aria-label="Fill color" onClick={(e) => setPop({ kind: 'fill', rect: popRect(e) })}>
            <span className={`pv-chip fill ${fill ? '' : 'none'}`} style={{ background: fill ?? undefined }} />
          </button>
          <button className="pv-tool" title="Text Style" aria-label="Text style" onClick={(e) => setPop({ kind: 'text', rect: popRect(e) })}>
            <ALargeSmall size={17} strokeWidth={1.8} />
          </button>
          <div style={{ flex: 1 }} />
          {sel && (
            <button className="btn small pv-crop" onClick={() => run('crop')}>
              Crop
            </button>
          )}
        </div>
      )}

      <div className="pv-body">
        {sidebar && (
          <aside className="pv-thumbs">
            {items.map((it, i) => {
              const d = docs.current.get(it.key)
              return (
                <button key={it.key} className={`pv-thumb ${it.key === cur ? 'on' : ''}`} onClick={() => setCur(it.key)}>
                  <span className="pv-thumb-img">
                    <img src={d?.thumb ?? it.url} alt="" draggable={false} loading="lazy" />
                  </span>
                  <span className="pv-thumb-name">{items.length > 1 ? i + 1 : it.name}</span>
                </button>
              )
            })}
            {!items.length && <div className="pv-thumbs-empty">No images</div>}
          </aside>
        )}

        <div className="pv-main">
          {!item ? (
            <OpenPanel onPick={(it) => addItems([it])} onBrowse={() => picker.current?.click()} />
          ) : isVideo ? (
            <div className="pv-video">
              <video src={item.url} controls autoPlay />
            </div>
          ) : error ? (
            <div className="pv-error">
              <h3>“{item.name}” couldn’t be opened.</h3>
              <p>{error}</p>
            </div>
          ) : !doc ? (
            <div className="pv-error">
              <div className="spinner dark" />
            </div>
          ) : (
            <div className="pv-scroll" ref={scroller} onPointerDown={(e) => tool === 'select' && e.target === e.currentTarget && (setSel(null), setPicked(null))}>
              <div className="pv-stage">
                <div
                  ref={wrap}
                  className={`pv-wrap tool-${tool} ${doc.hasAlpha ? 'checker' : ''} ${s >= 4 ? 'pixelated' : ''}`}
                  style={{ width: W * s, height: H * s }}
                >
                  <div ref={host} className="pv-bitmap" hidden={!!adjust} />
                  <canvas ref={live} className="pv-live" hidden={!adjust} />
                  <canvas ref={alphaLayer} className="pv-alpha" hidden />
                  <svg className="pv-overlay" viewBox={`0 0 ${W} ${H}`} onPointerDown={onCanvasDown}>
                    {doc.anns.map((a) => (
                      <AnnSvg key={a.id} a={a} hit={10 / s} hidden={a.id === editing} />
                    ))}
                    {draft && <AnnSvg a={draft} hit={0} />}
                    {pickedAnn && !editing && (() => {
                      const b = bbox(pickedAnn)
                      const k = 1 / s
                      return (
                        <g className="pv-picked" pointerEvents="none">
                          <rect x={b.x} y={b.y} width={b.w} height={b.h} strokeWidth={k} />
                          {[[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y], i) => (
                            <circle key={i} cx={x} cy={y} r={4 * k} strokeWidth={k} />
                          ))}
                        </g>
                      )
                    })()}
                    {sel && sel.w > 0 && sel.h > 0 && (
                      <g className="pv-sel" pointerEvents="none">
                        <rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} strokeWidth={1 / s} className="ants-bg" />
                        <rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} strokeWidth={1 / s} strokeDasharray={`${4 / s} ${4 / s}`} className="ants" style={{ ['--dash' as string]: `${8 / s}` }} />
                      </g>
                    )}
                  </svg>
                  {sel && sel.w > 0 && (
                    <div className="pv-sel-size" style={{ left: (sel.x + sel.w) * s + 6, top: (sel.y + sel.h) * s + 6 }}>
                      {sel.w} × {sel.h}
                    </div>
                  )}
                  {editingAnn && (
                    <textarea
                      className="pv-text-edit"
                      // Focus after the pointerdown that created it has finished, or the browser's own
                      // focus handling for that click blurs it straight away.
                      autoFocus
                      ref={(el) => {
                        if (el && document.activeElement !== el) setTimeout(() => el.focus(), 0)
                      }}
                      defaultValue={editingAnn.text}
                      placeholder="Text"
                      style={{ left: editingAnn.x * s, top: editingAnn.y * s, fontSize: editingAnn.size * s, color: editingAnn.color, font: textFont({ ...editingAnn, size: editingAnn.size * s }), lineHeight: 1.2 }}
                      rows={Math.max(1, editingAnn.text.split('\n').length)}
                      onInput={(e) => {
                        const t = e.currentTarget
                        t.rows = Math.max(1, t.value.split('\n').length)
                        t.style.width = '0'
                        t.style.width = `${t.scrollWidth + 8}px`
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) e.currentTarget.blur()
                      }}
                      onBlur={(e) => {
                        const text = e.currentTarget.value
                        const id = editingAnn.id
                        setEditing(null)
                        const wasNew = editingAnn.text === ''
                        if (!text.trim()) {
                          doc.anns = doc.anns.filter((a) => a.id !== id)
                          setPicked(null)
                          rerender()
                          return
                        }
                        const next = doc.anns.map((a) => (a.id === id ? { ...a, text } : a))
                        if (wasNew) doc.anns = doc.anns.filter((a) => a.id !== id)
                        commit({ anns: next })
                        setTool('select')
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {adjust && doc && (
            <div className="pv-panel pv-adjust glass" onPointerDown={(e) => e.stopPropagation()}>
              <div className="pv-panel-head">
                <span>Adjust Color</span>
                <button className="pv-x" aria-label="Close" onClick={() => closeAdjust(true)}>
                  <X size={12} strokeWidth={2.6} />
                </button>
              </div>
              <Levels hist={hist} a={adjust} set={(p) => setAdjust({ ...adjust, ...p })} />
              {(
                [
                  ['Exposure', 'exposure', -2, 2],
                  ['Contrast', 'contrast', -1, 1],
                  ['Highlights', 'highlights', -1, 1],
                  ['Shadows', 'shadows', -1, 1],
                  ['Saturation', 'saturation', -1, 1],
                  ['Temperature', 'temperature', -1, 1],
                  ['Tint', 'tint', -1, 1],
                  ['Sepia', 'sepia', 0, 1],
                  ['Sharpness', 'sharpness', 0, 1],
                ] as const
              ).map(([label, k, min, max]) => (
                <Slider key={k} label={label} value={adjust[k]} min={min} max={max} onChange={(v) => setAdjust({ ...adjust, [k]: v })} />
              ))}
              <div className="pv-panel-actions">
                <button className="btn small" onClick={runAutoLevels}>
                  Auto Levels
                </button>
                <button className="btn small" onClick={() => setAdjust({ ...NEUTRAL })}>
                  Reset All
                </button>
                <div style={{ flex: 1 }} />
                <button className="btn small primary" onClick={() => closeAdjust(true)}>
                  Done
                </button>
              </div>
              <div className="pv-engine">Rendered on {engineInfo().backend === 'GPU' ? 'the GPU (WebGL2)' : engineInfo().backend === 'WASM' ? 'the Pearnel kernel (WASM)' : 'the CPU'}</div>
            </div>
          )}

          {inspector && doc && item && (
            <div className="pv-panel pv-inspector glass" onPointerDown={(e) => e.stopPropagation()}>
              <div className="pv-panel-head">
                <span>{item.name} Info</span>
                <button className="pv-x" aria-label="Close" onClick={() => setInspector(false)}>
                  <X size={12} strokeWidth={2.6} />
                </button>
              </div>
              <dl>
                <dt>Document Type</dt>
                <dd>{KIND_LABEL[extOf(item.name)] ?? 'Image'}</dd>
                <dt>File Size</dt>
                <dd>{item.size != null ? formatBytes(item.size) : '—'}</dd>
                <dt>Image Size</dt>
                <dd>
                  {W.toLocaleString()} × {H.toLocaleString()} pixels
                </dd>
                <dt>Image DPI</dt>
                <dd>72 pixels/inch</dd>
                <dt>Color Model</dt>
                <dd>RGB</dd>
                <dt>Alpha Channel</dt>
                <dd>{doc.hasAlpha ? 'Yes' : 'No'}</dd>
                <dt>Megapixels</dt>
                <dd>{((W * H) / 1e6).toFixed(1)} MP (could be 48 MP, like on the pPhone)</dd>
                <dt>Annotations</dt>
                <dd>{doc.anns.length}</dd>
                <dt>Modified</dt>
                <dd>{item.modified ? new Date(item.modified).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</dd>
                <dt>Where</dt>
                <dd>{item.where}</dd>
                <dt>Image Engine</dt>
                <dd>{engineInfo().backend === 'GPU' ? `WebGL2 · max texture ${engineInfo().maxTexture.toLocaleString()} px` : engineInfo().backend}</dd>
              </dl>
            </div>
          )}
        </div>
      </div>

      {sheet === 'size' && doc && <SizeSheet w={W} h={H} onCancel={() => setSheet(null)} onApply={(w, h) => (setSheet(null), geometry({ width: w, height: h }))} />}
      {sheet && typeof sheet === 'object' && doc && item && (
        <ExportSheet
          item={item}
          note={sheet.note}
          authed={authed}
          render={() => flatten(doc)}
          onCancel={() => setSheet(null)}
          onDone={(saved) => {
            setSheet(null)
            if (saved) {
              doc.dirty = false
              rerender()
            }
          }}
        />
      )}

      {pop && (
        <Popover anchor={pop.rect} onClose={() => setPop(null)}>
          {pop.kind === 'stroke' && (
            <>
              <div className="pv-pop-label">Border</div>
              <Swatches value={color} onPick={(c) => c && styleChanged({ color: c })} />
              <div className="pv-pop-label">Line Width</div>
              <div className="pv-weights">
                {[1, 2, 3, 5, 8, 12].map((w) => (
                  <button key={w} className={weight === w ? 'on' : ''} onClick={() => styleChanged({ weight: w })}>
                    <span style={{ height: Math.min(w, 10) }} />
                  </button>
                ))}
              </div>
            </>
          )}
          {pop.kind === 'fill' && (
            <>
              <div className="pv-pop-label">Fill</div>
              <Swatches value={fill} allowNone onPick={(c) => styleChanged({ fill: c })} />
            </>
          )}
          {pop.kind === 'text' && (
            <>
              <div className="pv-pop-label">Text Color</div>
              <Swatches value={color} onPick={(c) => c && styleChanged({ color: c })} />
              <div className="pv-pop-label">Size</div>
              <div className="seg pv-sizes">
                {[0.6, 1, 1.6, 2.5, 4].map((z, i) => (
                  <button key={z} className={textSize === z ? 'on' : ''} onClick={() => styleChanged({ textSize: z })}>
                    {['S', 'M', 'L', 'XL', 'XXL'][i]}
                  </button>
                ))}
              </div>
            </>
          )}
        </Popover>
      )}

      {show && items.length > 0 && <Slideshow items={slides} start={Math.max(0, idx)} onClose={() => setShow(false)} />}
      {dropping && <div className="pv-drop">Drop to open in Preview</div>}
    </div>
  )
}

function isTextTarget(t: EventTarget | null) {
  return t instanceof HTMLElement && !!t.closest('input, textarea, [contenteditable]')
}

// ---- Sheets -------------------------------------------------------------------------------------

function SizeSheet({ w, h, onCancel, onApply }: { w: number; h: number; onCancel: () => void; onApply: (w: number, h: number) => void }) {
  const [unit, setUnit] = useState<'px' | '%' | 'in'>('px')
  const [lock, setLock] = useState(true)
  const [nw, setNw] = useState(w)
  const [nh, setNh] = useState(h)
  const conv = (v: number, total: number) => (unit === 'px' ? v : unit === '%' ? (v / total) * 100 : v / 72)
  const back = (v: number, total: number) => Math.max(1, Math.round(unit === 'px' ? v : unit === '%' ? (v / 100) * total : v * 72))
  const fmt = (v: number) => (unit === 'px' ? String(Math.round(v)) : v.toFixed(2).replace(/\.?0+$/, ''))
  const setW = (px: number) => {
    setNw(px)
    if (lock) setNh(Math.max(1, Math.round((px * h) / w)))
  }
  const setH = (px: number) => {
    setNh(px)
    if (lock) setNw(Math.max(1, Math.round((px * w) / h)))
  }
  const presets: [string, number][] = [['640 × 480', 640], ['800 × 600', 800], ['1024 × 768', 1024], ['1280 × 1024', 1280], ['1920 × 1080', 1920]]
  return (
    <div className="pv-sheet-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <form
        className="pv-sheet"
        onSubmit={(e) => {
          e.preventDefault()
          if (nw * nh > 16384 * 16384) return fail('That’s bigger than any GPU in this house can hold.')
          onApply(nw, nh)
        }}
      >
        <h3>Image Dimensions</h3>
        <div className="pv-grid">
          <label>Fit into:</label>
          <select
            defaultValue=""
            onChange={(e) => {
              const v = +e.target.value
              if (!v) return
              const s = Math.min(v / w, (v * 0.75) / h, 1e9)
              setNw(Math.max(1, Math.round(w * s)))
              setNh(Math.max(1, Math.round(h * s)))
            }}
          >
            <option value="">Custom</option>
            {presets.map(([l, v]) => (
              <option key={l} value={v}>
                {l} pixels
              </option>
            ))}
          </select>
          <label>Width:</label>
          <div className="pv-row">
            <input type="number" min={0} step="any" value={fmt(conv(nw, w))} onChange={(e) => setW(back(+e.target.value, w))} />
            <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
              <option value="px">pixels</option>
              <option value="%">percent</option>
              <option value="in">inches</option>
            </select>
          </div>
          <label>Height:</label>
          <div className="pv-row">
            <input type="number" min={0} step="any" value={fmt(conv(nh, h))} onChange={(e) => setH(back(+e.target.value, h))} />
            <span className="pv-lock" title={lock ? 'Proportional' : 'Free'}>
              {unit === 'px' ? 'pixels' : unit === '%' ? 'percent' : 'inches'}
            </span>
          </div>
          <span />
          <label className="pv-check">
            <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Scale proportionally
          </label>
          <span />
          <label className="pv-check">
            <input type="checkbox" checked readOnly /> Resample image (on the GPU)
          </label>
        </div>
        <div className="pv-result">
          <span>Resulting Size:</span>
          <b>{formatBytes(nw * nh * 4)}</b>
          <small>(was {formatBytes(w * h * 4)})</small>
        </div>
        <div className="pv-sheet-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            OK
          </button>
        </div>
      </form>
    </div>
  )
}

type Dest = 'download' | 'folder' | 'pictures' | 'drive'

function ExportSheet({ item, note, authed, render, onCancel, onDone }: { item: Item; note?: string; authed: boolean; render: () => HTMLCanvasElement; onCancel: () => void; onDone: (savedOver: boolean) => void }) {
  const srcMime = mimeFor(extOf(item.name))
  const [name, setName] = useState(baseName(item.name))
  const [mime, setMime] = useState(srcMime ?? 'image/png')
  const [quality, setQuality] = useState(0.85)
  const [dest, setDest] = useState<Dest>(item.src.kind === 'local' ? 'download' : 'folder')
  const [size, setSize] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const canvas = useMemo(render, [])
  const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'
  const lossy = mime !== 'image/png'

  useEffect(() => {
    let live = true
    setSize(null)
    const t = setTimeout(() => encode(canvas, mime, quality).then((b) => live && setSize(b.size), () => live && setSize(-1)), 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [mime, quality])

  const folderLabel = item.src.kind === 'fs' ? item.where : item.src.kind === 'drive' ? item.where : null
  const go = async () => {
    setBusy(true)
    const file = `${name.trim() || 'Untitled'}.${ext}`
    try {
      const blob = await encode(canvas, mime, quality)
      if (dest === 'download') {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        onDone(false)
        return
      }
      if (dest === 'drive' || (dest === 'folder' && item.src.kind === 'drive')) {
        const dir = dest === 'drive' ? '' : parentOf(item.src.kind === 'drive' ? item.src.rel : '/').dir.replace(/\/$/, '')
        const rel = `${dir}/${file}`
        await drive.write(rel, blob)
        bumpDrive()
        os().notify({ app: 'preview', title: 'Exported', body: `Saved “${file}” to PearDrive.` })
        onDone(item.src.kind === 'drive' && rel === item.src.rel)
        return
      }
      const dir = dest === 'pictures' ? HOME + '/Pictures' : parentOf(item.src.kind === 'fs' ? item.src.path : HOME + '/Pictures/x').dir
      const content = await blobToDataURL(blob)
      const existing = resolve(`${dir}/${file}`)
      if (existing && existing.type === 'file') {
        existing.content = content
        existing.size = blob.size
        existing.modified = Date.now()
        existing.kind = 'image'
      } else addNode(dir, file, { type: 'file', kind: 'image', content, size: blob.size, modified: Date.now() })
      os().bumpFs()
      os().notify({ app: 'preview', title: 'Exported', body: `Saved “${file}” to ${dir.replace(HOME, '~')}.` })
      onDone(item.src.kind === 'fs' && `${dir}/${file}` === item.src.path)
    } catch (e) {
      fail(e)
      setBusy(false)
    }
  }

  return (
    <div className="pv-sheet-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <form
        className="pv-sheet"
        onSubmit={(e) => {
          e.preventDefault()
          void go()
        }}
      >
        {note && <p className="pv-note">{note}</p>}
        <div className="pv-grid">
          <label>Export As:</label>
          <div className="pv-row">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
            <span className="pv-ext">.{ext}</span>
          </div>
          <label>Where:</label>
          <select value={dest} onChange={(e) => setDest(e.target.value as Dest)}>
            <option value="download">Downloads (on your actual computer)</option>
            {folderLabel && <option value="folder">{folderLabel}</option>}
            {folderLabel !== '~/Pictures' && <option value="pictures">~/Pictures</option>}
            {authed && item.src.kind !== 'drive' && <option value="drive">PearDrive</option>}
          </select>
          <label>Format:</label>
          <select value={mime} onChange={(e) => setMime(e.target.value)}>
            <option value="image/png">PNG</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/webp">WebP</option>
            <option disabled>HEIC (requires PearCare+)</option>
          </select>
          {lossy && (
            <>
              <label>Quality:</label>
              <div className="pv-row">
                <small>Least</small>
                <input type="range" min={0.05} max={1} step={0.01} value={quality} onChange={(e) => setQuality(+e.target.value)} />
                <small>Best</small>
              </div>
            </>
          )}
          <label>File Size:</label>
          <span className="pv-size">{size === null ? 'Calculating…' : size < 0 ? 'Not supported by this browser' : formatBytes(size)}</span>
        </div>
        <div className="pv-sheet-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

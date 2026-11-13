import { create } from 'zustand'
import { os } from '../store'
import { HOME, addNode, mkdir, resolve, moveToTrash, type FileNode } from './fs'
import { blobToDataURL, encode, makeCanvas } from './imaging'
import { shutterSound } from './shutter'
import { SHADOW_DROP, centredBox, clampBox, pickMime, shotName, sourceBox, thumbSize, windowShotSize, type Box } from './screenshotCore'

export type Tool = 'screen' | 'window' | 'selection' | 'record-screen' | 'record-selection'
export type SaveTo = 'desktop' | 'documents' | 'pictures' | 'clipboard'
export type Mode = 'idle' | 'toolbar' | 'quick-select' | 'quick-window'

export interface Options {
  saveTo: SaveTo
  timer: 0 | 5 | 10
  thumbnail: boolean
  remember: boolean
  pointer: boolean
}

export interface Thumb {
  id: string
  kind: 'image' | 'video'
  poster: string
  w: number
  h: number
  path: string | null
  name: string
}

interface ShotState {
  mode: Mode
  tool: Tool
  region: Box | null
  options: Options
  hiding: boolean
  countdown: number | null
  recording: { startedAt: number } | null
  thumbs: Thumb[]
}

const KEY = 'pearos.screenshot.v1'
const DEFAULTS: Options = { saveTo: 'desktop', timer: 0, thumbnail: true, remember: true, pointer: false }

function loadOptions(): Options {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return DEFAULTS
    const o = { ...DEFAULTS }
    if (['desktop', 'documents', 'pictures', 'clipboard'].includes(raw.saveTo)) o.saveTo = raw.saveTo
    if ([0, 5, 10].includes(raw.timer)) o.timer = raw.timer
    for (const k of ['thumbnail', 'remember', 'pointer'] as const) if (typeof raw[k] === 'boolean') o[k] = raw[k]
    return o
  } catch {
    return DEFAULTS
  }
}

export const useShots = create<ShotState>(() => ({
  mode: 'idle',
  tool: 'selection',
  region: null,
  options: loadOptions(),
  hiding: false,
  countdown: null,
  recording: null,
  thumbs: [],
}))

useShots.subscribe((s, prev) => {
  if (s.options === prev.options) return
  try { localStorage.setItem(KEY, JSON.stringify(s.options)) } catch { /* Options still apply for this session. */ }
})

const set = useShots.setState
const get = useShots.getState
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const frames = (n: number) => new Promise<void>((r) => { const step = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1))); step(n) })

export class ShotError extends Error {
  constructor(public code: 'unsupported' | 'denied' | 'surface' | 'failed', message: string) {
    super(message)
  }
}

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let idle = 0
let pointer = { x: 0, y: 0 }
if (typeof window !== 'undefined') window.addEventListener('pointermove', (e) => (pointer = { x: e.clientX, y: e.clientY }), true)

function release() {
  clearTimeout(idle)
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  video = null
}

const keepAlive = () => {
  clearTimeout(idle)
  if (!get().recording) idle = window.setTimeout(release, 20_000)
}

async function acquire(): Promise<HTMLVideoElement> {
  clearTimeout(idle)
  if (video && stream?.getVideoTracks()[0]?.readyState === 'live') return video
  if (!navigator.mediaDevices?.getDisplayMedia) throw new ShotError('unsupported', 'This browser can’t capture the screen.')
  let s: MediaStream
  try {
    s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' } as DisplayMediaStreamOptions)
  } catch {
    throw new ShotError('denied', 'Screen access was declined.')
  }
  const track = s.getVideoTracks()[0]
  const surface = (track.getSettings() as { displaySurface?: string }).displaySurface
  if (surface && surface !== 'browser') {
    s.getTracks().forEach((t) => t.stop())
    throw new ShotError('surface', 'Share this tab, not a window or screen.')
  }
  track.addEventListener('ended', release)
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.srcObject = s
  await v.play()
  if (!v.videoWidth) await new Promise<void>((r) => v.addEventListener('loadedmetadata', () => r(), { once: true }))
  stream = s
  video = v
  return v
}

async function settle(v: HTMLVideoElement) {
  await frames(2)
  await sleep(110)
  await new Promise<void>((r) => {
    const t = setTimeout(r, 380)
    v.requestVideoFrameCallback(() => {
      clearTimeout(t)
      r()
    })
  })
}

async function snapshot() {
  const v = await acquire()
  await settle(v)
  const c = makeCanvas(v.videoWidth, v.videoHeight)
  c.getContext('2d')!.drawImage(v, 0, 0)
  return { c, scale: v.videoWidth / window.innerWidth }
}

function drawPointer(g: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  g.save()
  g.translate(x * scale, y * scale)
  g.scale(scale, scale)
  const arrow = new Path2D('M0 0 L0 16.5 L4.1 12.8 L6.9 19.2 L9.4 18.1 L6.6 11.8 L12 11.6 Z')
  g.shadowColor = 'rgba(0,0,0,.35)'
  g.shadowBlur = 2
  g.shadowOffsetY = 1
  g.fillStyle = '#000'
  g.fill(arrow)
  g.shadowColor = 'transparent'
  g.lineWidth = 1.2
  g.strokeStyle = '#fff'
  g.lineJoin = 'round'
  g.stroke(arrow)
  g.restore()
}

const folderFor = (to: SaveTo) => (to === 'documents' ? `${HOME}/Documents` : to === 'pictures' ? `${HOME}/Pictures` : `${HOME}/Desktop`)

function notifyError(e: unknown) {
  const err = e instanceof ShotError ? e : new ShotError('failed', e instanceof Error ? e.message : 'Something went wrong.')
  const body: Record<ShotError['code'], string> = {
    unsupported: 'This browser can’t capture the screen. Try Chrome, Edge or another Chromium browser.',
    denied: 'Screenshot needs permission to record this tab. You said no, which is fair. Try again and choose “Allow”.',
    surface: 'Screenshot has to see this very tab. When your browser asks what to share, choose the tab running PearOS.',
    failed: `That didn’t work: ${err.message}`,
  }
  os().notify({ app: 'screenshot', title: 'Screenshot', body: body[err.code] })
}

function hideUI() {
  set({ hiding: true })
}

function showUI() {
  set({ hiding: false })
}

function overlappingAbove(id: string): HTMLElement[] {
  const s = os()
  const target = s.windows.find((w) => w.id === id)
  if (!target) return []
  return s.windows
    .filter((w) => w.id !== id && w.z > target.z && !w.minimized && w.space === target.space && w.x < target.x + target.w && w.x + w.w > target.x && w.y < target.y + target.h && w.y + w.h > target.y)
    .map((w) => document.querySelector<HTMLElement>(`.window[data-win="${w.id}"]`))
    .filter((el): el is HTMLElement => !!el)
}

export interface CaptureSpec {
  kind: 'screen' | 'region' | 'window'
  box?: Box
  windowId?: string
  copy?: boolean
}

async function render(spec: CaptureSpec): Promise<HTMLCanvasElement> {
  const hidden = spec.windowId ? overlappingAbove(spec.windowId) : []
  hidden.forEach((el) => (el.style.visibility = 'hidden'))
  let shot: Awaited<ReturnType<typeof snapshot>>
  try {
    shot = await snapshot()
  } finally {
    hidden.forEach((el) => (el.style.visibility = ''))
  }
  const { c, scale } = shot
  const showPointer = get().options.pointer
  let out: HTMLCanvasElement
  if (spec.kind === 'screen' || !spec.box) {
    out = c
    if (showPointer) drawPointer(c.getContext('2d')!, pointer.x, pointer.y, scale)
  } else if (spec.kind === 'window') {
    const b = clampBox(spec.box, window.innerWidth, window.innerHeight)
    const sb = sourceBox(b, scale)
    const { margin, w, h } = windowShotSize(b, scale)
    out = makeCanvas(w, h)
    const g = out.getContext('2d')!
    const radius = 11 * scale
    const shape = () => {
      g.beginPath()
      g.roundRect(margin, margin, sb.w, sb.h, radius)
    }
    g.save()
    g.shadowColor = 'rgba(0,0,0,.34)'
    g.shadowBlur = 30 * scale
    g.shadowOffsetY = SHADOW_DROP * scale
    g.fillStyle = '#000'
    shape()
    g.fill()
    g.restore()
    g.save()
    shape()
    g.clip()
    g.drawImage(c, sb.x, sb.y, sb.w, sb.h, margin, margin, sb.w, sb.h)
    g.restore()
    g.lineWidth = scale
    g.strokeStyle = 'rgba(0,0,0,.28)'
    shape()
    g.stroke()
    if (showPointer && pointer.x >= b.x && pointer.x <= b.x + b.w && pointer.y >= b.y && pointer.y <= b.y + b.h) drawPointer(g, pointer.x - b.x + margin / scale, pointer.y - b.y + margin / scale, scale)
  } else {
    const sb = sourceBox(clampBox(spec.box, window.innerWidth, window.innerHeight), scale)
    out = makeCanvas(sb.w, sb.h)
    const g = out.getContext('2d')!
    g.drawImage(c, sb.x, sb.y, sb.w, sb.h, 0, 0, sb.w, sb.h)
    if (showPointer) drawPointer(g, pointer.x - spec.box.x, pointer.y - spec.box.y, scale)
  }
  return out
}

function posterOf(c: HTMLCanvasElement) {
  const t = thumbSize(c.width, c.height, 380, 300)
  const p = makeCanvas(t.w, t.h)
  p.getContext('2d')!.drawImage(c, 0, 0, t.w, t.h)
  return p.toDataURL('image/jpeg', 0.82)
}

function pushThumb(t: Omit<Thumb, 'id'>) {
  if (!get().options.thumbnail) return
  set((s) => ({ thumbs: [...s.thumbs.slice(-3), { ...t, id: Math.random().toString(36).slice(2, 9) }] }))
}

function ensureDir(dir: string) {
  if (!resolve(dir)) mkdir(dir)
}

async function deliver(canvas: HTMLCanvasElement, copy: boolean) {
  const blob = await encode(canvas, 'image/png')
  const name = shotName(new Date(), 'Screenshot', 'png')
  const t = thumbSize(canvas.width, canvas.height)
  const poster = posterOf(canvas)
  if (copy || get().options.saveTo === 'clipboard') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      throw new ShotError('failed', 'The clipboard said no. Click the page once and try again.')
    }
    pushThumb({ kind: 'image', poster, w: t.w, h: t.h, path: null, name })
    return
  }
  const dir = folderFor(get().options.saveTo)
  ensureDir(dir)
  const node: FileNode = { type: 'file', kind: 'image', content: await blobToDataURL(blob), size: blob.size, modified: Date.now() }
  const saved = addNode(dir, name, node)
  if (!saved) throw new ShotError('failed', `${dir.replace(HOME, '~')} is missing and couldn’t be recreated.`)
  os().bumpFs()
  pushThumb({ kind: 'image', poster, w: t.w, h: t.h, path: `${dir}/${saved}`, name: saved })
}

export async function capture(spec: CaptureSpec, withTimer = false) {
  const delay = withTimer ? get().options.timer : 0
  hideUI()
  set({ mode: 'idle' })
  try {
    for (let n = delay; n > 0; n--) {
      set({ countdown: n })
      await sleep(1000)
    }
    set({ countdown: null })
    const canvas = await render(spec)
    shutterSound()
    await deliver(canvas, !!spec.copy)
    keepAlive()
  } catch (e) {
    keepAlive()
    notifyError(e)
  } finally {
    set({ countdown: null })
    showUI()
  }
}

export function openToolbar() {
  os().closeOverlays()
  const { options, region } = get()
  const W = window.innerWidth
  const H = window.innerHeight
  set({ mode: 'toolbar', hiding: false, region: options.remember && region ? clampBox(region, W, H) : centredBox(W, H) })
}

export function cancel() {
  set({ mode: 'idle', hiding: false, countdown: null })
}

export const quickSelect = (copy = false) => {
  os().closeOverlays()
  set({ mode: 'quick-select', hiding: false })
  quickCopy = copy
}

export const quickWindow = () => set({ mode: 'quick-window', hiding: false })

let quickCopy = false
export const wantsCopy = () => quickCopy

export function quickScreen(copy = false) {
  os().closeOverlays()
  return capture({ kind: 'screen', copy })
}

export function setTool(tool: Tool) {
  set({ tool })
}

export function setRegion(region: Box) {
  set({ region })
}

export function setOptions(o: Partial<Options>) {
  set((s) => ({ options: { ...s.options, ...o } }))
}

let recorder: MediaRecorder | null = null
let chunks: BlobPart[] = []
let loop = 0
let recMime = { mime: '', ext: 'webm' }
let recPoster = ''

export async function startRecording(box: Box | null) {
  hideUI()
  set({ mode: 'idle' })
  try {
    for (let n = get().options.timer; n > 0; n--) {
      set({ countdown: n })
      await sleep(1000)
    }
    set({ countdown: null })
    const v = await acquire()
    await settle(v)
    const scale = v.videoWidth / window.innerWidth
    const sb = box ? sourceBox(clampBox(box, window.innerWidth, window.innerHeight), scale) : { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight }
    const w = sb.w - (sb.w % 2)
    const h = sb.h - (sb.h % 2)
    const c = makeCanvas(w, h)
    const g = c.getContext('2d')!
    const draw = () => {
      g.drawImage(v, sb.x, sb.y, w, h, 0, 0, w, h)
      if (get().options.pointer) drawPointer(g, pointer.x - sb.x / scale, pointer.y - sb.y / scale, scale)
      loop = requestAnimationFrame(draw)
    }
    draw()
    recPoster = posterOf(c)
    recMime = pickMime((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))
    chunks = []
    recorder = new MediaRecorder(c.captureStream(30), recMime.mime ? { mimeType: recMime.mime, videoBitsPerSecond: 8_000_000 } : undefined)
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.start(400)
    set({ recording: { startedAt: Date.now() } })
    showUI()
  } catch (e) {
    showUI()
    set({ countdown: null })
    notifyError(e)
  }
}

export async function stopRecording() {
  const rec = recorder
  if (!rec || rec.state === 'inactive') return
  cancelAnimationFrame(loop)
  const done = new Promise<void>((r) => (rec.onstop = () => r()))
  rec.stop()
  await done
  recorder = null
  set({ recording: null })
  try {
    const blob = new Blob(chunks, { type: recMime.mime.split(';')[0] || 'video/webm' })
    chunks = []
    const to = get().options.saveTo === 'clipboard' ? 'desktop' : get().options.saveTo
    const dir = folderFor(to)
    ensureDir(dir)
    const node: FileNode = { type: 'file', kind: 'video', content: URL.createObjectURL(blob), poster: recPoster, size: blob.size, modified: Date.now() }
    const saved = addNode(dir, shotName(new Date(), 'Screen Recording', recMime.ext), node)
    if (!saved) throw new ShotError('failed', 'The recording had nowhere to go.')
    os().bumpFs()
    pushThumb({ kind: 'video', poster: recPoster, w: 190, h: 119, path: `${dir}/${saved}`, name: saved })
    shutterSound()
  } catch (e) {
    notifyError(e)
  }
  keepAlive()
}

export function dismissThumb(id: string) {
  set((s) => ({ thumbs: s.thumbs.filter((t) => t.id !== id) }))
}

export function trashThumb(t: Thumb) {
  if (t.path) {
    moveToTrash(t.path)
    os().bumpFs()
  }
  dismissThumb(t.id)
}

export function windowAt(x: number, y: number): { id: string; box: Box } | null {
  const s = os()
  for (const el of document.elementsFromPoint(x, y)) {
    const win = (el as HTMLElement).closest?.('.window') as HTMLElement | null
    if (!win) continue
    const w = s.windows.find((q) => q.id === win.dataset.win)
    if (!w || w.minimized) continue
    const r = win.getBoundingClientRect()
    return { id: w.id, box: { x: r.left, y: r.top, w: r.width, h: r.height } }
  }
  return null
}

export function releaseCapture() {
  release()
}


import { create } from 'zustand'
import { bootKernel, gravityKernel, kernelReady } from '../kernel'
import { DOCK_ZONE, MENU_H, onSpace, os, tileRect, useOS, type Win } from '../store'
import { useA11y } from './a11y'
import { useFlights } from './flights'

type Pose = { x: number; y: number; angle: number; gravityScale: number }
type Entry = { key: number; source: Win; pose: Pose }
type SavedLayout = Pick<Win, 'x' | 'y' | 'w' | 'h' | 'angle' | 'gravityScale' | 'tile' | 'restore'>

export const useGravity = create<{ enabled: boolean; loading: boolean; upright: boolean; canRestore: boolean }>(() => ({
  enabled: false, loading: false, upright: false, canRestore: false,
}))

const entries = new Map<string, Entry>()
const elements = new Map<string, HTMLElement>()
const savedLayout = new Map<string, SavedLayout>()
const holds = new Set<symbol>()
let nextKey = 1
let mounted = false
let running = false
let syncing = false
let frame = 0
let previousTime: number | null = null
let cancelGrab: (() => void) | null = null
let savedViewport = { width: 0, height: 0 }

const sameGeometry = (a: Win, b: Win) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.angle === b.angle && a.gravityScale === b.gravityScale && a.tile === b.tile
const poseOf = (w: Win): Pose => ({ x: w.x, y: w.y, angle: w.angle ?? 0, gravityScale: w.gravityScale ?? 1 })
const saveWindow = (w: Win): SavedLayout => ({ x: w.x, y: w.y, w: w.w, h: w.h, angle: w.angle, gravityScale: w.gravityScale, tile: w.tile, restore: w.restore })

export function windowTransform(w: Pick<Win, 'x' | 'y' | 'angle' | 'gravityScale'>) {
  return `translate(${w.x}px, ${w.y}px) rotate(${w.angle ?? 0}rad) scale(${w.gravityScale ?? 1})`
}

function shouldRun() {
  const s = os()
  return mounted && useGravity.getState().enabled && !document.hidden && s.phase === 'desktop'
    && !s.overlay.missionControl && !s.overlay.launchpad && !s.overlay.spotlight
    && !s.desktopRevealed && !s.quickLook && !s.contextMenu && !holds.size && !useA11y.getState().reduceMotion
    && !useFlights.getState().ids.length
}

function commitPoses() {
  let changed = false
  const windows = os().windows.map((w) => {
    const e = entries.get(w.id)
    if (!e || !sameGeometry(w, e.source)) return w
    const p = e.pose
    if (w.x === p.x && w.y === p.y && (w.angle ?? 0) === p.angle && (w.gravityScale ?? 1) === p.gravityScale) return w
    changed = true
    const next = { ...w, ...p }
    e.source = next
    return next
  })
  if (changed) useOS.setState({ windows })
}

function stopFrames() {
  cancelAnimationFrame(frame)
  frame = 0
  previousTime = null
}

function paintPoses(elapsed: number) {
  const { active, poses } = gravityKernel.step(elapsed)
  const byKey = new Map([...entries.values()].map((e) => [e.key, e]))
  for (let i = 0; i < poses.length; i += 6) {
    const e = byKey.get(poses[i])
    if (!e) continue
    e.pose = { x: poses[i + 1], y: poses[i + 2], angle: poses[i + 3], gravityScale: poses[i + 4] }
  }
  if (running) for (const [id, e] of entries) {
    const el = elements.get(id)
    if (el) el.style.transform = windowTransform(e.pose)
  }
  return active
}

function tick(time: number) {
  frame = 0
  if (!running) return
  const active = paintPoses(previousTime === null ? 0 : (time - previousTime) / 1000)
  previousTime = time
  if (active) frame = requestAnimationFrame(tick)
  else {
    previousTime = null
    commitPoses()
  }
}

function wake() {
  if (running && !frame) {
    previousTime = null
    frame = requestAnimationFrame(tick)
  }
}

function sync() {
  if (!mounted || syncing || !kernelReady()) return
  syncing = true
  try {
    if (!useGravity.getState().enabled) {
      running = false
      stopFrames()
      cancelGrab?.()
      if (!entries.size) return
      commitPoses()
      gravityKernel.reset()
      entries.clear()
      return
    }
    const canRun = shouldRun()
    const s = os()
    const eligible = s.windows.filter((w) => !w.minimized && !w.tile && !w.fullscreen && !s.hiddenApps.includes(w.app) && !w.props.infoPath && onSpace(w, s.activeSpace, s.assign))
    const ids = new Set(eligible.map((w) => w.id))
    const removed = [...entries.keys()].some((id) => !ids.has(id))
    if ((running && !canRun) || removed) {
      cancelGrab?.()
      commitPoses()
    }
    running = canRun
    if (!running) stopFrames()
    let changed = false
    for (const [id, e] of entries) if (!ids.has(id)) {
      gravityKernel.remove(e.key)
      entries.delete(id)
      changed = true
    }
    for (const w of os().windows) {
      if (!savedLayout.has(w.id)) {
        savedLayout.set(w.id, saveWindow(w))
        useGravity.setState({ canRestore: true })
      }
      if (!ids.has(w.id)) continue
      const e = entries.get(w.id)
      if (!e || !sameGeometry(w, e.source)) {
        cancelGrab?.()
        const key = e?.key ?? nextKey++
        entries.set(w.id, { key, source: w, pose: poseOf(w) })
        gravityKernel.put(key, w.x, w.y, w.w, w.h, w.angle ?? 0)
        changed = true
      }
    }
    if (changed || running) paintPoses(0)
    if (running) wake()
  } finally {
    syncing = false
  }
}

function updateBounds() {
  if (!mounted || !kernelReady() || !useGravity.getState().enabled) return
  gravityKernel.bounds(window.innerWidth, window.innerHeight, MENU_H, DOCK_ZONE)
  paintPoses(0)
  wake()
}

export function mountDesktopGravity() {
  mounted = true
  if (kernelReady()) {
    gravityKernel.reset()
    gravityKernel.upright(useGravity.getState().upright)
  }
  updateBounds()
  const unsubOS = useOS.subscribe(sync)
  const unsubGravity = useGravity.subscribe((s, prev) => {
    if (s.upright !== prev.upright && kernelReady()) gravityKernel.upright(s.upright)
    if (s.enabled !== prev.enabled || s.upright !== prev.upright) sync()
  })
  const unsubA11y = useA11y.subscribe(sync)
  const unsubFlights = useFlights.subscribe(sync)
  window.addEventListener('resize', updateBounds)
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('blur', releaseGrab)
  sync()
  return () => {
    mounted = false
    running = false
    stopFrames()
    releaseGrab()
    commitPoses()
    entries.clear()
    holds.clear()
    unsubOS()
    unsubGravity()
    unsubA11y()
    unsubFlights()
    window.removeEventListener('resize', updateBounds)
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('blur', releaseGrab)
  }
}

export async function setDesktopGravity(enabled: boolean) {
  if (enabled === useGravity.getState().enabled || useGravity.getState().loading) return
  if (!enabled) {
    useGravity.setState({ enabled: false })
    return
  }
  useGravity.setState({ loading: true })
  try {
    await bootKernel()
    savedViewport = { width: window.innerWidth, height: window.innerHeight }
    savedLayout.clear()
    for (const w of os().windows) savedLayout.set(w.id, saveWindow(w))
    gravityKernel.reset()
    gravityKernel.upright(useGravity.getState().upright)
    gravityKernel.bounds(window.innerWidth, window.innerHeight, MENU_H, DOCK_ZONE)
    useGravity.setState({ enabled: true, canRestore: savedLayout.size > 0 })
  } catch {
    os().notify({ app: 'settings', title: 'Desktop Gravity', body: 'The physics kernel could not start. Your windows are staying put.' })
  } finally {
    useGravity.setState({ loading: false })
  }
}

export function restoreDesktopOrder() {
  useGravity.setState({ enabled: false })
  useOS.setState((s) => ({ windows: s.windows.map((w) => {
    const saved = savedLayout.get(w.id)
    if (!saved) return w
    if (savedViewport.width === window.innerWidth && savedViewport.height === window.innerHeight) return { ...w, ...saved }
    if (saved.tile) return { ...w, ...saved, ...tileRect(saved.tile) }
    const width = Math.min(saved.w, Math.max(120, window.innerWidth - 40))
    const height = Math.min(saved.h, Math.max(100, window.innerHeight - MENU_H - DOCK_ZONE - 20))
    return {
      ...w, ...saved, w: width, h: height, angle: 0, gravityScale: 1,
      x: Math.max(10, Math.min(saved.x, window.innerWidth - width - 10)),
      y: Math.max(MENU_H + 8, Math.min(saved.y, window.innerHeight - DOCK_ZONE - height - 10)),
    }
  }) }))
  savedLayout.clear()
  useGravity.setState({ canRestore: false })
}

export function registerGravityWindow(id: string, el: HTMLElement) {
  elements.set(id, el)
  repaintGravityWindow(id)
  return () => {
    if (elements.get(id) === el) elements.delete(id)
  }
}

export function repaintGravityWindow(id: string) {
  const e = entries.get(id)
  const el = elements.get(id)
  if (running && e && el) el.style.transform = windowTransform(e.pose)
}

function releaseGrab() { cancelGrab?.() }

export function grabGravityWindow(id: string, el: HTMLElement, event: { pointerId: number; clientX: number; clientY: number }) {
  const e = entries.get(id)
  if (!running || !e) return null
  releaseGrab()
  if (!gravityKernel.grab(e.key, event.clientX, event.clientY)) return null
  const pointerId = event.pointerId
  let finished = false
  el.setPointerCapture(pointerId)
  el.classList.add('dragging')
  el.dataset.gravityGrabbed = ''
  const move = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) {
      gravityKernel.pointer(ev.clientX, ev.clientY)
      wake()
    }
  }
  const finish = (ev?: PointerEvent) => {
    if (finished || (ev && ev.pointerId !== pointerId)) return
    finished = true
    cancelGrab = null
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', finish)
    el.removeEventListener('pointercancel', finish)
    el.removeEventListener('lostpointercapture', finish)
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
    el.classList.remove('dragging')
    delete el.dataset.gravityGrabbed
    gravityKernel.release()
    wake()
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', finish)
  el.addEventListener('pointercancel', finish)
  el.addEventListener('lostpointercapture', finish)
  cancelGrab = finish
  wake()
  return finish
}

export function holdDesktopGravity() {
  const token = Symbol()
  holds.add(token)
  sync()
  return () => {
    holds.delete(token)
    sync()
  }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useOS, os, fullscreenRect, fullscreenSide, spaceOrder, tileRect, onSpace } from '../store'
import { Wallpaper } from './Wallpaper'
import { ShaderLayer } from './ShaderLayers'
import { MenuBar } from './MenuBar'
import { ControlCenter, StatusMenuPopover } from './MenuBarStatus'
import { Dock } from './Dock'
import { Window } from './Window'
import { Launchpad, Notifications, Spotlight } from './Overlays'
import { NotificationCenter } from './Center'
import { DesktopWidgets, WidgetGallery } from './Widgets'
import { Stickies } from './Stickies'
import { GlobalContextMenu } from './ContextMenu'
import { isTextField, menu, openContextMenu } from '../lib/menu'
import { desktopMenu, fileMenu, selectionMenu, textMenu, windowChromeMenu, windowFallbackMenu } from '../lib/menus'
import { TAG_COLORS } from './ContextMenu'
import { DiskIcon, FileIcon, FolderIcon, fileThumb } from './icons'
import { HOME, canRename, listDir, moveNode, moveToTrash, rename, resolve } from '../lib/fs'
import { RenameField, useEnterToRename } from './RenameField'
import { openPath } from '../apps/open'
import { APPS, preloadApps } from '../apps/registry'
import type { AppId } from '../apps/ids'
import { shameToast, useScreenTime } from '../lib/screenTime'
import { missionLayout } from '../lib/missionControl'
import { MissionControl } from './MissionControl'
import { QuickLook } from './QuickLook'
import { HotCorners } from './HotCorners'
import { ScreenshotUI } from './Screenshot'
import { cancel as cancelShot, openToolbar, quickScreen, quickSelect, useShots } from '../lib/screenshot'
import { moveQuickLook, openVirtualQuickLook } from '../lib/quickLook'
import { useQuickLookShortcut } from './useQuickLookShortcut'
import { mountDesktopGravity, restoreDesktopOrder, setDesktopGravity, useGravity } from '../lib/gravity'
import { useA11y } from '../lib/a11y'
import { AppSwitcher } from './AppSwitcher'
import { SystemDialogs } from './SystemDialogs'
import { playTrashMove } from '../lib/sounds'
import { closeFinderTab, FINDER_VIEWS, finderCommands, goToFinderFolder, showFileInfo } from '../apps/finderCommands'

const JOKES: { app: Parameters<ReturnType<typeof os>['notify']>[0]['app']; title: string; body: string | (() => string); actions?: string[] }[] = [
  { app: 'intelligence', title: 'Pear Intelligence', body: 'Pear Intelligence is ready. Unfortunately, so are we.' },
  { app: 'settings', title: 'Software Update', body: 'PearOS Grove 15.0.1 is ready to install. It fixes the bugs in 15.0 and adds new, more interesting ones.', actions: ['Later', 'Try Tonight'] },
  { app: 'finder', title: 'Storage Almost Full', body: "You've used 7.9 GB of 8 GB. Upgrade to 16 GB for only $200 (it's like 32 GB)." },
  { app: 'passwords', title: 'Passwords', body: '47 of your passwords appeared in a data leak. All 47 were "password123".' },
  { app: 'mirroring', title: 'pPhone Mirroring', body: 'Your pPhone is nearby. We can tell. It is in your pocket and you are ignoring it.' },
  { app: 'settings', title: 'Background Items Added', body: '"Pear Updater Updater" can run in the background. You can manage this in Login Items & Extensions & Background & Foreground Items.' },
  { app: 'activity', title: 'Activity Monitor', body: 'kernel_task is now using 412% CPU to keep your PearBook cool. It is not working.' },
  { app: 'settings', title: 'Screen Time', body: () => shameToast(useScreenTime.getState().data) },
]

function useJokeNotifications() {
  useEffect(() => {
    let i = 0
    const fire = () => {
      const j = JOKES[i++ % JOKES.length]
      os().notify({
        app: j.app,
        title: j.title,
        body: typeof j.body === 'function' ? j.body() : j.body,
        actions: j.actions?.map((label) => ({
          label,
          run: () => setTimeout(() => os().notify({ app: j.app, title: j.title, body: "OK! We'll ask again in 5 minutes. And every 5 minutes after that." }), 600),
        })),
      })
    }
    const first = setTimeout(fire, 3500)
    const loop = setInterval(fire, 75_000)
    return () => {
      clearTimeout(first)
      clearInterval(loop)
    }
  }, [])
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = os()
      if (e.defaultPrevented || e.isComposing) return
      if (s.systemDialog) return
      if (s.quickLook) {
        const plain = !e.metaKey && !e.ctrlKey && !e.altKey
        if ((plain && (e.key === 'Escape' || e.code === 'Space')) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y')) {
          e.preventDefault()
          e.stopImmediatePropagation()
          if (!e.repeat) useOS.setState({ quickLook: null })
          return
        }
        if (plain && (e.target as Element)?.closest('input[type="range"]')) return
        if (plain && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !(e.target as Element)?.closest('audio, video, iframe, input[type="range"]')) {
          e.preventDefault()
          e.stopImmediatePropagation()
          moveQuickLook(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1)
          return
        }
        if (plain && e.key !== 'Tab') {
          e.stopImmediatePropagation()
          return
        }
      }
      if (e.altKey && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        s.flashMenu('pear')
        s.openDialog({ kind: 'force-quit' })
        return
      }
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey && /^Digit[345]$/.test(e.code)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.repeat) return
        const copy = e.metaKey && e.ctrlKey
        if (e.code === 'Digit3') quickScreen(copy)
        else if (e.code === 'Digit4') quickSelect(copy)
        else openToolbar()
        return
      }
      if (e.key === 'Escape' && useShots.getState().mode !== 'idle' && !s.contextMenu) {
        e.preventDefault()
        e.stopImmediatePropagation()
        cancelShot()
        return
      }
      const target = e.target as Element
      if (target?.closest?.('.finder-sheet')) return
      const command = e.metaKey || (e.ctrlKey && !navigator.platform.startsWith('Mac') && !target?.closest?.('.app-terminal'))
      if (command && e.altKey && !e.shiftKey && s.activeApp === 'finder' && e.code === 'KeyP') {
        e.preventDefault()
        e.stopImmediatePropagation()
        s.flashMenu('View')
        s.set('finderPathBar', !s.finderPathBar)
        return
      }
      if (command && !e.altKey) {
        const win = s.windows.find((w) => w.id === s.focused)
        const key = e.shiftKey && e.code !== 'Backquote' ? '' : e.code
        let action: (() => void) | undefined
        let flash: string | undefined
        if (key === 'KeyF' && win && e.ctrlKey && e.metaKey) {
          action = () => s.toggleFullscreen(win.id)
          flash = 'View'
        }
        if (!e.metaKey || !e.ctrlKey) {
          if (key === 'KeyW') {
            action = () => { if (win && (win.app !== 'finder' || !closeFinderTab(win.id))) s.closeWindow(win.id) }
            flash = 'File'
          }
          if (key === 'KeyM' && win) {
            action = () => s.minimize(win.id)
            flash = 'Window'
          }
          if (key === 'KeyQ') {
            action = () => { if (s.activeApp !== 'finder') s.closeApp(s.activeApp) }
            flash = 'app'
          }
          if (key === 'KeyH') {
            action = () => s.hideApp(s.activeApp)
            flash = 'app'
          }
          if (key === 'Backquote') action = () => s.cycleWindows(e.shiftKey)
          if (key === 'KeyN') {
            const item = APPS[s.activeApp].menus?.flatMap((m) => m.items).find((item) => item !== 'sep' && item.shortcut === '⌘N')
            action = item && item !== 'sep' && item.action ? () => item.action?.(win ?? null) : () => s.openApp(s.activeApp, { forceNew: true })
            flash = 'File'
          }
          if (s.activeApp === 'finder') {
            const finder = win && finderCommands.get(win.id)
            if (key === 'KeyI' && finder) { action = finder.getInfo; flash = 'File' }
            if (key === 'KeyT') { action = finder ? finder.newTab : () => s.openApp('finder', { forceNew: true }); flash = 'File' }
            if (e.shiftKey && e.code === 'KeyG') { action = () => goToFinderFolder(win?.id); flash = 'Go' }
            if (e.shiftKey && e.code === 'KeyW' && win && finder?.hasTabs) { action = () => s.closeWindow(win.id); flash = 'File' }
            if (e.shiftKey && e.code === 'Backspace') { action = () => s.openDialog({ kind: 'empty-trash' }); flash = 'app' }
            if (key === 'Slash') { action = () => s.set('finderStatusBar', !s.finderStatusBar); flash = 'View' }
            const view = e.metaKey && FINDER_VIEWS.find((v) => 'Digit' + v.shortcut.at(-1) === key)
            if (view && finder) { action = () => finder.setView(view.id); flash = 'View' }
          }
        }
        if (action && !s.overlay.missionControl && !s.overlay.spotlight && !s.overlay.launchpad && !s.quickLook && useShots.getState().mode === 'idle') {
          e.preventDefault()
          e.stopImmediatePropagation()
          if (!e.repeat || key === 'Backquote') {
            if (flash) s.flashMenu(flash)
            action()
            if (s.focused !== os().focused || key === 'Backquote') requestAnimationFrame(() => {
              const frame = document.querySelector<HTMLElement>(`.window[data-win="${os().focused}"]`)
              if (frame && !frame.contains(document.activeElement)) frame.focus({ preventScroll: true })
            })
          }
          return
        }
      }
      if (e.key === 'F3' || (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'ArrowUp')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        s.setOverlay({ missionControl: !s.overlay.missionControl })
      } else if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const spaces = spaceOrder(s)
        const next = spaces[spaces.indexOf(s.activeSpace) + (e.key === 'ArrowLeft' ? -1 : 1)]
        if (next !== undefined) {
          const moving = e.shiftKey && next > 0 ? s.focused : null
          if (moving) s.moveWindowToSpace(moving, next)
          s.switchSpace(next)
          if (moving) s.focus(moving)
        }
      } else if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && /^Digit[1-8]$/.test(e.code)) {
        const target = s.spaces[Number(e.code.slice(5)) - 1]
        if (target !== undefined) {
          e.preventDefault()
          e.stopImmediatePropagation()
          s.switchSpace(target)
        }
      } else if (s.desktopRevealed && e.key === 'Escape') {
        s.toggleDesktop()
      } else if (s.overlay.missionControl && (e.key === 'Escape' || (e.ctrlKey && e.key === 'ArrowDown'))) {
        e.preventDefault()
        e.stopImmediatePropagation()
        s.closeOverlays()
      } else if (!e.shiftKey && (e.ctrlKey || e.altKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault()
        s.setOverlay({ spotlight: !s.overlay.spotlight, launchpad: false, controlCenter: false, notificationCenter: false, menu: null })
      } else if (e.key === 'Escape') {
        s.closeOverlays()
      } else if (e.ctrlKey && e.altKey && s.focused) {
        const map: Record<string, Parameters<typeof s.tileWindow>[1]> = { ArrowLeft: 'left', ArrowRight: 'right', KeyF: 'fill', KeyR: null }
        const key = e.code in map ? e.code : e.key
        if (key in map) {
          e.preventDefault()
          s.tileWindow(s.focused, map[key])
        }
      } else if (e.key === 'F4') {
        e.preventDefault()
        s.setOverlay({ launchpad: !s.overlay.launchpad })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

interface Marquee {
  x0: number
  y0: number
  x1: number
  y1: number
}

function DesktopIcons({
  sel,
  setSel,
  iconRefs,
}: {
  sel: string[]
  setSel: React.Dispatch<React.SetStateAction<string[]>>
  iconRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>
}) {
  useOS((s) => s.fsVersion)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [offsets, setOffsets] = useState<Record<string, { dx: number; dy: number }>>({})
  const [draggingPaths, setDraggingPaths] = useState<string[]>([])
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const active = useOS((s) => s.activeApp === 'finder' && s.focused === null)
  const primarySel = sel.length === 1 ? sel[0] : null
  const startRename = (p: string) => canRename(p) && setRenaming(p)
  useEnterToRename(active && renaming === null, primarySel, startRename)
  const commit = (from: string, to: string) => {
    setRenaming(null)
    const res = rename(from, to)
    if (!res) return
    if ('error' in res) return os().notify({ app: 'finder', title: 'Finder', body: res.error })
    setSel([res.path])
    setOffsets((prev) => {
      if (!prev[from]) return prev
      const next = { ...prev, [res.path]: prev[from] }
      delete next[from]
      return next
    })
    os().bumpFs()
  }
  const desk = resolve(HOME + '/Desktop')
  const files = desk && desk.type === 'dir' ? listDir(desk) : []
  const items = [{ name: 'Pear HD', path: '/', node: null as null | ReturnType<typeof resolve> }, ...files.map(([name, node]) => ({ name, path: `${HOME}/Desktop/${name}`, node }))]
  const quickLook = (p: string) => openVirtualQuickLook(p, items.map((item) => item.path), (item) => setSel([item.path]))
  useQuickLookShortcut(active && renaming === null, primarySel, quickLook)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = os()
      if (!sel.length || !active || s.activeApp !== 'finder' || Object.values(s.overlay).some(Boolean) || s.quickLook || s.systemDialog || renaming || isTextField(e.target as Element)) return
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyI') {
        e.preventDefault()
        showFileInfo(sel[0])
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'Backspace') {
        const deletable = sel.filter((p) => p !== '/' && canRename(p))
        if (!deletable.length) return
        e.preventDefault()
        let moved = false
        for (const p of deletable) if (moveToTrash(p)) moved = true
        if (moved) {
          playTrashMove()
          setSel([])
          os().bumpFs()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, renaming, sel, setSel])

  const beginIconDrag = (path: string, e: React.PointerEvent) => {
    if (e.button !== 0 || renaming) return
    e.stopPropagation()
    os().focus(null)
    let nextSel = sel
    if (e.metaKey || e.ctrlKey) {
      nextSel = sel.includes(path) ? sel.filter((p) => p !== path) : [...sel, path]
      setSel(nextSel)
    } else if (e.shiftKey) {
      nextSel = sel.includes(path) ? sel : [...sel, path]
      setSel(nextSel)
    } else if (!sel.includes(path)) {
      nextSel = [path]
      setSel(nextSel)
    }
    const sx = e.clientX
    const sy = e.clientY
    const group = nextSel.includes(path) ? nextSel : [path]
    let started = false
    let highlightedDock: Element | null = null
    let highlightedFolder: Element | null = null

    const clearHighlights = () => {
      highlightedDock?.classList.remove('drop-target')
      highlightedDock = null
      highlightedFolder?.classList.remove('drop-target')
      highlightedFolder = null
    }

    const hitTarget = (cx: number, cy: number) => {
      const stack = document.elementsFromPoint(cx, cy)
      const dockBtn = stack.find((el) => el.matches('[data-dock-app]'))
      const folderBtn = stack.find((el) => {
        const p = (el as HTMLElement).dataset?.deskFolder
        return !!p && !group.includes(p)
      })
      return { dockBtn, folderBtn }
    }

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (!started) {
        if (Math.hypot(dx, dy) < 5) return
        started = true
        setDraggingPaths(group)
      }
      setDragDelta({ dx, dy })
      clearHighlights()
      const { dockBtn, folderBtn } = hitTarget(ev.clientX, ev.clientY)
      if (dockBtn) {
        dockBtn.classList.add('drop-target')
        highlightedDock = dockBtn
      } else if (folderBtn) {
        folderBtn.classList.add('drop-target')
        highlightedFolder = folderBtn
      }
    }

    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      clearHighlights()
      if (!started) return
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      setDraggingPaths([])
      setDragDelta({ dx: 0, dy: 0 })

      const { dockBtn, folderBtn } = hitTarget(ev.clientX, ev.clientY)
      const dockApp = (dockBtn as HTMLElement | undefined)?.dataset.dockApp as AppId | undefined
      if (dockApp === 'trash') {
        let trashed = false
        for (const p of group) if (p !== '/' && moveToTrash(p)) trashed = true
        if (trashed) {
          playTrashMove()
          setSel([])
          os().bumpFs()
        }
        return
      }
      if (dockApp && dockApp !== 'launchpad') {
        const first = group.find((p) => p !== '/')
        if (first) {
          if (dockApp === 'textedit' || dockApp === 'preview' || dockApp === 'finder') openPath(first)
          else os().openApp(dockApp)
        }
        return
      }
      const folderPath = (folderBtn as HTMLElement | undefined)?.dataset.deskFolder
      if (folderPath) {
        let movedAny = false
        for (const p of group) {
          if (p !== '/' && moveNode(p, folderPath)) movedAny = true
        }
        if (movedAny) {
          setSel([])
          os().bumpFs()
        }
        return
      }
      setOffsets((prev) => {
        const next = { ...prev }
        for (const p of group) {
          const cur = prev[p] ?? { dx: 0, dy: 0 }
          next[p] = { dx: cur.dx + dx, dy: cur.dy + dy }
        }
        return next
      })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div className="desktop-icons" onPointerDown={() => setSel([])}>
      {items.map((it) => {
        const ext = it.name.includes('.') ? it.name.split('.').pop()! : ''
        const isDragging = draggingPaths.includes(it.path)
        const base = offsets[it.path] ?? { dx: 0, dy: 0 }
        const tx = base.dx + (isDragging ? dragDelta.dx : 0)
        const ty = base.dy + (isDragging ? dragDelta.dy : 0)
        return (
          <button
            key={it.path}
            ref={(el) => { iconRefs.current[it.path] = el }}
            data-desk-path={it.path}
            data-desk-folder={it.node?.type === 'dir' ? it.path : undefined}
            className={`desk-icon ${sel.includes(it.path) ? 'sel' : ''} ${isDragging ? 'dragging' : ''}`}
            style={tx || ty ? { transform: `translate(${tx}px, ${ty}px)` } : undefined}
            data-heavy={it.node === null ? '' : undefined}
            onPointerDown={(e) => beginIconDrag(it.path, e)}
            onDoubleClick={() => openPath(it.path)}
            onContextMenu={(e) => {
              if (!sel.includes(it.path)) setSel([it.path])
              menu(fileMenu(it.path, { rename: () => startRename(it.path), quickLook: () => quickLook(it.path) }))(e)
            }}
          >
            {it.node === null ? <DiskIcon size={60} /> : it.node?.type === 'dir' ? <FolderIcon size={60} /> : <FileIcon size={60} kind={it.node!.kind} ext={ext} thumb={fileThumb(it.node)} />}
            {renaming === it.path ? (
              <RenameField name={it.name} dir={it.node?.type === 'dir'} onDone={(to) => commit(it.path, to)} onCancel={() => setRenaming(null)} />
            ) : (
              <span>
                {it.name}
                {(it.node?.tags ?? []).map((tg) => (
                  <i key={tg} className="tag-dot" style={{ background: TAG_COLORS[tg] }} />
                ))}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function usePreloadApps() {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1))
    const t = window.setTimeout(() => idle(preloadApps), 2000)
    return () => clearTimeout(t)
  }, [])
}

function TilePreview() {
  const tilePreview = useOS((s) => s.tilePreview)
  if (!tilePreview) return null
  const r = tileRect(tilePreview)
  return <div className="tile-preview" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
}

function Windows() {
  const windows = useOS((s) => s.windows)
  const focused = useOS((s) => s.focused)
  const activeSpace = useOS((s) => s.activeSpace)
  const assign = useOS((s) => s.assign)
  const hiddenApps = useOS((s) => s.hiddenApps)
  const slide = useOS((s) => s.spaceSlide)
  const revealed = useOS((s) => s.desktopRevealed)
  const mcApp = useOS((s) => s.mcApp)
  const overview = useOS((s) => s.overlay.missionControl)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const layout = useMemo(() => overview ? missionLayout(windows.filter((w) => onSpace(w, activeSpace, assign) && !w.minimized && !hiddenApps.includes(w.app) && (!mcApp || w.app === mcApp))
    .map((w) => w.fullscreen ? { ...w, ...fullscreenRect(fullscreenSide(w, { windows, hiddenApps }), viewport) } : w), viewport.width, viewport.height) : new Map(), [windows, activeSpace, assign, hiddenApps, overview, mcApp, viewport])
  return <>
    {windows.map((w) => <Window key={w.id} win={w} focused={w.id === focused} inactive={!onSpace(w, activeSpace, assign)} hidden={hiddenApps.includes(w.app)}
      displaySide={fullscreenSide(w, { windows, hiddenApps })} viewport={viewport} overviewRect={layout.get(w.id)} slide={slide} revealed={revealed} dimmed={overview && !layout.has(w.id)} />)}
    {overview && <MissionControl layout={layout} viewport={viewport} />}
  </>
}

function Brightness() {
  const brightness = useOS((s) => s.brightness)
  return <div className="brightness" style={{ opacity: 1 - brightness }} />
}

function GravityControls() {
  const { enabled, canRestore } = useGravity()
  const overview = useOS((s) => s.overlay.missionControl)
  const reducedMotion = useA11y((s) => s.reduceMotion)
  if ((!enabled && !canRestore) || overview) return null
  return <div className="gravity-controls glass" role="group" aria-label="Desktop Gravity" onPointerDown={(e) => e.stopPropagation()}>
    <span>{enabled ? reducedMotion ? 'Gravity paused · Reduce Motion' : 'Gravity on' : 'Gravity off'}</span>
    {enabled && <button className="btn small" onClick={() => void setDesktopGravity(false)}>Stop Gravity</button>}
    <button className="btn small" onClick={restoreDesktopOrder}>Restore Order</button>
  </div>
}

export function Desktop() {
  useJokeNotifications()
  useShortcuts()
  usePreloadApps()
  useEffect(mountDesktopGravity, [])
  const missionControl = useOS((s) => s.overlay.missionControl)
  const fullscreen = useOS((s) => s.activeSpace < 0)
  const [deskSel, setDeskSel] = useState<string[]>([])
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const iconRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const startMarquee = (e: React.PointerEvent) => {
    os().focus(null)
    os().closeOverlays()
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('.window, .desk-icon, .wg, .sticky, .menubar, .dock-wrap, .toasts, .gravity-controls')) return
    setDeskSel([])
    const x0 = e.clientX
    const y0 = e.clientY
    let active = false
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
      active = true
      const box = { x0, y0, x1: ev.clientX, y1: ev.clientY }
      setMarquee(box)
      const left = Math.min(box.x0, box.x1)
      const right = Math.max(box.x0, box.x1)
      const top = Math.min(box.y0, box.y1)
      const bottom = Math.max(box.y0, box.y1)
      const hit: string[] = []
      for (const [p, el] of Object.entries(iconRefs.current)) {
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom) hit.push(p)
      }
      setDeskSel(hit)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setMarquee(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div
      className={`desktop ${missionControl ? 'in-mission-control' : ''} ${fullscreen ? 'fullscreen-space' : ''}`}
      onPointerDown={startMarquee}
      onContextMenu={(e) => {
        e.preventDefault()
        const t = e.target as HTMLElement
        if (t.closest('.menubar, .toasts, .control-center, .status-popover, .notif-center, .wg, .spotlight, .launchpad, .dropdown, .dock-wrap, .sys-dialog-backdrop, .dock-stack-catch')) return
        const open = (items: Parameters<typeof openContextMenu>[2]) => openContextMenu(e.clientX, e.clientY, items)
        const field = t.closest('input, textarea')
        if (isTextField(field)) return open(textMenu(field))
        const sel = window.getSelection()?.toString().trim()
        if (sel) return open(selectionMenu(sel))
        const winEl = t.closest<HTMLElement>('.window')
        if (winEl) {
          const win = os().windows.find((w) => w.id === winEl.dataset.win)
          if (!win) return
          os().focus(win.id)
          return open(t.closest('[data-drag]') && !t.closest('button, a, [data-nodrag]') ? windowChromeMenu(win) : windowFallbackMenu(win))
        }
        open(desktopMenu())
      }}
    >
      <HotCorners />
      <Wallpaper />
      <ShaderLayer target="desktop" />
      <ShaderLayer target="sky" />
      <DesktopIcons sel={deskSel} setSel={setDeskSel} iconRefs={iconRefs} />
      {marquee && (
        <div
          className="desktop-marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
      <DesktopWidgets />
      <Stickies />
      <ShaderLayer target="shadow" />
      <TilePreview />
      <Windows />
      <GravityControls />
      <MenuBar />
      <Dock />
      <Notifications />
      <StatusMenuPopover />
      <ControlCenter />
      <NotificationCenter />
      <WidgetGallery />
      <Spotlight />
      <Launchpad />
      <AppSwitcher />
      <SystemDialogs />
      <GlobalContextMenu />
      <QuickLook />
      <ScreenshotUI />
      <ShaderLayer target="overlay" />
      <Brightness />
    </div>
  )
}

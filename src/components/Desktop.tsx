import { useEffect, useMemo, useState } from 'react'
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
import { HOME, canRename, listDir, rename, resolve } from '../lib/fs'
import { RenameField, useEnterToRename } from './RenameField'
import { openPath } from '../apps/open'
import { APPS, preloadApps } from '../apps/registry'
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
      if (command && !e.altKey) {
        const win = s.windows.find((w) => w.id === s.focused)
        const key = e.shiftKey && e.code !== 'Backquote' ? '' : e.code
        let action: (() => void) | undefined
        if (key === 'KeyF' && win && e.ctrlKey && e.metaKey) action = () => s.toggleFullscreen(win.id)
        if (!e.metaKey || !e.ctrlKey) {
          if (key === 'KeyW') action = () => { if (win && (win.app !== 'finder' || !closeFinderTab(win.id))) s.closeWindow(win.id) }
          if (key === 'KeyM' && win) action = () => s.minimize(win.id)
          if (key === 'KeyQ') action = () => { if (s.activeApp !== 'finder') s.closeApp(s.activeApp) }
          if (key === 'KeyH') action = () => s.hideApp(s.activeApp)
          if (key === 'Backquote') action = () => s.cycleWindows(e.shiftKey)
          if (key === 'KeyN') {
            const item = APPS[s.activeApp].menus?.flatMap((m) => m.items).find((item) => item !== 'sep' && item.shortcut === '⌘N')
            action = item && item !== 'sep' && item.action ? () => item.action?.(win ?? null) : () => s.openApp(s.activeApp, { forceNew: true })
          }
          if (s.activeApp === 'finder') {
            const finder = win && finderCommands.get(win.id)
            if (key === 'KeyI' && finder) action = finder.getInfo
            if (key === 'KeyT') action = finder ? finder.newTab : () => s.openApp('finder', { forceNew: true })
            if (e.shiftKey && e.code === 'KeyG') action = () => goToFinderFolder(win?.id)
            if (e.shiftKey && e.code === 'KeyW' && win && finder?.hasTabs) action = () => s.closeWindow(win.id)
            const view = e.metaKey && FINDER_VIEWS.find((v) => 'Digit' + v.shortcut.at(-1) === key)
            if (view && finder) action = () => finder.setView(view.id)
          }
        }
        if (action && !s.overlay.missionControl && !s.overlay.spotlight && !s.overlay.launchpad && !s.quickLook && useShots.getState().mode === 'idle') {
          e.preventDefault()
          e.stopImmediatePropagation()
          if (!e.repeat || key === 'Backquote') {
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

function DesktopIcons() {
  useOS((s) => s.fsVersion)
  const [sel, setSel] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const active = useOS((s) => s.activeApp === 'finder' && s.focused === null)
  const startRename = (p: string) => canRename(p) && setRenaming(p)
  useEnterToRename(active && renaming === null, sel, startRename)
  const commit = (from: string, to: string) => {
    setRenaming(null)
    const res = rename(from, to)
    if (!res) return
    if ('error' in res) return os().notify({ app: 'finder', title: 'Finder', body: res.error })
    setSel(res.path)
    os().bumpFs()
  }
  const desk = resolve(HOME + '/Desktop')
  const files = desk && desk.type === 'dir' ? listDir(desk) : []
  const items = [{ name: 'Pear HD', path: '/', node: null as null | ReturnType<typeof resolve> }, ...files.map(([name, node]) => ({ name, path: `${HOME}/Desktop/${name}`, node }))]
  const quickLook = (p: string) => openVirtualQuickLook(p, items.map((item) => item.path), (item) => setSel(item.path))
  useQuickLookShortcut(active && renaming === null, sel, quickLook)
  useEffect(() => {
    const info = (e: KeyboardEvent) => {
      const s = os()
      if (!sel || !active || s.activeApp !== 'finder' || Object.values(s.overlay).some(Boolean) || s.quickLook || renaming || isTextField(e.target as Element)) return
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyI') {
        e.preventDefault()
        showFileInfo(sel)
      }
    }
    window.addEventListener('keydown', info)
    return () => window.removeEventListener('keydown', info)
  }, [active, renaming, sel])
  return (
    <div className="desktop-icons" onPointerDown={() => setSel(null)}>
      {items.map((it) => {
        const ext = it.name.includes('.') ? it.name.split('.').pop()! : ''
        return (
          <button
            key={it.path}
            className={`desk-icon ${sel === it.path ? 'sel' : ''}`}
            data-heavy={it.node === null ? '' : undefined}
            onPointerDown={(e) => {
              e.stopPropagation()
              os().focus(null)
              setSel(it.path)
            }}
            onDoubleClick={() => openPath(it.path)}
            onContextMenu={(e) => {
              setSel(it.path)
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

  return (
    <div
      className={`desktop ${missionControl ? 'in-mission-control' : ''} ${fullscreen ? 'fullscreen-space' : ''}`}
      onPointerDown={() => {
        os().focus(null)
        os().closeOverlays()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        const t = e.target as HTMLElement
        if (t.closest('.menubar, .toasts, .control-center, .status-popover, .notif-center, .wg, .spotlight, .launchpad, .dropdown, .dock-wrap')) return
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
      <DesktopIcons />
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
      <GlobalContextMenu />
      <QuickLook />
      <ScreenshotUI />
      <ShaderLayer target="overlay" />
      <Brightness />
    </div>
  )
}

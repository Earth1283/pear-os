import { useEffect, useState } from 'react'
import { useOS, os, tileRect } from '../store'
import { Wallpaper } from './Wallpaper'
import { MenuBar } from './MenuBar'
import { Dock } from './Dock'
import { Window } from './Window'
import { ControlCenter, Launchpad, Notifications, Spotlight } from './Overlays'
import { NotificationCenter } from './Center'
import { DesktopWidgets, WidgetGallery } from './Widgets'
import { GlobalContextMenu } from './ContextMenu'
import { isTextField, menu, openContextMenu } from '../lib/menu'
import { desktopMenu, fileMenu, selectionMenu, textMenu, windowChromeMenu, windowFallbackMenu } from '../lib/menus'
import { TAG_COLORS } from './ContextMenu'
import { DiskIcon, FileIcon, FolderIcon } from './icons'
import { HOME, listDir, resolve } from '../lib/fs'
import { openPath } from '../apps/open'

const JOKES: { app: Parameters<ReturnType<typeof os>['notify']>[0]['app']; title: string; body: string; actions?: string[] }[] = [
  { app: 'intelligence', title: 'Pear Intelligence', body: 'Pear Intelligence is ready. Unfortunately, so are we.' },
  { app: 'settings', title: 'Software Update', body: 'PearOS Sequel 15.0.1 is ready to install. It fixes the bugs in 15.0 and adds new, more interesting ones.', actions: ['Later', 'Try Tonight'] },
  { app: 'finder', title: 'Storage Almost Full', body: "You've used 7.9 GB of 8 GB. Upgrade to 16 GB for only $200 (it's like 32 GB)." },
  { app: 'passwords', title: 'Passwords', body: '47 of your passwords appeared in a data leak. All 47 were "password123".' },
  { app: 'mirroring', title: 'pPhone Mirroring', body: 'Your pPhone is nearby. We can tell. It is in your pocket and you are ignoring it.' },
  { app: 'settings', title: 'Background Items Added', body: '"Pear Updater Updater" can run in the background. You can manage this in Login Items & Extensions & Background & Foreground Items.' },
  { app: 'activity', title: 'Activity Monitor', body: 'kernel_task is now using 412% CPU to keep your PearBook cool. It is not working.' },
  { app: 'about', title: 'Screen Time', body: 'Your screen time was up 340% last week, averaging 14 hours a day in this browser tab.' },
]

function useJokeNotifications() {
  useEffect(() => {
    let i = 0
    const fire = () => {
      const j = JOKES[i++ % JOKES.length]
      os().notify({
        app: j.app,
        title: j.title,
        body: j.body,
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
      if ((e.ctrlKey || e.altKey || e.metaKey) && e.code === 'Space') {
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function DesktopIcons() {
  useOS((s) => s.fsVersion)
  const [sel, setSel] = useState<string | null>(null)
  const desk = resolve(HOME + '/Desktop')
  const files = desk && desk.type === 'dir' ? listDir(desk) : []
  const items = [{ name: 'Pear HD', path: '/', node: null as null | ReturnType<typeof resolve> }, ...files.map(([name, node]) => ({ name, path: `${HOME}/Desktop/${name}`, node }))]
  return (
    <div className="desktop-icons" onPointerDown={() => setSel(null)}>
      {items.map((it) => {
        const ext = it.name.includes('.') ? it.name.split('.').pop()! : ''
        return (
          <button
            key={it.path}
            className={`desk-icon ${sel === it.path ? 'sel' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              setSel(it.path)
            }}
            onDoubleClick={() => openPath(it.path)}
            onContextMenu={(e) => {
              setSel(it.path)
              menu(fileMenu(it.path))(e)
            }}
          >
            {it.node === null ? <DiskIcon size={60} /> : it.node?.type === 'dir' ? <FolderIcon size={60} /> : <FileIcon size={60} kind={it.node!.kind} ext={ext} />}
            <span>
              {it.name}
              {(it.node?.tags ?? []).map((tg) => (
                <i key={tg} className="tag-dot" style={{ background: TAG_COLORS[tg] }} />
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function Desktop() {
  const windows = useOS((s) => s.windows)
  const focused = useOS((s) => s.focused)
  const tilePreview = useOS((s) => s.tilePreview)
  const brightness = useOS((s) => s.brightness)
  useJokeNotifications()
  useShortcuts()

  const preview = tilePreview ? tileRect(tilePreview) : null

  return (
    <div
      className="desktop"
      onPointerDown={() => {
        os().focus(null)
        os().closeOverlays()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        const t = e.target as HTMLElement
        if (t.closest('.menubar, .toasts, .control-center, .notif-center, .wg, .spotlight, .launchpad, .dropdown, .dock-wrap')) return
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
      <Wallpaper />
      <DesktopIcons />
      <DesktopWidgets />
      {preview && <div className="tile-preview" style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h }} />}
      {windows.map((w) => (
        <Window key={w.id} win={w} focused={w.id === focused} />
      ))}
      <MenuBar />
      <Dock />
      <Notifications />
      <ControlCenter />
      <NotificationCenter />
      <WidgetGallery />
      <Spotlight />
      <Launchpad />
      <GlobalContextMenu />
      <div className="brightness" style={{ opacity: 1 - brightness }} />
    </div>
  )
}

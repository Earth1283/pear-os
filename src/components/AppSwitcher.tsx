import { useEffect, useRef, useState } from 'react'
import { APPS } from '../apps/registry'
import type { AppId } from '../apps/ids'
import { os, useOS, type AppSwitchShortcut } from '../store'
import { useShots } from '../lib/screenshot'
import { AppIcon } from './icons'

interface Selection {
  apps: AppId[]
  index: number
}

function matches(e: KeyboardEvent, shortcut: AppSwitchShortcut) {
  if (e.metaKey || e.isComposing) return false
  if (shortcut === 'ctrl-shift-space') return e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'Space'
  return e.altKey && !e.ctrlKey && e.code === (shortcut === 'alt-tab' ? 'Tab' : 'Backquote')
}

export function AppSwitcher() {
  const shortcut = useOS((s) => s.appSwitchShortcut)
  const hiddenApps = useOS((s) => s.hiddenApps)
  const [selection, setSelection] = useState<Selection | null>(null)
  const current = useRef<Selection | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  function update(next: Selection | null) {
    current.current = next
    setSelection(next)
  }

  function finish(app?: AppId) {
    const previous = previousFocus.current
    update(null)
    if (app) os().activateApp(app)
    requestAnimationFrame(() => {
      if (current.current) return
      const id = os().focused
      const win = id ? document.querySelector<HTMLElement>(`.window[data-win="${id}"]`) : null
      if (previous?.isConnected && (!app || win?.contains(previous))) previous.focus({ preventScroll: true })
      else win?.focus({ preventScroll: true })
    })
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const cycling = matches(e, shortcut)
      const selection = current.current
      if (!selection && !cycling) return
      if (useShots.getState().mode !== 'idle') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (selection) {
        if (e.key === 'Escape') return finish()
        if (e.key === 'Enter') return finish(selection.apps[selection.index])
        const targetApp = selection.apps[selection.index]
        if (e.code === 'KeyQ' && targetApp && targetApp !== 'finder') {
          os().closeApp(targetApp)
          const remaining = selection.apps.filter((a) => a !== targetApp)
          if (remaining.length === 0) return finish()
          update({ apps: remaining, index: Math.min(selection.index, remaining.length - 1) })
          return
        }
        if (e.code === 'KeyH' && targetApp) {
          if (os().hiddenApps.includes(targetApp)) os().activateApp(targetApp)
          else os().hideApp(targetApp)
          return
        }
        const backward = e.key === 'ArrowLeft' || (e.shiftKey && shortcut !== 'ctrl-shift-space' && cycling)
        if (cycling || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const index = (selection.index + (backward ? -1 : 1) + selection.apps.length) % selection.apps.length
          update({ ...selection, index })
        }
        return
      }
      const apps = os().runningApps.filter((app) => !APPS[app].hidden)
      if (apps.length < 2 || e.repeat) return
      previousFocus.current = document.activeElement as HTMLElement | null
      os().closeOverlays()
      update({ apps, index: e.shiftKey && shortcut !== 'ctrl-shift-space' ? apps.length - 1 : 1 })
    }
    const up = (e: KeyboardEvent) => {
      const selection = current.current
      if (!selection || e.key !== (shortcut === 'ctrl-shift-space' ? 'Control' : 'Alt')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      finish(selection.apps[selection.index])
    }
    const blur = () => { if (current.current) update(null) }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [shortcut])

  useEffect(() => {
    if (!selection) return
    const selected = strip.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    selected?.focus({ preventScroll: true })
  }, [selection])

  if (!selection) return null
  return (
    <div className="app-switch-layer" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) finish() }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
      <div className="app-switcher glass" ref={strip} role="dialog" aria-modal="true" aria-label="App Switcher">
        <div className="app-switch-items">
          {selection.apps.map((app, index) => (
            <button key={app} type="button" className={hiddenApps.includes(app) ? 'hidden-app' : ''} aria-current={index === selection.index} aria-label={APPS[app].name} onClick={() => finish(app)}>
              <AppIcon app={app} size={52} />
              <span>{APPS[app].name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

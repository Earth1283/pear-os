import { useEffect, useState } from 'react'
import { AlertTriangle, Power, RotateCcw, LogOut, Trash2 } from 'lucide-react'
import { os, useOS } from '../store'
import { APPS } from '../apps/registry'
import type { AppId } from '../apps/ids'
import { AppIcon } from './icons'
import { emptyTrash, trashCount } from '../lib/fs'
import { logout } from '../lib/backend'
import { usePlayer } from '../lib/player'
import { playBonk, playTrashEmpty } from '../lib/sounds'
import './SystemDialogs.css'

export function SystemDialogs() {
  const dialog = useOS((s) => s.systemDialog)
  if (!dialog) return null
  if (dialog.kind === 'force-quit') return <ForceQuitDialog />
  if (dialog.kind === 'power') return <PowerConfirmDialog mode={dialog.mode} />
  if (dialog.kind === 'empty-trash') return <EmptyTrashDialog />
  return null
}

function ForceQuitDialog() {
  const running = useOS((s) => s.runningApps.filter((a) => !APPS[a].hidden))
  const [selected, setSelected] = useState<AppId>(() => running[0] ?? 'finder')
  const activeSel = running.includes(selected) ? selected : running[0] ?? 'finder'
  const close = () => os().closeDialog()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = running.indexOf(activeSel)
        const next = running[(idx + (e.key === 'ArrowDown' ? 1 : -1) + running.length) % running.length]
        if (next) setSelected(next)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        forceQuitSelected()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const forceQuitSelected = () => {
    if (activeSel === 'finder') {
      const wins = os().windows.filter((w) => w.app === 'finder')
      wins.forEach((w) => os().closeWindow(w.id))
      os().notify({ app: 'finder', title: 'Finder', body: 'Finder relaunched. It was never really gone.' })
    } else {
      os().closeApp(activeSel)
    }
    playBonk()
  }

  return (
    <div className="sys-dialog-backdrop" onPointerDown={close}>
      <div className="sys-dialog force-quit glass" role="dialog" aria-modal="true" aria-label="Force Quit Applications" onPointerDown={(e) => e.stopPropagation()}>
        <div className="fq-header">
          <button className="tl tl-close" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 10 10"><path d="M3 3l4 4M7 3l-4 4" /></svg>
          </button>
          <span className="fq-title">Force Quit Applications</span>
        </div>
        <p className="fq-desc">If an app doesn’t respond for a while, select its name and click Force Quit.</p>
        <div className="fq-list" role="listbox" aria-label="Running applications">
          {running.map((app) => {
            const notResponding = app === 'intelligence'
            return (
              <button
                key={app}
                type="button"
                role="option"
                aria-selected={activeSel === app}
                className={`fq-row ${activeSel === app ? 'sel' : ''} ${notResponding ? 'nr' : ''}`}
                onClick={() => setSelected(app)}
                onDoubleClick={forceQuitSelected}
              >
                <AppIcon app={app} size={22} />
                <span className="fq-name">
                  {APPS[app].name}
                  {notResponding && <em> (not responding)</em>}
                </span>
              </button>
            )
          })}
        </div>
        <div className="fq-footer">
          <small>You can open this window by pressing ⌥⌘⎋.</small>
          <button className="btn primary" onClick={forceQuitSelected}>
            {activeSel === 'finder' ? 'Relaunch' : 'Force Quit'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PowerConfirmDialog({ mode }: { mode: 'restart' | 'shutdown' | 'logout' }) {
  const [seconds, setSeconds] = useState(60)
  const [reopen, setReopen] = useState(true)
  const close = () => os().closeDialog()

  const confirm = () => {
    close()
    if (mode === 'logout') {
      usePlayer.getState().stop()
      logout()
      os().resetSession()
      os().setPhase('login')
      return
    }
    os().set('shutdownMode', mode === 'restart' ? 'restart' : 'off')
    os().setPhase('shuttingdown')
  }

  useEffect(() => {
    const t = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(t)
          confirm()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        confirm()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const copy =
    mode === 'restart'
      ? {
          icon: <RotateCcw size={28} strokeWidth={1.8} />,
          title: 'Are you sure you want to restart your computer now?',
          sub: `If you do nothing, the computer will restart automatically in ${seconds} second${seconds === 1 ? '' : 's'}.`,
          action: 'Restart',
        }
      : mode === 'shutdown'
        ? {
            icon: <Power size={28} strokeWidth={1.8} />,
            title: 'Are you sure you want to shut down your computer now?',
            sub: `If you do nothing, the computer will shut down automatically in ${seconds} second${seconds === 1 ? '' : 's'}.`,
            action: 'Shut Down',
          }
        : {
            icon: <LogOut size={28} strokeWidth={1.8} />,
            title: 'Are you sure you want to quit all applications and log out now?',
            sub: `If you do nothing, you will be logged out automatically in ${seconds} second${seconds === 1 ? '' : 's'}.`,
            action: 'Log Out',
          }

  return (
    <div className="sys-dialog-backdrop" onPointerDown={close}>
      <div className="sys-dialog mac-alert glass" role="alertdialog" aria-modal="true" aria-label={copy.action} onPointerDown={(e) => e.stopPropagation()}>
        <div className="mac-alert-icon">{copy.icon}</div>
        <div className="mac-alert-body">
          <h3>{copy.title}</h3>
          <p>{copy.sub}</p>
          <label className="mac-alert-check">
            <input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} />
            <span>Reopen windows when logging back in</span>
          </label>
          <div className="mac-alert-actions">
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" onClick={confirm}>{copy.action}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyTrashDialog() {
  const count = trashCount()
  const close = () => os().closeDialog()

  const confirm = () => {
    const n = emptyTrash()
    os().bumpFs()
    playTrashEmpty()
    close()
    os().notify({
      app: 'trash',
      title: 'Trash Emptied',
      body: n ? `${n} item${n === 1 ? '' : 's'} permanently erased, including your feelings.` : 'The Trash was already empty.',
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        confirm()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="sys-dialog-backdrop" onPointerDown={close}>
      <div className="sys-dialog mac-alert glass" role="alertdialog" aria-modal="true" aria-label="Empty Trash" onPointerDown={(e) => e.stopPropagation()}>
        <div className="mac-alert-icon warn">
          <Trash2 size={28} strokeWidth={1.7} />
          <AlertTriangle size={14} className="mac-alert-badge" />
        </div>
        <div className="mac-alert-body">
          <h3>Are you sure you want to permanently erase the items in the Trash?</h3>
          <p>You can’t undo this action. {count} item{count === 1 ? '' : 's'} will be erased forever.</p>
          <div className="mac-alert-actions">
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" onClick={confirm}>Empty Trash</button>
          </div>
        </div>
      </div>
    </div>
  )
}

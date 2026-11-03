import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { os, useOS, type HistoryItem } from '../store'
import { APPS } from '../apps/registry'
import { AppIcon } from './icons'
import { CenterWidget, openGallery } from './Widgets'

function ago(t: number, now: number) {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86_400)}d ago`
}

export function NotificationCenter() {
  const open = useOS((s) => s.overlay.notificationCenter)
  const history = useOS((s) => s.history)
  const widgets = useOS((s) => s.widgets.center)
  const dnd = useOS((s) => s.dnd)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(t)
  }, [open])

  const groups = useMemo(() => {
    const map = new Map<string, HistoryItem[]>()
    for (const h of history) map.set(h.app, [...(map.get(h.app) ?? []), h])
    return [...map.entries()]
  }, [history])

  if (!open) return null
  return (
    <div className="overlay-catch" onPointerDown={() => os().setOverlay({ notificationCenter: false })}>
      <aside className="notif-center glass" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()} aria-label="Notification Center">
        <div className="nc-scroll">
          <section>
            <header className="nc-head">
              <h2>Notifications</h2>
              {history.length > 0 && (
                <button className="nc-clear" title="Clear All" onClick={() => os().clearHistory()}>
                  <X size={12} strokeWidth={3} />
                </button>
              )}
            </header>
            {dnd && <p className="nc-dnd">Do Not Disturb is on. New notifications will wait here quietly.</p>}
            {history.length === 0 ? (
              <p className="nc-empty">No Notifications</p>
            ) : (
              groups.map(([app, items]) => (
                <div key={app} className="nc-group">
                  <div className="nc-gh">
                    <span>{APPS[items[0].app].name}</span>
                    <button title={`Clear ${APPS[items[0].app].name}`} onClick={() => os().clearHistory(items[0].app)}>
                      <X size={10} strokeWidth={3} />
                    </button>
                  </div>
                  {items.map((h) => (
                    <div key={h.id} className="nc-item">
                      <AppIcon app={h.app} size={32} />
                      <div className="nc-body">
                        <div className="nc-ih">
                          <b>{h.title}</b>
                          <small>{ago(h.time, now)}</small>
                        </div>
                        <p>{h.body}</p>
                      </div>
                      <button className="nc-x" title="Dismiss" onClick={() => os().removeHistory(h.id)}>
                        <X size={10} strokeWidth={3} />
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </section>
          <section>
            <header className="nc-head">
              <h2>Widgets</h2>
            </header>
            <div className="nc-widgets">
              {widgets.map((w) => (
                <CenterWidget key={w.id} w={w} />
              ))}
            </div>
            <button className="nc-edit" onClick={() => openGallery('center')}>
              Edit Widgets
            </button>
          </section>
        </div>
      </aside>
    </div>
  )
}

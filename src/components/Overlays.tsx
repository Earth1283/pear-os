import { useEffect, useMemo, useRef, useState } from 'react'
import { Airplay, Bluetooth, Calculator as CalcIcon, Globe, Moon, Radio, Search, Sun, Volume2, Wifi, X, Contrast, MonitorSmartphone } from 'lucide-react'
import { useOS, os } from '../store'
import { APPS, LAUNCHPAD_APPS } from '../apps/registry'
import type { AppId } from '../apps/ids'
import { AppIcon } from './icons'
import { calc, formatNumber } from '../kernel'

export function Spotlight() {
  const open = useOS((s) => s.overlay.spotlight)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => input.current?.focus(), 10)
    }
  }, [open])

  const results = useMemo(() => {
    const out: { key: string; icon: React.ReactNode; title: string; sub: string; run: () => void }[] = []
    const t = q.trim()
    if (!t) return out
    const v = calc(t)
    if (v !== null && /[\d)]/.test(t)) {
      out.push({
        key: 'calc',
        icon: <CalcIcon size={22} />,
        title: `${t} = ${formatNumber(v)}`,
        sub: 'Calculated in Rust, compiled to WebAssembly, for your convenience',
        run: () => navigator.clipboard?.writeText(String(v)),
      })
    }
    const lower = t.toLowerCase()
    for (const id of LAUNCHPAD_APPS) {
      if (APPS[id].name.toLowerCase().includes(lower)) out.push({ key: id, icon: <AppIcon app={id} size={26} />, title: APPS[id].name, sub: 'Application', run: () => os().openApp(id) })
    }
    out.push({
      key: 'web',
      icon: <Globe size={22} />,
      title: `Search the web for “${t}”`,
      sub: 'Gargle',
      run: () => os().openApp('safari', { props: { url: `gargle.com/search?q=${encodeURIComponent(t)}` } }),
    })
    out.push({
      key: 'siri',
      icon: <AppIcon app="intelligence" size={26} />,
      title: `Ask Pear Intelligence about “${t}”`,
      sub: 'Results may vary. Results will vary.',
      run: () => os().openApp('intelligence', { props: { ask: t } }),
    })
    return out
  }, [q])

  if (!open) return null
  const go = (i: number) => {
    const r = results[i]
    if (!r) return
    os().setOverlay({ spotlight: false })
    r.run()
  }
  return (
    <div className="overlay-catch" onPointerDown={() => os().setOverlay({ spotlight: false })}>
      <div className="spotlight glass" onPointerDown={(e) => e.stopPropagation()}>
        <div className="spot-input">
          <Search size={22} opacity={0.55} />
          <input
            ref={input}
            value={q}
            placeholder="Spotlight Search"
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') os().setOverlay({ spotlight: false })
              if (e.key === 'ArrowDown') setSel((s) => Math.min(results.length - 1, s + 1))
              if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1))
              if (e.key === 'Enter') go(sel)
            }}
          />
        </div>
        {results.length > 0 && (
          <div className="spot-results">
            {results.map((r, i) => (
              <button key={r.key} className={`spot-row ${i === sel ? 'sel' : ''}`} onPointerEnter={() => setSel(i)} onClick={() => go(i)}>
                <span className="spot-icon">{r.icon}</span>
                <span className="spot-text">
                  <span className="spot-title">{r.title}</span>
                  <span className="spot-sub">{r.sub}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Launchpad() {
  const open = useOS((s) => s.overlay.launchpad)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (open) setQ('')
  }, [open])
  if (!open) return null
  const apps = LAUNCHPAD_APPS.filter((id) => APPS[id].name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="launchpad" onPointerDown={() => os().setOverlay({ launchpad: false })}>
      <div className="lp-search" onPointerDown={(e) => e.stopPropagation()}>
        <Search size={14} opacity={0.7} />
        <input autoFocus value={q} placeholder="Search" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && os().setOverlay({ launchpad: false })} />
      </div>
      <div className="lp-grid">
        {apps.map((id) => (
          <button
            key={id}
            className="lp-app"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              os().setOverlay({ launchpad: false })
              os().openApp(id)
            }}
          >
            <AppIcon app={id} size={88} />
            <span>{APPS[id].name}</span>
          </button>
        ))}
      </div>
      <div className="lp-dots">
        <span className="on" />
        <span />
      </div>
    </div>
  )
}

function Tile({ on, icon, label, sub, onClick }: { on: boolean; icon: React.ReactNode; label: string; sub: string; onClick: () => void }) {
  return (
    <button className="cc-row" onClick={onClick}>
      <span className={`cc-circle ${on ? 'on' : ''}`}>{icon}</span>
      <span className="cc-text">
        <b>{label}</b>
        <small>{sub}</small>
      </span>
    </button>
  )
}

export function ControlCenter() {
  const open = useOS((s) => s.overlay.controlCenter)
  const { wifi, bluetooth, brightness, volume, theme } = useOS()
  const [airdrop, setAirdrop] = useState(true)
  const [focus, setFocus] = useState(false)
  if (!open) return null
  return (
    <div className="overlay-catch" onPointerDown={() => os().setOverlay({ controlCenter: false })}>
      <div className="control-center glass" onPointerDown={(e) => e.stopPropagation()}>
        <div className="cc-grid">
          <div className="cc-card cc-net">
            <Tile on={wifi} icon={<Wifi size={15} />} label="Wi-Fi" sub={wifi ? 'PearNet' : 'Off'} onClick={() => os().set('wifi', !wifi)} />
            <Tile on={bluetooth} icon={<Bluetooth size={15} />} label="Bluetooth" sub={bluetooth ? 'On, connected to nothing' : 'Off'} onClick={() => os().set('bluetooth', !bluetooth)} />
            <Tile on={airdrop} icon={<Radio size={15} />} label="AirDrop" sub={airdrop ? 'Everyone for 10 Minutes' : 'Receiving Off'} onClick={() => setAirdrop(!airdrop)} />
          </div>
          <div className="cc-col">
            <button className="cc-card cc-small" onClick={() => setFocus(!focus)}>
              <span className={`cc-circle ${focus ? 'on purple' : ''}`}>
                <Moon size={15} />
              </span>
              <b>{focus ? 'Do Not Disturb' : 'Focus'}</b>
            </button>
            <div className="cc-split">
              <button className="cc-card cc-tiny" onClick={() => os().set('theme', theme === 'dark' ? 'light' : 'dark')}>
                <Contrast size={18} />
                <small>{theme === 'dark' ? 'Dark' : 'Light'} Mode</small>
              </button>
              <button
                className="cc-card cc-tiny"
                onClick={() => os().notify({ app: 'mirroring', title: 'Screen Mirroring', body: 'Looking for displays… Found: the one you are looking at.' })}
              >
                <Airplay size={18} />
                <small>Mirroring</small>
              </button>
            </div>
          </div>
        </div>
        <div className="cc-card cc-slider">
          <b>Display</b>
          <label>
            <Sun size={14} />
            <input type="range" min={0.25} max={1} step={0.01} value={brightness} onChange={(e) => os().set('brightness', +e.target.value)} />
          </label>
        </div>
        <div className="cc-card cc-slider">
          <b>Sound</b>
          <label>
            <Volume2 size={14} />
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => os().set('volume', +e.target.value)} />
          </label>
        </div>
        <button className="cc-card cc-wide" onClick={() => os().openApp('mirroring')}>
          <MonitorSmartphone size={16} />
          <span>pPhone Mirroring</span>
        </button>
      </div>
    </div>
  )
}

export function Notifications() {
  const toasts = useOS((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast glass">
          <button className="toast-x" onClick={() => os().dismiss(t.id)} aria-label="Dismiss">
            <X size={10} strokeWidth={3} />
          </button>
          <AppIcon app={t.app} size={36} />
          <div className="toast-body">
            <div className="toast-head">
              <b>{t.title}</b>
              <small>now</small>
            </div>
            <p>{t.body}</p>
            {t.actions && (
              <div className="toast-actions">
                {t.actions.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => {
                      os().dismiss(t.id)
                      a.run?.()
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export type { AppId }

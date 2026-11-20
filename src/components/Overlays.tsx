import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Airplay, Bluetooth, Calculator as CalcIcon, Globe, LayoutGrid, Moon, Pause, Play, Radio, Search, SkipBack, SkipForward, Sun, Volume2, Wifi, X, Contrast, MonitorSmartphone } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useOS, os } from '../store'
import { APPS, LAUNCHPAD_APPS } from '../apps/registry'
import type { AppId } from '../apps/ids'
import { AppIcon } from './icons'
import { calc, formatNumber } from '../kernel'
import { STATION_TRACKS, useCurrent, usePlayer } from '../lib/player'
import { useSpoken } from '../lib/captions'
import { Art, Eq } from './MusicBits'
import { indexVirtualFiles, searchVirtualFiles } from '../lib/fileSearch'
import { formatBytes, HOME, parentOf } from '../lib/fs'
import { openVirtualQuickLook, virtualLookItem, type QuickLookItem } from '../lib/quickLook'
import { QuickLookContent, QuickLookIcon } from './QuickLook'
import { openPath } from '../apps/open'
import { revealInFinder } from '../apps/finderCommands'

export function Spotlight() {
  const open = useOS((s) => s.overlay.spotlight)
  return open ? <SpotlightPanel /> : null
}

interface SpotlightResult {
  key: string
  icon: React.ReactNode
  title: string
  sub: string
  run: () => void
  item?: QuickLookItem
}

function SpotlightPanel() {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const version = useOS((s) => s.fsVersion)
  const files = useMemo(() => indexVirtualFiles(), [version])

  const results = useMemo(() => {
    const out: SpotlightResult[] = []
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
    if ('mission control spaces desktops'.includes(lower)) out.push({ key: 'mission-control', icon: <LayoutGrid size={24} />, title: 'Mission Control', sub: 'Windows & Desktops', run: () => os().setOverlay({ missionControl: true }) })
    for (const id of LAUNCHPAD_APPS) {
      if (APPS[id].name.toLowerCase().includes(lower)) out.push({ key: id, icon: <AppIcon app={id} size={26} />, title: APPS[id].name, sub: 'Application', run: () => os().openApp(id) })
    }
    for (const path of searchVirtualFiles(files, t)) {
      const item = virtualLookItem(path)
      if (!item) continue
      const location = parentOf(path).dir.replace(HOME, '~')
      out.push({ key: path, icon: <QuickLookIcon item={item} size={23} />, title: item.name,
        sub: `${item.dir ? 'Folder' : 'File'} · ${location}`, item, run: () => openPath(path) })
    }
    const { drive, local } = usePlayer.getState()
    const hits = [...STATION_TRACKS, ...drive, ...local].filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(lower)).slice(0, 4)
    for (const t of hits) {
      out.push({
        key: t.id,
        icon: <Art track={t} size={26} radius={5} />,
        title: t.title,
        sub: t.source === 'station' ? 'Pear Radio · Live' : `Song · ${t.artist}`,
        run: () => {
          usePlayer.getState().playTrack(t, t.source === 'station' ? STATION_TRACKS : t.source === 'drive' ? drive : local)
          os().openApp('music', { props: { view: 'now' } })
        },
      })
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
  }, [q, files])

  const index = Math.min(sel, results.length - 1)
  const item = results[index]?.item
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focused = os().focused
    input.current?.focus()
    return () => {
      requestAnimationFrame(() => {
        const s = os()
        if (!s.overlay.spotlight && !s.quickLook && s.focused === focused && previous?.isConnected && document.activeElement === document.body) {
          previous.focus({ preventScroll: true })
        }
      })
    }
  }, [])
  useEffect(() => {
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, q])

  const go = (i: number) => {
    const result = results[i]
    if (!result) return
    os().setOverlay({ spotlight: false })
    result.run()
  }
  const showInFinder = () => item && revealInFinder(item.path)
  const quickLook = () => item && openVirtualQuickLook(item.path, results.flatMap((r) => r.item ? [r.item.path] : []))

  return (
    <div className="overlay-catch" onPointerDown={(e) => {
      e.stopPropagation()
      os().setOverlay({ spotlight: false })
    }}>
      <div ref={panel} className="spotlight glass" role="dialog" aria-label="Spotlight" aria-modal="true" onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return
          const items = [...(panel.current?.querySelectorAll<HTMLElement>('.spot-input input, .spot-preview [tabindex="0"], .spot-preview button, .spot-preview a[href]') ?? [])]
          const active = items.indexOf(document.activeElement as HTMLElement)
          const next = items[(active + (e.shiftKey ? -1 : 1) + items.length) % items.length]
          if (next) { e.preventDefault(); next.focus() }
        }}>
        <div className="spot-input">
          <Search size={22} opacity={0.55} />
          <input
            ref={input}
            role="combobox"
            aria-label="Spotlight Search"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={results.length ? listId : undefined}
            aria-activedescendant={index >= 0 ? `${listId}-${index}` : undefined}
            value={q}
            placeholder="Spotlight Search"
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') os().setOverlay({ spotlight: false })
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setSel(Math.max(0, Math.min(results.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))))
              }
              if (item && (e.metaKey || e.ctrlKey) && e.code === 'KeyY') {
                e.preventDefault()
                quickLook()
              } else if (item && (e.metaKey || e.ctrlKey) && e.code === 'KeyR') {
                e.preventDefault()
                showInFinder()
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (item && (e.metaKey || e.ctrlKey)) showInFinder()
                else go(index)
              }
            }}
          />
        </div>
        {results.length > 0 && (
          <div className={`spot-body ${item ? 'with-preview' : ''}`}>
            <div className="spot-results" ref={resultsRef} id={listId} role="listbox" aria-label="Search results">
              {results.map((result, i) => (
                <button key={result.key} id={`${listId}-${i}`} role="option" aria-selected={i === index} tabIndex={-1}
                  className={`spot-row ${i === index ? 'sel' : ''}`} onPointerMove={() => { if (i !== index) setSel(i) }} onClick={() => go(i)}>
                  <span className="spot-icon">{result.icon}</span>
                  <span className="spot-text"><span className="spot-title">{result.title}</span><span className="spot-sub">{result.sub}</span></span>
                </button>
              ))}
            </div>
            {item && <aside className="spot-preview" aria-label={`Preview of ${item.name}`}>
              <div className="spot-preview-content"><QuickLookContent key={`${item.path}:${version}`} item={item} /></div>
              <div className="spot-preview-details">
                <strong title={item.name}>{item.name}</strong>
                <small>{formatBytes(item.size)} · {new Date(item.modified).toLocaleDateString()}</small>
                <div className="spot-preview-actions">
                  <button className="btn small" title="Quick Look (⌘Y)" onClick={quickLook}>Quick Look</button>
                  <button className="btn small" title="Show in Finder (⌘R)" onClick={showInFinder}>Show in Finder</button>
                </div>
              </div>
            </aside>}
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

function NowPlayingCard() {
  const cur = useCurrent()
  const spoken = useSpoken()
  const playing = usePlayer((s) => s.playing)
  const p = usePlayer.getState()
  return (
    <div className="cc-card cc-music">
      <button className="cc-music-main" onClick={() => os().openApp('music', { props: { view: 'now' } })} title="Open Music">
        <Art track={cur} size={44} radius={7} />
        <span className="cc-text">
          <b>{cur?.title ?? 'Not Playing'}</b>
          <small>{cur?.source === 'station' && spoken ? spoken : cur ? cur.artist : 'Music'}</small>
        </span>
        {cur && playing && <Eq playing />}
      </button>
      <div className="cc-music-ctl">
        <button title="Previous" onClick={() => p.prev()} disabled={!cur}>
          <SkipBack size={15} fill="currentColor" />
        </button>
        <button title={playing ? 'Pause' : 'Play'} onClick={() => p.toggle()}>
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
        </button>
        <button title="Next" onClick={() => p.next()} disabled={!cur}>
          <SkipForward size={15} fill="currentColor" />
        </button>
      </div>
    </div>
  )
}

export function ControlCenter() {
  const open = useOS((s) => s.overlay.controlCenter)
  const [airdrop, setAirdrop] = useState(true)
  return open ? <ControlCenterPanel airdrop={airdrop} setAirdrop={setAirdrop} /> : null
}

function ControlCenterPanel({ airdrop, setAirdrop }: { airdrop: boolean; setAirdrop: (v: boolean) => void }) {
  const { wifi, bluetooth, brightness, volume, theme, dnd } = useOS(useShallow((s) => ({ wifi: s.wifi, bluetooth: s.bluetooth, brightness: s.brightness, volume: s.volume, theme: s.theme, dnd: s.dnd })))
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
            <button className="cc-card cc-small" onClick={() => os().set('dnd', !dnd)} aria-pressed={dnd}>
              <span className={`cc-circle ${dnd ? 'on purple' : ''}`}>
                <Moon size={15} />
              </span>
              <b>{dnd ? 'Do Not Disturb' : 'Focus'}</b>
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
        <NowPlayingCard />
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
  const centerOpen = useOS((s) => s.overlay.notificationCenter)
  if (centerOpen) return null
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

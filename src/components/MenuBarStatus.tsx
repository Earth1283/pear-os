import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AudioLines, Bluetooth, Camera, Check, ChevronLeft, ChevronRight, Contrast, MonitorSmartphone, Moon, Pause, Play, Radio, Search, SkipBack, SkipForward, Sun, ToggleLeft, ToggleRight, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { os, useOS } from '../store'
import type { StatusMenu } from '../lib/menuBarConfig'
import { useCurrent, usePlayer } from '../lib/player'
import { useSpoken } from '../lib/captions'
import { stopRecording, useShots } from '../lib/screenshot'
import { playPop } from '../lib/sounds'
import { Art, Eq } from './MusicBits'
import { IntelOrb } from './icons'
import './MenuBarStatus.css'

const TITLES: Record<StatusMenu, string> = {
  wifi: 'Wi-Fi', bluetooth: 'Bluetooth', battery: 'Battery', focus: 'Focus',
  sound: 'Sound', nowPlaying: 'Now Playing', privacy: 'Privacy',
}

type BatteryManager = EventTarget & { level: number; charging: boolean }
type BatteryStatus = { percent: number; pluggedIn: boolean }

function useBatteryStatus() {
  const [status, setStatus] = useState<BatteryStatus | null>(null)
  useEffect(() => {
    const source = navigator as Navigator & { getBattery?(): Promise<BatteryManager> }
    const controller = new AbortController()
    void source.getBattery?.().then((battery) => {
      if (controller.signal.aborted) return
      const update = () => setStatus({ percent: Math.round(battery.level * 100), pluggedIn: battery.charging })
      battery.addEventListener('levelchange', update, { signal: controller.signal })
      battery.addEventListener('chargingchange', update, { signal: controller.signal })
      update()
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  return status
}

function BatteryIcon({ status }: { status: BatteryStatus | null }) {
  return (
    <svg width="25" height="12" viewBox="0 0 25 12" aria-hidden="true">
      <rect x=".5" y=".5" width="21" height="11" rx="3" fill="none" stroke="currentColor" opacity=".65" />
      {status ? <rect x="2" y="2" width={(18 * status.percent) / 100} height="8" rx="1.6" fill="currentColor" />
        : <path d="M8 6h6" stroke="currentColor" opacity=".65" />}
      <path d="M23 4v4c.8-.3 1.3-1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity=".65" />
    </svg>
  )
}

function Clock() {
  const { date, clock24Hour, clockSeconds } = useOS((s) => s.menuBar)
  const open = useOS((s) => s.overlay.notificationCenter)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const period = clockSeconds ? 1000 : 60_000
    let timer: number
    const tick = () => {
      setNow(new Date())
      timer = window.setTimeout(tick, period - (Date.now() % period) + 20)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [clockSeconds])
  return (
    <button className={`mb-item clock ${open ? 'active' : ''}`} title="Notification Center" aria-expanded={open}
      onClick={() => os().setOverlay({ notificationCenter: !open })}>
      {date && <span className="mb-clock-date">{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')}</span>}
      <span>{now.toLocaleTimeString('en-US', { hour: clock24Hour ? '2-digit' : 'numeric', minute: '2-digit', second: clockSeconds ? '2-digit' : undefined, hourCycle: clock24Hour ? 'h23' : 'h12' })}</span>
    </button>
  )
}

function StatusButton({ id, title, children }: { id: StatusMenu; title?: string; children: ReactNode }) {
  const open = useOS((s) => s.overlay.statusMenu === id)
  return (
    <button id={`mb-${id}`} className={`mb-item icon mb-${id} ${open ? 'active' : ''}`} title={title ?? TITLES[id]}
      aria-label={TITLES[id]} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => os().setOverlay({ statusMenu: open ? null : id })}>
      {children}
    </button>
  )
}

export function MenuBarStatus() {
  const { wifi, bluetooth, dnd, volume, menuBar, cameraInUse } = useOS(useShallow((s) => ({
    wifi: s.wifi, bluetooth: s.bluetooth, dnd: s.dnd, volume: s.volume, menuBar: s.menuBar, cameraInUse: s.cameraInUse,
  })))
  const { statusMenu, controlCenter, spotlight } = useOS((s) => s.overlay)
  const countdown = useShots((s) => s.countdown)
  const recording = useShots((s) => s.recording !== null)
  const current = useCurrent()
  const playing = usePlayer((s) => s.playing)
  const battery = useBatteryStatus()
  const WifiIcon = wifi ? Wifi : WifiOff
  const SoundIcon = volume > 0 ? Volume2 : VolumeX
  return (
    <div className="mb-right">
      {countdown !== null && <span className="mb-item icon mb-countdown" title="Screenshot timer" aria-live="polite">{countdown}</span>}
      {recording && (
        <button className="mb-item icon mb-rec" title="Stop Recording" aria-label="Stop Recording" onClick={() => stopRecording()}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <rect x="5.4" y="5.4" width="5.2" height="5.2" rx="1" fill="currentColor" />
          </svg>
        </button>
      )}
      {(dnd || statusMenu === 'focus') && <StatusButton id="focus" title={dnd ? 'Do Not Disturb is on' : 'Focus'}><Moon size={13} fill={dnd ? 'currentColor' : 'none'} /></StatusButton>}
      {(current || statusMenu === 'nowPlaying') && <StatusButton id="nowPlaying" title={current ? `Now Playing · ${current.title}` : undefined}><AudioLines size={15} className={playing ? 'mb-playing' : ''} /></StatusButton>}
      {menuBar.sound && <StatusButton id="sound"><SoundIcon size={16} /></StatusButton>}
      {menuBar.bluetooth && <StatusButton id="bluetooth" title={bluetooth ? 'Bluetooth on' : 'Bluetooth off'}><Bluetooth size={15} opacity={bluetooth ? 1 : 0.55} /></StatusButton>}
      {menuBar.battery && <StatusButton id="battery" title={battery ? `Battery · ${battery.percent}%` : 'Battery'}>
        {menuBar.batteryPercentage && battery && <span className="pct">{battery.percent}%</span>}
        <BatteryIcon status={battery} />
      </StatusButton>}
      {menuBar.wifi && <StatusButton id="wifi" title={wifi ? 'Wi-Fi · PearNet' : 'Wi-Fi off'}><WifiIcon size={16} strokeWidth={2.2} /></StatusButton>}
      {menuBar.spotlight && <button className={`mb-item icon ${spotlight ? 'active' : ''}`} title="Spotlight" aria-label="Spotlight" aria-expanded={spotlight}
        onClick={() => os().setOverlay({ spotlight: !spotlight })}><Search size={14} strokeWidth={2.4} /></button>}
      <button id="mb-control-center" className={`mb-item icon ${controlCenter ? 'active' : ''}`} title="Control Center" aria-label="Control Center"
        aria-expanded={controlCenter} aria-haspopup="dialog" onClick={() => os().setOverlay({ controlCenter: !controlCenter })}>
        <span className="mb-control-icon" aria-hidden="true"><ToggleRight size={16} /><ToggleLeft size={16} /></span>
      </button>
      {(cameraInUse || statusMenu === 'privacy') && <StatusButton id="privacy" title={cameraInUse ? 'Photo Booth is using the camera' : 'Camera inactive'}><span className="mb-privacy-dot" data-active={cameraInUse} /></StatusButton>}
      <button className="mb-item icon mb-intelligence" title="Pear Intelligence" aria-label="Pear Intelligence" onClick={() => os().openApp('intelligence')}>
        <IntelOrb size={16} />
      </button>
      <Clock />
    </div>
  )
}

function SettingsLink({ pane, children }: { pane: string; children: ReactNode }) {
  return <button className="status-link" onClick={() => os().openApp('settings', { props: { pane } })}>{children}</button>
}

function StatusToggle({ label, checked, change }: { label: string; checked: boolean; change: (value: boolean) => void }) {
  return (
    <button className="status-option" role="switch" aria-checked={checked} onClick={() => change(!checked)}>
      <span>{label}</span><span className={`toggle ${checked ? 'on' : ''}`} aria-hidden="true" />
    </button>
  )
}

function Slider({ kind }: { kind: 'brightness' | 'volume' }) {
  const value = useOS((s) => s[kind])
  const Icon = kind === 'brightness' ? Sun : value > 0 ? Volume2 : VolumeX
  return (
    <label className="status-slider">
      <Icon size={15} aria-hidden="true" />
      <input type="range" aria-label={kind === 'brightness' ? 'Brightness' : 'Output volume'} min={kind === 'brightness' ? 0.25 : 0}
        max={1} step={0.01} value={value} onChange={(e) => {
          os().set(kind, +e.target.value)
          if (kind === 'volume') playPop()
        }} />
    </label>
  )
}

function NowPlaying() {
  const cur = useCurrent()
  const spoken = useSpoken()
  const playing = usePlayer((s) => s.playing)
  const { prev, toggle, next } = usePlayer.getState()
  return (
    <div className="cc-music">
      <button className="cc-music-main" onClick={() => os().openApp('music', { props: { view: 'now' } })} title="Open Music">
        <Art track={cur} size={44} radius={7} />
        <span className="cc-text"><b>{cur?.title ?? 'Not Playing'}</b><small>{cur?.source === 'station' && spoken ? spoken : cur?.artist ?? 'Music'}</small></span>
        {cur && playing && <Eq playing />}
      </button>
      <div className="cc-music-ctl">
        <button aria-label="Previous" title="Previous" onClick={prev} disabled={!cur}><SkipBack size={15} fill="currentColor" /></button>
        <button aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <button aria-label="Next" title="Next" onClick={() => next()} disabled={!cur}><SkipForward size={15} fill="currentColor" /></button>
      </div>
    </div>
  )
}

function BatteryDetails() {
  const status = useBatteryStatus()
  return <>
    {status ? <div className="status-reading"><b>{status.percent}%</b><span>Power Source · {status.pluggedIn ? 'Power Adapter' : 'Battery'}</span></div>
      : <p className="status-note">Battery status unavailable in this browser</p>}
    <SettingsLink pane="battery">Battery Settings…</SettingsLink>
  </>
}

function StatusDetails({ id }: { id: StatusMenu }) {
  const { wifi, bluetooth, dnd, cameraInUse } = useOS(useShallow((s) => ({ wifi: s.wifi, bluetooth: s.bluetooth, dnd: s.dnd, cameraInUse: s.cameraInUse })))
  switch (id) {
    case 'wifi':
      return <>
        <StatusToggle label="Wi-Fi" checked={wifi} change={(value) => os().set('wifi', value)} />
        {wifi && <div className="status-device"><Wifi size={16} /><strong>PearNet</strong><span>Connected</span><Check size={15} /></div>}
        <SettingsLink pane="wifi">Wi-Fi Settings…</SettingsLink>
      </>
    case 'bluetooth':
      return <>
        <StatusToggle label="Bluetooth" checked={bluetooth} change={(value) => os().set('bluetooth', value)} />
        {bluetooth && <p className="status-note">No connected devices</p>}
        <SettingsLink pane="bluetooth">Bluetooth Settings…</SettingsLink>
      </>
    case 'focus':
      return <>
        <StatusToggle label="Do Not Disturb" checked={dnd} change={(value) => os().set('dnd', value)} />
        <SettingsLink pane="focus">Focus Settings…</SettingsLink>
      </>
    case 'sound':
      return <>
        <div className="status-range"><b>Output Volume</b><Slider kind="volume" /></div>
        <SettingsLink pane="sound">Sound Settings…</SettingsLink>
      </>
    case 'nowPlaying':
      return <NowPlaying />
    case 'battery':
      return <BatteryDetails />
    case 'privacy':
      return <p className="status-note">{cameraInUse ? 'Photo Booth is using the camera.' : 'Camera inactive'}</p>
  }
}

function useMenuPanel(triggerId: string) {
  const panelRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const panel = panelRef.current
    const trigger = document.getElementById(triggerId)
    const focused = os().focused
    panel?.focus({ preventScroll: true })
    return () => {
      const state = os()
      const active = document.activeElement
      if (state.focused === focused && (active === document.body || panel?.contains(active)) && !Object.values(state.overlay).some(Boolean)) {
        const target = trigger?.isConnected ? trigger : document.getElementById('mb-control-center')
        target?.focus({ preventScroll: true })
      }
    }
  }, [triggerId])
  return panelRef
}

export function StatusMenuPopover() {
  const id = useOS((s) => s.overlay.statusMenu)
  return id && <AnchoredStatusMenu key={id} id={id} />
}

function AnchoredStatusMenu({ id }: { id: StatusMenu }) {
  const panel = useMenuPanel(`mb-${id}`)
  useLayoutEffect(() => {
    const trigger = document.getElementById(`mb-${id}`)
    const bar = trigger?.closest<HTMLElement>('.menubar')
    if (!trigger?.parentElement || !bar) return
    const align = () => {
      const offset = bar.clientWidth - trigger.offsetLeft - trigger.offsetWidth
      panel.current?.style.setProperty('--status-offset', `${offset}px`)
    }
    align()
    const observer = new ResizeObserver(align)
    observer.observe(trigger.parentElement)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [id, panel])
  return (
    <div className="overlay-catch menu-bar-catch" onPointerDown={(e) => { e.stopPropagation(); os().setOverlay({ statusMenu: null }) }}>
      <div className="status-popover glass" ref={panel} tabIndex={-1} role="dialog" aria-label={TITLES[id]} onPointerDown={(e) => e.stopPropagation()}>
        <h2>{TITLES[id]}</h2>
        <StatusDetails id={id} />
      </div>
    </div>
  )
}

function ControlTile({ id, icon, label, sub, toggle, action }: {
  id?: StatusMenu
  icon: ReactNode
  label: string
  sub: string
  toggle?: { label: string; checked: boolean; run: () => void }
  action: () => void
}) {
  const circle = <span className={`cc-circle ${toggle?.checked ? 'on' : ''} ${id === 'focus' ? 'purple' : ''}`} aria-hidden="true">{icon}</span>
  return (
    <div className="cc-row">
      {toggle && <button className="cc-quick-toggle" role="switch" aria-label={toggle.label} aria-checked={toggle.checked} onClick={toggle.run}>{circle}</button>}
      <button className="cc-tile-detail" data-cc-detail={id} onClick={action}>
        {!toggle && circle}
        <span className="cc-text"><b>{label}</b><small>{sub}</small></span>
        <ChevronRight className="cc-chevron" size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

export function ControlCenter() {
  const open = useOS((s) => s.overlay.controlCenter)
  return open && <ControlCenterPanel />
}

function ControlCenterPanel() {
  const [detail, setDetail] = useState<StatusMenu | null>(null)
  const panel = useMenuPanel('mb-control-center')
  const back = useRef<HTMLButtonElement>(null)
  const detailTrigger = useRef<StatusMenu | null>(null)
  useLayoutEffect(() => {
    if (detail) back.current?.focus({ preventScroll: true })
    else panel.current?.querySelector<HTMLElement>(`[data-cc-detail="${detailTrigger.current}"]`)?.focus({ preventScroll: true })
  }, [detail, panel])
  const showDetail = (id: StatusMenu) => {
    detailTrigger.current = id
    setDetail(id)
  }
  const { wifi, bluetooth, dnd, theme, cameraInUse } = useOS(useShallow((s) => ({
    wifi: s.wifi, bluetooth: s.bluetooth, dnd: s.dnd, theme: s.theme, cameraInUse: s.cameraInUse,
  })))
  return (
    <div className="overlay-catch menu-bar-catch" onPointerDown={(e) => { e.stopPropagation(); os().setOverlay({ controlCenter: false }) }}>
      <div className="control-center glass" ref={panel} tabIndex={-1} role="dialog" aria-label="Control Center" onPointerDown={(e) => e.stopPropagation()}>
        {detail ? <>
          <h2 className="cc-detail-title"><button ref={back} onClick={() => setDetail(null)} aria-label="Back to Control Center"><ChevronLeft size={17} /></button>{TITLES[detail]}</h2>
          <div className="cc-card cc-detail"><StatusDetails id={detail} /></div>
        </> : <>
          {cameraInUse && <div className="cc-card cc-wide cc-privacy"><Camera size={15} /><span>Photo Booth · Camera</span></div>}
          <div className="cc-grid">
            <div className="cc-card cc-net">
              <ControlTile id="wifi" icon={<Wifi size={15} />} label="Wi-Fi" sub={wifi ? 'PearNet' : 'Off'}
                toggle={{ label: 'Wi-Fi', checked: wifi, run: () => os().set('wifi', !wifi) }} action={() => showDetail('wifi')} />
              <ControlTile id="bluetooth" icon={<Bluetooth size={15} />} label="Bluetooth" sub={bluetooth ? 'On' : 'Off'}
                toggle={{ label: 'Bluetooth', checked: bluetooth, run: () => os().set('bluetooth', !bluetooth) }} action={() => showDetail('bluetooth')} />
              <ControlTile icon={<Radio size={15} />} label="AirPear" sub="File Sharing" action={() => os().openApp('airpear')} />
            </div>
            <div className="cc-col">
              <div className="cc-card cc-small">
                <ControlTile id="focus" icon={<Moon size={15} />} label="Focus" sub={dnd ? 'Do Not Disturb' : 'Off'}
                  toggle={{ label: 'Do Not Disturb', checked: dnd, run: () => os().set('dnd', !dnd) }} action={() => showDetail('focus')} />
              </div>
              <div className="cc-split">
                <button className="cc-card cc-tiny" aria-pressed={theme === 'dark'} onClick={() => os().set('theme', theme === 'dark' ? 'light' : 'dark')}>
                  <Contrast size={18} /><small>Dark Mode</small>
                </button>
                <button className="cc-card cc-tiny" onClick={() => os().openApp('mirroring')}>
                  <MonitorSmartphone size={18} /><small>pPhone Mirroring</small>
                </button>
              </div>
            </div>
          </div>
          <div className="cc-card cc-slider"><b>Display</b><Slider kind="brightness" /></div>
          <div className="cc-card cc-slider"><b>Sound</b><Slider kind="volume" /></div>
          <div className="cc-card"><NowPlaying /></div>
          <SettingsLink pane="controlcenter">Control Center Settings…</SettingsLink>
        </>}
      </div>
    </div>
  )
}

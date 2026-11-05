import { useEffect, useState } from 'react'
import { Cloud, CloudLightning, CloudRain, CloudSun, Check, Cpu, FileText, Pause, Play, Plus, Sun, SkipBack, SkipForward, Clock as ClockIcon, Calendar as CalIcon, Music2 } from 'lucide-react'
import { MENU_H, DOCK_ZONE, WIDGET_PX, os, useOS, type WidgetHome, type WidgetInst, type WidgetKind, type WidgetSize } from '../store'
import { refreshSys, useBackend } from '../lib/backend'
import { kernelTaskCpu } from '../kernel'
import { menu, type MenuEntry } from '../lib/menu'
import { useCurrent, usePlayer, formatTime } from '../lib/player'
import { useSpoken } from '../lib/captions'
import { Art } from './MusicBits'

interface Def {
  kind: WidgetKind
  name: string
  blurb: string
  sizes: WidgetSize[]
  Icon: typeof Cloud
}

export const WIDGET_DEFS: Def[] = [
  { kind: 'clock', name: 'Clock', blurb: 'Two hands, no meetings.', sizes: ['small', 'medium'], Icon: ClockIcon },
  { kind: 'calendar', name: 'Calendar', blurb: 'Mostly empty, like the rest of your week.', sizes: ['small', 'medium', 'large'], Icon: CalIcon },
  { kind: 'weather', name: 'Weather', blurb: 'Forecast by vibes. Accuracy: also vibes.', sizes: ['small', 'medium', 'large'], Icon: CloudSun },
  { kind: 'system', name: 'Activity', blurb: 'How hard this machine is working to run this.', sizes: ['small', 'medium'], Icon: Cpu },
  { kind: 'music', name: 'Music', blurb: 'Now playing, with buttons.', sizes: ['small', 'medium', 'large'], Icon: Music2 },
  { kind: 'notes', name: 'Notes', blurb: 'Your most recent thoughts, in public.', sizes: ['small', 'medium', 'large'], Icon: FileText },
]
const def = (k: WidgetKind) => WIDGET_DEFS.find((d) => d.kind === k)!

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

// ───────────────────────────── Clock ─────────────────────────────

function AnalogClock({ now, size }: { now: Date; size: number }) {
  const s = now.getSeconds() + now.getMilliseconds() / 1000
  const m = now.getMinutes() + s / 60
  const h = (now.getHours() % 12) + m / 60
  const hand = (deg: number, len: number, w: number, color: string) => (
    <line x1="50" y1="50" x2="50" y2={50 - len} stroke={color} strokeWidth={w} strokeLinecap="round" transform={`rotate(${deg} 50 50)`} />
  )
  return (
    <svg className="wd-analog" width={size} height={size} viewBox="0 0 100 100" aria-label={now.toLocaleTimeString()}>
      <circle cx="50" cy="50" r="47" className="wd-face" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1="8" x2="50" y2={i % 3 === 0 ? 15 : 12} className="wd-tick" strokeWidth={i % 3 === 0 ? 2.6 : 1.4} strokeLinecap="round" transform={`rotate(${i * 30} 50 50)`} />
      ))}
      {hand(h * 30, 24, 4, 'var(--fg)')}
      {hand(m * 6, 36, 3, 'var(--fg)')}
      {hand(Math.floor(s) * 6, 40, 1.4, '#ff9f0a')}
      <circle cx="50" cy="50" r="3" fill="#ff9f0a" />
    </svg>
  )
}

function ClockWidget({ size }: { size: WidgetSize }) {
  const now = useNow(1000)
  if (size === 'small') {
    return (
      <div className="wd-center">
        <AnalogClock now={now} size={118} />
        <small className="wd-cap">Pear Valley</small>
      </div>
    )
  }
  return (
    <div className="wd-row">
      <AnalogClock now={now} size={124} />
      <div className="wd-clock-text">
        <small className="wd-cap">Pear Valley</small>
        <b className="wd-big">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</b>
        <small>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</small>
      </div>
    </div>
  )
}

// ───────────────────────────── Calendar ─────────────────────────────

const EVENTS = [
  { at: '10:00 AM', what: 'Sync to discuss syncing', color: '#0a84ff' },
  { at: '1:30 PM', what: 'Lunch (pears)', color: '#30d158' },
  { at: '3:00 PM', what: 'Restart for updates', color: '#ff9f0a' },
]

function CalendarWidget({ size }: { size: WidgetSize }) {
  const now = useNow(30_000)
  const day = (
    <div className="wd-date">
      <small className="wd-red">{now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}</small>
      <b className="wd-huge">{now.getDate()}</b>
    </div>
  )
  if (size === 'small') {
    return (
      <div className="wd-col">
        {day}
        <small className="wd-dim">No more events today</small>
      </div>
    )
  }
  if (size === 'medium') {
    return (
      <div className="wd-row top">
        {day}
        <div className="wd-events">
          {EVENTS.map((e) => (
            <div key={e.at} className="wd-event" style={{ ['--c' as string]: e.color }}>
              <b>{e.what}</b>
              <small>{e.at}</small>
            </div>
          ))}
        </div>
      </div>
    )
  }
  const y = now.getFullYear()
  const mo = now.getMonth()
  const lead = new Date(y, mo, 1).getDay()
  const days = new Date(y, mo + 1, 0).getDate()
  const cells = [...Array(lead).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)]
  return (
    <div className="wd-col full">
      <div className="wd-month">
        <b>{now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()}</b>
        <small>{y}</small>
      </div>
      <div className="wd-grid">
        {'SMTWTFS'.split('').map((c, i) => (
          <i key={i} className="wd-dow">
            {c}
          </i>
        ))}
        {cells.map((d, i) => (
          <i key={i} className={d === now.getDate() ? 'today' : ''}>
            {d || ''}
          </i>
        ))}
      </div>
    </div>
  )
}

// ───────────────────────────── Weather ─────────────────────────────

const CONDITIONS = [
  { name: 'Sunny', Icon: Sun, color: '#ffb800' },
  { name: 'Partly Cloudy', Icon: CloudSun, color: '#8fc6ff' },
  { name: 'Mostly Beach Ball', Icon: Cloud, color: '#b4bcc8' },
  { name: 'Drizzling Pears', Icon: CloudRain, color: '#5aa9ff' },
  { name: 'Thundering Opinions', Icon: CloudLightning, color: '#c9a7ff' },
]

function mix(n: number) {
  let h = n | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function forecast(now: Date) {
  const dayN = Math.floor(now.getTime() / 86_400_000)
  const base = 62 + Math.round(mix(dayN) * 20)
  const temp = (h: number, d = dayN) => Math.round(base + mix(d + 7) * 4 + 7 * Math.sin(((h - 9) / 24) * Math.PI * 2))
  const cond = (h: number, d = dayN) => CONDITIONS[Math.min(CONDITIONS.length - 1, Math.floor(mix(d * 24 + h) ** 1.6 * CONDITIONS.length))]
  return { dayN, temp, cond, base }
}

function WeatherWidget({ size }: { size: WidgetSize }) {
  const now = useNow(60_000)
  const f = forecast(now)
  const h = now.getHours()
  const c = f.cond(h)
  const hi = Math.max(...Array.from({ length: 24 }, (_, i) => f.temp(i)))
  const lo = Math.min(...Array.from({ length: 24 }, (_, i) => f.temp(i)))
  const head = (
    <div className="wd-wx-head">
      <div>
        <b className="wd-loc">Pear Valley</b>
        <span className="wd-temp">{f.temp(h)}°</span>
      </div>
      <div className="wd-wx-now">
        <c.Icon size={size === 'small' ? 22 : 26} color={c.color} fill={c.Icon === Sun ? c.color : 'none'} />
        <b>{c.name}</b>
        <small>
          H:{hi}° L:{lo}°
        </small>
      </div>
    </div>
  )
  if (size === 'small') return <div className="wd-col wx">{head}</div>
  const hours = Array.from({ length: size === 'medium' ? 6 : 6 }, (_, i) => h + i)
  const days = Array.from({ length: 5 }, (_, i) => i + 1)
  return (
    <div className="wd-col wx">
      {head}
      <div className="wd-hours">
        {hours.map((hh, i) => {
          const cc = f.cond(hh % 24, f.dayN + Math.floor(hh / 24))
          return (
            <div key={hh} className="wd-hour">
              <small>{i === 0 ? 'Now' : new Date(2000, 0, 1, hh % 24).toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '')}</small>
              <cc.Icon size={17} color={cc.color} fill={cc.Icon === Sun ? cc.color : 'none'} />
              <b>{f.temp(hh % 24, f.dayN + Math.floor(hh / 24))}°</b>
            </div>
          )
        })}
      </div>
      {size === 'large' && (
        <div className="wd-days">
          {days.map((d) => {
            const dn = f.dayN + d
            const cc = f.cond(14, dn)
            const when = new Date(now.getTime() + d * 86_400_000).toLocaleDateString('en-US', { weekday: 'short' })
            return (
              <div key={d} className="wd-day">
                <small>{when}</small>
                <cc.Icon size={16} color={cc.color} fill={cc.Icon === Sun ? cc.color : 'none'} />
                <span>{f.temp(4, dn)}°</span>
                <i style={{ ['--a' as string]: `${((f.temp(4, dn) - 55) / 40) * 100}%`, ['--b' as string]: `${((f.temp(15, dn) - 55) / 40) * 100}%` }} />
                <span>{f.temp(15, dn)}°</span>
              </div>
            )
          })}
          <small className="wd-dim foot">Forecast provided by vibes</small>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── Activity ─────────────────────────────

let sysUsers = 0
let sysTimer: ReturnType<typeof setInterval> | undefined
function useSysPoll() {
  const authed = useBackend((s) => s.authed)
  useEffect(() => {
    if (!authed) return
    if (sysUsers++ === 0) {
      void refreshSys()
      sysTimer = setInterval(() => void refreshSys(), 4000)
    }
    return () => {
      if (--sysUsers === 0) clearInterval(sysTimer)
    }
  }, [authed])
}

function Ring({ value, color, label, text }: { value: number; color: string; label: string; text: string }) {
  const r = 24
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="wd-ring">
      <svg viewBox="0 0 60 60" width="62" height="62">
        <circle cx="30" cy="30" r={r} fill="none" className="wd-track" strokeWidth="6" />
        <circle cx="30" cy="30" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 30 30)" style={{ transition: 'stroke-dasharray .6s ease' }} />
        <text x="30" y="34" textAnchor="middle" className="wd-ring-text">
          {text}
        </text>
      </svg>
      <small>{label}</small>
    </div>
  )
}

function useStats() {
  useSysPoll()
  const sys = useBackend((s) => s.sys)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (sys) return
    const t = setInterval(() => setTick((n) => n + 1), 2000)
    return () => clearInterval(t)
  }, [sys])
  if (sys) {
    const memPct = sys.memTotal ? sys.memUsed / sys.memTotal : 0
    const diskPct = sys.diskTotal && sys.diskFree != null ? 1 - sys.diskFree / sys.diskTotal : null
    return { real: true, cpu: sys.cpuUsage / 100, mem: memPct, disk: diskPct, note: sys.hostname, uptime: sys.uptime }
  }
  return { real: false, cpu: Math.min(1, kernelTaskCpu(tick * 2.4) / 400), mem: 0.99, disk: 0.97 as number | null, note: 'kernel_task', uptime: null as number | null }
}

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`
}

function SystemWidget({ size }: { size: WidgetSize }) {
  const st = useStats()
  const pct = (v: number) => `${Math.round(v * 100)}`
  if (size === 'small') {
    return (
      <div className="wd-col">
        <div className="wd-rings">
          <Ring value={st.cpu} color="#ff453a" label="CPU" text={pct(st.cpu)} />
          <Ring value={st.mem} color="#0a84ff" label="Memory" text={pct(st.mem)} />
        </div>
        <small className="wd-dim wd-center-text">{st.real ? st.note : 'simulated, like everything'}</small>
      </div>
    )
  }
  const bar = (label: string, v: number | null, color: string) => (
    <div className="wd-bar">
      <span>{label}</span>
      <div>
        <i style={{ width: `${(v ?? 0) * 100}%`, background: color }} />
      </div>
      <b>{v == null ? '—' : `${pct(v)}%`}</b>
    </div>
  )
  return (
    <div className="wd-col full">
      <div className="wd-sys-head">
        <Cpu size={14} /> <b>{st.real ? st.note : 'PearBook Pro'}</b>
        <small>{st.uptime != null ? `up ${fmtUptime(st.uptime)}` : st.note + ' is doing its best'}</small>
      </div>
      {bar('CPU', st.cpu, '#ff453a')}
      {bar('Memory', st.mem, '#0a84ff')}
      {bar('Disk', st.disk, '#ff9f0a')}
    </div>
  )
}

// ───────────────────────────── Music ─────────────────────────────

function MusicWidget({ size }: { size: WidgetSize }) {
  const cur = useCurrent()
  const spoken = useSpoken()
  const playing = usePlayer((s) => s.playing)
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const p = usePlayer.getState()
  const live = cur?.source === 'station'
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const controls = (
    <div className="wd-ctl" data-nodrag onPointerDown={stop}>
      <button title="Previous" onClick={(e) => (stop(e), p.prev())} disabled={!cur}>
        <SkipBack size={16} fill="currentColor" />
      </button>
      <button className="pp" title={playing ? 'Pause' : 'Play'} onClick={(e) => (stop(e), p.toggle())}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <button title="Next" onClick={(e) => (stop(e), p.next())} disabled={!cur}>
        <SkipForward size={16} fill="currentColor" />
      </button>
    </div>
  )
  const title = cur?.title ?? 'Not Playing'
  const sub = cur?.source === 'station' && spoken ? spoken : cur ? cur.artist : 'Open Music'
  const bar = <div className="wd-prog">{<i style={{ width: live ? '100%' : duration ? `${(position / duration) * 100}%` : '0%' }} className={live ? 'live' : ''} />}</div>
  if (size === 'small') {
    return (
      <div className="wd-col mus">
        <div className="wd-music-top">
          <Art track={cur} size={64} radius={9} />
        </div>
        <div className="wd-music-text">
          <b>{title}</b>
          <small>{sub}</small>
        </div>
        {controls}
      </div>
    )
  }
  if (size === 'medium') {
    return (
      <div className="wd-row mus">
        <Art track={cur} size={126} radius={11} />
        <div className="wd-music-side">
          <div className="wd-music-text">
            <b>{title}</b>
            <small>{sub}</small>
          </div>
          {bar}
          <div className="wd-times">
            <small>{cur ? formatTime(position) : ''}</small>
            <small>{live ? 'LIVE' : duration ? `-${formatTime(Math.max(0, duration - position))}` : ''}</small>
          </div>
          {controls}
        </div>
      </div>
    )
  }
  const up = queue.slice(index + 1, index + 3)
  return (
    <div className="wd-col mus full">
      <div className="wd-music-hero">
        <Art track={cur} size={170} radius={14} />
      </div>
      <div className="wd-music-text center">
        <b>{title}</b>
        <small>{sub}</small>
      </div>
      {bar}
      {controls}
      {up.length > 0 && (
        <div className="wd-up">
          {up.map((t) => (
            <div key={t.id}>
              <Art track={t} size={24} radius={4} />
              <span>{t.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── Notes ─────────────────────────────

function NotesWidget({ size }: { size: WidgetSize }) {
  const notes = useOS((s) => s.notes)
  const shown = notes.slice(0, size === 'large' ? 3 : size === 'medium' ? 2 : 1)
  if (!shown.length) {
    return (
      <div className="wd-col">
        <b>Notes</b>
        <small className="wd-dim">No notes. A clear mind, or a lost cause.</small>
      </div>
    )
  }
  return (
    <div className={`wd-notes ${size}`}>
      {shown.map((n) => {
        const [title, ...rest] = n.text.split('\n')
        return (
          <div key={n.id} className="wd-note">
            <b>{title || 'New Note'}</b>
            <p>{rest.filter(Boolean).join(' ') || 'No additional text'}</p>
          </div>
        )
      })}
    </div>
  )
}

// ───────────────────────────── frame + host ─────────────────────────────

export function WidgetBody({ kind, size }: { kind: WidgetKind; size: WidgetSize }) {
  switch (kind) {
    case 'clock':
      return <ClockWidget size={size} />
    case 'calendar':
      return <CalendarWidget size={size} />
    case 'weather':
      return <WeatherWidget size={size} />
    case 'system':
      return <SystemWidget size={size} />
    case 'music':
      return <MusicWidget size={size} />
    case 'notes':
      return <NotesWidget size={size} />
  }
}

function openFor(kind: WidgetKind) {
  switch (kind) {
    case 'weather':
      return os().openApp('safari', { props: { url: 'gargle.com/search?q=weather+pear+valley' } })
    case 'system':
      return os().openApp('activity')
    case 'music':
      return os().openApp('music', { props: { view: 'now' } })
    case 'notes':
      return os().openApp('notes')
  }
}

export const openGallery = (home: WidgetHome = 'desktop') => {
  galleryHome = home
  os().setOverlay({ widgetGallery: true, notificationCenter: false, controlCenter: false, spotlight: false, menu: null })
}
let galleryHome: WidgetHome = 'desktop'

function widgetMenu(w: WidgetInst): MenuEntry[] {
  const d = def(w.kind)
  return [
    ...d.sizes.map((s): MenuEntry => ({ label: s[0].toUpperCase() + s.slice(1), checked: w.size === s, run: () => os().resizeWidget(w.id, s) })),
    'sep',
    { label: 'Edit Widgets…', run: () => openGallery(os().widgets.desktop.some((x) => x.id === w.id) ? 'desktop' : 'center') },
    { label: 'Remove Widget', run: () => os().removeWidget(w.id) },
  ]
}

/** A widget in the Notification Center (not draggable). */
export function CenterWidget({ w }: { w: WidgetInst }) {
  return (
    <div className={`widget ${w.size} inline`} data-kind={w.kind} onContextMenu={menu(widgetMenu(w))} onClick={() => openFor(w.kind)}>
      <WidgetBody kind={w.kind} size={w.size} />
    </div>
  )
}

function DesktopWidget({ w }: { w: WidgetInst }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [start, setStart] = useState<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null)
  const [pw, ph] = WIDGET_PX[w.size]
  const clamp = (x: number, y: number) => ({
    x: Math.round(Math.max(6, Math.min(window.innerWidth - pw - 6, x))),
    y: Math.round(Math.max(MENU_H + 4, Math.min(window.innerHeight - DOCK_ZONE + 40 - ph, y))),
  })
  const at = clamp(pos?.x ?? w.x, pos?.y ?? w.y)
  return (
    <div
      className={`widget ${w.size} ${start?.moved ? 'dragging' : ''}`}
      data-kind={w.kind}
      style={{ left: at.x, top: at.y }}
      onContextMenu={menu(widgetMenu(w))}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('[data-nodrag]')) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setStart({ px: e.clientX, py: e.clientY, ox: at.x, oy: at.y, moved: false })
      }}
      onPointerMove={(e) => {
        if (!start) return
        const dx = e.clientX - start.px
        const dy = e.clientY - start.py
        if (!start.moved && Math.hypot(dx, dy) < 4) return
        if (!start.moved) setStart({ ...start, moved: true })
        setPos(clamp(start.ox + dx, start.oy + dy))
      }}
      onPointerUp={() => {
        if (!start) return
        if (start.moved && pos) os().moveWidget(w.id, pos.x, pos.y)
        else openFor(w.kind)
        setStart(null)
        setPos(null)
      }}
      onPointerCancel={() => (setStart(null), setPos(null))}
    >
      <WidgetBody kind={w.kind} size={w.size} />
    </div>
  )
}

export function DesktopWidgets() {
  const list = useOS((s) => s.widgets.desktop)
  return (
    <div className="desk-widgets">
      {list.map((w) => (
        <DesktopWidget key={w.id} w={w} />
      ))}
    </div>
  )
}

export function WidgetGallery() {
  const open = useOS((s) => s.overlay.widgetGallery)
  const [kind, setKind] = useState<WidgetKind>('clock')
  const [home, setHome] = useState<WidgetHome>('desktop')
  const [added, setAdded] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setHome(galleryHome)
      setAdded(null)
    }
  }, [open])
  if (!open) return null
  const d = def(kind)
  return (
    <div className="overlay-catch dim" onPointerDown={() => os().setOverlay({ widgetGallery: false })}>
      <div className="wg glass" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        <aside className="wg-side">
          <h2>Widgets</h2>
          {WIDGET_DEFS.map((x) => (
            <button key={x.kind} className={`wg-kind ${kind === x.kind ? 'on' : ''}`} onClick={() => setKind(x.kind)}>
              <x.Icon size={15} />
              {x.name}
            </button>
          ))}
        </aside>
        <section className="wg-main">
          <header>
            <div>
              <h3>{d.name}</h3>
              <small>{d.blurb}</small>
            </div>
            <div className="wg-seg" role="group" aria-label="Add to">
              <button className={home === 'desktop' ? 'on' : ''} onClick={() => setHome('desktop')}>
                Desktop
              </button>
              <button className={home === 'center' ? 'on' : ''} onClick={() => setHome('center')}>
                Notification Center
              </button>
            </div>
          </header>
          <div className="wg-previews">
            {d.sizes.map((s) => {
              const key = `${kind}-${s}`
              return (
                <div key={s} className="wg-item">
                  <div className={`widget ${s} inline static`} data-kind={kind}>
                    <WidgetBody kind={kind} size={s} />
                  </div>
                  <button
                    className="wg-add"
                    title={`Add ${s} ${d.name} widget to ${home === 'desktop' ? 'the desktop' : 'Notification Center'}`}
                    onClick={() => {
                      os().addWidget(home, kind, s)
                      setAdded(key)
                      setTimeout(() => setAdded((a) => (a === key ? null : a)), 1400)
                    }}
                  >
                    {added === key ? <Check size={14} strokeWidth={3} /> : <Plus size={14} strokeWidth={3} />}
                  </button>
                  <small>{s[0].toUpperCase() + s.slice(1)}</small>
                </div>
              )
            })}
          </div>
          <footer>
            <button className="btn primary" onClick={() => os().setOverlay({ widgetGallery: false })}>
              Done
            </button>
          </footer>
        </section>
      </div>
    </div>
  )
}

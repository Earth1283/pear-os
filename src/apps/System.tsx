import { useEffect, useMemo, useRef, useState } from 'react'
import { Accessibility, Bell, Bluetooth, Cpu, Hand, Info, LayoutGrid, Lock, Monitor, Moon, Palette, RefreshCw, Search, Sparkles, Wifi, Image, Battery, ZoomIn, ZoomOut, Gauge } from 'lucide-react'
import { useOS, os, type Win, type Wallpaper } from '../store'
import { kernelTaskCpu, entropy, renderMandelbrot, DEFAULT_VIEW, type FractalView, kernelVersion } from '../kernel'
import { APPS } from './registry'
import { LaptopArt, PearLogo, AppIcon } from '../components/icons'

export function About() {
  return (
    <div className="about" data-drag>
      <LaptopArt size={150} />
      <h1>PearBook Pro</h1>
      <small className="muted">16-inch, Nov 2025</small>
      <dl>
        <dt>Chip</dt>
        <dd>Pear P4 Max (2 performance cores, 1 efficiency core, 0 cores that do anything)</dd>
        <dt>Memory</dt>
        <dd>8 GB (comparable to 16 GB on other computers)</dd>
        <dt>Startup disk</dt>
        <dd>Pear HD</dd>
        <dt>Serial number</dt>
        <dd>C02PEAR4LYF3</dd>
        <dt>PearOS</dt>
        <dd>Sequel 15.1</dd>
        <dt>Kernel</dt>
        <dd className="mono small">pearnel.wasm (Rust)</dd>
      </dl>
      <button className="btn" onClick={() => os().openApp('settings', { props: { pane: 'about' } })}>
        More Info…
      </button>
      <small className="legal">™ and © 1983–2025 Pear Inc. All Rights Reserved. Not affiliated with any fruit-named company.</small>
    </div>
  )
}

type Proc = { name: string; icon?: keyof typeof APPS; cpu: number; mem: number; threads: number; pid: number; user: string; winId?: string; nr?: boolean }

const STATIC_PROCS: Omit<Proc, 'cpu'>[] = [
  { name: 'WindowServer', mem: 812, threads: 24, pid: 151, user: '_windowserver' },
  { name: 'mds_stores', mem: 640, threads: 9, pid: 377, user: 'root' },
  { name: 'Pear Intelligence (Not Responding)', icon: 'intelligence', mem: 4096, threads: 128, pid: 1984, user: 'pear', nr: true },
  { name: 'photoanalysisd', mem: 1200, threads: 11, pid: 802, user: 'pear' },
  { name: 'Google Chrome Helper (Renderer)', mem: 512, threads: 18, pid: 4121, user: 'pear' },
  { name: 'Google Chrome Helper (Renderer)', mem: 498, threads: 18, pid: 4122, user: 'pear' },
  { name: 'Google Chrome Helper (Renderer)', mem: 455, threads: 17, pid: 4123, user: 'pear' },
  { name: 'Electron Helper (Slack)', mem: 1100, threads: 31, pid: 5001, user: 'pear' },
  { name: 'Electron Helper (Discord)', mem: 980, threads: 29, pid: 5002, user: 'pear' },
  { name: 'Electron Helper (another one)', mem: 870, threads: 28, pid: 5003, user: 'pear' },
  { name: 'Pear Updater Updater', mem: 90, threads: 3, pid: 666, user: 'root' },
  { name: 'bird', mem: 64, threads: 4, pid: 420, user: 'pear' },
  { name: 'coreaudiod', mem: 30, threads: 8, pid: 212, user: '_coreaudiod' },
]

export function ActivityMonitor() {
  const windows = useOS((s) => s.windows)
  const [tick, setTick] = useState(0)
  const [sel, setSel] = useState<number | null>(null)
  const [tab, setTab] = useState('CPU')
  const hist = useRef<number[]>([])
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1200)
    return () => clearInterval(t)
  }, [])

  const procs: Proc[] = useMemo(() => {
    const t = tick * 1.2
    const kt: Proc = { name: 'kernel_task', cpu: kernelTaskCpu(t), mem: 2048, threads: 512, pid: 0, user: 'root' }
    const statics = STATIC_PROCS.map((p) => ({ ...p, cpu: p.nr ? 0 : p.name === 'mds_stores' ? 80 + entropy() * 40 : entropy() * (p.name.includes('Helper') ? 30 : 6) }))
    const apps = Object.values(
      windows.reduce<Record<string, Proc>>((acc, w) => {
        const name = APPS[w.app].name
        acc[name] ??= { name, icon: w.app, cpu: 0, mem: 0, threads: 0, pid: 1000 + (w.id.charCodeAt(0) % 900), user: 'pear', winId: w.id }
        acc[name].cpu += 0.5 + entropy() * 8
        acc[name].mem += 120 + (w.id.charCodeAt(1) % 300)
        acc[name].threads += 6
        return acc
      }, {}),
    )
    return [kt, ...apps, ...statics].sort((a, b) => b.cpu - a.cpu)
  }, [tick, windows])

  const total = Math.min(100, procs.reduce((s, p) => s + p.cpu, 0) / 8)
  hist.current = [...hist.current.slice(-59), total]
  const selected = sel !== null ? procs.find((p) => p.pid === sel) : null

  return (
    <div className="activity">
      <div className="toolbar" data-drag>
        <button
          className="tb-btn"
          disabled={!selected}
          aria-label="Force quit"
          onClick={() => {
            if (!selected) return
            if (selected.winId) {
              os().closeApp(windows.find((w) => w.id === selected.winId)!.app)
            } else if (selected.name === 'kernel_task') {
              os().panic('Force quit kernel_task (bold move)')
            } else {
              os().notify({ app: 'activity', title: 'Activity Monitor', body: `"${selected.name}" respawned immediately. It always does.` })
            }
            setSel(null)
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <div className="toolbar-title left">
          Activity Monitor
          <small>All Processes</small>
        </div>
        <div className="seg tabs">
          {['CPU', 'Memory', 'Energy', 'Disk', 'Network'].map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="am-table">
        <table className="list-view">
          <thead>
            <tr>
              <th>Process Name</th>
              <th className="num">{tab === 'Memory' ? 'Memory' : tab === 'Energy' ? 'Energy Impact' : '% CPU'}</th>
              <th className="num">Threads</th>
              <th className="num">PID</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {procs.map((p) => (
              <tr key={p.pid + p.name} className={`${sel === p.pid ? 'sel' : ''} ${p.nr ? 'nr' : ''}`} onClick={() => setSel(p.pid)}>
                <td>
                  <span className="lv-name">
                    {p.icon ? <AppIcon app={p.icon} size={16} /> : <span className="proc-dot" />}
                    {p.name}
                  </span>
                </td>
                <td className="num">{tab === 'Memory' ? `${(p.mem / 1024).toFixed(2)} GB` : tab === 'Energy' ? (p.cpu / 3).toFixed(1) : p.cpu.toFixed(1)}</td>
                <td className="num">{p.threads}</td>
                <td className="num">{p.pid}</td>
                <td>{p.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="am-footer">
        <dl>
          <dt>System:</dt>
          <dd className="red">{(total * 0.7).toFixed(2)}%</dd>
          <dt>User:</dt>
          <dd className="blue">{(total * 0.3).toFixed(2)}%</dd>
          <dt>Idle:</dt>
          <dd>{(100 - total).toFixed(2)}%</dd>
        </dl>
        <div className="am-graph">
          <svg viewBox="0 0 60 40" preserveAspectRatio="none">
            <path d={'M0 40 ' + hist.current.map((v, i) => `L${i} ${40 - v * 0.4}`).join(' ') + ` L${hist.current.length - 1} 40Z`} fill="#ff453a" opacity=".8" />
          </svg>
          <small>CPU LOAD</small>
        </div>
        <dl>
          <dt>Threads:</dt>
          <dd>{procs.reduce((s, p) => s + p.threads, 0)}</dd>
          <dt>Processes:</dt>
          <dd>{procs.length + 400}</dd>
          <dt>Memory Pressure:</dt>
          <dd className="red">Yes</dd>
        </dl>
      </div>
    </div>
  )
}

export function Fractals() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<FractalView>(DEFAULT_VIEW)
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const c = canvas.current
    const b = box.current
    if (!c || !b) return
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      c.width = Math.max(1, Math.round(b.clientWidth * dpr))
      c.height = Math.max(1, Math.round(b.clientHeight * dpr))
      setMs(renderMandelbrot(c, view))
    }
    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(b)
    return () => ro.disconnect()
  }, [view])

  const zoomAt = (e: React.MouseEvent, factor: number) => {
    const r = box.current!.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width - 0.5
    const fy = (e.clientY - r.top) / r.height - 0.5
    const aspect = r.width / r.height
    setView((v) => ({ ...v, cx: v.cx + fx * v.scale * aspect, cy: v.cy + fy * v.scale, scale: v.scale * factor, iter: Math.min(3000, Math.round(v.iter * (factor < 1 ? 1.15 : 0.87))) }))
  }

  return (
    <div className="fractals">
      <div className="toolbar dark" data-drag>
        <div className="toolbar-title left">
          Fractals
          <small>
            {ms.toFixed(1)} ms in pearnel.wasm · zoom {(3 / view.scale).toExponential(1)}× · {view.iter} iter
          </small>
        </div>
        <div className="seg">
          {(['Sequel', 'Pear', 'Rainbow'] as const).map((n, i) => (
            <button key={n} className={view.scheme === i ? 'on' : ''} onClick={() => setView((v) => ({ ...v, scheme: i as 0 | 1 | 2 }))}>
              {n}
            </button>
          ))}
        </div>
        <button className="tb-btn" onClick={() => setView(DEFAULT_VIEW)} aria-label="Reset">
          <RefreshCw size={14} />
        </button>
        <button
          className="btn small"
          onClick={() => {
            os().set('fractalWallpaper', view)
            os().set('wallpaper', 'fractal')
            os().notify({ app: 'fractals', title: 'Wallpaper Set', body: 'Your wallpaper is now rendered by a Rust kernel every time you resize the window. As nature intended.' })
          }}
        >
          Set as Wallpaper
        </button>
      </div>
      <div
        ref={box}
        className="fractal-canvas"
        onClick={(e) => zoomAt(e, e.shiftKey || e.altKey ? 2 : 0.4)}
        onContextMenu={(e) => {
          e.preventDefault()
          zoomAt(e, 2.5)
        }}
      >
        <canvas ref={canvas} />
        <div className="fractal-hint">
          <ZoomIn size={12} /> click · <ZoomOut size={12} /> right-click
        </div>
      </div>
    </div>
  )
}

const PANES = [
  { id: 'account', label: 'Pear User', sub: 'Pear Account', icon: null },
  { id: 'sep1' },
  { id: 'wifi', label: 'Wi-Fi', icon: Wifi, color: '#0a84ff' },
  { id: 'bluetooth', label: 'Bluetooth', icon: Bluetooth, color: '#0a84ff' },
  { id: 'sep2' },
  { id: 'general', label: 'General', icon: Info, color: '#8e8e93' },
  { id: 'appearance', label: 'Appearance', icon: Palette, color: '#1c1c1e' },
  { id: 'accessibility', label: 'Accessibility', icon: Accessibility, color: '#0a84ff' },
  { id: 'intelligence', label: 'Pear Intelligence & Siri', icon: Sparkles, color: '#bf5af2' },
  { id: 'desktop', label: 'Desktop & Dock', icon: LayoutGrid, color: '#1c1c1e' },
  { id: 'displays', label: 'Displays', icon: Monitor, color: '#0a84ff' },
  { id: 'wallpaper', label: 'Wallpaper', icon: Image, color: '#30b0c7' },
  { id: 'sep3' },
  { id: 'notifications', label: 'Notifications', icon: Bell, color: '#ff3b30' },
  { id: 'focus', label: 'Focus', icon: Moon, color: '#5e5ce6' },
  { id: 'sep4' },
  { id: 'battery', label: 'Battery', icon: Battery, color: '#30d158' },
  { id: 'privacy', label: 'Privacy & Security', icon: Hand, color: '#0a84ff' },
  { id: 'lock', label: 'Lock Screen', icon: Lock, color: '#1c1c1e' },
  { id: 'about', label: 'About', icon: Cpu, color: '#8e8e93' },
  { id: 'update', label: 'Software Update', icon: Gauge, color: '#8e8e93' },
] as const

type PaneId = (typeof PANES)[number]['id']

function Row({ label, children, sub }: { label: string; children?: React.ReactNode; sub?: string }) {
  return (
    <div className="set-row">
      <div>
        <div>{label}</div>
        {sub && <small className="muted">{sub}</small>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on} />
}

const WALLPAPERS: { id: Wallpaper; name: string; cls: string }[] = [
  { id: 'sequel', name: 'Sequel', cls: 'wp-sequel' },
  { id: 'sequel-dark', name: 'Sequel Night', cls: 'wp-sequel-dark' },
  { id: 'orchard', name: 'Orchard', cls: 'orchard' },
  { id: 'graphite', name: 'Graphite', cls: 'graphite' },
  { id: 'fractal', name: 'Mandelbrot (Rust)', cls: 'wp-fractal' },
]

function UpdatePane() {
  const [p, setP] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setP((x) => (x >= 99 ? 12 : x + Math.random() * 9)), 700)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="set-card">
      <div className="update">
        <PearLogo size={40} />
        <div style={{ flex: 1 }}>
          <b>PearOS Sequel 15.1.1</b>
          <small className="muted">Preparing update… {p < 99 ? `About ${Math.round((100 - p) * 7)} minutes remaining` : 'Starting over'}</small>
          <div className="boot-bar light">
            <div style={{ width: `${p}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function Settings({ win }: { win: Win }) {
  const [pane, setPane] = useState<PaneId>((win.props.pane as PaneId) ?? 'appearance')
  const [q, setQ] = useState('')
  const s = useOS()
  const [misc, setMisc] = useState<Record<string, boolean>>({ intel: false, siri: true, notif: true, filevault: true, ff: false })
  useEffect(() => {
    if (win.props.pane) setPane(win.props.pane as PaneId)
  }, [win.props.pane])
  const current = PANES.find((p) => p.id === pane)!
  useEffect(() => os().setTitle(win.id, 'label' in current ? current.label : 'System Settings'), [pane])

  let body: React.ReactNode
  switch (pane) {
    case 'appearance':
      body = (
        <>
          <div className="set-card">
            <Row label="Appearance">
              <div className="appearance-pick">
                {(['light', 'dark'] as const).map((t) => (
                  <button key={t} className={s.theme === t ? 'on' : ''} onClick={() => os().set('theme', t)}>
                    <span className={`ap-thumb ${t}`}>
                      <i />
                    </span>
                    <small>{t === 'light' ? 'Light' : 'Dark'}</small>
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Accent colour" sub="Any colour you like, as long as it's this one">
              <span className="accent-dot" />
            </Row>
            <Row label="Show scroll bars">
              <select defaultValue="auto">
                <option value="auto">Automatically based on mouse or trackpad</option>
                <option>Never (you'll find them)</option>
              </select>
            </Row>
          </div>
        </>
      )
      break
    case 'wallpaper':
      body = (
        <div className="set-card">
          <div className="wp-grid">
            {WALLPAPERS.map((w) => (
              <button key={w.id} className={`wp-pick ${s.wallpaper === w.id ? 'on' : ''}`} onClick={() => os().set('wallpaper', w.id)}>
                <span className={`wp-thumb ${w.cls}`} />
                <small>{w.name}</small>
              </button>
            ))}
          </div>
          <Row label="Show on all Spaces">
            <Toggle on onChange={() => {}} />
          </Row>
        </div>
      )
      break
    case 'desktop':
      body = (
        <div className="set-card">
          <Row label="Size">
            <input type="range" min={36} max={72} value={s.dockSize} onChange={(e) => os().set('dockSize', +e.target.value)} />
          </Row>
          <Row label="Magnification">
            <Toggle on={s.dockMagnify} onChange={(v) => os().set('dockMagnify', v)} />
          </Row>
          <Row label="Click wallpaper to reveal desktop" sub="Always. (We heard you hated it. We kept it.)">
            <select defaultValue="always">
              <option value="always">Always</option>
              <option>Only in Stage Manager</option>
            </select>
          </Row>
          <Row label="Tile by dragging windows to screen edges" sub="New in Sequel! Windows apparently did this in 2009.">
            <Toggle on onChange={() => {}} />
          </Row>
        </div>
      )
      break
    case 'intelligence':
      body = (
        <div className="set-card">
          <Row label="Pear Intelligence" sub="Joined waitlist. Position in queue: 41,203,991">
            <Toggle on={misc.intel} onChange={(v) => setMisc({ ...misc, intel: v })} />
          </Row>
          <Row label="Listen for “Hey Pear”" sub="Also triggers when anyone says “hay”, “pair”, or “pare”">
            <Toggle on={misc.siri} onChange={(v) => setMisc({ ...misc, siri: v })} />
          </Row>
          <Row label="Language">
            <select>
              <option>English (United States)</option>
              <option disabled>Every other language (coming “later”)</option>
            </select>
          </Row>
        </div>
      )
      break
    case 'about':
    case 'general':
      body = (
        <div className="set-card">
          <div className="about-mini">
            <LaptopArt size={110} />
            <div>
              <b>PearBook Pro</b>
              <small className="muted">16-inch, Nov 2025</small>
            </div>
          </div>
          <Row label="Name">PearBook Pro (47)</Row>
          <Row label="Chip">Pear P4 Max</Row>
          <Row label="Memory">8 GB (like 16 GB)</Row>
          <Row label="Serial number">C02PEAR4LYF3</Row>
          <Row label="Coverage" sub="Expired 3 days after purchase">
            <button className="btn small">Details…</button>
          </Row>
          <Row label="PearOS">Sequel 15.1</Row>
          <Row label="Kernel">
            <span className="mono small">{kernelVersion().slice(0, 48)}…</span>
          </Row>
        </div>
      )
      break
    case 'battery':
      body = (
        <div className="set-card">
          <Row label="Battery Health" sub="Your battery may need to be serviced. Or replaced. Or the whole laptop.">
            <b className="red">Service Recommended</b>
          </Row>
          <Row label="Maximum Capacity">61%</Row>
          <Row label="Low Power Mode">
            <select defaultValue="always">
              <option value="always">Always (it's faster that way)</option>
            </select>
          </Row>
        </div>
      )
      break
    case 'privacy':
      body = (
        <div className="set-card">
          <Row label="Allow applications from" sub="Pear prompts for permission every week to keep you safe and annoyed">
            <select>
              <option>App Store</option>
              <option>App Store &amp; Known Developers</option>
            </select>
          </Row>
          <Row label="Screen recording reminders" sub="“Zoom” has been accessing your screen. Allow for another week?">
            <button className="btn small">Allow For One Week</button>
          </Row>
          <Row label="FileVault">
            <Toggle on={misc.filevault} onChange={(v) => setMisc({ ...misc, filevault: v })} />
          </Row>
        </div>
      )
      break
    case 'update':
      body = <UpdatePane />
      break
    case 'wifi':
      body = (
        <div className="set-card">
          <Row label="Wi-Fi">
            <Toggle on={s.wifi} onChange={(v) => os().set('wifi', v)} />
          </Row>
          {s.wifi && (
            <>
              <Row label="PearNet" sub="Connected · 5 bars · 0 bytes/s">
                <Wifi size={15} />
              </Row>
              <Row label="xfinitywifi" sub="Open · requires 14 forms">
                <Wifi size={15} opacity={0.4} />
              </Row>
              <Row label="FBI Surveillance Van 3" sub="Secured">
                <Wifi size={15} opacity={0.6} />
              </Row>
            </>
          )}
        </div>
      )
      break
    case 'bluetooth':
      body = (
        <div className="set-card">
          <Row label="Bluetooth">
            <Toggle on={s.bluetooth} onChange={(v) => os().set('bluetooth', v)} />
          </Row>
          <Row label="Pear's AirPears Pro" sub="Connected to your pPhone instead, as usual">
            <button className="btn small">Connect</button>
          </Row>
          <Row label="Magic Mouse" sub="Charging (cannot be used while charging, by design)" />
        </div>
      )
      break
    case 'account':
      body = (
        <div className="set-card center-col">
          <div className="avatar big">
            <PearLogo size={48} color="#fff" />
          </div>
          <b>Pear User</b>
          <small className="muted">pear@icloud.com</small>
          <Row label="iCloud" sub="5 GB of 5 GB used">
            <button className="btn small primary">Upgrade</button>
          </Row>
          <Row label="Media &amp; Purchases" sub="1 album you didn't ask for">
            <button className="btn small">Manage</button>
          </Row>
        </div>
      )
      break
    default:
      body = (
        <div className="set-card">
          <Row label={'label' in current ? current.label : ''} sub="This pane intentionally left blank. Like the 'Optimize Storage' button's results.">
            <Toggle on={misc[pane] ?? true} onChange={(v) => setMisc({ ...misc, [pane]: v })} />
          </Row>
        </div>
      )
  }

  const filtered = PANES.filter((p) => !q || ('label' in p && p.label.toLowerCase().includes(q.toLowerCase())))

  return (
    <div className="settings">
      <aside className="sidebar" data-drag>
        <div className="sidebar-spacer" />
        <label className="search-field wide">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        </label>
        {filtered.map((p) => {
          if (!('label' in p)) return q ? null : <div key={p.id} className="sb-gap" />
          if (p.id === 'account')
            return (
              <button key={p.id} className={`sb-item account ${pane === p.id ? 'active' : ''}`} onClick={() => setPane(p.id)}>
                <span className="avatar small">
                  <PearLogo size={16} color="#fff" />
                </span>
                <span>
                  <b>{p.label}</b>
                  <small>{p.sub}</small>
                </span>
              </button>
            )
          const I = p.icon!
          return (
            <button key={p.id} className={`sb-item big ${pane === p.id ? 'active' : ''}`} onClick={() => setPane(p.id)}>
              <span className="sb-badge" style={{ background: p.color }}>
                <I size={12} color="#fff" strokeWidth={2.4} />
              </span>
              <span>{p.label}</span>
            </button>
          )
        })}
      </aside>
      <section className="settings-main">
        <div className="toolbar" data-drag>
          <div className="toolbar-title left">{'label' in current ? current.label : ''}</div>
        </div>
        <div className="settings-body">
          {body}
        </div>
      </section>
    </div>
  )
}

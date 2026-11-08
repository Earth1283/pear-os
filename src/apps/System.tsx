import { useEffect, useMemo, useRef, useState } from 'react'
import { Accessibility, Bell, Bluetooth, Cpu, Hand, Info, LayoutGrid, Lock, Monitor, Moon, Palette, RefreshCw, Search, Sparkles, Wifi, Image, Battery, ZoomIn, ZoomOut, Gauge, Blend, Hourglass } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useOS, os, type Win, type Wallpaper } from '../store'
import { kernelTaskCpu, entropy, renderMandelbrot, DEFAULT_VIEW, type FractalView, kernelVersion } from '../kernel'
import { GPU_MIN_SCALE, MandelbrotGL, gpuInfo } from '../lib/gpu'
import { APPS } from './registry'
import { LaptopArt, PearLogo, AppIcon } from '../components/icons'
import { menu } from '../lib/menu'
import { A11Y_DEFAULTS, speak, useA11y, type A11ySettings, type ColorFilter, type Invert, type ZoomModifier } from '../lib/a11y'
import { PRESETS, PRESET_ORDER } from '../lib/shaderPresets'
import { shaderStats, useShaders, type ShaderTarget } from '../lib/shaders'
import { altitudeDegrees, formatHour, moonName, skyAt, type Body, type SkyState } from '../lib/sky'
import { ScreenTimePane } from './ScreenTimePane'
import { procs as realProcs, useBackend, formatBytes as fmtBytes, type RealProc } from '../lib/backend'

export function About() {
  const sys = useBackend((s) => s.sys)
  return (
    <div className="about" data-drag>
      <LaptopArt size={150} />
      <h1>PearBook Pro</h1>
      <small className="muted">16-inch, Nov 2025</small>
      <dl>
        <dt>Chip</dt>
        <dd>Pear P4 Max (2 performance cores, 1 efficiency core, 0 cores that do anything)</dd>
        <dt>Graphics</dt>
        <dd>{gpuInfo().renderer} (borrowed from your actual computer)</dd>
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
      {sys && (
        <div className="about-real">
          <b>Actually running on</b>
          <span>
            {sys.hostname} · {sys.os}
          </span>
          <span>
            {sys.cpu} · {sys.cores} cores · {fmtBytes(sys.memTotal)} RAM (no multiplier)
          </span>
        </div>
      )}
      <button className="btn" onClick={() => os().openApp('settings', { props: { pane: 'about' } })}>
        More Info…
      </button>
      <small className="legal">™ and © 1983–2025 Pear Inc. All Rights Reserved. Not affiliated with any fruit-named company.</small>
    </div>
  )
}

type Proc = { name: string; icon?: keyof typeof APPS; cpu: number; mem: number; threads: number; pid: number; user: string; winId?: string; nr?: boolean; real?: boolean; mine?: boolean }

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
  const authed = useBackend((s) => s.authed)
  const hostname = useBackend((s) => s.sys?.hostname)
  const [real, setReal] = useState<RealProc[] | null>(null)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1200)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!authed) return setReal(null)
    let live = true
    const load = () => realProcs.list().then((r) => live && setReal(r), () => live && setReal(null))
    load()
    const t = setInterval(load, 2000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [authed])

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
    if (real) {
      const host: Proc[] = real.map((p) => ({ name: p.name, cpu: p.cpu, mem: p.mem / 1048576, threads: p.threads, pid: p.pid, user: p.mine ? 'you' : 'other', real: true, mine: p.mine }))
      const jokes = statics.filter((p) => p.nr)
      return [{ ...kt, pid: -1 }, ...apps.map((a) => ({ ...a, pid: -1000 - a.pid })), ...jokes.map((j) => ({ ...j, pid: -j.pid })), ...host].sort((a, b) => b.cpu - a.cpu)
    }
    return [kt, ...apps, ...statics].sort((a, b) => b.cpu - a.cpu)
  }, [tick, windows, real])

  const forceQuit = (p: Proc, gentle = false) => {
    if (p.real) {
      if (!p.mine) return os().notify({ app: 'activity', title: 'Activity Monitor', body: `“${p.name}” belongs to another user. pearosd only kills its own kind.` })
      realProcs
        .kill(p.pid, !gentle)
        .then(() => os().notify({ app: 'activity', title: 'Activity Monitor', body: `Sent ${gentle ? 'SIGTERM' : 'SIGKILL'} to “${p.name}” (PID ${p.pid}) on ${hostname ?? 'the host'}. That one was real.` }))
        .catch((e) => os().notify({ app: 'activity', title: 'Activity Monitor', body: `Couldn't quit “${p.name}”: ${e.message}` }))
      return setSel(null)
    }
    if (p.winId) os().closeApp(windows.find((w) => w.id === p.winId)!.app)
    else if (p.name === 'kernel_task') os().panic(`${gentle ? 'Quit' : 'Force quit'} kernel_task (bold move)`)
    else if (p.nr && gentle) os().notify({ app: 'activity', title: 'Activity Monitor', body: `"${p.name}" is not responding to your request to stop not responding.` })
    else os().notify({ app: 'activity', title: 'Activity Monitor', body: `"${p.name}" respawned immediately. It always does.` })
    setSel(null)
  }
  const procMenu = (p: Proc) =>
    menu([
      { label: 'Quit Process', run: () => forceQuit(p, true) },
      { label: 'Force Quit Process', shortcut: '⌥⌘⎋', run: () => forceQuit(p) },
      'sep',
      { label: 'Sample Process', run: () => os().notify({ app: 'activity', title: `Sample of ${p.name}`, body: 'Analysis complete. 98% of samples were in “waiting for something”.' }) },
      { label: 'Run Spindump', run: () => os().notify({ app: 'activity', title: 'Spindump', body: 'Spindump spun. Then dumped. Results saved to a file you will never open.' }) },
      'sep',
      { label: 'Get Info', shortcut: '⌘I', run: () => os().notify({ app: 'activity', title: p.name, body: `PID ${p.pid} · ${p.threads} threads · ${(p.mem / 1024).toFixed(2)} GB · Parent: launchd · Feelings: none` }) },
      { label: 'Copy Process Name', run: () => navigator.clipboard?.writeText(p.name) },
    ])

  const total = Math.min(100, procs.reduce((s, p) => s + p.cpu, 0) / 8)
  const history = useMemo(() => (hist.current = [...hist.current.slice(-59), total]), [procs])
  const selected = sel !== null ? procs.find((p) => p.pid === sel) : null

  return (
    <div className="activity">
      <div className="toolbar" data-drag>
        <button
          className="tb-btn"
          disabled={!selected}
          aria-label="Force quit"
          onClick={() => selected && forceQuit(selected)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <div className="toolbar-title left">
          Activity Monitor
          <small>{real ? `All Processes, actually on ${hostname ?? 'the host'}` : 'All Processes'}</small>
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
              <tr key={p.pid + p.name} className={`${sel === p.pid ? 'sel' : ''} ${p.nr ? 'nr' : ''}`} onClick={() => setSel(p.pid)} onContextMenu={(e) => (setSel(p.pid), procMenu(p)(e))}>
                <td>
                  <span className="lv-name">
                    {p.icon ? <AppIcon app={p.icon} size={16} /> : <span className="proc-dot" />}
                    {p.name}
                  </span>
                </td>
                <td className="num">{tab === 'Memory' ? `${(p.mem / 1024).toFixed(2)} GB` : tab === 'Energy' ? (p.cpu / 3).toFixed(1) : p.cpu.toFixed(1)}</td>
                <td className="num">{p.threads}</td>
                <td className="num">{p.pid < 0 ? '—' : p.pid}</td>
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
            <path d={'M0 40 ' + history.map((v, i) => `L${i} ${40 - v * 0.4}`).join(' ') + ` L${history.length - 1} 40Z`} fill="#ff453a" opacity=".8" />
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

type Engine = 'auto' | 'gpu' | 'cpu'

export function Fractals() {
  const cpuCanvas = useRef<HTMLCanvasElement>(null)
  const gpuCanvas = useRef<HTMLCanvasElement>(null)
  const gl = useRef<MandelbrotGL | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const gpu = gpuInfo()
  const [view, setView] = useState<FractalView>(DEFAULT_VIEW)
  const [engine, setEngine] = useState<Engine>(gpu.available ? 'auto' : 'cpu')
  const [stats, setStats] = useState({ ms: 0, on: 'cpu' as 'cpu' | 'gpu' })
  const useGpu = gpu.available && (engine === 'gpu' || (engine === 'auto' && view.scale > GPU_MIN_SCALE))

  useEffect(() => {
    if (!gpu.available || !gpuCanvas.current) return
    try {
      gl.current = new MandelbrotGL(gpuCanvas.current)
    } catch {
      gl.current = null
    }
    return () => gl.current?.dispose()
  }, [])

  useEffect(() => {
    const b = box.current
    if (!b) return
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round(b.clientWidth * dpr))
      const h = Math.max(1, Math.round(b.clientHeight * dpr))
      if (useGpu && gl.current) {
        gpuCanvas.current!.width = w
        gpuCanvas.current!.height = h
        setStats({ ms: gl.current.render(view), on: 'gpu' })
      } else if (cpuCanvas.current) {
        cpuCanvas.current.width = w
        cpuCanvas.current.height = h
        setStats({ ms: renderMandelbrot(cpuCanvas.current, view), on: 'cpu' })
      }
    }
    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(b)
    return () => ro.disconnect()
  }, [view, useGpu])

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const r = box.current!.getBoundingClientRect()
    const fx = (clientX - r.left) / r.width - 0.5
    const fy = (clientY - r.top) / r.height - 0.5
    const aspect = r.width / r.height
    setView((v) => ({ ...v, cx: v.cx + fx * v.scale * aspect, cy: v.cy + fy * v.scale, scale: v.scale * factor, iter: Math.min(4000, Math.round(v.iter * (factor < 1 ? 1.15 : 0.87))) }))
  }

  const setWallpaper = () => {
    os().set('fractalWallpaper', view)
    os().set('wallpaper', 'fractal')
    os().notify({ app: 'fractals', title: 'Wallpaper Set', body: useGpu ? `Your wallpaper is now rendered by your ${gpu.renderer}. Every resize. On purpose.` : 'Your wallpaper is now rendered by a Rust kernel every time you resize the window. As nature intended.' })
  }

  const saveImage = () => {
    const c = useGpu ? gpuCanvas.current : cpuCanvas.current
    if (!c) return
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = `Mandelbrot ${view.cx.toFixed(6)}, ${view.cy.toFixed(6)}.png`
    a.click()
  }

  const engineLabel = stats.on === 'gpu' ? `on ${gpu.renderer} (WebGL2)` : 'in pearnel.wasm (Rust)'

  return (
    <div className="fractals">
      <div className="toolbar dark" data-drag>
        <div className="toolbar-title left">
          Fractals
          <small>
            {stats.ms.toFixed(1)} ms {engineLabel} · zoom {(3 / view.scale).toExponential(1)}× · {view.iter} iter
          </small>
        </div>
        <div className="seg" title="Render engine">
          {(
            [
              ['auto', 'Auto'],
              ['gpu', 'GPU'],
              ['cpu', 'Rust'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={engine === id ? 'on' : ''} disabled={id !== 'cpu' && !gpu.available} onClick={() => setEngine(id)}>
              {label}
            </button>
          ))}
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
        <button className="btn small" onClick={setWallpaper}>
          Set as Wallpaper
        </button>
      </div>
      <div
        ref={box}
        className="fractal-canvas"
        onClick={(e) => zoomAt(e.clientX, e.clientY, e.shiftKey || e.altKey ? 2 : 0.4)}
        onContextMenu={menu((e) => [
          { label: 'Zoom In Here', run: () => zoomAt(e.clientX, e.clientY, 0.4) },
          { label: 'Zoom Out Here', run: () => zoomAt(e.clientX, e.clientY, 2.5) },
          { label: 'Reset View', run: () => setView(DEFAULT_VIEW) },
          'sep',
          {
            label: 'Render With',
            submenu: [
              { label: 'Automatic', checked: engine === 'auto', disabled: !gpu.available, run: () => setEngine('auto') },
              { label: `GPU: ${gpu.renderer}`, checked: engine === 'gpu', disabled: !gpu.available, run: () => setEngine('gpu') },
              { label: 'CPU: pearnel.wasm (Rust, f64)', checked: engine === 'cpu', run: () => setEngine('cpu') },
            ],
          },
          { label: 'Colors', submenu: (['Sequel', 'Pear', 'Rainbow'] as const).map((n, i) => ({ label: n, checked: view.scheme === i, run: () => setView((v) => ({ ...v, scheme: i as 0 | 1 | 2 })) })) },
          {
            label: 'Detail',
            submenu: [
              { label: 'More Iterations', run: () => setView((v) => ({ ...v, iter: Math.min(8000, Math.round(v.iter * 1.5)) })) },
              { label: 'Fewer Iterations', run: () => setView((v) => ({ ...v, iter: Math.max(50, Math.round(v.iter / 1.5)) })) },
            ],
          },
          'sep',
          { label: 'Copy Coordinates', run: () => navigator.clipboard?.writeText(`${view.cx}, ${view.cy} @ ${view.scale}`) },
          { label: 'Save Image…', run: saveImage },
          { label: 'Set as Wallpaper', run: setWallpaper },
        ])}
      >
        <canvas ref={cpuCanvas} style={{ visibility: useGpu ? 'hidden' : 'visible' }} />
        <canvas ref={gpuCanvas} style={{ visibility: useGpu ? 'visible' : 'hidden' }} />
        <div className="fractal-hint">
          <ZoomIn size={12} /> click · <ZoomOut size={12} /> shift-click · right-click for more
          {engine === 'auto' && gpu.available && !useGpu && <b> · float32 ran out, Rust took over</b>}
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
  { id: 'shaders', label: 'Shaders', icon: Blend, color: '#bf5af2' },
  { id: 'sep3' },
  { id: 'notifications', label: 'Notifications', icon: Bell, color: '#ff3b30' },
  { id: 'focus', label: 'Focus', icon: Moon, color: '#5e5ce6' },
  { id: 'screentime', label: 'Screen Time', icon: Hourglass, color: '#5e5ce6' },
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
  { id: 'lake', name: 'Mountain Lake', cls: 'wp-lake' },
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

function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => ('speechSynthesis' in window ? speechSynthesis.getVoices() : []))
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const on = () => setVoices(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', on)
    return () => speechSynthesis.removeEventListener('voiceschanged', on)
  }, [])
  return voices
}

const SHADER_TARGETS: { id: ShaderTarget; label: string; sub: string }[] = [
  { id: 'desktop', label: 'Desktop', sub: 'Drawn over the wallpaper, under the windows' },
  { id: 'windows', label: 'Windows', sub: 'Every open window, from one shared GPU context' },
  { id: 'overlay', label: 'Whole screen', sub: 'A click-through layer over everything, Dock included' },
]

function LakeOptions() {
  const s = useShaders()
  const live = useOS((o) => o.liveWallpaper)
  return (
    <>
      <Row label="High Quality Water" sub="Smooth ripples and a continuous reflection, instead of rows that snap to the pixel grid">
        <Toggle on={s.hqWater} onChange={(v) => s.set('hqWater', v)} />
      </Row>
      <Row label="High Quality Sky" sub="Soft clouds, a round sun and moon and no dithering, instead of pixel-art banding">
        <Toggle on={s.hqSky} onChange={(v) => s.set('hqSky', v)} />
      </Row>
      <Row label="Wind" sub={live ? 'Gusts roll across the lake, bend the pines and ruffle your folders, stickies, widgets and windows. Nothing blows away. Probably.' : 'Becalmed until Dynamic wallpaper is on.'}>
        <Toggle on={s.wind} onChange={(v) => s.set('wind', v)} />
      </Row>
    </>
  )
}

function SkyDiagram({ sky }: { sky: SkyState }) {
  const W = 280
  const H = 84
  const horizon = 66
  const place = (b: Body) => ({ x: W * (0.5 + 0.42 * b.x), y: horizon - b.elev * 52 })
  const sun = place(sky.sun)
  const moon = place(sky.moon)
  const side = (b: Body) => (b.elev > 0 ? `${altitudeDegrees(b.elev)}° up` : 'below the horizon')
  return (
    <div className="sky-diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Positions of the sun and moon">
        <path d={`M ${W * 0.08} ${horizon} A ${W * 0.42} 52 0 0 1 ${W * 0.92} ${horizon}`} fill="none" stroke="var(--line)" strokeDasharray="3 4" />
        <line x1="0" x2={W} y1={horizon} y2={horizon} stroke="var(--line)" />
        <circle cx={sun.x} cy={sun.y} r="8" fill="#ffb020" opacity={sky.sun.elev > 0 ? 1 : 0.3} />
        <circle cx={moon.x} cy={moon.y} r="6" fill="#cfd8ff" stroke="var(--line)" opacity={(moon.y < horizon ? 1 : 0.3) * (0.45 + 0.55 * sky.illum)} />
      </svg>
      <small className="muted">
        Sun {side(sky.sun)} · Moon {side(sky.moon)}, {Math.round(sky.illum * 100)}% lit ({moonName(sky.phase).toLowerCase()})
      </small>
    </div>
  )
}

function ShadersPane() {
  const s = useShaders()
  const reduce = useA11y((a) => a.reduceMotion)
  const g = gpuInfo()
  const [stats, setStats] = useState(shaderStats())
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setStats(shaderStats())
      tick((n) => n + 1)
    }, 500)
    return () => clearInterval(id)
  }, [])
  const preset = PRESETS[s.preset]
  const running = s.enabled && g.available
  const sky = skyAt(new Date(), s.hourOverride)
  return (
    <>
      <p className="set-intro">Real-time GLSL shaders, run by your actual GPU (the Pear P4 Max is a sticker). Everything here is drawn live, not played back from a video.</p>
      <div className="set-card">
        <Row label="Shaders" sub={g.available ? `Rendered on your ${g.renderer}` : 'Needs WebGL2. Your browser said no.'}>
          <Toggle on={running} onChange={(v) => g.available && s.set('enabled', v)} />
        </Row>
      </div>
      <h4 className="set-head">Lighting</h4>
      <div className="set-card">
        <Row label="Sun, moon & lamp" sub={running ? 'Shadows between windows, files and folders. The sun and moon follow the time, and the lamp (your pointer) comes on at night' : 'Turn Shaders on to see it'}>
          <Toggle on={s.lighting} onChange={(v) => s.set('lighting', v)} />
        </Row>
        <Row label="Time of day" sub={s.hourOverride === null ? 'Following your clock' : 'Set by hand. The Mountain Lake follows it too'}>
          <Toggle on={s.hourOverride === null} onChange={(v) => s.set('hourOverride', v ? null : Math.round(sky.hour * 4) / 4)} />
        </Row>
        {s.hourOverride !== null && (
          <Row label={formatHour(s.hourOverride)}>
            <input type="range" min={0} max={24} step={0.25} value={s.hourOverride} onChange={(e) => s.set('hourOverride', +e.target.value)} aria-label="Time of day" />
          </Row>
        )}
        <SkyDiagram sky={sky} />
      </div>
      <h4 className="set-head">Look</h4>
      <div className="set-card">
        <div className="wp-grid">
          {PRESET_ORDER.map((id) => (
            <button key={id} className={`wp-pick ${s.preset === id ? 'on' : ''}`} onClick={() => s.set('preset', id)} title={PRESETS[id].blurb}>
              <span className="wp-thumb" style={{ background: PRESETS[id].swatch }} />
              <small>{PRESETS[id].name}</small>
            </button>
          ))}
        </div>
        <Row label={preset.name} sub={preset.blurb} />
        <Row label="Intensity">
          <input type="range" min={0.1} max={1} step={0.01} value={s.intensity} onChange={(e) => s.set('intensity', +e.target.value)} aria-label="Shader intensity" />
        </Row>
      </div>
      <h4 className="set-head">Where</h4>
      <div className="set-card">
        {SHADER_TARGETS.map((t) => {
          const has = !!preset.layers[t.id]
          return (
            <Row key={t.id} label={t.label} sub={has ? t.sub : `Not part of ${preset.name}`}>
              <Toggle on={has && s.targets[t.id]} onChange={(v) => has && s.setTarget(t.id, v)} />
            </Row>
          )
        })}
      </div>
      <h4 className="set-head">Status</h4>
      <div className="set-card">
        <Row label="Renderer" sub={reduce ? 'Reduce motion is on, so you get one still frame per layer' : 'Capped at 30 fps. Pauses while this tab is in the background'}>
          <span className="muted sh-stat">
            {running && stats && stats.layers ? `${stats.layers} layer${stats.layers === 1 ? '' : 's'} · ${reduce ? 'still' : `${stats.fps} fps`} · ${stats.ms.toFixed(1)} ms/frame` : 'Idle'}
          </span>
        </Row>
      </div>
    </>
  )
}

function AccessibilityPane() {
  const a = useA11y()
  const voices = useVoices()
  const set = a.set
  const tog = (k: { [K in keyof A11ySettings]: A11ySettings[K] extends boolean ? K : never }[keyof A11ySettings]) => <Toggle on={a[k]} onChange={(v) => set(k, v)} />
  const range = (k: 'displayContrast' | 'filterIntensity' | 'pointerSize' | 'rate', min: number, max: number, step = 0.01) => (
    <input type="range" min={min} max={max} step={step} value={a[k]} onChange={(e) => set(k, +e.target.value)} aria-label={k} />
  )
  const canSpeak = 'speechSynthesis' in window
  const mod = { ctrl: '⌃ Control', alt: '⌥ Option', meta: '⌘ Command' }
  return (
    <>
      <p className="set-intro">Personalize PearOS in ways that work for you. These are real: they change how this whole screen looks, sounds and behaves, and they're remembered on this browser.</p>

      <h4 className="set-head">Vision · Display</h4>
      <div className="set-card">
        <Row label="Reduce motion" sub="Turns off animations and the moving wallpaper">
          {tog('reduceMotion')}
        </Row>
        <Row label="Reduce transparency" sub="Makes menus, the Dock and sidebars solid">
          {tog('reduceTransparency')}
        </Row>
        <Row label="Increase contrast" sub="Darker borders and text on everything">
          {tog('increaseContrast')}
        </Row>
        <Row label="Display contrast">
          {range('displayContrast', 1, 2)}
        </Row>
        <Row label="Invert colors" sub="Smart Invert keeps photos, video and app icons looking normal">
          <select value={a.invert} onChange={(e) => set('invert', e.target.value as Invert)}>
            <option value="off">Off</option>
            <option value="smart">Smart Invert</option>
            <option value="classic">Classic Invert</option>
          </select>
        </Row>
        <Row label="Color filters" sub="Helps tell apart colors that are hard to distinguish">
          <select value={a.colorFilter} onChange={(e) => set('colorFilter', e.target.value as ColorFilter)}>
            <option value="off">Off</option>
            <option value="grayscale">Grayscale</option>
            <option value="protanopia">Red/Green filter (Protanopia)</option>
            <option value="deuteranopia">Green/Red filter (Deuteranopia)</option>
            <option value="tritanopia">Blue/Yellow filter (Tritanopia)</option>
            <option value="tint">Color Tint</option>
          </select>
        </Row>
        {a.colorFilter !== 'off' && (
          <Row label="Filter intensity">
            {range('filterIntensity', 0, 1)}
          </Row>
        )}
        {a.colorFilter === 'tint' && (
          <Row label="Tint color">
            <input type="color" value={a.tint} onChange={(e) => set('tint', e.target.value)} className="set-color" />
          </Row>
        )}
      </div>

      <h4 className="set-head">Vision · Pointer</h4>
      <div className="set-card">
        <Row label="Pointer size">
          {range('pointerSize', 1, 4)}
        </Row>
        <Row label="Shake mouse pointer to locate" sub="Wiggle the mouse quickly and the pointer gets big for a moment">
          {tog('shakeToLocate')}
        </Row>
        <Row label="Pointer outline color">
          <input type="color" value={a.pointerOutline} onChange={(e) => set('pointerOutline', e.target.value)} className="set-color" />
        </Row>
        <Row label="Pointer fill color">
          <input type="color" value={a.pointerFill} onChange={(e) => set('pointerFill', e.target.value)} className="set-color" />
          <button
            className="btn small"
            disabled={a.pointerFill === A11Y_DEFAULTS.pointerFill && a.pointerOutline === A11Y_DEFAULTS.pointerOutline}
            onClick={() => {
              set('pointerFill', A11Y_DEFAULTS.pointerFill)
              set('pointerOutline', A11Y_DEFAULTS.pointerOutline)
            }}
          >
            Reset
          </button>
        </Row>
      </div>

      <h4 className="set-head">Vision · Zoom</h4>
      <div className="set-card">
        <Row label="Use keyboard shortcuts to zoom" sub="⌥⌘8 toggles zoom, ⌥⌘= zooms in, ⌥⌘− zooms out (Ctrl works in place of ⌘)">
          {tog('zoomKeys')}
        </Row>
        <Row label="Use scroll gesture with modifier keys to zoom" sub={`Hold ${mod[a.zoomModifier]} and scroll. The view follows the pointer.`}>
          <select value={a.zoomModifier} onChange={(e) => set('zoomModifier', e.target.value as ZoomModifier)} disabled={!a.zoomScroll}>
            <option value="ctrl">⌃ Control</option>
            <option value="alt">⌥ Option</option>
            <option value="meta">⌘ Command</option>
          </select>
          {tog('zoomScroll')}
        </Row>
        <Row label="Current zoom" sub={a.zoom > 1 ? 'Zoomed in' : 'Not zoomed'}>
          <span className="small">{Math.round(a.zoom * 100)}%</span>
          <button className="btn small" disabled={a.zoom <= 1} onClick={() => useA11y.setState({ zoom: 1 })}>
            Reset
          </button>
        </Row>
        <Row label="Hover Text" sub="Hold ⌘ (or Ctrl) and point at something to see it in large type">
          {tog('hoverText')}
        </Row>
      </div>

      <h4 className="set-head">Vision · Spoken Content</h4>
      <div className="set-card">
        {!canSpeak && <Row label="Speech isn't available" sub="This browser doesn't support speech synthesis." />}
        <Row label="Speak selection" sub="Press ⌥Esc to hear the selected text, or whatever's under the pointer">
          {tog('speakSelection')}
        </Row>
        <Row label="Speak items under the pointer" sub="Reads out buttons, labels and text as you point at them">
          {tog('speakPointer')}
        </Row>
        <Row label="Speak announcements" sub="Reads notifications aloud as they arrive">
          {tog('speakAnnouncements')}
        </Row>
        <Row label="System voice">
          <select value={a.voice} onChange={(e) => set('voice', e.target.value)} disabled={!canSpeak}>
            <option value="">System default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
          <button className="btn small" disabled={!canSpeak} onClick={() => speak('Hello. This is how PearOS sounds when it reads things to you.')}>
            Play
          </button>
        </Row>
        <Row label="Speaking rate">
          {range('rate', 0.5, 2)}
        </Row>
      </div>

      <h4 className="set-head">Hearing</h4>
      <div className="set-card">
        <Row label="Flash the screen when an alert occurs" sub="Every notification flashes the display">
          {tog('flashAlerts')}
          <button className="btn small" onClick={() => os().notify({ app: 'settings', title: 'Test Alert', body: 'This is what an alert looks like. And sounds like, if you turned on announcements.' })}>
            Test
          </button>
        </Row>
        <Row label="Play stereo audio as mono" sub="Music plays the same thing out of both speakers">
          {tog('monoAudio')}
        </Row>
      </div>

      <h4 className="set-head">Motor · Keyboard</h4>
      <div className="set-card">
        <Row label="Keyboard navigation" sub="Use Tab to move focus between controls, with a clear focus ring">
          {tog('keyboardNav')}
        </Row>
        <Row label="Accessibility Shortcut" sub="⌥⌘F5 opens this pane from anywhere" />
      </div>

      <div className="set-actions">
        <button
          className="btn"
          onClick={() => {
            a.reset()
            useA11y.setState({ zoom: 1 })
          }}
        >
          Restore Defaults
        </button>
      </div>
    </>
  )
}

export function Settings({ win }: { win: Win }) {
  const [pane, setPane] = useState<PaneId>((win.props.pane as PaneId) ?? 'appearance')
  const [q, setQ] = useState('')
  const s = useOS(
    useShallow((st) => ({
      bluetooth: st.bluetooth,
      brightness: st.brightness,
      dockMagnify: st.dockMagnify,
      dockSize: st.dockSize,
      liveWallpaper: st.liveWallpaper,
      theme: st.theme,
      wallpaper: st.wallpaper,
      wifi: st.wifi,
    })),
  )
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
          <Row label="Dynamic wallpaper" sub={gpuInfo().available ? `Shaded live on your ${gpuInfo().renderer}` : 'Needs WebGL2. Your browser said no.'}>
            <Toggle on={s.liveWallpaper && gpuInfo().available} onChange={(v) => gpuInfo().available && os().set('liveWallpaper', v)} />
          </Row>
          {s.wallpaper === 'lake' && <LakeOptions />}
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
          <Row label="Graphics" sub="Your real GPU, via WebGL2">
            <span className="small">{gpuInfo().renderer}</span>
          </Row>
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
    case 'displays': {
      const g = gpuInfo()
      body = (
        <>
          <div className="set-card">
            <div className="about-mini">
              <Monitor size={54} strokeWidth={1.2} />
              <div>
                <b>Built-in Liquid Retina XDR Display (in a browser tab)</b>
                <small className="muted">
                  {window.screen.width} × {window.screen.height} · {window.devicePixelRatio}× · {window.innerWidth} × {window.innerHeight} usable
                </small>
              </div>
            </div>
            <Row label="Graphics processor" sub="The real one, underneath PearOS">
              <span className="small">{g.renderer}</span>
            </Row>
            <Row label="Vendor">
              <span className="small">{g.vendor || '—'}</span>
            </Row>
            <Row label="WebGL2">{g.available ? 'Available' : 'Unavailable'}</Row>
            <Row label="Max texture size">{g.maxTexture ? `${g.maxTexture} × ${g.maxTexture}` : '—'}</Row>
          </div>
          <div className="set-card">
            <Row label="Brightness">
              <input type="range" min={0.25} max={1} step={0.01} value={s.brightness} onChange={(e) => os().set('brightness', +e.target.value)} />
            </Row>
            <Row label="True Tone" sub="Makes everything slightly yellow, like a pear">
              <Toggle on={misc.truetone ?? true} onChange={(v) => setMisc({ ...misc, truetone: v })} />
            </Row>
            <Row label="Dynamic wallpaper on GPU">
              <Toggle on={s.liveWallpaper && g.available} onChange={(v) => g.available && os().set('liveWallpaper', v)} />
            </Row>
          </div>
        </>
      )
      break
    }
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
    case 'shaders':
      body = <ShadersPane />
      break
    case 'screentime':
      body = <ScreenTimePane />
      break
    case 'accessibility':
      body = <AccessibilityPane />
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

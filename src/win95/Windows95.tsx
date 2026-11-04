import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { os } from '../store'
import { useBootCamp } from '../lib/bootcamp'
import { SPECS, msgbox, useW95, w95, type AppKey, type IconName, type W95Win } from './store'
import { Icon } from './icons'
import { Frame } from './ui'
import { CloseProgram, DisplayProps, Explorer, MsgBox, Notepad, PearNet, RunDialog, ShutdownDialog, SystemProps, Welcome, Winver, note } from './apps'
import { Dos, DosTerm } from './Dos'
import { Minesweeper } from './Minesweeper'
import { Paint } from './Paint'
import { FirstRun, Setup } from './Setup'
import { shutdownSound, startupSound } from './sound'
import './win95.css'

const VIEW: Record<AppKey, ComponentType<{ win: W95Win }>> = {
  explorer: Explorer,
  notepad: Notepad,
  mines: Minesweeper,
  paint: Paint,
  dos: Dos,
  pnet: PearNet,
  welcome: Welcome,
  msgbox: MsgBox,
  winver: Winver,
  display: DisplayProps,
  system: SystemProps,
  run: RunDialog,
  shutdown: ShutdownDialog,
  closeprog: CloseProgram,
}

type Stage = 'post' | 'setup' | 'splash' | 'firstrun' | 'desktop' | 'closing' | 'safe' | 'dos'
type Target = 'shutdown' | 'restart' | 'dos' | 'mac'

/* ------------------------------------------------------------------ boot screens */

function Post({ cd, onDone }: { cd: boolean; onDone: () => void }) {
  const lines = [
    'PearBIOS v1.0 (C) 1995-2026 Pear Computer, Inc.',
    'Pear Silicon M-class Processor, emulating a 486DX/2-66',
    '',
    'Memory Test :  8192K OK',
    'Detecting IDE Primary Master   ... Pear HD',
    'Detecting IDE Primary Slave    ... WIN95_OSR2 (CD-ROM)',
    'Detecting Floppy Drive A:      ... None. The 90s called.',
    '',
    cd ? 'Booting from CD-ROM: WIN95_OSR2' : 'Starting Windows 95...',
  ]
  const [n, setN] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (n >= lines.length) {
      const t = setTimeout(() => done.current(), 600)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setN((v) => v + 1), n === 3 ? 450 : 190)
    return () => clearTimeout(t)
    // `lines` is rebuilt every render but only its length matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n])
  return (
    <div className="w95-post">
      {lines.slice(0, n).map((l, i) => (
        <div key={i}>{l || '\u00a0'}</div>
      ))}
      <span className="cur">_</span>
    </div>
  )
}

function Sky({ children, bar }: { children: React.ReactNode; bar?: boolean }) {
  return (
    <div className="w95-sky">
      <i className="cloud c1" />
      <i className="cloud c2" />
      <i className="cloud c3" />
      {children}
      {bar && <div className="w95-strip" />}
    </div>
  )
}

function Splash({ onDone }: { onDone: () => void }) {
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    startupSound()
    const t = setTimeout(() => done.current(), 3800)
    return () => clearTimeout(t)
  }, [])
  return (
    <Sky bar>
      <div className="w95-splash-logo">
        <Icon name="flag" size={84} />
        <div>
          <span>Windows<b>95</b></span>
          <small>Pear Silicon edition</small>
        </div>
      </div>
      <p className="w95-splash-msg">Starting Windows 95…</p>
    </Sky>
  )
}

/* ------------------------------------------------------------------ start menu */

interface SItem {
  label: string
  icon?: IconName
  run?: () => void
  sub?: SItem[]
  disabled?: boolean
  sep?: boolean
}

const open = (app: AppKey, props?: Record<string, unknown>) => () => w95().open(app, props)

const MENU: SItem[] = [
  {
    label: 'Programs',
    icon: 'programs',
    sub: [
      {
        label: 'Accessories',
        icon: 'folder',
        sub: [
          { label: 'Notepad', icon: 'notepad', run: open('notepad') },
          { label: 'Paint', icon: 'paint', run: open('paint') },
          { label: 'Games', icon: 'folder', sub: [{ label: 'Minesweeper', icon: 'mines', run: open('mines') }] },
        ],
      },
      { label: 'StartUp', icon: 'folder', sub: [{ label: '(Empty)', disabled: true }] },
      { label: 'The Pear Network', icon: 'globe', run: open('pnet') },
      { label: 'MS-DOS Prompt', icon: 'dos', run: open('dos') },
      { label: 'Windows Explorer', icon: 'computer', run: open('explorer', { path: 'C:\\' }) },
    ],
  },
  {
    label: 'Documents',
    icon: 'docs',
    sub: [
      { label: 'README.TXT', icon: 'doc', run: () => note('README.TXT') },
      { label: 'homework.txt', icon: 'doc', run: () => note('homework.txt') },
      { label: 'My Documents', icon: 'folder', run: open('explorer', { path: 'C:\\My Documents' }) },
    ],
  },
  {
    label: 'Settings',
    icon: 'settings',
    sub: [
      { label: 'Control Panel', icon: 'control', run: open('explorer', { path: 'Control Panel' }) },
      { label: 'Printers', icon: 'printer', run: () => msgbox('There are no printers. There was never a printer.', { title: 'Printers' }) },
      { label: 'Taskbar…', icon: 'settings', run: () => msgbox('The taskbar is at the bottom. It is staying at the bottom.', { title: 'Taskbar Properties' }) },
    ],
  },
  {
    label: 'Find',
    icon: 'find',
    sub: [
      { label: 'Files or Folders…', icon: 'find', run: () => msgbox('0 file(s) found.\n\nYou were looking for meaning, not a file.', { title: 'Find: All Files' }) },
      { label: 'Computer…', icon: 'computer', run: () => msgbox('Your computer is right there.', { title: 'Find Computer' }) },
    ],
  },
  { label: 'Help', icon: 'help', run: () => msgbox('Windows Help is not installed.\n\nIt was going to be, but it got stuck in the other disk.', { icon: 'info', title: 'Windows Help' }) },
  { label: 'Run…', icon: 'run', run: open('run') },
  { label: '', sep: true },
  { label: 'Shut Down…', icon: 'shutdown', run: open('shutdown') },
]

function Rows({ items, big }: { items: SItem[]; big?: boolean }) {
  const [hot, setHot] = useState<number | null>(null)
  return (
    <div className={`w95-smenu ${big ? 'big' : ''}`}>
      {items.map((it, i) =>
        it.sep ? (
          <hr key={i} />
        ) : (
          <div key={it.label} className="w95-srow-wrap" onPointerEnter={() => setHot(i)}>
            <button
              className={`w95-srow ${hot === i ? 'hot' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                if (it.sub) return setHot(i)
                w95().setStart(false)
                it.run?.()
              }}
            >
              {it.icon ? <Icon name={it.icon} size={big ? 32 : 16} /> : <span className="noicon" />}
              <span>{it.label}</span>
              {it.sub && <span className="arrow">▸</span>}
            </button>
            {it.sub && hot === i && <Rows items={it.sub} />}
          </div>
        ),
      )}
    </div>
  )
}

function StartMenu() {
  return (
    <div className="w95-start" onPointerDown={(e) => e.stopPropagation()}>
      <div className="w95-start-side"><span>Windows<b>95</b></span></div>
      <Rows items={MENU} big />
    </div>
  )
}

/* ------------------------------------------------------------------ desktop */

const DESKTOP_ICONS: { label: string; icon: IconName; run: () => void }[] = [
  { label: 'My Computer', icon: 'computer', run: open('explorer', { path: 'My Computer' }) },
  { label: 'My Documents', icon: 'folder', run: open('explorer', { path: 'C:\\My Documents' }) },
  { label: 'The Pear Network', icon: 'globe', run: open('pnet') },
  { label: 'Recycle Bin', icon: 'recycleFull', run: open('explorer', { path: 'Recycle Bin' }) },
]

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  return <span title={now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}>{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
}

function Bsod() {
  const code = useRef(['0E', '0D', '06'][Math.floor(Math.random() * 3)])
  const addr = useRef(`0028:C00${Math.floor(Math.random() * 9000 + 1000).toString(16).toUpperCase()}`)
  useEffect(() => {
    const dismiss = () => useW95.getState().uncrash()
    const t = setTimeout(() => {
      window.addEventListener('keydown', dismiss)
      window.addEventListener('pointerdown', dismiss)
    }, 500)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', dismiss)
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [])
  return (
    <div className="w95-bsod" role="alert">
      <p><span>Windows</span></p>
      <p>
        A fatal exception {code.current} has occurred at {addr.current} in VXD PEARSIL(01) + 00000F2A. The current application will be terminated.
      </p>
      <p>*  Press any key to terminate the current application.</p>
      <p>*  Press CTRL+ALT+DEL again to restart your computer. You will lose any unsaved information in all applications.</p>
      <p className="center">Press any key to continue <span className="cur">_</span></p>
    </div>
  )
}

function Desktop95({ first }: { first: boolean }) {
  const windows = useW95((s) => s.windows)
  const focused = useW95((s) => s.focused)
  const startOpen = useW95((s) => s.startOpen)
  const bsod = useW95((s) => s.bsod)
  const desk = useW95((s) => s.desk)
  const [sel, setSel] = useState<string | null>(null)

  // First arrival: the welcome screen, and Windows noticing the Mac underneath it.
  useEffect(() => {
    const timers: number[] = []
    if (useBootCamp.getState().welcome) timers.push(window.setTimeout(() => w95().open('welcome'), 500))
    if (first) {
      timers.push(
        window.setTimeout(
          () =>
            msgbox('Windows has found new hardware:\n\nPear Silicon M-class Processor\n\nWindows does not have a driver for this device. Windows does not have a driver for any device. Windows is running on vibes.', {
              icon: 'info',
              title: 'New Hardware Found',
              buttons: [{ label: 'OK' }, { label: 'Do not install a driver' }],
            }),
          2600,
        ),
      )
    }
    // One crash per boot, at a time of Windows' choosing.
    timers.push(window.setTimeout(() => w95().crash(), 150_000 + Math.random() * 90_000))
    return () => timers.forEach(clearTimeout)
  }, [first])

  // The classic three-finger salute, if the browser lets it through.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        w95().open('closeprog')
      } else if (e.key === 'Escape') w95().setStart(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tasks = windows.filter((w) => !SPECS[w.app].dialog)

  return (
    <div className="w95-root" onPointerDown={() => w95().setStart(false)}>
      <div className="w95-desktop" style={{ background: desk }} onPointerDown={() => setSel(null)}>
        <div className="w95-dicons">
          {DESKTOP_ICONS.map((d) => (
            <button
              key={d.label}
              className={`w95-dicon ${sel === d.label ? 'sel' : ''}`}
              onPointerDown={(e) => {
                e.stopPropagation()
                setSel(d.label)
                w95().setStart(false)
              }}
              onDoubleClick={d.run}
            >
              <Icon name={d.icon} />
              <span>{d.label}</span>
            </button>
          ))}
        </div>
        {windows.map((w) => {
          const View = VIEW[w.app]
          return (
            <Frame key={w.id} win={w}>
              <View win={w} />
            </Frame>
          )
        })}
      </div>
      {startOpen && <StartMenu />}
      <div className="w95-taskbar" onPointerDown={(e) => e.stopPropagation()}>
        <button className={`w95-startbtn ${startOpen ? 'on' : ''}`} onClick={() => w95().setStart(!startOpen)}>
          <Icon name="flag" size={18} />
          <b>Start</b>
        </button>
        <i className="w95-grip" />
        <div className="w95-tasks">
          {tasks.map((w) => (
            <button
              key={w.id}
              className={`w95-task ${focused === w.id && !w.min ? 'on' : ''}`}
              onClick={() => (focused === w.id && !w.min ? w95().minimize(w.id) : w95().focus(w.id))}
            >
              <Icon name={SPECS[w.app].icon} size={16} />
              <span>{w.title}</span>
            </button>
          ))}
        </div>
        <div className="w95-tray sunken">
          <Icon name="sound" size={16} />
          <Clock />
        </div>
      </div>
      {bsod && <Bsod />}
    </div>
  )
}

/* ------------------------------------------------------------------ shell */

export function Windows95() {
  const [stage, setStage] = useState<Stage>('post')
  const [target, setTarget] = useState<Target>('shutdown')
  const first = useRef(false)
  const power = useW95((s) => s.power)
  const pending = useBootCamp((s) => s.windows === 'pending')

  const toMac = useCallback(() => {
    w95().reset()
    useBootCamp.getState().set({ startup: 'mac' })
    os().setPhase('booting')
  }, [])

  // Leave the whole thing clean so the next boot starts from a bare desktop.
  useEffect(() => () => w95().reset(), [])

  useEffect(() => {
    if (!power || stage !== 'desktop') return
    setTarget(power)
    w95().requestPower(null)
    shutdownSound()
    setStage('closing')
  }, [power, stage])

  useEffect(() => {
    if (stage !== 'closing') return
    const t = setTimeout(() => {
      w95().reset()
      if (target === 'shutdown') setStage('safe')
      else if (target === 'restart') setStage('post')
      else if (target === 'dos') setStage('dos')
      else toMac()
    }, 2600)
    return () => clearTimeout(t)
  }, [stage, target, toMac])

  const finishSetup = useCallback(() => {
    useBootCamp.getState().set({ windows: 'installed' })
    first.current = true
    setStage('post')
  }, [])

  useEffect(() => {
    if (stage !== 'safe') return
    const off = () => os().setPhase('off')
    window.addEventListener('keydown', off)
    return () => window.removeEventListener('keydown', off)
  }, [stage])

  let view: React.ReactNode
  switch (stage) {
    case 'post':
      view = <Post cd={pending} onDone={() => setStage(useBootCamp.getState().windows === 'pending' ? 'setup' : 'splash')} />
      break
    case 'setup':
      view = <Setup onDone={finishSetup} />
      break
    case 'splash':
      view = <Splash onDone={() => setStage(first.current ? 'firstrun' : 'desktop')} />
      break
    case 'firstrun':
      view = <FirstRun onDone={() => setStage('desktop')} />
      break
    case 'desktop':
      view = <Desktop95 first={first.current} />
      break
    case 'closing':
      view = (
        <Sky>
          <p className="w95-closing">Windows is shutting down.</p>
        </Sky>
      )
      break
    case 'safe':
      view = (
        <div className="w95-safe" onPointerDown={() => os().setPhase('off')}>
          <p>It's now safe to turn off your computer.</p>
          <small>Press any key to turn it off. It is the same thing.</small>
        </div>
      )
      break
    case 'dos':
      view = <DosTerm full onWin={() => setStage('splash')} onPear={toMac} />
      break
  }
  return <div className="w95 w95-shell">{view}</div>
}

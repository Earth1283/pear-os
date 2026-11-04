import { useEffect, useRef, useState } from 'react'
import { useBootCamp } from '../lib/bootcamp'
import { SPECS, msgbox, useW95, w95, type IconName, type W95Win } from './store'
import { Icon } from './icons'
import { MenuBar95 } from './ui'
import { dingSound, errorSound } from './sound'

/* ------------------------------------------------------------------ text files */

export const TEXTS: Record<string, string> = {
  'README.TXT': `WINDOWS 95 README
=================

Thank you for installing Windows 95 on your PearBook Pro.

KNOWN ISSUES
  - Windows 95 does not recognise your processor.
  - Windows 95 does not recognise the year.
  - Windows 95 will crash. We do not know when. Neither does it.
  - If the screen goes blue, press any key. Pressing a second key is
    optional but encouraged.

To return to Pear OS, click Start, then Shut Down, then pick the last option.
`,
  'AUTOEXEC.BAT': `@ECHO OFF
PROMPT $p$g
PATH C:\\WINDOWS;C:\\WINDOWS\\COMMAND
SET BLASTER=A220 I5 D1 T4
REM The above line is why your sound card works. Do not touch it.
`,
  'CONFIG.SYS': `DEVICE=C:\\WINDOWS\\HIMEM.SYS
DOS=HIGH,UMB
FILES=40
BUFFERS=20
DEVICE=C:\\WINDOWS\\PEARSIL.VXD  ; unsupported
`,
  'homework.txt': `Essay: "What I did on my summer vacation"

I installed Windows 95. It took three days. That was the vacation.
`,
  'unsaved doc 1.txt': 'dear diary, the dock has no magnification and my computer is gray\n',
  'your hopes.dat': 'MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000 (this file is empty. deleting did not help)\n',
  'PearOS 2000 (cancelled).iso': 'This disk image was moved to the Recycle Bin on 2000-01-01.\nIt did not run Y2K-compatible code.\n',
}

export function note(name: string, text?: string) {
  w95().open('notepad', { title: `${name} - Notepad`, text: text ?? TEXTS[name] ?? '' })
}

const unsupported = (what: string) =>
  msgbox(`Windows cannot open "${what}". There is no program associated with this file type.\n\nInsert the Windows 95 CD-ROM and try again. (It is the .iso. It is already in there.)`, { icon: 'warn', title: what })

/* ------------------------------------------------------------------ launching */

const NOT_FOUND = (cmd: string) =>
  msgbox(`Cannot find the file '${cmd}' (or one of its components). Make sure the path and filename are correct and that all required libraries are available.`, { icon: 'error', title: cmd })

export function runCommand(raw: string) {
  const cmd = raw.trim()
  if (!cmd) return
  const key = cmd.toLowerCase().replace(/\.(exe|com)$/, '')
  const open = w95().open
  switch (key) {
    case 'notepad':
      return open('notepad')
    case 'winmine':
    case 'minesweeper':
    case 'mines':
      return open('mines')
    case 'mspaint':
    case 'pbrush':
    case 'paint':
      return open('paint')
    case 'command':
    case 'cmd':
    case 'dos':
      return open('dos')
    case 'explorer':
    case 'c:\\':
    case 'c:':
      return open('explorer', { path: key === 'explorer' ? 'My Computer' : 'C:\\' })
    case 'iexplore':
    case 'pnet':
    case 'netscape':
      return open('pnet')
    case 'winver':
      return open('winver')
    case 'control':
      return open('explorer', { path: 'Control Panel' })
    case 'welcome':
      return open('welcome')
    case 'bsod':
    case 'crash':
      return w95().crash()
    default:
      return NOT_FOUND(cmd)
  }
}

/* ------------------------------------------------------------------ explorer */

interface Entry {
  name: string
  icon: IconName
  to?: string
  run?: () => void
}

const folder = (name: string, to: string): Entry => ({ name, icon: 'folder', to })
const txt = (name: string): Entry => ({ name, icon: 'doc', run: () => note(name) })
const prog = (name: string, icon: IconName, run: () => void): Entry => ({ name, icon, run })
const junk = (name: string, icon: IconName = 'dll'): Entry => ({ name, icon, run: () => unsupported(name) })

const notReady = (drive: string) => () =>
  msgbox(`${drive} is not accessible.\n\nThe device is not ready.`, { icon: 'error', title: drive, buttons: [{ label: 'Retry' }, { label: 'Cancel' }] })

const CP_STUB = (label: string) => () =>
  msgbox(`${label} is not available on this computer. Insert the Windows 95 CD-ROM, or do not.`, { icon: 'info', title: label })

function listing(path: string): Entry[] {
  switch (path) {
    case 'My Computer':
      return [
        { name: '3½ Floppy (A:)', icon: 'floppy', run: notReady('A:\\') },
        { name: 'Pear HD (C:)', icon: 'drive', to: 'C:\\' },
        { name: 'WIN95_OSR2 (D:)', icon: 'cdrom', to: 'D:\\' },
        { name: 'Printers', icon: 'printer', run: CP_STUB('Printers') },
        { name: 'Control Panel', icon: 'control', to: 'Control Panel' },
      ]
    case 'C:\\':
      return [
        folder('WINDOWS', 'C:\\WINDOWS'),
        folder('Program Files', 'C:\\Program Files'),
        folder('My Documents', 'C:\\My Documents'),
        prog('COMMAND.COM', 'dos', () => w95().open('dos')),
        txt('AUTOEXEC.BAT'),
        txt('CONFIG.SYS'),
        txt('README.TXT'),
      ]
    case 'C:\\WINDOWS':
      return [
        folder('SYSTEM', 'C:\\WINDOWS\\SYSTEM'),
        prog('NOTEPAD.EXE', 'notepad', () => w95().open('notepad')),
        prog('MSPAINT.EXE', 'paint', () => w95().open('paint')),
        prog('WINMINE.EXE', 'mines', () => w95().open('mines')),
        prog('WINVER.EXE', 'flag', () => w95().open('winver')),
        prog('EXPLORER.EXE', 'computer', () => w95().open('explorer', { path: 'My Computer' })),
        junk('WIN.COM', 'exe'),
      ]
    case 'C:\\WINDOWS\\SYSTEM':
      return [junk('KERNEL32.DLL'), junk('USER32.DLL'), junk('GDI32.DLL'), junk('PEARSIL.VXD'), junk('VMM32.VXD'), junk('CLIPPY.DLL')]
    case 'C:\\Program Files':
      return [
        prog('Pear Network', 'globe', () => w95().open('pnet')),
        prog('Clippy Setup.exe', 'exe', () => msgbox('It looks like you are trying to run an installer.\n\nWould you like help?', { icon: 'question', title: 'Assistant', buttons: [{ label: 'Yes' }, { label: 'No, but it will help anyway' }] })),
        prog('Plus! Setup.exe', 'exe', () => msgbox('Plus! needs 18 MB of free disk space. You have 7,999.9 MB, which is not enough for reasons we cannot explain.', { icon: 'warn', title: 'Plus! Setup' })),
      ]
    case 'C:\\My Documents':
      return [txt('homework.txt'), junk('Resume (final) (final2).doc', 'doc'), junk('Q3 earnings.xls', 'doc'), prog('Untitled.bmp', 'paint', () => w95().open('paint'))]
    case 'D:\\':
      return [
        folder('WIN95', 'D:\\WIN95'),
        prog('SETUP.EXE', 'exe', () => msgbox('Windows 95 is already installed. Reinstalling is the only thing that has ever fixed anything, so we understand.', { icon: 'info', title: 'Windows 95 Setup' })),
        txt('README.TXT'),
      ]
    case 'D:\\WIN95':
      return [junk('WIN95_02.CAB'), junk('WIN95_03.CAB'), junk('WIN95_04.CAB'), junk('PRECOPY1.CAB')]
    case 'Recycle Bin':
      return [txt('PearOS 2000 (cancelled).iso'), txt('your hopes.dat'), txt('unsaved doc 1.txt')]
    case 'Control Panel':
      return [
        { name: 'Display', icon: 'display', run: () => w95().open('display') },
        { name: 'System', icon: 'system', run: () => w95().open('system') },
        { name: 'Add New Hardware', icon: 'hardware', run: () => msgbox('Windows will now search for new Plug and Play devices.\n\nSearching…\n\nFound: Pear Silicon M-class Processor.\nStatus: Unknown. Driver: none. Mood: dismissive.', { icon: 'info', title: 'Add New Hardware Wizard' }) },
        { name: 'Sounds', icon: 'sound', run: CP_STUB('Sounds') },
        { name: 'Mouse', icon: 'mouse', run: CP_STUB('Mouse') },
        { name: 'Keyboard', icon: 'keyboard', run: CP_STUB('Keyboard') },
        { name: 'Fonts', icon: 'fonts', run: CP_STUB('Fonts') },
        { name: 'Printers', icon: 'printer', run: CP_STUB('Printers') },
      ]
    default:
      return []
  }
}

function parent(p: string): string | null {
  if (p === 'My Computer' || p === 'Recycle Bin') return null
  if (p === 'Control Panel' || p === 'C:\\' || p === 'D:\\') return 'My Computer'
  const up = p.slice(0, p.lastIndexOf('\\'))
  return up.endsWith(':') ? `${up}\\` : up
}

const labelOf = (p: string) => (p === 'C:\\' ? 'Pear HD (C:)' : p === 'D:\\' ? 'WIN95_OSR2 (D:)' : p.split('\\').pop() || p)

export function Explorer({ win }: { win: W95Win }) {
  const [path, setPath] = useState((win.props.path as string | undefined) ?? 'My Computer')
  const [sel, setSel] = useState<string | null>(null)
  const items = listing(path)
  const up = parent(path)

  useEffect(() => {
    useW95.getState().setTitle(win.id, labelOf(path))
  }, [path, win.id])

  const go = (p: string) => {
    setPath(p)
    setSel(null)
  }

  return (
    <div className="w95-col">
      <MenuBar95
        menus={[
          { label: 'File', items: [{ label: 'Close', run: () => w95().close(win.id) }] },
          { label: 'Edit', items: [{ label: 'Select All', disabled: true }] },
          { label: 'View', items: [{ label: 'Large Icons', checked: true }, { label: 'Small Icons', disabled: true }, { label: 'List', disabled: true }, { label: 'Details', disabled: true }] },
          { label: 'Help', items: [{ label: 'About Windows 95', run: () => w95().open('winver') }] },
        ]}
      />
      <div className="w95-toolbar">
        <button className="w95-btn small" disabled={!up} onClick={() => up && go(up)} title="Up One Level">
          ⬑ Up
        </button>
        <div className="w95-addr sunken">
          <Icon name={path === 'My Computer' ? 'computer' : path === 'Recycle Bin' ? 'recycle' : path === 'Control Panel' ? 'control' : 'folderOpen'} size={16} />
          <span>{path}</span>
        </div>
      </div>
      <div className="w95-list sunken" onPointerDown={() => setSel(null)}>
        {items.length === 0 && <p className="w95-empty">This folder is empty.</p>}
        {items.map((it) => (
          <button
            key={it.name}
            className={`w95-item ${sel === it.name ? 'sel' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              setSel(it.name)
            }}
            onDoubleClick={() => (it.to ? go(it.to) : it.run?.())}
          >
            <Icon name={it.icon} />
            <span>{it.name}</span>
          </button>
        ))}
      </div>
      <div className="w95-status">
        <span className="sunken">{items.length} object(s)</span>
        <span className="sunken">{path === 'My Computer' ? '7.81GB free' : path === 'Recycle Bin' ? '0 bytes (it is lying)' : ''}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ notepad */

export function Notepad({ win }: { win: W95Win }) {
  const [text, setText] = useState((win.props.text as string | undefined) ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  const stamp = () => {
    const d = new Date()
    const t = `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ${d.toLocaleDateString('en-US')}`
    setText((v) => v + t)
  }
  return (
    <div className="w95-col">
      <MenuBar95
        menus={[
          {
            label: 'File',
            items: [
              { label: 'New', run: () => setText('') },
              { label: 'Open…', disabled: true },
              { label: 'Save', run: () => msgbox('The disk is write-protected.\n\nRemove the write-protection or use another disk.', { icon: 'error', title: 'Notepad' }) },
              'sep',
              { label: 'Exit', run: () => w95().close(win.id) },
            ],
          },
          {
            label: 'Edit',
            items: [
              { label: 'Select All', run: () => ref.current?.select() },
              { label: 'Time/Date', keys: 'F5', run: stamp },
            ],
          },
          { label: 'Search', items: [{ label: 'Find…', run: () => msgbox('Cannot find "meaning".', { icon: 'info', title: 'Notepad' }) }] },
          { label: 'Help', items: [{ label: 'About Notepad', run: () => msgbox('Notepad\nVersion 4.00\nIt is a box that holds text.', { title: 'About Notepad' }) }] },
        ]}
      />
      <textarea
        ref={ref}
        className="w95-notepad sunken"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'F5') {
            e.preventDefault()
            stamp()
          }
        }}
        autoFocus
      />
    </div>
  )
}

/* ------------------------------------------------------------------ the pear network (dial-up) */

type Dial = 'form' | 'dialing' | 'failed'
const DIAL_STEPS = ['Dialing 1-800-PEARNET…', 'Waiting for a carrier tone (kshhhhhhhhh)…', 'Verifying user name and password…', 'Negotiating with the line…']

export function PearNet({ win }: { win: W95Win }) {
  void win
  const [stage, setStage] = useState<Dial>('form')
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (stage !== 'dialing') return
    if (step >= DIAL_STEPS.length) {
      const t = setTimeout(() => setStage('failed'), 500)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setStep((s) => s + 1), 1100)
    return () => clearTimeout(t)
  }, [stage, step])

  const dial = () => {
    setStep(0)
    setStage('dialing')
  }

  return (
    <div className="w95-col">
      <MenuBar95 menus={[{ label: 'File', items: [{ label: 'Close', run: () => w95().close(win.id) }] }, { label: 'Help', items: [{ label: 'About The Pear Network', run: () => msgbox('The Pear Network\nBrowse the web at 5.6 KB/s.', { title: 'About' }) }] }]} />
      <div className="w95-toolbar">
        <button className="w95-btn small" disabled>Back</button>
        <button className="w95-btn small" disabled>Forward</button>
        <button className="w95-btn small" onClick={dial}>Refresh</button>
        <div className="w95-addr sunken"><span>http://www.pear.com/</span></div>
      </div>
      <div className="w95-page sunken">
        {stage === 'form' && (
          <div className="w95-connect">
            <h3>Connect To</h3>
            <label>User name: <input defaultValue="pear" /></label>
            <label>Password: <input type="password" defaultValue="hunter2" /></label>
            <label>Phone number: <input defaultValue="1-800-PEARNET" /></label>
            <div className="w95-row">
              <button className="w95-btn def" onClick={dial}>Connect</button>
              <button className="w95-btn" onClick={() => w95().close(win.id)}>Cancel</button>
            </div>
          </div>
        )}
        {stage === 'dialing' && (
          <div className="w95-connect">
            <h3>Connecting…</h3>
            <p>{DIAL_STEPS[Math.min(step, DIAL_STEPS.length - 1)]}</p>
            <div className="w95-prog sunken"><i style={{ width: `${Math.min(100, (step / DIAL_STEPS.length) * 100)}%` }} /></div>
          </div>
        )}
        {stage === 'failed' && (
          <div className="w95-webpage">
            <h2>The page cannot be displayed</h2>
            <p>The page you are looking for is currently unavailable. The Web site might be experiencing technical difficulties.</p>
            <hr />
            <p><b>Please try the following:</b></p>
            <ul>
              <li>Click the <b>Refresh</b> button, or try again later.</li>
              <li>Check that nobody picked up the phone. Someone did. It was you, in 1997.</li>
              <li>Hang up and try again. The line is busy because your sister is on the line.</li>
            </ul>
            <p className="w95-blink">▲ UNDER CONSTRUCTION ▲</p>
            <p className="w95-dim">Error 404 (the 4 stands for 56k)</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ message boxes and dialogs */

export function MsgBox({ win }: { win: W95Win }) {
  const text = String(win.props.text ?? '')
  const icon = (win.props.icon as IconName) ?? 'info'
  const buttons = (win.props.buttons as { label: string; run?: () => void }[]) ?? [{ label: 'OK' }]
  useEffect(() => {
    if (icon === 'error' || icon === 'warn') errorSound()
    else dingSound()
  }, [icon])
  return (
    <div className="w95-msg">
      <div className="w95-msg-body">
        <Icon name={icon} />
        <p>{text}</p>
      </div>
      <div className="w95-row center">
        {buttons.map((b, i) => (
          <button
            key={b.label}
            className={`w95-btn ${i === 0 ? 'def' : ''}`}
            autoFocus={i === 0}
            onClick={() => {
              w95().close(win.id)
              b.run?.()
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const TIPS = [
  'To switch between windows, click a button on the taskbar. To switch between operating systems, restart and pray.',
  'You can right-click almost anything. Nothing will happen, but you can.',
  'Double-click a folder to open it. Triple-click a folder to open it faster. This is false.',
  'Windows 95 supports long filenames of up to 255 characters, so "Resume (final) (final2) (really final).doc" is fine.',
  'If a program stops responding, wait. If it keeps not responding, wait longer. This is the Windows way.',
  'The Recycle Bin holds deleted files until you empty it, or until the heat death of the universe, whichever is later.',
  'Press Ctrl+Alt+Delete to see what is running. It will not help, but it will feel productive.',
]

export function Welcome({ win }: { win: W95Win }) {
  const show = useBootCamp((s) => s.welcome)
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length))
  return (
    <div className="w95-welcome">
      <div className="w95-welcome-top">
        <div className="w95-welcome-head">
          <Icon name="flag" size={40} />
          <div>
            <b>Welcome to Windows 95</b>
            <span>Pear Silicon edition</span>
          </div>
        </div>
        <div className="w95-tip">
          <div className="w95-tip-title"><Icon name="bulb" size={24} /> Did you know…</div>
          <p>{TIPS[tip]}</p>
        </div>
        <div className="w95-welcome-btns">
          <button className="w95-btn" onClick={() => msgbox('What\'s New in Windows 95:\n\n- A Start button\n- Long filenames\n- A new way to crash', { title: "What's New" })}>What's New</button>
          <button className="w95-btn" onClick={() => msgbox('Online Registration requires a modem.\n\nYour modem is imaginary. Your registration is therefore imaginary, but successful.', { title: 'Online Registration' })}>Online Registration</button>
          <button className="w95-btn" onClick={() => msgbox('The Windows Tour is not installed. The tour guide quit.', { title: 'Windows Tour' })}>Windows Tour</button>
          <button className="w95-btn" onClick={() => setTip((t) => (t + 1) % TIPS.length)}>Next Tip</button>
          <button className="w95-btn def" onClick={() => w95().close(win.id)}>Close</button>
        </div>
      </div>
      <label className="w95-check">
        <input type="checkbox" checked={show} onChange={(e) => useBootCamp.getState().set({ welcome: e.target.checked })} />
        Show this Welcome Screen next time you start Windows
      </label>
    </div>
  )
}

export function Winver({ win }: { win: W95Win }) {
  return (
    <div className="w95-about">
      <div className="w95-about-banner">
        <Icon name="flag" size={48} />
        <span>Windows<b>95</b></span>
      </div>
      <p>Windows 95<br />Version 4.00.950 B (Pear Silicon edition)</p>
      <p>Copyright © 1981-1995 Redmond Corp.</p>
      <hr />
      <p>
        This product is licensed to:<br />
        <b>Pear User</b><br />
        Pear Computer, Inc.<br />
        <span className="w95-dim">Product ID: 111-1111111</span>
      </p>
      <hr />
      <p>
        Physical memory available to Windows: 8,192 KB<br />
        <span className="w95-dim">(it is like 16,384 KB)</span><br />
        System resources: 100% free<br />
        <span className="w95-dim">(this will not last)</span>
      </p>
      <div className="w95-row end"><button className="w95-btn def" onClick={() => w95().close(win.id)}>OK</button></div>
    </div>
  )
}

const DESKS: [string, string][] = [
  ['(None)', '#c0c0c0'],
  ['Teal', '#008080'],
  ['Pear Green', '#5b8c3a'],
  ['Navy', '#000080'],
  ['Maroon', '#800000'],
  ['Purple', '#800080'],
  ['Black', '#000000'],
  ['Hot Pink', '#ff69b4'],
]

export function DisplayProps({ win }: { win: W95Win }) {
  const cur = useW95((s) => s.desk)
  const [pick, setPick] = useState(cur)
  return (
    <div className="w95-props">
      <div className="w95-tabs"><span className="on">Background</span><span>Screen Saver</span><span>Appearance</span><span>Settings</span></div>
      <div className="w95-sheet">
        <div className="w95-monitor"><div style={{ background: pick }} /></div>
        <p>Desktop colour:</p>
        <div className="w95-listbox sunken">
          {DESKS.map(([name, c]) => (
            <button key={name} className={pick === c ? 'sel' : ''} onClick={() => setPick(c)}>
              <i style={{ background: c }} />
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="w95-row end">
        <button className="w95-btn def" onClick={() => { w95().set('desk', pick); w95().close(win.id) }}>OK</button>
        <button className="w95-btn" onClick={() => w95().close(win.id)}>Cancel</button>
        <button className="w95-btn" onClick={() => w95().set('desk', pick)}>Apply</button>
      </div>
    </div>
  )
}

export function SystemProps({ win }: { win: W95Win }) {
  const name = useW95((s) => s.computer)
  return (
    <div className="w95-props">
      <div className="w95-tabs"><span className="on">General</span><span>Device Manager</span><span>Hardware Profiles</span><span>Performance</span></div>
      <div className="w95-sheet">
        <div className="w95-sys">
          <Icon name="computer" size={48} />
          <div>
            <b>System:</b>
            <div>Windows 95</div>
            <div>4.00.950 B</div>
            <br />
            <b>Registered to:</b>
            <div>Pear User</div>
            <div>{name}</div>
            <br />
            <b>Computer:</b>
            <div>Pear Silicon M-class</div>
            <div className="w95-dim">(emulating a 486DX/2-66)</div>
            <div>8.0MB RAM</div>
          </div>
        </div>
        <p>Device Manager:</p>
        <div className="w95-listbox sunken static">
          <div><Icon name="computer" size={16} /> Computer</div>
          <div className="in"><Icon name="warn" size={16} /> Other devices</div>
          <div className="in2"><Icon name="warn" size={16} /> Pear Silicon M-class Processor</div>
          <div className="in2"><Icon name="warn" size={16} /> Pear Intelligence Neural Engine</div>
          <div className="in"><Icon name="display" size={16} /> Display adapters</div>
        </div>
      </div>
      <div className="w95-row end"><button className="w95-btn def" onClick={() => w95().close(win.id)}>OK</button><button className="w95-btn" onClick={() => w95().close(win.id)}>Cancel</button></div>
    </div>
  )
}

export function RunDialog({ win }: { win: W95Win }) {
  const [v, setV] = useState('')
  const go = () => {
    w95().close(win.id)
    runCommand(v)
  }
  return (
    <div className="w95-run">
      <div className="w95-run-top">
        <Icon name="run" size={32} />
        <p>Type the name of a program, folder, or document, and Windows will open it for you.</p>
      </div>
      <label>
        Open:
        <input className="w95-input sunken" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => {
          // Without this the Enter keypress lands on the dialog we are about to open and clicks its OK button.
          if (e.key === 'Enter') {
            e.preventDefault()
            go()
          }
        }}
        autoFocus
        spellCheck={false}
        />
      </label>
      <div className="w95-row end">
        <button className="w95-btn def" onClick={go}>OK</button>
        <button className="w95-btn" onClick={() => w95().close(win.id)}>Cancel</button>
        <button className="w95-btn" onClick={() => msgbox('Browse is not available. Everything is already in front of you.', { title: 'Browse' })}>Browse…</button>
      </div>
    </div>
  )
}

const POWER_CHOICES: { id: 'shutdown' | 'restart' | 'dos' | 'mac'; label: string }[] = [
  { id: 'shutdown', label: 'Shut down the computer?' },
  { id: 'restart', label: 'Restart the computer?' },
  { id: 'dos', label: 'Restart the computer in MS-DOS mode?' },
  { id: 'mac', label: 'Go back to Pear OS? (It misses you.)' },
]

export function ShutdownDialog({ win }: { win: W95Win }) {
  const [pick, setPick] = useState<(typeof POWER_CHOICES)[number]['id']>('shutdown')
  return (
    <div className="w95-shutdown">
      <div className="w95-shutdown-top">
        <Icon name="shutdown" size={40} />
        <div>
          <p>Are you sure you want to:</p>
          {POWER_CHOICES.map((c) => (
            <label key={c.id}>
              <input type="radio" name="power" checked={pick === c.id} onChange={() => setPick(c.id)} /> {c.label}
            </label>
          ))}
        </div>
      </div>
      <div className="w95-row center">
        <button
          className="w95-btn def"
          onClick={() => {
            w95().close(win.id)
            w95().requestPower(pick)
          }}
        >
          Yes
        </button>
        <button className="w95-btn" onClick={() => w95().close(win.id)}>No</button>
        <button className="w95-btn" onClick={() => msgbox('Help is not installed. Please shut down your computer to install Help.', { icon: 'info', title: 'Help' })}>Help</button>
      </div>
    </div>
  )
}

export function CloseProgram({ win }: { win: W95Win }) {
  const windows = useW95((s) => s.windows)
  const real = windows.filter((w) => !SPECS[w.app].dialog && w.id !== win.id)
  const rows = [
    ...real.map((w) => ({ id: w.id, label: w.title })),
    { id: 'explorer', label: 'Explorer' },
    { id: 'systray', label: 'Systray' },
    { id: 'pear', label: 'PEAR32 (not responding)' },
  ]
  const [sel, setSel] = useState<string>(rows[rows.length - 1].id)
  const endTask = () => {
    if (real.some((w) => w.id === sel)) return w95().close(sel)
    msgbox(sel === 'pear' ? 'This program is not responding, and neither are we.' : 'You cannot end this task. It is holding everything together.', { icon: 'warn', title: 'Close Program' })
  }
  return (
    <div className="w95-close">
      <p>
        <b>WARNING:</b> Pressing CTRL+ALT+DEL again will restart your computer. You will lose unsaved information in all programs that are running.
      </p>
      <div className="w95-listbox sunken">
        {rows.map((r) => (
          <button key={r.id} className={sel === r.id ? 'sel' : ''} onClick={() => setSel(r.id)}>{r.label}</button>
        ))}
      </div>
      <div className="w95-row end">
        <button className="w95-btn def" onClick={endTask}>End Task</button>
        <button className="w95-btn" onClick={() => { w95().close(win.id); w95().requestPower('shutdown') }}>Shut Down</button>
        <button className="w95-btn" onClick={() => w95().close(win.id)}>Cancel</button>
      </div>
    </div>
  )
}

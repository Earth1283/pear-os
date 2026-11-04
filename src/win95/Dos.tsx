import { useEffect, useRef, useState } from 'react'
import { w95, type W95Win } from './store'
import { TEXTS } from './apps'

const DIRS: Record<string, [string, string][]> = {
  'C:\\': [
    ['WINDOWS', '<DIR>'],
    ['PROGRA~1', '<DIR>'],
    ['MYDOCU~1', '<DIR>'],
    ['COMMAND.COM', '93,890'],
    ['AUTOEXEC.BAT', '188'],
    ['CONFIG.SYS', '112'],
    ['README.TXT', '421'],
  ],
  'C:\\WINDOWS': [
    ['SYSTEM', '<DIR>'],
    ['COMMAND', '<DIR>'],
    ['WIN.COM', '22,583'],
    ['NOTEPAD.EXE', '53,248'],
    ['WINMINE.EXE', '23,552'],
    ['PEARSIL.VXD', '1,337'],
  ],
  'C:\\WINDOWS\\SYSTEM': [['KERNEL32.DLL', '445,952'], ['USER32.DLL', '372,224'], ['CLIPPY.DLL', '9,001']],
  'C:\\WINDOWS\\COMMAND': [['FORMAT.COM', '49,031'], ['SCANDISK.EXE', '124,222'], ['EDIT.COM', '69,886']],
  'C:\\PROGRA~1': [['PEARNET', '<DIR>']],
  'C:\\MYDOCU~1': [['HOMEWORK.TXT', '73']],
}

const HELP = `For more information on a specific command, type HELP command-name.
CD       Displays the name of or changes the current directory.
CLS      Clears the screen.
DATE     Displays the date.
DIR      Displays a list of files and subdirectories.
ECHO     Displays messages.
EXIT     Quits the COMMAND.COM program.
FORMAT   Formats a disk for use with Windows. (Do not.)
MEM      Displays the amount of used and free memory.
PEAR     Starts Pear OS. It will not be mad.
TYPE     Displays the contents of a text file.
VER      Displays the Windows version.
WIN      Starts Windows.`

const BANNER = ['Windows 95. [Version 4.00.950]', '(C)Copyright Redmond Corp 1981-1995.', '']

export function DosTerm({ full, onWin, onPear, onExit }: { full?: boolean; onWin?: () => void; onPear: () => void; onExit?: () => void }) {
  const [lines, setLines] = useState<string[]>(full ? ['Starting MS-DOS...', '', ...BANNER] : BANNER)
  const [cwd, setCwd] = useState('C:\\')
  const [input, setInput] = useState('')
  const [confirm, setConfirm] = useState<'format' | null>(null)
  const [busy, setBusy] = useState(false)
  const hist = useRef<string[]>([])
  const hi = useRef(-1)
  const screen = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    screen.current?.scrollTo(0, screen.current.scrollHeight)
  }, [lines, input])
  useEffect(() => {
    field.current?.focus()
  }, [])

  const print = (...l: string[]) => setLines((x) => [...x, ...l])

  const exec = (raw: string) => {
    const [cmd, ...rest] = raw.trim().split(/\s+/)
    const arg = rest.join(' ')
    switch (cmd.toLowerCase()) {
      case '':
        return
      case 'help':
      case '?':
        return print(...HELP.split('\n'), '')
      case 'ver':
        return print('', 'Windows 95. [Version 4.00.950]', '')
      case 'cls':
        return setLines([])
      case 'echo':
        return print(arg || 'ECHO is on', '')
      case 'date':
        return print(`Current date is ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: '2-digit', day: '2-digit', year: 'numeric' }).replace(',', '')}`, '')
      case 'time':
        return print(`Current time is ${new Date().toLocaleTimeString('en-US')}`, '')
      case 'vol':
        return print(' Volume in drive C is PEAR_HD', ' Volume Serial Number is 1337-C0DE', '')
      case 'mem':
        return print('', 'Memory Type        Total      Used      Free', '----------------  -------   -------   -------', 'Conventional         640K      52K      588K', 'Extended (XMS)     7,552K   7,551K        1K', '', 'Total memory       8,192K   (it is like 16,384K)', '')
      case 'dir': {
        const rows = DIRS[cwd] ?? []
        return print(
          ' Volume in drive C is PEAR_HD',
          ' Volume Serial Number is 1337-C0DE',
          ` Directory of ${cwd}`,
          '',
          ...rows.map(([n, s]) => `${n.padEnd(14)}${s.padStart(10)}  11-04-26  2:00p`),
          `        ${rows.length} file(s)`,
          '   8,388,608,000 bytes free',
          '',
        )
      }
      case 'cd':
      case 'cd..':
      case 'chdir': {
        const target = cmd.toLowerCase() === 'cd..' ? '..' : arg
        if (!target) return print(cwd, '')
        if (target === '\\') return setCwd('C:\\')
        if (target === '..') return setCwd(cwd === 'C:\\' ? cwd : cwd.slice(0, cwd.lastIndexOf('\\')) || 'C:\\')
        const next = cwd === 'C:\\' ? `C:\\${target.toUpperCase()}` : `${cwd}\\${target.toUpperCase()}`
        return DIRS[next] ? setCwd(next) : print('Invalid directory', '')
      }
      case 'type': {
        const k = Object.keys(TEXTS).find((t) => t.toLowerCase() === arg.toLowerCase())
        return k ? print(...TEXTS[k].split('\n')) : print('File not found - ' + arg.toUpperCase(), '')
      }
      case 'format':
        if (!/^c:?$/i.test(arg)) return print('Required parameter missing', '')
        setConfirm('format')
        return print('', 'WARNING, ALL DATA ON NON-REMOVABLE DISK', 'DRIVE C: WILL BE LOST!', 'Proceed with Format (Y/N)?')
      case 'win':
        if (full) return onWin?.()
        return print('You are already running Windows.', 'This program cannot be run in Windows.', '')
      case 'pear':
      case 'macos':
        print('Loading Pear OS...')
        return setTimeout(onPear, 700)
      case 'exit':
        if (full) return print('Cannot exit. You are the operating system now. Type WIN to start Windows.', '')
        return onExit?.()
      case 'deltree':
        return print('Deleting C:\\WINDOWS... just kidding. Your files are safe. They are also not yours.', '')
      case 'scandisk':
        return print('Microsoft ScanDisk has found no problems. It also found no solutions.', '')
      case 'edit':
        return print('EDIT.COM was removed from this edition to save space for CLIPPY.DLL.', '')
      case 'ping':
        return print('Bad command or file name', '(there is no network in 1995. only the pear network.)', '')
      default:
        return print('Bad command or file name', '')
    }
  }

  const submit = () => {
    const raw = input
    setInput('')
    hist.current.unshift(raw)
    hi.current = -1
    print(`${cwd}>${raw}`)
    if (confirm) {
      setConfirm(null)
      if (/^y/i.test(raw.trim())) {
        setBusy(true)
        const steps = ['', 'Formatting 7,999.9M', '10 percent completed.', '40 percent completed.', '87 percent completed.', 'Format complete.', '', 'Just kidding. The disk is a browser tab.', '']
        steps.forEach((l, i) => setTimeout(() => {
          print(l)
          if (i === steps.length - 1) setBusy(false)
        }, 350 * (i + 1)))
      } else print('')
      return
    }
    exec(raw)
  }

  return (
    <div className={`w95-dos ${full ? 'full' : ''}`} ref={screen} onPointerDown={() => field.current?.focus()}>
      {lines.map((l, i) => (
        <div key={i}>{l || '\u00a0'}</div>
      ))}
      {!busy && (
        <div className="w95-dos-line">
          <span>{confirm ? '' : `${cwd}>`}</span>
          <input
            ref={field}
            value={input}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'ArrowUp') {
                e.preventDefault()
                hi.current = Math.min(hist.current.length - 1, hi.current + 1)
                setInput(hist.current[hi.current] ?? '')
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                hi.current = Math.max(-1, hi.current - 1)
                setInput(hist.current[hi.current] ?? '')
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

export function Dos({ win }: { win: W95Win }) {
  return <DosTerm onPear={() => w95().requestPower('mac')} onExit={() => w95().close(win.id)} />
}

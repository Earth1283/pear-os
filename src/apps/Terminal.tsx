import { useEffect, useRef, useState } from 'react'
import { os, useOS, type Win } from '../store'
import { HOME, listDir, mkdir, normalise, resolve, writeFile, moveToTrash, formatBytes, sizeOf } from '../lib/fs'
import { calc, formatNumber, kernelVersion } from '../kernel'
import { APPS } from './registry'
import type { AppId } from './ids'
import { menu } from '../lib/menu'
import { gpuInfo } from '../lib/gpu'

type Line = { text: string; cls?: string }

const PEAR_ART = [
  '                    .:\'',
  '                 __ :\'__',
  "              .'`  `-'  ``.",
  '             :            :',
  '            :              :',
  '           :                :',
  '           :                :',
  '            :              :',
  '             `.__.--.__.\'',
]

const COMMANDS = ['help', 'ls', 'cd', 'pwd', 'cat', 'echo', 'clear', 'whoami', 'uname', 'calc', 'pearfetch', 'neofetch', 'open', 'say', 'date', 'uptime', 'top', 'brew', 'sudo', 'mkdir', 'touch', 'rm', 'history', 'exit', 'pearsay', 'df', 'sw_vers', 'git', 'npm', 'vim', 'emacs', 'python3', 'ping']

function shortPath(p: string) {
  if (p === HOME) return '~'
  if (p.startsWith(HOME + '/')) return '~' + p.slice(HOME.length)
  return p
}

function pearsay(msg: string) {
  const w = Math.min(40, Math.max(msg.length, 4))
  const lines = msg.match(new RegExp(`.{1,${w}}(\\s|$)|\\S+?(\\s|$)`, 'g'))?.map((s) => s.trim()) ?? [msg]
  const out = [' ' + '_'.repeat(w + 2)]
  lines.forEach((l, i) => {
    const [a, b] = lines.length === 1 ? ['<', '>'] : i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|']
    out.push(`${a} ${l.padEnd(w)} ${b}`)
  })
  out.push(' ' + '-'.repeat(w + 2), '        \\   ,', "         \\ (:)", '          /   \\', '         (     )', "          `---'")
  return out.join('\n')
}

export function Terminal({ win }: { win: Win }) {
  const [cwd, setCwd] = useState(HOME)
  const [lines, setLines] = useState<Line[]>(() => [{ text: `Last login: ${new Date(Date.now() - 3_600_000).toString().slice(0, 24)} on ttys000`, cls: 'dim' }])
  const [input, setInput] = useState('')
  const [hist, setHist] = useState<string[]>([])
  const [hIdx, setHIdx] = useState(-1)
  const [sudo, setSudo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const setTitle = useOS((s) => s.setTitle)
  const prompt = `pear@PearBook-Pro ${shortPath(cwd).split('/').pop() || '/'} %`

  useEffect(() => {
    setTitle(win.id, `pear — -zsh — 80×24`)
  }, [])
  useEffect(() => {
    scroll.current?.scrollTo(0, scroll.current.scrollHeight)
  }, [lines])

  const print = (...ls: (string | Line)[]) => setLines((prev) => [...prev, ...ls.map((l) => (typeof l === 'string' ? { text: l } : l))])

  const run = async (raw: string, asRoot = false) => {
    const [cmd, ...args] = raw.trim().split(/\s+/)
    const rest = raw.trim().slice(cmd.length).trim()
    switch (cmd) {
      case '':
        return
      case 'help':
        return print('PearOS zsh, version 5.9 (wasm32-pear-sequel)', 'Commands: ' + COMMANDS.join(', '), { text: 'Tip: try `calc 2^64`, `pearfetch`, `open notes`, or `sudo rm -rf /` (please don\'t).', cls: 'dim' })
      case 'clear':
        return setLines([])
      case 'pwd':
        return print(cwd)
      case 'whoami':
        return print(asRoot ? 'root' : 'pear')
      case 'echo':
        return print(rest.replace(/^["']|["']$/g, '').replace(/\$HOME/g, HOME).replace(/\$USER/g, 'pear'))
      case 'date':
        return print(new Date().toString())
      case 'uname':
        return print(args.includes('-a') ? `Pearwin PearBook-Pro.local 24.1.0 ${kernelVersion()}` : 'Pearwin')
      case 'sw_vers':
        return print('ProductName:\t\tPearOS', 'ProductVersion:\t\t15.1', 'ProductNickname:\tSequel', 'BuildVersion:\t\t24B83')
      case 'uptime':
        return print(`${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}  up 412 days, 3 users, load averages: 9.41 8.88 9.12`)
      case 'history':
        return print(...hist.map((h, i) => `  ${String(i + 1).padStart(3)}  ${h}`))
      case 'ls': {
        const flags = args.filter((a) => a.startsWith('-')).join('')
        const target = args.find((a) => !a.startsWith('-')) ?? '.'
        const node = resolve(target, cwd)
        if (!node) return print({ text: `ls: ${target}: No such file or directory`, cls: 'err' })
        if (node.type === 'file') return print(target)
        const entries = listDir(node, flags.includes('a'))
        if (flags.includes('l'))
          return print(
            `total ${entries.length * 8}`,
            ...entries.map(([n, c]) => `${c.type === 'dir' ? 'd' : '-'}rw-r--r--  1 pear  staff  ${formatBytes(sizeOf(c)).padStart(9)}  ${new Date(c.modified).toDateString().slice(4, 10)}  ${c.type === 'dir' ? `\u001b${n}` : n}`),
          )
        return print({ text: entries.map(([n, c]) => (c.type === 'dir' ? `\u001b${n}` : n)).join('    ') || '' })
      }
      case 'cd': {
        const target = normalise(args[0] ?? '~', cwd)
        const node = resolve(target)
        if (!node) return print({ text: `cd: no such file or directory: ${args[0]}`, cls: 'err' })
        if (node.type !== 'dir') return print({ text: `cd: not a directory: ${args[0]}`, cls: 'err' })
        return setCwd(target)
      }
      case 'cat': {
        if (!args[0]) return print({ text: 'cat: reading from stdin is not supported. Neither is stdin.', cls: 'err' })
        const node = resolve(args[0], cwd)
        if (!node) return print({ text: `cat: ${args[0]}: No such file or directory`, cls: 'err' })
        if (node.type === 'dir') return print({ text: `cat: ${args[0]}: Is a directory`, cls: 'err' })
        if (node.kind !== 'text') return print({ text: '\u0000\u0007PK\u0003\u0004 ������ binary goo ������', cls: 'dim' })
        return print(...(node.content ?? '').replace(/\n$/, '').split('\n'))
      }
      case 'mkdir':
        if (!args[0]) return print({ text: 'usage: mkdir directory ...', cls: 'err' })
        if (!mkdir(args[0], cwd)) return print({ text: `mkdir: ${args[0]}: File exists (or doesn't, hard to say)`, cls: 'err' })
        return os().bumpFs()
      case 'touch':
        if (!args[0]) return print({ text: 'usage: touch file ...', cls: 'err' })
        if (!resolve(args[0], cwd)) writeFile(args[0], '', cwd)
        return os().bumpFs()
      case 'rm': {
        const recursive = args.some((a) => /^-\w*r/.test(a))
        const targets = args.filter((a) => !a.startsWith('-'))
        if (recursive && targets.some((t) => normalise(t, cwd) === '/')) {
          if (!asRoot) return print({ text: 'rm: /: Operation not permitted', cls: 'err' }, { text: 'hint: real ones use sudo', cls: 'dim' })
          print('rm: removing /System…', 'rm: removing /Users/pear/Documents/taxes.txt…', 'rm: removing your will to live…')
          setBusy(true)
          setTimeout(() => os().panic('sudo rm -rf / (you asked for this)'), 1400)
          return
        }
        for (const t of targets) {
          const node = resolve(t, cwd)
          if (!node) print({ text: `rm: ${t}: No such file or directory`, cls: 'err' })
          else if (node.type === 'dir' && !recursive) print({ text: `rm: ${t}: is a directory`, cls: 'err' })
          else moveToTrash(normalise(t, cwd))
        }
        return os().bumpFs()
      }
      case 'calc':
      case 'expr':
      case 'bc': {
        if (!rest) return print({ text: 'usage: calc <expression>   (evaluated by pearnel.wasm)', cls: 'dim' })
        const v = calc(rest)
        return v === null ? print({ text: `calc: parse error in "${rest}"`, cls: 'err' }) : print(formatNumber(v))
      }
      case 'pearfetch':
      case 'neofetch': {
        const info = [
          ['', 'pear@PearBook-Pro'],
          ['', '-----------------'],
          ['OS', 'PearOS Sequel 15.1 wasm32'],
          ['Host', 'PearBook Pro (16-inch, 2025)'],
          ['Kernel', 'pearnel.wasm 24.1.0'],
          ['Uptime', '412 days, 3 hours'],
          ['Packages', '1,204 (brew), all outdated'],
          ['Shell', 'zsh 5.9'],
          ['Resolution', `${window.innerWidth}x${window.innerHeight}`],
          ['DE', 'Aqua-ish'],
          ['WM', 'React 19'],
          ['Terminal', 'Terminal.tsx'],
          ['CPU', 'Pear P4 Max (2) @ 1.00 GHz'],
          ['GPU', `${gpuInfo().renderer} (WebGL2, borrowed)`],
          ['Memory', '7,998 MiB / 8,192 MiB (like 16,384 MiB)'],
        ]
        const rows = Math.max(PEAR_ART.length, info.length)
        const out: Line[] = []
        for (let i = 0; i < rows; i++) {
          const [k, v] = info[i] ?? ['', '']
          out.push({ text: `${(PEAR_ART[i] ?? '').padEnd(32)}${k ? `\u0002${k}\u0003: ${v}` : v}` })
        }
        return print(...out)
      }
      case 'open': {
        const name = rest.replace(/^-a\s+/, '').replace(/\.app$/, '').toLowerCase()
        if (!name) return print({ text: 'usage: open <app>', cls: 'err' })
        if (name === '.' || resolve(name, cwd)?.type === 'dir') return os().openApp('finder', { props: { path: normalise(name, cwd) }, forceNew: true })
        const id = (Object.keys(APPS) as AppId[]).find((k) => k === name || APPS[k].name.toLowerCase() === name || APPS[k].name.toLowerCase().startsWith(name))
        if (!id) return print({ text: `The application "${rest}" could not be found. It may be on your other Pear.`, cls: 'err' })
        return os().openApp(id)
      }
      case 'say':
        if ('speechSynthesis' in window) {
          const u = new SpeechSynthesisUtterance(rest || 'Hello. I am a pear.')
          u.volume = os().volume
          speechSynthesis.speak(u)
        }
        return
      case 'pearsay':
      case 'cowsay':
        return print(...pearsay(rest || 'moo? no. pear.').split('\n'))
      case 'top':
      case 'htop':
        os().openApp('activity')
        return print({ text: 'Opening Activity Monitor, the top of the line top.', cls: 'dim' })
      case 'df':
        return print('Filesystem     Size   Used  Avail Capacity  Mounted on', '/dev/disk3s1   8.0G   7.9G   0.1G    99%    /', '/dev/wasm0     64K    64K     0B   100%    /System/Library/Kernels')
      case 'brew': {
        setBusy(true)
        print('==> Auto-updating Homebrew...', '==> Updated 41,203 formulae.')
        await new Promise((r) => setTimeout(r, 900))
        print('==> Upgrading 214 outdated packages, because you typed "brew".')
        await new Promise((r) => setTimeout(r, 900))
        print({ text: `Error: ${args[1] ?? 'everything'} is already installed. Also uninstalled. Run \`brew doctor\`; it will tell you to see a doctor.`, cls: 'err' })
        setBusy(false)
        return
      }
      case 'git':
        if (args[0] === 'status') return print('On branch main', 'Your branch is ahead of reality by 3 commits.')
        return print({ text: 'fatal: not a git repository (or any of the parent directories). Not even this one.', cls: 'err' })
      case 'npm':
        return print('added 1,847 packages, and audited 1,848 packages in 3m', '', { text: '214 vulnerabilities (12 low, 200 moderate, 2 "it\'s fine")', cls: 'err' })
      case 'vim':
      case 'vi':
        return print({ text: "You're now trapped in vim. Type :q! to... just kidding, nothing happened. You're free.", cls: 'dim' })
      case 'emacs':
        return print({ text: 'emacs: please install an operating system first', cls: 'err' })
      case 'python':
      case 'python3':
        return print({ text: 'xcode-select: note: No developer tools were found, requesting install. (Download size: 40 GB)', cls: 'err' })
      case 'ping':
        return print(`PING ${args[0] ?? 'pear.com'}: 56 data bytes`, 'Request timeout for icmp_seq 0', { text: 'Wi-Fi says it has 5 bars. Wi-Fi is lying.', cls: 'dim' })
      case 'exit':
      case 'logout':
        print('[Process completed]')
        return setTimeout(() => os().closeWindow(win.id), 300)
      case 'sudo':
        if (!rest) return print({ text: 'usage: sudo command', cls: 'err' })
        if (asRoot) return run(rest, true)
        setSudo(rest)
        return
      default:
        if (/^[\d\s+\-*/^().%!]+$/.test(raw.trim())) {
          const v = calc(raw)
          if (v !== null) return print(formatNumber(v))
        }
        return print({ text: `zsh: command not found: ${cmd}`, cls: 'err' })
    }
  }

  const submit = async () => {
    const value = input
    setInput('')
    if (sudo !== null) {
      const cmd = sudo
      setSudo(null)
      print({ text: 'Password:' })
      if (!value) {
        print({ text: 'Sorry, try again.', cls: 'err' }, { text: 'pear is not in the sudoers file. This incident will be reported. (To whom? Pear Intelligence.)', cls: 'dim' })
        return
      }
      await run(cmd, true)
      return
    }
    print({ text: `${prompt} ${value}`, cls: 'cmd' })
    if (value.trim()) setHist((h) => [...h, value])
    setHIdx(-1)
    await run(value)
  }

  const render = (t: string) => {
    if (!t.includes('\u001b') && !t.includes('\u0002')) return t
    const parts = t.split(/(\u001b[^\s]+|\u0002[^\u0003]*\u0003)/g)
    return parts.map((p, i) =>
      p.startsWith('\u001b') ? (
        <span key={i} className="t-dir">
          {p.slice(1)}
        </span>
      ) : p.startsWith('\u0002') ? (
        <span key={i} className="t-key">
          {p.slice(1, -1)}
        </span>
      ) : (
        p
      ),
    )
  }

  return (
    <div
      className="terminal"
      onClick={() => window.getSelection()?.isCollapsed && inputRef.current?.focus()}
      onContextMenu={menu(() => [
        { label: 'Copy', shortcut: '⌘C', disabled: true },
        {
          label: 'Paste',
          shortcut: '⌘V',
          run: () =>
            navigator.clipboard
              ?.readText()
              .then((t) => setInput((i) => i + t.replace(/\n/g, ' ')))
              .catch(() => print({ text: 'pbpaste: clipboard access denied by the browser. Classic.', cls: 'err' })),
        },
        {
          label: 'Select All',
          shortcut: '⌘A',
          run: () => {
            const r = document.createRange()
            r.selectNodeContents(scroll.current!)
            window.getSelection()?.removeAllRanges()
            window.getSelection()?.addRange(r)
          },
        },
        'sep',
        { label: 'Clear to Start', shortcut: '⌘L', run: () => setLines([]) },
        { label: 'Clear Scrollback', shortcut: '⌥⌘K', run: () => setLines([]) },
        {
          label: 'Hard Reset',
          run: () => {
            setLines([])
            setCwd(HOME)
            setSudo(null)
          },
        },
        'sep',
        { label: 'New Window', shortcut: '⌘N', run: () => os().openApp('terminal', { forceNew: true }) },
        { label: 'Split Pane', shortcut: '⌘D', disabled: true },
        'sep',
        { label: 'Open man Page', disabled: true },
        { label: 'Show Inspector', shortcut: '⌘I', run: () => print({ text: `tty: ttys000 · shell: zsh · cwd: ${cwd} · kernel: pearnel.wasm`, cls: 'dim' }) },
      ])}
      ref={scroll}
    >
      {lines.map((l, i) => (
        <div key={i} className={`t-line ${l.cls ?? ''}`}>
          {render(l.text)}
        </div>
      ))}
      {!busy && (
        <div className="t-input">
          <span className="t-prompt">{sudo !== null ? 'Password:' : prompt}</span>
          <input
            ref={inputRef}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            type={sudo !== null ? 'password' : 'text'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'ArrowUp') {
                e.preventDefault()
                const i = hIdx === -1 ? hist.length - 1 : Math.max(0, hIdx - 1)
                if (hist[i] !== undefined) {
                  setHIdx(i)
                  setInput(hist[i])
                }
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                const i = hIdx + 1
                if (hIdx === -1 || i >= hist.length) {
                  setHIdx(-1)
                  setInput('')
                } else {
                  setHIdx(i)
                  setInput(hist[i])
                }
              } else if (e.key === 'Tab') {
                e.preventDefault()
                const parts = input.split(' ')
                const last = parts[parts.length - 1]
                if (parts.length === 1) {
                  const m = COMMANDS.filter((c) => c.startsWith(last))
                  if (m.length === 1) setInput(m[0] + ' ')
                } else {
                  const base = last.includes('/') ? last.slice(0, last.lastIndexOf('/') + 1) : ''
                  const dir = resolve(base || '.', cwd)
                  if (dir?.type === 'dir') {
                    const m = Object.keys(dir.children).filter((n) => n.startsWith(last.slice(base.length)))
                    if (m.length === 1) {
                      parts[parts.length - 1] = base + m[0] + (dir.children[m[0]].type === 'dir' ? '/' : '')
                      setInput(parts.join(' '))
                    }
                  }
                }
              } else if (e.key === 'l' && e.ctrlKey) {
                e.preventDefault()
                setLines([])
              } else if (e.key === 'c' && e.ctrlKey) {
                print({ text: `${prompt} ${input}^C`, cls: 'cmd' })
                setInput('')
                setSudo(null)
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

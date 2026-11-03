import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { os, useOS, type Win } from '../store'
import { ptyUrl, useBackend } from '../lib/backend'
import { menu } from '../lib/menu'

const LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#1d1d1f',
  cursor: '#1d1d1f',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(10,132,255,0.28)',
  black: '#000000',
  red: '#c91b00',
  green: '#00a600',
  yellow: '#a68b00',
  blue: '#0225c7',
  magenta: '#c930c7',
  cyan: '#00a6b2',
  white: '#c7c7c7',
  brightBlack: '#686868',
  brightRed: '#ff6e67',
  brightGreen: '#3db400',
  brightYellow: '#b39b00',
  brightBlue: '#6871ff',
  brightMagenta: '#ff77ff',
  brightCyan: '#4fb8c3',
  brightWhite: '#ffffff',
}

const DARK: ITheme = {
  ...LIGHT,
  background: '#1e1e1e',
  foreground: '#e8e8e8',
  cursor: '#e8e8e8',
  cursorAccent: '#1e1e1e',
  selectionBackground: 'rgba(10,132,255,0.4)',
  black: '#1e1e1e',
  blue: '#5c7cfa',
  brightYellow: '#fffc67',
  yellow: '#c7c400',
  white: '#e5e5e5',
}

export function RealTerminal({ win }: { win: Win }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm | null>(null)
  const theme = useOS((s) => s.theme)
  const hostname = useBackend((s) => s.sys?.hostname)
  const user = useBackend((s) => s.sys?.user)
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    os().setTitle(win.id, `${user || 'shell'} — ${hostname ?? 'pearosd'} — ${state === 'closed' ? 'exited' : 'zsh'}`)
  }, [hostname, user, state])

  useEffect(() => {
    const el = host.current!
    const t = new XTerm({
      fontFamily: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: false,
      macOptionIsMeta: true,
      scrollback: 5000,
      theme: useOS.getState().theme === 'dark' ? DARK : LIGHT,
    })
    const fit = new FitAddon()
    t.loadAddon(fit)
    t.open(el)
    term.current = t
    try {
      fit.fit()
    } catch {
      t.resize(80, 24)
    }

    const ws = new WebSocket(ptyUrl(t.cols, t.rows))
    ws.binaryType = 'arraybuffer'
    const enc = new TextEncoder()
    ws.onopen = () => {
      setState('open')
      t.focus()
    }
    ws.onmessage = (e) => t.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data))
    ws.onclose = () => {
      setState('closed')
      t.write('\r\n\x1b[2m[Process completed]\x1b[0m\r\n')
    }
    const input = t.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(enc.encode(d)))
    const binary = t.onBinary((d) => ws.readyState === WebSocket.OPEN && ws.send(Uint8Array.from(d, (c) => c.charCodeAt(0))))
    const resize = t.onResize(({ cols, rows }) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'resize', cols, rows })))
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        return
      }
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      input.dispose()
      binary.dispose()
      resize.dispose()
      ws.close()
      t.dispose()
      term.current = null
    }
  }, [attempt])

  useEffect(() => {
    if (term.current) term.current.options.theme = theme === 'dark' ? DARK : LIGHT
  }, [theme])

  return (
    <div
      className="real-terminal"
      onPointerDown={() => term.current?.focus()}
      onContextMenu={menu(() => [
        { label: 'Copy', shortcut: '⌘C', disabled: !term.current?.hasSelection(), run: () => navigator.clipboard?.writeText(term.current?.getSelection() ?? '') },
        {
          label: 'Paste',
          shortcut: '⌘V',
          run: () =>
            navigator.clipboard
              ?.readText()
              .then((txt) => term.current?.paste(txt))
              .catch(() => os().notify({ app: 'terminal', title: 'Terminal', body: 'The browser refused clipboard access. Use your keyboard shortcut instead.' })),
        },
        { label: 'Select All', shortcut: '⌘A', run: () => term.current?.selectAll() },
        'sep',
        { label: 'Clear Scrollback', shortcut: '⌘K', run: () => term.current?.clear() },
        { label: 'Reconnect', disabled: state === 'open', run: () => setAttempt((a) => a + 1) },
        'sep',
        { label: 'New Window', shortcut: '⌘N', run: () => os().openApp('terminal', { forceNew: true }) },
        { label: 'New Parody Window', run: () => os().openApp('terminal', { forceNew: true, props: { fake: true } }) },
      ])}
    >
      <div ref={host} className="xterm-host" />
      {state === 'closed' && (
        <button className="btn small reconnect" onClick={() => setAttempt((a) => a + 1)}>
          Reconnect
        </button>
      )}
    </div>
  )
}

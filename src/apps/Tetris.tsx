import { useEffect, useReducer, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { os, useOS, type Win } from '../store'
import { COLS, HIDDEN, ROT, ROWS, VISIBLE, FLASH_MS, Tetris, type Ev, type Kind } from '../lib/tetris'
import { LEARN_SPEEDS, TetrisAgent, WATCH_SPEEDS, type Stats } from '../lib/tetrisAI'
import type { MenuDef } from './types'

const COLORS: Record<Kind, string> = {
  I: '#00f0f0',
  O: '#f8e000',
  T: '#b048f0',
  S: '#20d040',
  Z: '#f03030',
  J: '#3060f0',
  L: '#ffa500',
}
const OUTLINE = '#1c1c1c'

const DAS = 150
const ARR = 38
const LEVELS = Array.from({ length: 10 }, (_, i) => i + 1)
const SIDE = 164
const RESTART_GUARD = 700

interface Prefs {
  best: number
  level: number
  ghost: boolean
  grid: boolean
  sound: boolean
}
const KEY = 'pearos.tetris.v1'

function loadPrefs(): Prefs {
  const d: Prefs = { best: 0, level: 1, ghost: true, grid: true, sound: true }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    if (Number.isFinite(raw.best) && raw.best! > 0) d.best = Math.floor(raw.best!)
    if (Number.isInteger(raw.level) && raw.level! >= 1 && raw.level! <= LEVELS.length) d.level = raw.level!
    if (typeof raw.ghost === 'boolean') d.ghost = raw.ghost
    if (typeof raw.grid === 'boolean') d.grid = raw.grid
    if (typeof raw.sound === 'boolean') d.sound = raw.sound
  } catch {
  }
  return d
}

let ac: AudioContext | undefined
function tone(freq: number, dur = 0.06, type: OscillatorType = 'square', vol = 0.05, to?: number, delay = 0) {
  const v = os().volume
  if (!v) return
  try {
    ac ??= new AudioContext()
    if (ac.state === 'suspended') void ac.resume()
    const t = ac.currentTime + delay
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
    g.gain.setValueAtTime(vol * v, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(ac.destination)
    o.start(t)
    o.stop(t + dur + 0.03)
  } catch {
  }
}

const NOTES = [523, 659, 784, 1047, 1319]
function sfx(e: Ev, n = 0) {
  if (e === 'move') tone(300, 0.025, 'square', 0.025)
  else if (e === 'rotate') tone(520, 0.04, 'square', 0.035, 700)
  else if (e === 'hold') tone(400, 0.09, 'sine', 0.07, 640)
  else if (e === 'drop') tone(220, 0.1, 'sawtooth', 0.05, 60)
  else if (e === 'lock') tone(120, 0.08, 'triangle', 0.12, 70)
  else if (e === 'clear' || e === 'tetris') for (let i = 0; i <= n; i++) tone(NOTES[i], 0.12, e === 'tetris' ? 'sawtooth' : 'square', 0.045, undefined, i * 0.06)
  else if (e === 'level') [0, 2, 4].forEach((k, i) => tone(NOTES[k] * 1.5, 0.1, 'triangle', 0.06, undefined, i * 0.07))
  else if (e === 'over') tone(330, 0.7, 'sawtooth', 0.07, 55)
}

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, alpha = 1) {
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.fillRect(x, y, s, s)
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1)
  ctx.globalAlpha = 1
}

function drawBoard(ctx: CanvasRenderingContext2D, g: Tetris, s: number, grid: boolean, ghost: boolean) {
  const W = COLS * s
  const H = VISIBLE * s
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  if (grid) {
    ctx.strokeStyle = 'rgba(0,0,0,.06)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < COLS; i++) {
      ctx.moveTo(i * s + 0.5, 0)
      ctx.lineTo(i * s + 0.5, H)
    }
    for (let i = 1; i < VISIBLE; i++) {
      ctx.moveTo(0, i * s + 0.5)
      ctx.lineTo(W, i * s + 0.5)
    }
    ctx.stroke()
  }
  for (let r = HIDDEN; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const k = g.board[r][c]
      if (k) drawCell(ctx, c * s, (r - HIDDEN) * s, s, COLORS[k], g.status === 'over' ? 0.5 : 1)
    }
  const p = g.cur
  if (p && (g.status === 'playing' || g.status === 'paused')) {
    if (ghost) {
      const gy = g.ghostY()
      if (gy !== p.y)
        for (const [x, y] of g.cells({ ...p, y: gy })) {
          if (y < HIDDEN) continue
          const px = x * s
          const py = (y - HIDDEN) * s
          ctx.fillStyle = COLORS[p.kind]
          ctx.globalAlpha = 0.18
          ctx.fillRect(px + 1, py + 1, s - 2, s - 2)
          ctx.globalAlpha = 0.85
          ctx.strokeStyle = COLORS[p.kind]
          ctx.lineWidth = 1.5
          ctx.strokeRect(px + 1.75, py + 1.75, s - 3.5, s - 3.5)
          ctx.globalAlpha = 1
        }
    }
    for (const [x, y] of g.cells()) if (y >= HIDDEN) drawCell(ctx, x * s, (y - HIDDEN) * s, s, COLORS[p.kind])
  }
  const f = g.flash
  if (f) {
    const a = 1 - (g.clock - f.at) / FLASH_MS
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, a) * 0.85})`
    for (const r of f.rows) if (r >= HIDDEN) ctx.fillRect(0, (r - HIDDEN) * s, W, s)
  }
}

function drawMini(canvas: HTMLCanvasElement | null, kind: Kind | null, m: number, dim = false) {
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const dpr = window.devicePixelRatio || 1
  const cw = m * 5
  const ch = m * 4
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
    canvas.style.width = `${cw}px`
    canvas.style.height = `${ch}px`
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  if (!kind) return
  const cells = ROT[kind][0]
  const xs = cells.map((c) => c[0])
  const ys = cells.map((c) => c[1])
  const w = Math.max(...xs) - Math.min(...xs) + 1
  const h = Math.max(...ys) - Math.min(...ys) + 1
  const ox = (cw - w * m) / 2 - Math.min(...xs) * m
  const oy = (ch - h * m) / 2 - Math.min(...ys) * m
  for (const [x, y] of cells) drawCell(ctx, ox + x * m, oy + y * m, m, COLORS[kind], dim ? 0.35 : 1)
}

const CHART_W = 132
const CHART_H = 70
const MAX_LINES = 400

function drawChart(canvas: HTMLCanvasElement | null, s: Stats) {
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(CHART_W * dpr)) {
    canvas.width = Math.round(CHART_W * dpr)
    canvas.height = Math.round(CHART_H * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, CHART_W, CHART_H)
  const n = Math.max(30, s.mu.length)
  const x = (i: number) => 5 + (i * (CHART_W - 10)) / (n - 1)
  const y = (v: number) => CHART_H - 5 - (Math.min(v, MAX_LINES) / MAX_LINES) * (CHART_H - 10)
  ctx.strokeStyle = 'rgba(127,127,127,.28)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const v of [0, 200, 400]) {
    ctx.moveTo(5, Math.round(y(v)) + 0.5)
    ctx.lineTo(CHART_W - 5, Math.round(y(v)) + 0.5)
  }
  ctx.stroke()
  const line = (vals: number[], color: string, width: number) => {
    if (!vals.length) return
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.beginPath()
    vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))))
    ctx.stroke()
  }
  line(s.best, 'rgba(127,127,127,.55)', 1)
  if (s.mu.length) {
    ctx.fillStyle = 'rgba(10,132,255,.16)'
    ctx.beginPath()
    ctx.moveTo(x(0), y(0))
    s.mu.forEach((v, i) => ctx.lineTo(x(i), y(v)))
    ctx.lineTo(x(s.mu.length - 1), y(0))
    ctx.fill()
    line(s.mu, '#0a84ff', 2)
    ctx.fillStyle = '#0a84ff'
    ctx.beginPath()
    ctx.arc(x(s.mu.length - 1), y(s.mu[s.mu.length - 1]), 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
}

type Cmd = 'new' | 'pause' | 'end' | 'ghost' | 'grid' | 'sound' | 'help' | 'forget' | `level:${number}` | `learn:${number}` | `watch:${number}`
interface Ctl {
  readonly status: Tetris['status']
  readonly ghost: boolean
  readonly grid: boolean
  readonly sound: boolean
  readonly level: number
  readonly ai: boolean
  readonly learn: number
  readonly watch: number
  run(cmd: Cmd): void
}
const ctls = new Map<string, Ctl>()

export function tetrisMenus(): MenuDef[] {
  const c = ctls.get(os().focused ?? '')
  const run = (cmd: Cmd) => () => c?.run(cmd)
  const st = c?.status
  const ai = !!c?.ai
  return [
    {
      title: 'Game',
      items: [
        { label: 'New Game', shortcut: '⌘N', action: run('new') },
        { label: st === 'paused' ? 'Resume' : 'Pause', shortcut: 'P', disabled: st !== 'playing' && st !== 'paused', action: run('pause') },
        'sep',
        {
          label: 'Starting Level',
          submenu: LEVELS.map((l) => ({ label: String(l), checked: c?.level === l, action: run(`level:${l}`) })),
        },
        'sep',
        { label: 'End Game', disabled: st !== 'playing' && st !== 'paused', action: run('end') },
        'sep',
        { label: 'Learning Speed', disabled: !ai, submenu: LEARN_SPEEDS.map((l, i) => ({ label: l.label, checked: c?.learn === i, action: run(`learn:${i}`) })) },
        { label: 'Watch Speed', disabled: !ai, submenu: WATCH_SPEEDS.map((l, i) => ({ label: l.label, checked: c?.watch === i, action: run(`watch:${i}`) })) },
        { label: 'Forget What It Learned', disabled: !ai, action: run('forget') },
      ],
    },
    {
      title: 'View',
      items: [
        { label: 'Show Ghost Piece', checked: c?.ghost ?? true, action: run('ghost') },
        { label: 'Show Grid', checked: c?.grid ?? true, action: run('grid') },
        'sep',
        { label: 'Sound Effects', checked: c?.sound ?? true, action: run('sound') },
      ],
    },
    {
      title: 'Help',
      items: [
        { label: ai ? 'Stop Getting Help' : 'Get Help', action: run('help') },
        'sep',
        {
          label: 'Tetris Help',
          action: () => os().notify({ app: 'tetris', title: 'Tetris Help', body: 'Arrows move, X and Z rotate, Space drops, C holds. If that was not helpful, try Get Help.' }),
        },
      ],
    },
  ]
}

const AI_QUIPS = [
  'That was a learning experience. For me.',
  'I regret nothing. I have no memory of this game.',
  'The ceiling and I have agreed to disagree.',
  'Noted. Adjusting weights. Blaming the pieces.',
]
const NAG = 'Please keep your hands off the keyboard. I am helping.'

const QUIPS = [
  'The pile reached the ceiling. The ceiling was not consulted.',
  'Somewhere, a long piece was just about to arrive.',
  'That one is on the I piece. Its whole career is being late.',
  'The rows were right there. They were literally right there.',
  'Stack cleared by gravity, your honour.',
]

export function TetrisGame({ win }: { win: Win }) {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [cell, setCell] = useState(26)
  const [, force] = useReducer((n: number) => n + 1, 0)
  const focused = useOS((s) => s.focused)
  const [ai, setAi] = useState(false)
  const aiRef = useRef(false)
  const agent = useRef<TetrisAgent | null>(null)
  agent.current ??= new TetrisAgent()
  const bot = agent.current
  const plan = useRef<{ piece: object; rot: number; x: number; tries: number } | null>(null)
  const botAcc = useRef(0)
  const restart = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hiddenPause = useRef(false)
  const nagged = useRef(-Infinity)
  const announced = useRef(false)
  const aiRecord = useRef(0)
  const chartRef = useRef<HTMLCanvasElement>(null)

  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const cellRef = useRef(cell)
  cellRef.current = cell

  const bodyRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLCanvasElement>(null)
  const holdRef = useRef<HTMLCanvasElement>(null)
  const nextRef = useRef<HTMLCanvasElement>(null)
  const raf = useRef(0)
  const last = useRef(0)
  const shown = useRef(0)
  const overAt = useRef(0)
  const held = useRef(new Set<string>())
  const das = useRef({ dir: 0, t: 0, repeating: false })

  const game = useRef<Tetris | null>(null)
  if (!game.current) {
    game.current = new Tetris(prefs.level, (e, n) => {
      if (aiRef.current) {
        if (prefsRef.current.sound && bot.watch <= 1 && (e === 'clear' || e === 'tetris')) sfx(e, n)
      } else if (prefsRef.current.sound) sfx(e, n)
      if (e === 'over' && aiRef.current) {
        const g = game.current!
        aiRecord.current = Math.max(aiRecord.current, g.lines)
        clearTimeout(restart.current)
        restart.current = setTimeout(() => aiRef.current && newAIGame(), 1700)
      } else if (e === 'over') {
        overAt.current = performance.now()
        das.current = { dir: 0, t: 0, repeating: false }
        const g = game.current!
        if (g.score > prefsRef.current.best) {
          if (prefsRef.current.best > 0) os().notify({ app: 'tetris', title: 'Tetris', body: `New high score: ${g.score.toLocaleString()}. The blocks are proud of you.` })
          setPrefs((p) => ({ ...p, best: g.score }))
        }
      }
      if (e !== 'move' && e !== 'rotate' && e !== 'drop') queueMicrotask(force)
    })
  }
  const g = game.current

  const draw = () => {
    const ctx = boardRef.current?.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawBoard(ctx, g, cellRef.current, prefsRef.current.grid, prefsRef.current.ghost)
  }

  const frame = (now: number) => {
    raf.current = 0
    const dt = Math.min(50, now - last.current)
    last.current = now
    if (aiRef.current) {
      if (g.status === 'playing') drive(dt)
    } else if (g.status === 'playing') {
      const d = das.current
      if (d.dir) {
        d.t += dt
        if (!d.repeating && d.t >= DAS) {
          d.repeating = true
          d.t -= DAS
          g.move(d.dir as 1 | -1)
        }
        while (d.repeating && d.t >= ARR) {
          d.t -= ARR
          if (!g.move(d.dir as 1 | -1)) {
            d.t = 0
            break
          }
        }
      }
    }
    g.update(dt, !aiRef.current && g.status === 'playing' && held.current.has('ArrowDown'))
    draw()
    if (g.score !== shown.current) {
      shown.current = g.score
      force()
    }
    if (g.status === 'playing' || g.flash) raf.current = requestAnimationFrame(frame)
  }
  const kick = () => {
    draw()
    if (!raf.current) {
      last.current = performance.now()
      raf.current = requestAnimationFrame(frame)
    }
  }

  /** One key press toward the placement the agent picked. Returns true once the piece has been dropped. */
  const act = (pl: NonNullable<typeof plan.current>) => {
    const p = g.cur
    if (!p) return true
    pl.tries++
    if (pl.tries > 24 || pl.x < 0) return g.hardDrop()
    if (p.rot !== pl.rot) {
      if (!g.rotate(1)) pl.rot = p.rot
      return false
    }
    let minX = COLS
    for (const [x] of g.cells()) minX = Math.min(minX, x)
    if (minX === pl.x) return g.hardDrop()
    if (!g.move(minX > pl.x ? -1 : 1)) return g.hardDrop()
    return false
  }
  const drive = (dt: number) => {
    const w = WATCH_SPEEDS[bot.watch]
    let pieces = w.perFrame
    let presses = 0
    if (w.step > 0) {
      botAcc.current += dt
      presses = Math.min(6, Math.floor(botAcc.current / w.step))
      botAcc.current -= presses * w.step
    }
    for (let guard = 0; guard < 400 && g.status === 'playing' && g.cur; guard++) {
      if (w.step > 0 && presses-- <= 0) break
      const p = g.cur
      let pl = plan.current
      if (!pl || pl.piece !== p) {
        const mv = bot.choose(g.board, p.kind)
        pl = plan.current = { piece: p, rot: mv?.rot ?? p.rot, x: mv?.x ?? -1, tries: 0 }
      }
      if (act(pl) && (w.step > 0 || --pieces <= 0)) break
    }
  }

  const newAIGame = () => {
    clearTimeout(restart.current)
    plan.current = null
    botAcc.current = 0
    shown.current = 0
    g.fixedLevel = true
    g.start(1)
    force()
    kick()
  }
  const startAI = async () => {
    if (aiRef.current) return
    aiRef.current = true
    setAi(true)
    held.current.clear()
    das.current = { dir: 0, t: 0, repeating: false }
    announced.current = false
    aiRecord.current = 0
    g.fixedLevel = true
    g.stop()
    force()
    kick()
    try {
      await bot.start()
    } catch (err) {
      console.error('Tetris agent failed to start', err)
      stopAI()
      return os().notify({ app: 'intelligence', title: 'Pear Intelligence', body: 'I tried to help, but my brain would not load. Typical.' })
    }
    if (!aiRef.current) return
    os().notify({
      app: 'intelligence',
      title: 'Pear Intelligence',
      body: bot.resumed ? `Welcome back. I remember ${bot.stats.generation} generations of this. Unfortunately.` : 'I noticed you were struggling. I am taking over, and I am learning as I go. Please do not look at the score.',
    })
    newAIGame()
  }
  const stopAI = () => {
    if (!aiRef.current) return
    aiRef.current = false
    setAi(false)
    clearTimeout(restart.current)
    bot.stop()
    g.fixedLevel = false
    g.stop()
    force()
    kick()
  }

  const newGame = () => {
    if (aiRef.current) stopAI()
    held.current.clear()
    das.current = { dir: 0, t: 0, repeating: false }
    shown.current = 0
    g.start(prefsRef.current.level)
    force()
    kick()
  }
  const togglePause = () => {
    if (g.status === 'playing') g.pause()
    else if (g.status === 'paused') g.resume()
    else return
    if (aiRef.current) bot.pause(g.status === 'paused')
    force()
    kick()
  }
  const run = (cmd: Cmd) => {
    if (cmd === 'new') return newGame()
    if (cmd === 'help') return aiRef.current ? stopAI() : void startAI()
    if (cmd === 'forget') {
      bot.forget()
      return aiRef.current && newAIGame()
    }
    if (cmd.startsWith('learn:')) return bot.setLearn(+cmd.slice(6))
    if (cmd.startsWith('watch:')) return bot.setWatch(+cmd.slice(6))
    if (cmd === 'pause') return togglePause()
    if (cmd === 'end') {
      if (aiRef.current) return stopAI()
      if (g.status === 'playing' || g.status === 'paused') {
        g.stop()
        force()
        kick()
      }
      return
    }
    if (cmd === 'ghost') return setPrefs((p) => ({ ...p, ghost: !p.ghost }))
    if (cmd === 'grid') return setPrefs((p) => ({ ...p, grid: !p.grid }))
    if (cmd === 'sound') return setPrefs((p) => ({ ...p, sound: !p.sound }))
    if (cmd.startsWith('level:')) {
      const level = +cmd.slice(6)
      setPrefs((p) => ({ ...p, level }))
      if (g.status === 'idle') {
        g.startLevel = g.level = level
      }
    }
  }
  const runRef = useRef(run)
  runRef.current = run
  const kickRef = useRef(kick)
  kickRef.current = kick

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
    }
    kickRef.current()
  }, [prefs])

  useEffect(() => {
    ctls.set(win.id, {
      get status() { return g.status },
      get ghost() { return prefsRef.current.ghost },
      get grid() { return prefsRef.current.grid },
      get sound() { return prefsRef.current.sound },
      get level() { return prefsRef.current.level },
      get ai() { return aiRef.current },
      get learn() { return bot.learn },
      get watch() { return bot.watch },
      run: (cmd) => runRef.current(cmd),
    })
    return () => {
      ctls.delete(win.id)
    }
  }, [win.id, g, bot])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const s = Math.floor(Math.min((h - 28) / VISIBLE, (w - SIDE - 44) / COLS))
      setCell(Math.max(12, Math.min(44, s)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = boardRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(COLS * cell * dpr)
    c.height = Math.round(VISIBLE * cell * dpr)
    kickRef.current()
  }, [cell])

  useEffect(() => {
    const m = Math.max(12, Math.min(24, Math.floor(cell * 0.8)))
    drawMini(holdRef.current, g.held, m, !g.canHold)
    drawMini(nextRef.current, g.status === 'idle' ? null : g.next[0], m)
    if (ai) drawChart(chartRef.current, bot.stats)
  })

  useEffect(() => {
    const off = bot.subscribe(() => {
      force()
      if (bot.stats.mastered && aiRef.current && !announced.current) {
        announced.current = true
        os().notify({ app: 'intelligence', title: 'Pear Intelligence', body: `Mastered Tetris after ${bot.stats.generation} generations. You may have your game back. You may not have your dignity.` })
      }
    })
    return () => {
      off()
      clearTimeout(restart.current)
      bot.stop()
    }
  }, [bot])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (os().focused !== win.id) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if ((e.metaKey || e.ctrlKey) && k === 'n') {
        e.preventDefault()
        return runRef.current('new')
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const playing = g.status === 'playing'
      const handled = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'x', 'z', 'c', 'Shift', 'p', 'Escape', 'Enter'].includes(k)
      if (!handled) return
      e.preventDefault()
      if (aiRef.current) {
        if (e.repeat) return
        if (k === 'p' || k === 'Escape' || ((k === 'Enter' || k === ' ') && g.status === 'paused')) return togglePause()
        if (performance.now() - nagged.current > 25_000) {
          nagged.current = performance.now()
          os().notify({ app: 'intelligence', title: 'Pear Intelligence', body: NAG })
        }
        return
      }
      if (e.repeat && k !== 'ArrowDown') return
      if (k === 'p' || k === 'Escape') return togglePause()
      if (k === 'Enter' || k === ' ') {
        if (g.status === 'paused') return togglePause()
        if ((g.status === 'idle' || g.status === 'over') && performance.now() - overAt.current > RESTART_GUARD) return newGame()
      }
      if (!playing) return
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        held.current.add(k)
        das.current = { dir: k === 'ArrowLeft' ? -1 : 1, t: 0, repeating: false }
        g.move(das.current.dir as 1 | -1)
      } else if (k === 'ArrowDown') held.current.add(k)
      else if (k === 'ArrowUp' || k === 'x') g.rotate(1)
      else if (k === 'z') g.rotate(-1)
      else if (k === 'c' || k === 'Shift') g.hold()
      else if (k === ' ') g.hardDrop()
      force()
      kick()
    }
    const up = (e: KeyboardEvent) => {
      held.current.delete(e.key)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const other = held.current.has('ArrowLeft') ? -1 : held.current.has('ArrowRight') ? 1 : 0
        das.current = { dir: other, t: 0, repeating: false }
      }
    }
    const release = () => {
      held.current.clear()
      das.current = { dir: 0, t: 0, repeating: false }
    }
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
    }
  }, [win.id])

  // Stepping away pauses the game; nobody wants to lose a run to a notification.
  useEffect(() => {
    if (focused !== win.id && g.status === 'playing' && !aiRef.current) {
      g.pause()
      held.current.clear()
      das.current = { dir: 0, t: 0, repeating: false }
      force()
    }
  }, [focused, win.id, g])
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden' && g.status === 'playing') {
        g.pause()
        if (aiRef.current) {
          bot.pause(true)
          hiddenPause.current = true
        }
        force()
      } else if (document.visibilityState === 'visible' && hiddenPause.current) {
        hiddenPause.current = false
        g.resume()
        bot.pause(false)
        force()
        kickRef.current()
      }
    }
    document.addEventListener('visibilitychange', hide)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [g, bot])

  const status = g.status
  const stat = (label: string, value: string, big = false) => (
    <div className={`tt-stat ${big ? 'big' : ''}`}>
      {label} <b>{value}</b>
    </div>
  )
  const best = Math.max(prefs.best, g.score)
  const st = bot.stats
  const skill = st.mu.length ? Math.round(st.mu[st.mu.length - 1]) : 0
  const aiNote = !st.running ? 'Waking up…' : st.mastered ? 'Mastered' : st.generation === 0 ? 'Starting from nothing…' : 'Learning'

  return (
    <div className="tetris">
      <div className="toolbar" data-drag>
        <div className="toolbar-title left">
          Tetris
          <small>
            {ai
              ? status === 'paused'
                ? 'Paused'
                : 'Pear Intelligence is helping'
              : status === 'idle'
                ? 'Ready'
                : status === 'over'
                  ? 'Game over'
                  : status === 'paused'
                    ? 'Paused'
                    : `Level ${g.level}`}
          </small>
        </div>
        <button className="btn small" onClick={ai ? stopAI : newGame}>
          {ai ? 'Take Over' : 'New Game'}
        </button>
        <button className="tb-btn" aria-label={status === 'paused' ? 'Resume' : 'Pause'} title={status === 'paused' ? 'Resume' : 'Pause'} disabled={status !== 'playing' && status !== 'paused'} onClick={togglePause}>
          {status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
        </button>
      </div>
      <div className="tt-body" ref={bodyRef}>
        <div className="tt-well" style={{ width: COLS * cell, height: VISIBLE * cell }}>
          <canvas ref={boardRef} className="tt-board" style={{ width: COLS * cell, height: VISIBLE * cell }} aria-label="Tetris board" />
          {status !== 'playing' && (
            <div className={`tt-overlay ${status}`}>
              {ai && status === 'idle' && (
                <>
                  <h2>Hold on</h2>
                  <p>Pear Intelligence is on its way to help.</p>
                </>
              )}
              {ai && status === 'over' && (
                <>
                  <h2>Game Over</h2>
                  <div className="tt-final">{g.lines}</div>
                  <p>{g.lines === 1 ? 'line' : 'lines'}{aiRecord.current > 0 ? ` · best so far ${aiRecord.current}` : ''}</p>
                  <p className="tt-quip">{AI_QUIPS[g.lines % AI_QUIPS.length]}</p>
                </>
              )}
              {!ai && status === 'idle' && (
                <>
                  <h2>Tetris</h2>
                  <p>Stack the pieces, clear the rows, avoid the ceiling.</p>
                  <ul className="tt-keys">
                    <li><kbd>←</kbd><kbd>→</kbd> move</li>
                    <li><kbd>↑</kbd> <kbd>X</kbd> rotate · <kbd>Z</kbd> back</li>
                    <li><kbd>↓</kbd> soft drop · <kbd>Space</kbd> hard drop</li>
                    <li><kbd>C</kbd> hold · <kbd>P</kbd> pause</li>
                  </ul>
                  <button className="btn primary small" onClick={newGame}>
                    Play
                  </button>
                </>
              )}
              {status === 'paused' && (
                <>
                  <h2>Paused</h2>
                  <p>The blocks are waiting. They are very patient.</p>
                  <button className="btn primary small" onClick={togglePause}>
                    Resume
                  </button>
                </>
              )}
              {!ai && status === 'over' && (
                <>
                  <h2>Game Over</h2>
                  <div className="tt-final">{g.score.toLocaleString()}</div>
                  <p>
                    {g.lines} {g.lines === 1 ? 'line' : 'lines'} · level {g.level}
                    {g.score > 0 && g.score >= prefs.best ? ' · new best!' : ''}
                  </p>
                  <p className="tt-quip">{QUIPS[g.lines % QUIPS.length]}</p>
                  <button className="btn primary small" onClick={newGame}>
                    Play Again
                  </button>
                </>
              )}
            </div>
          )}
          {status === 'playing' && g.banner && g.flash && (
            <div className="tt-banner" key={g.flash.at}>
              {g.banner}
            </div>
          )}
        </div>
        <aside className="tt-side">
          <section className="tt-box">
            <h3>Next</h3>
            <canvas ref={nextRef} />
          </section>
          {ai ? (
            <>
              <section className="tt-stats">
                {stat('score', String(g.score).padStart(5, '0'), true)}
                {stat('rows', String(g.lines), true)}
              </section>
              <section className="tt-ai">
                <h3>Pear Intelligence</h3>
                <canvas ref={chartRef} style={{ width: CHART_W, height: CHART_H }} aria-label="Lines per game as it learns" />
                <div className="tt-ai-row">
                  generation <b>{st.generation}</b>
                </div>
                <div className="tt-ai-row">
                  skill <b>{skill}</b>
                  <i>/ {MAX_LINES} lines</i>
                </div>
                <div className={`tt-ai-note ${st.mastered ? 'done' : ''}`}>{aiNote}</div>
              </section>
            </>
          ) : (
            <>
              <section className="tt-box">
                <h3>Hold</h3>
                <canvas ref={holdRef} />
              </section>
              <section className="tt-stats">
                {stat('score', String(g.score).padStart(5, '0'), true)}
                {stat('rows', String(g.lines), true)}
                {stat('level', String(g.level))}
                {stat('best', String(best).padStart(5, '0'))}
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

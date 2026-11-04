import { useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointer } from 'react'
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'
import { Coffee, Gavel, Radiation, RotateCcw, Skull, Undo2 } from 'lucide-react'
import { os, type Win } from '../store'
import { Engine } from '../lib/chessEngine'
import type { MenuDef, MenuItem } from './types'


interface Snap {
  fen: string
  san: string
  from?: Square
  to?: Square
  nuke?: boolean
  ev?: number
  mate?: number | null
}

interface Result {
  title: string
  sub: string
  tone: 'win' | 'loss' | 'draw'
}

const LEVELS = [
  { name: 'Beginner', skill: 0, ms: 150 },
  { name: 'Casual', skill: 6, ms: 250 },
  { name: 'Club', skill: 11, ms: 400 },
  { name: 'Expert', skill: 16, ms: 700 },
  { name: 'Grandmaster', skill: 20, ms: 1200 },
]

type NukeId = 'tactical' | 'orbital' | 'promo' | 'uno' | 'rewind' | 'friend' | 'kill' | 'coffee' | 'table' | 'ban'
type Cmd = 'new-w' | 'new-b' | 'resign' | 'undo' | 'flip' | 'eval' | 'coords' | `level:${number}` | NukeId

type FxKind = 'nuke' | 'strike' | 'promo' | 'uno' | 'flip' | 'hammer' | 'kill' | 'splash'
interface Fx {
  kind: FxKind
  sq?: Square
  key: number
}
interface Ghost {
  sq: Square
  type: PieceSymbol
  color: Color
  key: number
}

const FILES = 'abcdefgh'
const START = new Chess().fen()
const GLYPH: Record<PieceSymbol, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const FULL_SET: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 }
const ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p']

const turnOf = (fen: string) => fen.split(' ')[1] as Color
const fullmove = (fen: string) => +fen.split(' ')[5] || 1
const posKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')

function loadLevel() {
  try {
    const raw = localStorage.getItem('pearos.chess.level')
    const n = raw === null ? NaN : Number(raw)
    if (Number.isInteger(n) && n >= 0 && n < LEVELS.length) return n
  } catch {
  }
  return LEVELS.length - 1
}

function outcome(c: Chess, snaps: Snap[], side: Color): Result | null {
  try {
    if (c.isCheckmate()) {
      const youWin = c.turn() !== side
      return youWin
        ? { title: 'Checkmate', sub: 'You beat Stockfish. Legitimately, even. Probably.', tone: 'win' }
        : { title: 'Checkmate', sub: 'Stockfish wins. Might be time for the Additional Tools menu.', tone: 'loss' }
    }
    if (c.isStalemate()) return { title: 'Stalemate', sub: 'No legal moves, no check. Everybody goes home.', tone: 'draw' }
    if (c.isInsufficientMaterial()) return { title: 'Draw', sub: 'Insufficient material. Nobody can mate anybody.', tone: 'draw' }
    if (c.isDrawByFiftyMoves()) return { title: 'Draw', sub: 'Fifty moves without a capture or pawn push.', tone: 'draw' }
    const key = posKey(snaps[snaps.length - 1].fen)
    if (snaps.filter((s) => !s.nuke && posKey(s.fen) === key).length >= 3) return { title: 'Draw', sub: 'Threefold repetition.', tone: 'draw' }
  } catch {
  }
  return null
}

function missing(c: Chess): Record<Color, PieceSymbol[]> {
  const have: Record<Color, Record<PieceSymbol, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  }
  for (const row of c.board()) for (const p of row) if (p) have[p.color][p.type]++
  const out: Record<Color, PieceSymbol[]> = { w: [], b: [] }
  for (const col of ['w', 'b'] as const)
    for (const t of ORDER) for (let i = have[col][t]; i < FULL_SET[t]; i++) out[col].push(t)
  return out
}

const material = (c: Chess, col: Color) => c.board().flat().reduce((n, p) => (p && p.color === col ? n + VALUE[p.type] : n), 0)

function kingSquare(c: Chess, col: Color): Square | null {
  for (const row of c.board()) for (const p of row) if (p && p.type === 'k' && p.color === col) return p.square
  return null
}

const TAUNTS: Record<NukeId, string[]> = {
  tactical: ['My queen? That was a 14-year-old queen with a family.', 'Is that legal? That cannot be legal.', 'I calculated 40 plies. Not that.'],
  orbital: ['Where did that come from?! There is no sky on a chessboard!', 'Evaluating... evaluating... ow.', 'Target acquired is not a chess term.'],
  promo: ['Nine queens. NINE. This is a pawn-shaped hostage situation.', 'I have to respect the participation trophies.', 'That is... not how promotion works.'],
  uno: ['No u.', 'Wait, I was winning. Why do I have your pieces?', 'This is the worst timeline.'],
  rewind: ['Did we just... go backwards?', 'I remember this position. I liked it better before.', 'Time is a flat circle, apparently.'],
  friend: ['Hello? Yes, this is me. Why are you calling me?', 'You are asking me how to beat me. Bold.'],
  kill: ['zsh: killed', '…', 'Segmentation fau—'],
  coffee: ['Glug. Glug. Is this... a latte?', 'My transistors. My beautiful transistors.', 'I can see through time. Also my depth is 1.'],
  table: ['(┛ಠ_ಠ)┛彡┻━┻  That was my table.', 'Rude. Draw accepted, I guess.'],
  ban: ['I demand a recount!', 'You cannot ban an engine for using an engine.'],
}


function Piece({ type, color, className = '' }: { type: PieceSymbol; color: Color; className?: string }) {
  return (
    <span className={`cx-piece ${color === 'w' ? 'w' : 'b'} ${className}`} aria-hidden>
      {GLYPH[type]}
      {'︎'}
    </span>
  )
}


interface Ctl {
  readonly over: boolean
  readonly canNuke: boolean
  readonly canUndo: boolean
  readonly level: number
  readonly showEval: boolean
  readonly showCoords: boolean
  readonly nukes: number
  run(cmd: Cmd): void
}

const ctls = new Map<string, Ctl>()

export function chessMenus(): MenuDef[] {
  const id = os().focused ?? ''
  const c = ctls.get(id)
  const run = (cmd: Cmd) => () => c?.run(cmd)
  const armed = !!c?.canNuke
  const alive = !!c && !c.over
  const tool = (label: string, cmd: NukeId, enabled = armed): MenuItem => ({ label, disabled: !enabled, action: run(cmd) })
  return [
    {
      title: 'Game',
      items: [
        { label: 'New Game as White', shortcut: '⌘N', action: run('new-w') },
        { label: 'New Game as Black', action: run('new-b') },
        'sep',
        { label: 'Undo Move', shortcut: '⌘Z', disabled: !c?.canUndo, action: run('undo') },
        'sep',
        {
          label: 'Level',
          submenu: LEVELS.map((l, i) => ({ label: l.name, checked: c?.level === i, action: run(`level:${i}`) })),
        },
        'sep',
        { label: 'Resign', disabled: !alive, action: run('resign') },
      ],
    },
    {
      title: 'View',
      items: [
        { label: 'Flip Board', action: run('flip') },
        'sep',
        { label: 'Show Evaluation Bar', checked: c?.showEval ?? true, action: run('eval') },
        { label: 'Show Coordinates', checked: c?.showCoords ?? true, action: run('coords') },
      ],
    },
    {
      title: 'Additional Tools',
      items: [
        { label: c?.nukes ? `Tools deployed: ${c.nukes}` : 'Use as a last resort', disabled: true },
        'sep',
        tool('Tactical Nuke: Delete Their Queen', 'tactical'),
        tool('Orbital Strike…', 'orbital'),
        tool('Everyone’s a Queen (Participation Trophy)', 'promo'),
        'sep',
        tool('Spill Coffee on the Server', 'coffee'),
        tool('kill -9 stockfish', 'kill'),
        tool('Uno Reverse (Swap Sides)', 'uno'),
        'sep',
        tool('Rewind Time to When You Were Winning', 'rewind'),
        tool('Phone a Friend', 'friend'),
        'sep',
        tool('Report for Using an Engine', 'ban', alive),
        tool('Flip the Table', 'table', alive),
      ],
    },
  ]
}


export function ChessGame({ win }: { win: Win }) {
  const [snaps, setSnaps] = useState<Snap[]>([{ fen: START, san: '' }])
  const [side, setSide] = useState<Color>('w')
  const [level, setLevel] = useState(loadLevel)
  const [sel, setSel] = useState<Square | null>(null)
  const [drag, setDrag] = useState<{ from: Square; x: number; y: number } | null>(null)
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null)
  const [hint, setHint] = useState<{ from: Square; to: Square } | null>(null)
  const [thinking, setThinking] = useState(false)
  const [calling, setCalling] = useState(false)
  const [forced, setForced] = useState<Result | null>(null)
  const [strike, setStrike] = useState(false)
  const [taunt, setTaunt] = useState<{ text: string; key: number } | null>(null)
  const [manualFlip, setManualFlip] = useState(false)
  const [showEval, setShowEval] = useState(true)
  const [showCoords, setShowCoords] = useState(true)
  const [nukes, setNukes] = useState(0)
  const [fx, setFx] = useState<Fx | null>(null)
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [bs, setBs] = useState(480)
  const [, force] = useReducer((n: number) => n + 1, 0)

  const hc = useRef({ coffee: 0, dead: 0 })
  const eng = useRef<Engine | null>(null)
  if (!eng.current) eng.current = new Engine()
  const boardRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ from: Square; sx: number; sy: number; moved: boolean } | null>(null)
  const fxTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const warned = useRef(false)

  const last = snaps[snaps.length - 1]
  const chess = useMemo(() => new Chess(last.fen), [last.fen])
  const natural = useMemo(() => outcome(chess, snaps, side), [chess, snaps, side])
  const result = forced ?? natural
  const over = !!result
  const myTurn = chess.turn() === side
  const flipped = (side === 'b') !== manualFlip
  const foe = other(side)
  const canNuke = !over && myTurn && !calling && !strike && !promo

  const legal = useMemo(() => (sel && myTurn && !over ? chess.moves({ square: sel, verbose: true }) : []), [chess, sel, myTurn, over])
  const inCheck = useMemo(() => {
    try {
      return chess.isCheck() ? kingSquare(chess, chess.turn()) : null
    } catch {
      return null
    }
  }, [chess])

  useEffect(() => {
    eng.current!.start()
    return () => eng.current!.kill()
  }, [])

  const levelRef = useRef(level)
  levelRef.current = level
  useEffect(() => {
    try {
      localStorage.setItem('pearos.chess.level', String(level))
    } catch {
    }
  }, [level])

  useEffect(() => {
    if (over || myTurn) {
      setThinking(false)
      return
    }
    let cancelled = false
    setThinking(true)
    ;(async () => {
      const fen = last.fen
      const legalMoves = new Chess(fen).moves({ verbose: true })
      if (!legalMoves.length) return
      const h = hc.current
      const lvl = LEVELS[levelRef.current]
      let uci = ''
      let ev: number | undefined
      let mate: number | null | undefined
      let wasDead = false
      let wasWeak = false
      if (h.dead > 0) {
        await sleep(500 + Math.random() * 500)
        const m = pick(legalMoves)
        uci = m.from + m.to + (m.promotion ?? '')
        wasDead = true
      } else {
        wasWeak = h.coffee > 0
        try {
          const a = await eng.current!.search(fen, wasWeak ? { skill: 0, depth: 1 } : { skill: lvl.skill, movetime: lvl.ms })
          uci = a.best
          const sgn = turnOf(fen) === 'w' ? 1 : -1
          const own = a.mate !== null ? Math.sign(a.mate) * (10000 - Math.abs(a.mate)) : a.cp
          ev = sgn * own
          mate = a.mate !== null ? sgn * a.mate : null
        } catch {
          if (cancelled) return
          if (!warned.current) {
            warned.current = true
            os().notify({ app: 'terminal', title: 'Chess', body: 'Stockfish could not be reached. It will play random moves until it is restarted.' })
          }
          const m = pick(legalMoves)
          uci = m.from + m.to + (m.promotion ?? '')
        }
      }
      if (cancelled) return
      const c = new Chess(fen)
      let m
      try {
        m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      } catch {
        return
      }
      if (wasDead) {
        h.dead--
        if (h.dead === 0) {
          eng.current!.start()
          os().notify({ app: 'terminal', title: 'launchd', body: 'stockfish respawned (new PID, same attitude).' })
        }
      }
      if (wasWeak) h.coffee--
      force()
      setThinking(false)
      setSnaps((s) => (s[s.length - 1].fen === fen ? [...s, { fen: c.fen(), san: m.san, from: m.from, to: m.to, ev, mate }] : s))
    })()
    return () => {
      cancelled = true
    }
  }, [last.fen, side, over, myTurn])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth - (showEval ? 42 : 18)
      const h = el.clientHeight - 18
      setBs(Math.max(160, Math.floor(Math.min(w, h) / 8) * 8))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [showEval])

  const sq = bs / 8
  const posOf = (s: Square) => {
    const f = FILES.indexOf(s[0])
    const r = +s[1]
    return { x: (flipped ? 7 - f : f) * sq, y: (flipped ? r - 1 : 8 - r) * sq }
  }
  const sqAt = (cx: number, cy: number): Square | null => {
    const rect = boardRef.current?.getBoundingClientRect()
    if (!rect) return null
    const fi = Math.floor(((cx - rect.left) / rect.width) * 8)
    const ri = Math.floor(((cy - rect.top) / rect.height) * 8)
    if (fi < 0 || fi > 7 || ri < 0 || ri > 7) return null
    return `${FILES[flipped ? 7 - fi : fi]}${flipped ? ri + 1 : 8 - ri}` as Square
  }

  const say = (id: NukeId) => setTaunt({ text: pick(TAUNTS[id]), key: Date.now() })
  const play = (kind: FxKind, at?: Square, ms = 1700) => {
    clearTimeout(fxTimer.current)
    setFx({ kind, sq: at, key: Date.now() })
    fxTimer.current = setTimeout(() => setFx(null), ms)
  }
  useEffect(() => () => clearTimeout(fxTimer.current), [])

  const showGhosts = (list: { sq: Square; type: PieceSymbol; color: Color }[]) => {
    const key = Date.now()
    setGhosts(list.map((g) => ({ ...g, key })))
    setTimeout(() => setGhosts((cur) => cur.filter((g) => g.key !== key)), 1100)
  }

  const reset = (as: Color) => {
    setSnaps([{ fen: START, san: '' }])
    setSide(as)
    setForced(null)
    setSel(null)
    setDrag(null)
    setPromo(null)
    setHint(null)
    setStrike(false)
    setCalling(false)
    setTaunt(null)
    setManualFlip(false)
    setNukes(0)
    setFx(null)
    setGhosts([])
    hc.current.coffee = 0
    if (hc.current.dead > 0) eng.current!.start()
    hc.current.dead = 0
    force()
  }

  const undo = () => {
    let i = snaps.length - 2
    while (i > 0 && turnOf(snaps[i].fen) !== side) i--
    if (i < 0) return
    setSnaps(snaps.slice(0, i + 1))
    setForced(null)
    setSel(null)
    setHint(null)
  }
  const canUndo = snaps.length > 1 && !strike

  const commit = (from: Square, to: Square, promotion?: string) => {
    const c = new Chess(last.fen)
    let m
    try {
      m = c.move({ from, to, promotion })
    } catch {
      return
    }
    setSnaps((s) => [...s, { fen: c.fen(), san: m.san, from: m.from, to: m.to }])
    setSel(null)
    setHint(null)
    setPromo(null)
  }

  const attempt = (from: Square, to: Square) => {
    const ms = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to)
    if (!ms.length) return
    if (ms[0].promotion) setPromo({ from, to })
    else commit(from, to)
  }

  const alter = (c: Chess, san: string) => {
    const f = c.fen().split(' ')
    f[3] = '-'
    const fen = f.join(' ')
    setSnaps((s) => [...s, { fen, san, nuke: true }])
    setNukes((n) => n + 1)
    setSel(null)
    setHint(null)
    const k = kingSquare(c, foe)
    if (k && c.isAttacked(k, side)) {
      setTimeout(() => setForced({ title: 'King captured', sub: 'The fallout exposed their king and you took it. This is not in the FIDE handbook.', tone: 'win' }), 900)
    }
  }

  const detonate = (squares: Square[], san: string) => {
    const c = new Chess(last.fen)
    const gone = squares.flatMap((s) => {
      const p = c.get(s)
      return p ? [{ sq: s, type: p.type, color: p.color }] : []
    })
    squares.forEach((s) => c.remove(s))
    showGhosts(gone)
    alter(c, san)
  }

  const fire = (id: NukeId) => {
    const needsTurn = id !== 'table' && id !== 'ban'
    if (over || (needsTurn && !canNuke)) return
    const c = new Chess(last.fen)
    const theirs: { sq: Square; type: PieceSymbol }[] = []
    for (const row of c.board()) for (const p of row) if (p && p.color === foe && p.type !== 'k') theirs.push({ sq: p.square, type: p.type })

    switch (id) {
      case 'tactical': {
        const queens = theirs.filter((p) => p.type === 'q')
        const best = ORDER.find((t) => theirs.some((p) => p.type === t))
        const targets = queens.length ? queens : theirs.filter((p) => p.type === best).slice(0, 1)
        if (!targets.length) return os().notify({ app: 'terminal', title: 'Chess', body: 'There is nothing left to nuke. Seek help.' })
        play('nuke')
        say(id)
        return detonate(targets.map((t) => t.sq), `☢ ${queens.length ? 'Queen' : 'Piece'} deleted`)
      }
      case 'orbital':
        setStrike(true)
        setSel(null)
        return
      case 'promo': {
        const pawns: Square[] = []
        for (const row of c.board()) for (const p of row) if (p && p.color === side && p.type === 'p') pawns.push(p.square)
        if (!pawns.length) return os().notify({ app: 'terminal', title: 'Chess', body: 'You have no pawns to promote. Participation trophies were not awarded.' })
        pawns.forEach((p) => c.put({ type: 'q', color: side }, p))
        play('promo')
        say(id)
        return alter(c, `♛ ${pawns.length} promoted`)
      }
      case 'uno':
        play('uno')
        say(id)
        setSnaps((s) => [...s, { fen: last.fen, san: '↺ Uno Reverse', nuke: true }])
        setNukes((n) => n + 1)
        setSel(null)
        setHint(null)
        return setSide(foe)
      case 'rewind': {
        let best = -1
        let bestEv = -Infinity
        snaps.forEach((s, i) => {
          if (i === snaps.length - 1 || s.ev === undefined || turnOf(s.fen) !== side) return
          const mine = side === 'w' ? s.ev : -s.ev
          if (mine > bestEv) {
            bestEv = mine
            best = i
          }
        })
        say(id)
        setNukes((n) => n + 1)
        setSel(null)
        setHint(null)
        if (best < 0) return undo()
        return setSnaps(snaps.slice(0, best + 1))
      }
      case 'friend': {
        if (!eng.current!.alive) {
          say('friend')
          return os().notify({ app: 'terminal', title: 'Phone a Friend', body: 'Your friend is not picking up. Something happened to them recently.' })
        }
        setCalling(true)
        eng.current!
          .search(last.fen, { skill: 20, movetime: 900 })
          .then((a) => {
            const m = new Chess(last.fen).move({ from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best[4] })
            setHint({ from: m.from, to: m.to })
            say(id)
            setNukes((n) => n + 1)
            os().notify({ app: 'terminal', title: 'Phone a Friend', body: `Stockfish says: ${m.san}. It did not realise who was asking.` })
          })
          .catch(() => os().notify({ app: 'terminal', title: 'Phone a Friend', body: 'The call dropped.' }))
          .finally(() => setCalling(false))
        return
      }
      case 'kill':
        eng.current!.kill()
        hc.current.dead = 3
        play('kill')
        say(id)
        setNukes((n) => n + 1)
        os().notify({ app: 'terminal', title: 'Terminal', body: 'zsh: killed     stockfish' })
        return force()
      case 'coffee':
        hc.current.coffee = 6
        play('splash')
        say(id)
        setNukes((n) => n + 1)
        return force()
      case 'table':
        play('flip', undefined, 1500)
        say(id)
        setNukes((n) => n + 1)
        setTimeout(() => setForced({ title: 'Draw', sub: 'By table flip. The pieces are somewhere in the next room.', tone: 'draw' }), 900)
        return
      case 'ban':
        play('hammer', undefined, 2200)
        say(id)
        setNukes((n) => n + 1)
        setTimeout(() => setForced({ title: 'You win', sub: 'Stockfish was banned for using an engine.', tone: 'win' }), 1100)
        return
    }
  }

  const doStrike = (target: Square) => {
    const p = chess.get(target)
    if (!p || p.type === 'k') {
      return os().notify({ app: 'terminal', title: 'Orbital Strike', body: p ? 'Kings are protected by the Geneva Convention. Pick another target.' : 'Target is empty. The strike was wasted on an empty square.' })
    }
    setStrike(false)
    play('strike', target, 1300)
    if (p.color === side) os().notify({ app: 'terminal', title: 'Orbital Strike', body: 'Friendly fire detected.' })
    say('orbital')
    detonate([target], `☢ ${p.type.toUpperCase()}${target} struck`)
  }

  const run = (cmd: Cmd) => {
    if (cmd === 'new-w') return reset('w')
    if (cmd === 'new-b') return reset('b')
    if (cmd === 'undo') return canUndo && undo()
    if (cmd === 'flip') return setManualFlip((f) => !f)
    if (cmd === 'eval') return setShowEval((v) => !v)
    if (cmd === 'coords') return setShowCoords((v) => !v)
    if (cmd === 'resign') return !over && setForced({ title: 'You resigned', sub: 'Stockfish accepts, without gloating. Much.', tone: 'loss' })
    if (cmd.startsWith('level:')) return setLevel(+cmd.slice(6))
    fire(cmd as NukeId)
  }
  const runRef = useRef(run)
  runRef.current = run
  const live = useRef({ over, canNuke, canUndo, level, showEval, showCoords, nukes })
  live.current = { over, canNuke, canUndo, level, showEval, showCoords, nukes }
  useEffect(() => {
    ctls.set(win.id, {
      get over() { return live.current.over },
      get canNuke() { return live.current.canNuke },
      get canUndo() { return live.current.canUndo },
      get level() { return live.current.level },
      get showEval() { return live.current.showEval },
      get showCoords() { return live.current.showCoords },
      get nukes() { return live.current.nukes },
      run: (cmd) => runRef.current(cmd),
    })
    return () => {
      ctls.delete(win.id)
    }
  }, [win.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (os().focused !== win.id) return
      if (e.key === 'Escape') {
        setStrike(false)
        setPromo(null)
        setSel(null)
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        runRef.current('undo')
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        runRef.current('new-w')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [win.id])

  const onDown = (e: ReactPointer) => {
    if (e.button !== 0) return
    const s = sqAt(e.clientX, e.clientY)
    if (!s) return
    if (strike) return doStrike(s)
    if (over || !myTurn || promo) return
    if (sel && legal.some((m) => m.to === s)) return attempt(sel, s)
    const p = chess.get(s)
    if (p && p.color === side) {
      setSel(s)
      const rect = boardRef.current!.getBoundingClientRect()
      dragRef.current = { from: s, sx: e.clientX, sy: e.clientY, moved: false }
      setDrag({ from: s, x: e.clientX - rect.left, y: e.clientY - rect.top })
      boardRef.current!.setPointerCapture(e.pointerId)
    } else setSel(null)
  }
  const onMove = (e: ReactPointer) => {
    const d = dragRef.current
    if (!d) return
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true
    const rect = boardRef.current!.getBoundingClientRect()
    setDrag({ from: d.from, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }
  const onUp = (e: ReactPointer) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    setDrag(null)
    if (!d.moved) return
    const target = sqAt(e.clientX, e.clientY)
    if (target && target !== d.from) attempt(d.from, target)
  }

  const lastReal = [...snaps].reverse().find((s) => s.from && s.to)
  const evSnap = [...snaps].reverse().find((s) => s.ev !== undefined)
  const ev = evSnap?.ev ?? 0
  const pctWhite = evSnap ? Math.max(3, Math.min(97, 50 + 50 * (2 / (1 + Math.exp(-ev / 400)) - 1))) : 50
  const evLabel = !evSnap ? '–' : evSnap.mate != null ? `M${Math.abs(evSnap.mate)}` : `${ev >= 0 ? '+' : '−'}${(Math.abs(ev) / 100).toFixed(1)}`
  const miss = useMemo(() => missing(chess), [chess])
  const diff = material(chess, side) - material(chess, foe)
  const squares: { s: Square; light: boolean }[] = []
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const file = flipped ? 7 - f : f
      const rank = flipped ? r + 1 : 8 - r
      squares.push({ s: `${FILES[file]}${rank}` as Square, light: (file + rank) % 2 === 1 })
    }
  const dying = hc.current.dead > 0
  const wet = hc.current.coffee > 0
  const lvl = LEVELS[level]

  const card = (who: 'engine' | 'you') => {
    const mine = who === 'you'
    const col = mine ? side : foe
    const lostPieces = miss[other(col)]
    return (
      <div className={`cx-card ${who} ${!mine && (fx?.kind === 'kill' || fx?.kind === 'splash' || fx?.kind === 'hammer') ? 'hit' : ''}`}>
        <div className="cx-avatar">{mine ? '🍐' : <Radiation size={16} />}</div>
        <div className="cx-card-main">
          <div className="cx-name">
            {mine ? 'You' : 'Stockfish 19'}
            <span className="cx-col">{col === 'w' ? 'White' : 'Black'}</span>
          </div>
          <div className="cx-sub">
            {mine
              ? myTurn && !over
                ? 'Your move'
                : ' '
              : dying
                ? `💀 Rebooting (${hc.current.dead})`
                : wet
                  ? `☕ Soaked (${hc.current.coffee})`
                  : thinking
                    ? 'Thinking…'
                    : `${lvl.name} · Lite`}
          </div>
          <div className="cx-captured">
            {lostPieces.map((t, i) => (
              <Piece key={i} type={t} color={other(col)} className="mini" />
            ))}
            {(mine ? diff : -diff) > 0 && <span className="cx-diff">+{mine ? diff : -diff}</span>}
          </div>
        </div>
      </div>
    )
  }

  const pairs = snaps.slice(1)
  const ghostPos = (g: Ghost) => posOf(g.sq)

  return (
    <div className={`chess ${strike ? 'striking' : ''}`}>
      <div className="toolbar" data-drag>
        <div className="toolbar-title left">
          Chess
          <small>
            {side === 'w' ? 'You (White)' : 'You (Black)'} vs Stockfish 19
          </small>
        </div>
        <button className="btn small" onClick={() => reset(side)}>
          New Game
        </button>
        <button className="tb-btn" aria-label="Undo move" title="Undo move" disabled={!canUndo} onClick={() => run('undo')}>
          <Undo2 size={15} />
        </button>
        <button className="tb-btn" aria-label="Flip board" title="Flip board" onClick={() => run('flip')}>
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="cx-body">
        <div className="cx-stage" ref={stageRef}>
          {showEval && (
            <div className="cx-eval" style={{ height: bs }} title={`Evaluation: ${evLabel}`}>
              <div className="cx-eval-fill" style={{ height: `${pctWhite}%`, [flipped ? 'top' : 'bottom']: 0 }} />
              <span className={`cx-eval-label ${pctWhite >= 50 !== flipped ? 'bottom' : 'top'}`}>{evLabel}</span>
            </div>
          )}
          <div
            className={`cx-board ${fx?.kind === 'flip' ? 'flipping' : ''} ${fx?.kind === 'nuke' || fx?.kind === 'strike' ? 'quake' : ''}`}
            ref={boardRef}
            style={{ width: bs, height: bs, ['--sq' as string]: `${sq}px` }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {squares.map(({ s, light }, i) => {
              const p = chess.get(s)
              const isLast = !!lastReal && (lastReal.from === s || lastReal.to === s)
              const target = legal.find((m) => m.to === s)
              const file = i % 8
              const row = Math.floor(i / 8)
              return (
                <div
                  key={s}
                  className={`cx-sq ${light ? 'l' : 'd'} ${isLast ? 'last' : ''} ${sel === s ? 'sel' : ''} ${inCheck === s ? 'check' : ''} ${hint && (hint.from === s || hint.to === s) ? 'hint' : ''}`}
                >
                  {showCoords && file === 0 && <i className="cx-rank">{s[1]}</i>}
                  {showCoords && row === 7 && <i className="cx-file">{s[0]}</i>}
                  {target && <b className={`cx-dot ${p ? 'cap' : ''}`} />}
                  {p && !(drag && drag.from === s && dragRef.current?.moved) && <Piece type={p.type} color={p.color} />}
                </div>
              )
            })}
            {drag && dragRef.current?.moved && chess.get(drag.from) && (
              <div className="cx-drag" style={{ left: drag.x - sq / 2, top: drag.y - sq / 2 }}>
                <Piece type={chess.get(drag.from)!.type} color={chess.get(drag.from)!.color} />
              </div>
            )}
            {ghosts.map((g) => (
              <div key={g.key + g.sq} className="cx-ghost" style={{ left: ghostPos(g).x, top: ghostPos(g).y }}>
                <Piece type={g.type} color={g.color} />
              </div>
            ))}

            {fx?.kind === 'nuke' && (
              <div className="cx-fx nuke" key={fx.key}>
                <div className="cx-flash" />
                <div className="cx-ring" />
                <Radiation className="cx-big" size={bs * 0.4} strokeWidth={1.4} />
              </div>
            )}
            {fx?.kind === 'strike' && fx.sq && (
              <div className="cx-fx strike" key={fx.key}>
                <div className="cx-beam" style={{ left: posOf(fx.sq).x + sq / 2 - sq * 0.18, width: sq * 0.36 }} />
                <div className="cx-blast" style={{ left: posOf(fx.sq).x + sq / 2, top: posOf(fx.sq).y + sq / 2, width: sq * 3, height: sq * 3 }} />
              </div>
            )}
            {fx?.kind === 'promo' && (
              <div className="cx-fx promo" key={fx.key}>
                <div className="cx-flash gold" />
                <span className="cx-stamp gold">ALL HAIL THE QUEENS</span>
              </div>
            )}
            {fx?.kind === 'uno' && (
              <div className="cx-fx uno" key={fx.key}>
                <div className="cx-card-uno">↺</div>
              </div>
            )}
            {fx?.kind === 'hammer' && (
              <div className="cx-fx hammer" key={fx.key}>
                <Gavel className="cx-gavel" size={bs * 0.34} strokeWidth={1.6} />
                <span className="cx-stamp">BANNED</span>
              </div>
            )}
            {fx?.kind === 'kill' && (
              <div className="cx-fx kill" key={fx.key}>
                <Skull size={bs * 0.2} strokeWidth={1.6} />
                <code>zsh: killed &nbsp;&nbsp;&nbsp; stockfish</code>
              </div>
            )}
            {fx?.kind === 'splash' && (
              <div className="cx-fx splash" key={fx.key}>
                <Coffee className="cx-cup" size={bs * 0.3} strokeWidth={1.4} />
                <div className="cx-spill" />
              </div>
            )}

            {strike && <div className="cx-banner">Select a target · Esc to cancel</div>}
            {promo && (
              <div className="cx-promo" onPointerDown={(e) => e.stopPropagation()}>
                {(['q', 'r', 'b', 'n'] as const).map((t) => (
                  <button key={t} onClick={() => commit(promo.from, promo.to, t)} aria-label={`Promote to ${t}`}>
                    <Piece type={t} color={side} />
                  </button>
                ))}
              </div>
            )}
            {result && (
              <div className={`cx-result ${result.tone}`} onPointerDown={(e) => e.stopPropagation()}>
                <h2>{result.title}</h2>
                <p>{result.sub}</p>
                {nukes > 0 && (
                  <p className="cx-fallout">
                    <Radiation size={12} /> Additional Tools used: {nukes}
                  </p>
                )}
                <div className="cx-result-btns">
                  <button className="btn primary small" onClick={() => reset(side)}>
                    New Game
                  </button>
                  {snaps.length > 1 && !forced && (
                    <button className="btn small" onClick={undo}>
                      Take Back
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="cx-side">
          {card('engine')}
          <div className="cx-moves" aria-label="Moves">
            {pairs.length === 0 && <span className="cx-empty">No moves yet.</span>}
            {pairs.map((s, i) => {
              const prev = snaps[i]
              const num = !s.nuke && turnOf(prev.fen) === 'w' ? `${fullmove(prev.fen)}.` : null
              return (
                <span key={i} className="cx-mv-wrap">
                  {num && <span className="cx-num">{num}</span>}
                  <span className={`cx-mv ${s.nuke ? 'nuke' : ''} ${i === pairs.length - 1 ? 'cur' : ''}`}>{s.san}</span>
                </span>
              )
            })}
          </div>
          {taunt && (
            <div className="cx-taunt" key={taunt.key}>
              <b>Stockfish:</b> {taunt.text}
            </div>
          )}
          {card('you')}
          <div className="cx-foot">
            <span>Level</span>
            <select className="cx-select" value={level} onChange={(e) => setLevel(+e.target.value)} aria-label="Level">
              {LEVELS.map((l, i) => (
                <option key={l.name} value={i}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </aside>
      </div>
    </div>
  )
}

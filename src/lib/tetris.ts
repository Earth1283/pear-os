// Tetris rules, with no UI in sight: 7-bag randomiser, SRS rotation and wall kicks, hold, ghost,
// lock delay with move resets, guideline scoring. The app drives it with `update(dt)` and listens to events.

export type Kind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'
export const KINDS: Kind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

export const COLS = 10
export const ROWS = 22
/** The top two rows are the spawn area and are not drawn. */
export const HIDDEN = 2
export const VISIBLE = ROWS - HIDDEN

export const LOCK_MS = 500
export const MAX_RESETS = 15
export const SOFT_MS = 45
export const FLASH_MS = 260
const MAX_LEVEL = 20
const PREVIEW = 5

type Cell = [number, number]

const SHAPE: Record<Kind, string[]> = {
  I: ['....', 'XXXX', '....', '....'],
  O: ['XX', 'XX'],
  T: ['.X.', 'XXX', '...'],
  S: ['.XX', 'XX.', '...'],
  Z: ['XX.', '.XX', '...'],
  J: ['X..', 'XXX', '...'],
  L: ['..X', 'XXX', '...'],
}

function rotations(kind: Kind): Cell[][] {
  let m = SHAPE[kind].map((r) => r.split(''))
  const out: Cell[][] = []
  for (let i = 0; i < 4; i++) {
    const cells: Cell[] = []
    m.forEach((row, y) => row.forEach((ch, x) => ch === 'X' && cells.push([x, y])))
    out.push(cells)
    const n = m.length
    const prev = m
    m = prev.map((_, r) => prev.map((__, c) => prev[n - 1 - c][r]))
  }
  return out
}

/** ROT[kind][rotation] is the list of filled [x, y] cells inside the piece's box. */
export const ROT = Object.fromEntries(KINDS.map((k) => [k, rotations(k)])) as Record<Kind, Cell[][]>

// Super Rotation System kicks, written the way the guideline does (y points up).
const KICK_JLSTZ: Record<string, Cell[]> = {
  '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
}
const KICK_I: Record<string, Cell[]> = {
  '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
}
const NO_KICK: Cell[] = [[0, 0]]

const kicks = (kind: Kind, from: number, to: number) => (kind === 'O' ? NO_KICK : (kind === 'I' ? KICK_I : KICK_JLSTZ)[`${from}${to}`])

export interface Piece {
  kind: Kind
  rot: number
  x: number
  y: number
}

export type Status = 'idle' | 'playing' | 'paused' | 'over'
export type Ev = 'move' | 'rotate' | 'lock' | 'hold' | 'drop' | 'clear' | 'tetris' | 'level' | 'over'

const LINE_POINTS = [0, 100, 300, 500, 800]
export const CLEAR_NAMES = ['', 'Single', 'Double', 'Triple', 'Tetris']

export class Tetris {
  board: (Kind | null)[][] = Tetris.empty()
  cur: Piece | null = null
  held: Kind | null = null
  queue: Kind[] = []
  status: Status = 'idle'
  score = 0
  lines = 0
  level: number
  combo = -1
  b2b = false
  /** Rows that just cleared, for a brief flash. */
  flash: { rows: number[]; at: number } | null = null
  /** Label for the last clear, shown until the next one. */
  banner = ''
  clock = 0

  private bag: Kind[] = []
  canHold = true
  private acc = 0
  private lockT = 0
  private resets = 0
  private lowest = 0

  constructor(
    public startLevel = 1,
    private emit: (e: Ev, n?: number) => void = () => {},
    private rand: () => number = Math.random,
  ) {
    this.level = startLevel
  }

  static empty() {
    return Array.from({ length: ROWS }, () => Array<Kind | null>(COLS).fill(null))
  }

  start(level = this.startLevel) {
    this.startLevel = level
    this.level = level
    this.board = Tetris.empty()
    this.held = null
    this.queue = []
    this.bag = []
    this.score = this.lines = 0
    this.combo = -1
    this.b2b = false
    this.flash = null
    this.banner = ''
    this.canHold = true
    this.status = 'playing'
    this.refill()
    this.spawn(this.queue.shift()!)
    this.refill()
  }

  /** Back to the empty, not-yet-started board. */
  stop() {
    this.status = 'idle'
    this.cur = null
    this.board = Tetris.empty()
    this.held = null
    this.queue = []
    this.score = this.lines = 0
    this.level = this.startLevel
    this.combo = -1
    this.b2b = false
    this.flash = null
    this.banner = ''
  }

  pause() {
    if (this.status === 'playing') this.status = 'paused'
  }
  resume() {
    if (this.status === 'paused') this.status = 'playing'
  }

  get next() {
    return this.queue.slice(0, PREVIEW)
  }

  /** Seconds-per-row curve from the guideline, in milliseconds. */
  get interval() {
    const l = Math.min(this.level, MAX_LEVEL) - 1
    return Math.max(16, 1000 * Math.pow(0.8 - l * 0.007, l))
  }

  private refill() {
    while (this.queue.length < 7 + PREVIEW) {
      if (!this.bag.length) {
        this.bag = [...KINDS]
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.rand() * (i + 1))
          ;[this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]
        }
      }
      this.queue.push(this.bag.pop()!)
    }
  }

  private collides(kind: Kind, rot: number, x: number, y: number) {
    for (const [cx, cy] of ROT[kind][rot]) {
      const nx = x + cx
      const ny = y + cy
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true
      if (ny >= 0 && this.board[ny][nx]) return true
    }
    return false
  }

  private spawn(kind: Kind) {
    const p: Piece = { kind, rot: 0, x: kind === 'O' ? 4 : 3, y: 0 }
    this.cur = p
    this.acc = this.lockT = this.resets = 0
    if (this.collides(kind, 0, p.x, p.y)) return this.end()
    // Pieces appear a row above the visible field and drop straight in.
    if (!this.collides(kind, 0, p.x, p.y + 1)) p.y++
    this.lowest = p.y
  }

  private end() {
    this.status = 'over'
    this.cur = null
    this.emit('over')
  }

  cells(p: Piece = this.cur!): Cell[] {
    return ROT[p.kind][p.rot].map(([cx, cy]) => [p.x + cx, p.y + cy])
  }

  get grounded() {
    const p = this.cur
    return !!p && this.collides(p.kind, p.rot, p.x, p.y + 1)
  }

  ghostY() {
    const p = this.cur
    if (!p) return 0
    let y = p.y
    while (!this.collides(p.kind, p.rot, p.x, y + 1)) y++
    return y
  }

  /** A successful shift or turn restarts the lock timer, up to MAX_RESETS times per row reached. */
  private touched() {
    if (!this.grounded) this.lockT = 0
    else if (this.resets < MAX_RESETS) {
      this.lockT = 0
      this.resets++
    }
  }

  private get live() {
    return this.status === 'playing' && !!this.cur
  }

  move(dx: -1 | 1) {
    const p = this.cur
    if (!this.live || !p || this.collides(p.kind, p.rot, p.x + dx, p.y)) return false
    p.x += dx
    this.touched()
    this.emit('move')
    return true
  }

  rotate(dir: 1 | -1) {
    const p = this.cur
    if (!this.live || !p) return false
    const to = (p.rot + dir + 4) % 4
    for (const [kx, ky] of kicks(p.kind, p.rot, to)) {
      if (this.collides(p.kind, to, p.x + kx, p.y - ky)) continue
      p.rot = to
      p.x += kx
      p.y -= ky
      if (p.y > this.lowest) {
        this.lowest = p.y
        this.resets = 0
      }
      this.touched()
      this.emit('rotate')
      return true
    }
    return false
  }

  hold() {
    const p = this.cur
    if (!this.live || !p || !this.canHold) return false
    const swap = this.held
    this.held = p.kind
    this.spawn(swap ?? this.take())
    this.canHold = false
    this.emit('hold')
    return true
  }

  hardDrop() {
    const p = this.cur
    if (!this.live || !p) return false
    const y = this.ghostY()
    this.score += 2 * (y - p.y)
    p.y = y
    this.emit('drop')
    this.lock()
    return true
  }

  private take() {
    const k = this.queue.shift()!
    this.refill()
    return k
  }

  update(dt: number, soft = false) {
    this.clock += dt
    if (this.flash && this.clock - this.flash.at > FLASH_MS) this.flash = null
    const p = this.cur
    if (this.status !== 'playing' || !p) return
    if (this.grounded) {
      this.lockT += dt
      if (this.lockT >= LOCK_MS) this.lock()
      return
    }
    const iv = soft ? Math.min(this.interval, SOFT_MS) : this.interval
    this.acc += dt
    while (this.acc >= iv && this.cur === p && !this.collides(p.kind, p.rot, p.x, p.y + 1)) {
      this.acc -= iv
      p.y++
      if (soft) this.score++
      if (p.y > this.lowest) {
        this.lowest = p.y
        this.resets = 0
      }
    }
    if (this.grounded) {
      this.acc = 0
      this.lockT = 0
    }
  }

  private lock() {
    const p = this.cur!
    const cells = this.cells(p)
    for (const [x, y] of cells) if (y >= 0) this.board[y][x] = p.kind
    const lockedOut = cells.every(([, y]) => y < HIDDEN)
    this.emit('lock')
    this.clearLines()
    if (lockedOut) return this.end()
    this.canHold = true
    this.spawn(this.take())
  }

  private clearLines() {
    const rows: number[] = []
    this.board.forEach((r, y) => r.every(Boolean) && rows.push(y))
    const n = rows.length
    if (!n) {
      this.combo = -1
      return
    }
    this.board = [...Array.from({ length: n }, () => Array<Kind | null>(COLS).fill(null)), ...this.board.filter((_, y) => !rows.includes(y))]
    const hard = n === 4
    let pts = LINE_POINTS[n] * this.level
    if (hard && this.b2b) pts = Math.floor(pts * 1.5)
    const bonus = hard && this.b2b
    this.b2b = hard
    this.combo++
    if (this.combo > 0) pts += 50 * this.combo * this.level
    this.score += pts
    this.lines += n
    this.banner = CLEAR_NAMES[n] + (bonus ? ' · back-to-back' : '') + (this.combo > 0 ? ` · ${this.combo + 1} combo` : '')
    this.flash = { rows, at: this.clock }
    this.emit(hard ? 'tetris' : 'clear', n)
    const lvl = Math.min(MAX_LEVEL, this.startLevel + Math.floor(this.lines / 10))
    if (lvl > this.level) {
      this.level = lvl
      this.emit('level', lvl)
    }
  }
}

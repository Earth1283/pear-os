// The Tetris agent, as the page sees it. The learning itself lives in the Rust kernel (kernel/src/tetrisai.rs)
// and runs in a Web Worker so the desktop stays smooth. The page keeps its own copy of the latest weights
// (a second, tiny WASM instance) and uses it to choose every move of the game you are watching.

import wasmUrl from '../kernel/pearnel.wasm?url'
import { KINDS, COLS, ROWS, type Kind } from './tetris'

interface AiExports {
  memory: WebAssembly.Memory
  ai_reset(seed: number): void
  ai_generation(): number
  ai_params_ptr(): number
  ai_params_len(): number
  ai_set_progress(generation: number, mastered: number): void
  ai_generation_count(): number
  ai_mastered(): number
  ai_log_ptr(): number
  ai_log_len(): number
  ai_log_clear(): void
  ai_io_ptr(): number
  ai_choose(kind: number): number
}

export interface GenRow {
  generation: number
  /** Lines the agent itself clears in a fresh 1,000-piece game. */
  mu: number
  /** Mean and best lines across the generation's population of candidates. */
  mean: number
  best: number
}

export class AgentCore {
  private constructor(private k: AiExports) {}

  static async create() {
    const bytes = await (await fetch(wasmUrl)).arrayBuffer()
    const { instance } = await WebAssembly.instantiate(bytes, {})
    return new AgentCore(instance.exports as unknown as AiExports)
  }

  reset(seed: number) {
    this.k.ai_reset(seed)
  }

  /** Learns for one generation and returns what it logged. */
  generation(): GenRow | null {
    const k = this.k
    k.ai_generation()
    const n = k.ai_log_len()
    let row: GenRow | null = null
    if (n >= 4) {
      const ptr = k.ai_log_ptr()
      const log = new Float32Array(k.memory.buffer, ptr, n)
      row = { generation: log[n - 4], mu: log[n - 3], mean: log[n - 2], best: log[n - 1] }
    }
    k.ai_log_clear()
    return row
  }

  get generations() {
    return this.k.ai_generation_count()
  }
  get mastered() {
    return this.k.ai_mastered() !== 0
  }

  // Pointers are read before `memory.buffer`: touching the agent can grow memory, which detaches an older buffer.
  theta(): number[] {
    const ptr = this.k.ai_params_ptr()
    return Array.from(new Float32Array(this.k.memory.buffer, ptr, this.k.ai_params_len()))
  }

  load(theta: ArrayLike<number>, generation: number, mastered: boolean) {
    const ptr = this.k.ai_params_ptr()
    const dst = new Float32Array(this.k.memory.buffer, ptr, this.k.ai_params_len())
    if (theta.length !== dst.length) return false
    dst.set(theta as ArrayLike<number>)
    this.k.ai_set_progress(generation, mastered ? 1 : 0)
    return true
  }

  /** `board` is ROWS x COLS cells (any non-null entry is filled). Returns the placement to aim for. */
  choose(board: (Kind | null)[][], kind: Kind): { rot: number; x: number } | null {
    const k = this.k
    const ptr = k.ai_io_ptr()
    const io = new Uint8Array(k.memory.buffer, ptr, ROWS * COLS)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) io[r * COLS + c] = board[r][c] ? 1 : 0
    const mv = k.ai_choose(KINDS.indexOf(kind))
    return mv < 0 ? null : { rot: mv >> 4, x: mv & 15 }
  }
}

export type ToWorker =
  | { type: 'init'; epoch: number; seed: number; theta: number[] | null; generation: number; mastered: boolean; gps: number }
  | { type: 'speed'; gps: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'reset'; epoch: number; seed: number }
export type FromWorker = { type: 'gen'; epoch: number; theta: number[]; generation: number; mastered: boolean; row: GenRow | null } | { type: 'error'; message: string }

/** Generations per second the learner is allowed to run (0 = as fast as it can). */
export const LEARN_SPEEDS = [
  { label: 'Slow', gps: 0.25 },
  { label: 'Normal', gps: 0.5 },
  { label: 'Fast', gps: 3 },
  { label: 'Max', gps: 0 },
]
/** How the game being watched is driven: ms between key presses, and pieces per frame once those are free. */
export const WATCH_SPEEDS = [
  { label: '1×', step: 70, perFrame: 1 },
  { label: '4×', step: 18, perFrame: 1 },
  { label: '16×', step: 0, perFrame: 1 },
  { label: 'Warp', step: 0, perFrame: 8 },
]

// Seeds whose first generations are unremarkable, so the climb takes a while and is worth watching.
const SEEDS = [2, 5, 4, 1, 6, 3]
const KEY = 'pearos.tetris.ai.v1'
const MAX_POINTS = 400

export interface Stats {
  generation: number
  mastered: boolean
  running: boolean
  mu: number[]
  mean: number[]
  best: number[]
}

interface Saved {
  theta: number[]
  generation: number
  mastered: boolean
  mu: number[]
  mean: number[]
  best: number[]
  learn: number
  watch: number
  resets: number
}

const blank = (): Stats => ({ generation: 0, mastered: false, running: false, mu: [], mean: [], best: [] })

function load(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
    if (!s || !Array.isArray(s.theta) || s.theta.length !== 16 || !s.theta.every(Number.isFinite)) return null
    return {
      theta: s.theta,
      generation: Math.max(0, s.generation | 0),
      mastered: !!s.mastered,
      mu: (s.mu ?? []).filter(Number.isFinite).slice(-MAX_POINTS),
      mean: (s.mean ?? []).filter(Number.isFinite).slice(-MAX_POINTS),
      best: (s.best ?? []).filter(Number.isFinite).slice(-MAX_POINTS),
      learn: Math.min(LEARN_SPEEDS.length - 1, Math.max(0, s.learn | 0)),
      watch: Math.min(WATCH_SPEEDS.length - 1, Math.max(0, s.watch | 0)),
      resets: Math.max(0, s.resets | 0),
    }
  } catch {
    return null
  }
}

export class TetrisAgent {
  stats: Stats = blank()
  learn = 1
  watch = 0
  /** True when the saved brain from an earlier session was picked up. */
  resumed = false

  private core: AgentCore | null = null
  private worker: Worker | null = null
  private listeners = new Set<() => void>()
  private resets = 0
  private epoch = 0
  private starting: Promise<void> | null = null

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  private emit() {
    this.listeners.forEach((f) => f())
  }

  get ready() {
    return this.core !== null && this.stats.running
  }

  async start() {
    if (this.stats.running) return
    this.starting ??= (async () => {
      this.core ??= await AgentCore.create()
      const saved = load()
      let theta: number[] | null = null
      if (saved) {
        this.stats = { generation: saved.generation, mastered: saved.mastered, running: false, mu: saved.mu, mean: saved.mean, best: saved.best }
        this.learn = saved.learn
        this.watch = saved.watch
        this.resets = saved.resets
        theta = saved.theta
        this.resumed = saved.generation > 0
        this.core.load(theta, saved.generation, saved.mastered)
      } else {
        this.core.reset(this.seed())
        this.resumed = false
      }
      this.stats.running = true
      this.worker = new Worker(new URL('./tetrisWorker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data)
      this.worker.onerror = () => this.fail()
      this.post({ type: 'init', epoch: this.epoch, seed: this.seed(), theta, generation: this.stats.generation, mastered: this.stats.mastered, gps: LEARN_SPEEDS[this.learn].gps })
      this.emit()
    })()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private seed() {
    return SEEDS[this.resets % SEEDS.length]
  }

  private post(m: ToWorker) {
    this.worker?.postMessage(m)
  }

  private fail() {
    this.worker?.terminate()
    this.worker = null
    this.stats.running = false
    this.emit()
  }

  private onMessage(m: FromWorker) {
    if (m.type === 'error') return this.fail()
    if (m.epoch !== this.epoch) return
    this.core?.load(m.theta, m.generation, m.mastered)
    const s = this.stats
    s.generation = m.generation
    s.mastered = m.mastered
    if (m.row) {
      s.mu.push(m.row.mu)
      s.mean.push(m.row.mean)
      s.best.push(m.row.best)
      for (const a of [s.mu, s.mean, s.best]) if (a.length > MAX_POINTS) a.shift()
    }
    this.save()
    this.emit()
  }

  private save() {
    const s = this.stats
    if (!this.core) return
    const data: Saved = { theta: this.core.theta(), generation: s.generation, mastered: s.mastered, mu: s.mu, mean: s.mean, best: s.best, learn: this.learn, watch: this.watch, resets: this.resets }
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
    }
  }

  /** Stops learning and hands the controls back. The brain is kept for next time. */
  stop() {
    this.worker?.terminate()
    this.worker = null
    this.stats.running = false
    this.save()
    this.emit()
  }

  pause(paused: boolean) {
    this.post({ type: 'pause', paused })
  }

  setLearn(i: number) {
    this.learn = i
    this.post({ type: 'speed', gps: LEARN_SPEEDS[i].gps })
    this.save()
    this.emit()
  }
  setWatch(i: number) {
    this.watch = i
    this.save()
    this.emit()
  }

  /** Forget everything, then start over from a blank brain. */
  forget() {
    this.resets++
    this.epoch++
    this.core?.reset(this.seed())
    this.stats = { ...blank(), running: this.stats.running }
    this.resumed = false
    this.post({ type: 'reset', epoch: this.epoch, seed: this.seed() })
    this.save()
    this.emit()
  }

  choose(board: (Kind | null)[][], kind: Kind) {
    return this.core?.choose(board, kind) ?? null
  }
}

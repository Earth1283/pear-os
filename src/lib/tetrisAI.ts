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
  ai_set_progress(generation: number, mastered: number, level: number, trainCap: number): void
  ai_set_bounded(bounded: number): void
  ai_level(): number
  ai_eval_cap(): number
  ai_train_cap(): number
  ai_generation_count(): number
  ai_mastered(): number
  ai_log_ptr(): number
  ai_log_len(): number
  ai_log_clear(): void
  ai_io_ptr(): number
  ai_choose(kind: number, next: number): number
}

export interface GenRow {
  generation: number
  /** Lines the agent itself clears in a fresh 1,000-piece game. */
  mu: number
  /** Mean and best lines across the generation's population of candidates. */
  mean: number
  best: number
  /** The difficulty level the evaluation game was played at. */
  level: number
  /** How much of the exam game the agent lived through, 0 to 1. */
  survived: number
}

/** Where a learner stands on the ladder: its level, and how long the exam game is at that level. */
export interface Progress {
  generation: number
  mastered: boolean
  level: number
  trainCap: number
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
    if (n >= 6) {
      const ptr = k.ai_log_ptr()
      const log = new Float32Array(k.memory.buffer, ptr, n)
      row = { generation: log[n - 6], mu: log[n - 5], mean: log[n - 4], best: log[n - 3], level: log[n - 2], survived: log[n - 1] }
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
  get level() {
    return this.k.ai_level()
  }
  get evalCap() {
    return this.k.ai_eval_cap()
  }
  get trainCap() {
    return this.k.ai_train_cap()
  }
  setBounded(bounded: boolean) {
    this.k.ai_set_bounded(bounded ? 1 : 0)
  }

  // Pointers are read before `memory.buffer`: touching the agent can grow memory, which detaches an older buffer.
  theta(): number[] {
    const ptr = this.k.ai_params_ptr()
    return Array.from(new Float32Array(this.k.memory.buffer, ptr, this.k.ai_params_len()))
  }

  load(theta: ArrayLike<number>, p: Progress) {
    const ptr = this.k.ai_params_ptr()
    const dst = new Float32Array(this.k.memory.buffer, ptr, this.k.ai_params_len())
    if (theta.length !== dst.length) return false
    dst.set(theta as ArrayLike<number>)
    this.k.ai_set_progress(p.generation, p.mastered ? 1 : 0, p.level, p.trainCap)
    return true
  }

  /** `board` is ROWS x COLS cells (any non-null entry is filled). Returns the placement to aim for. */
  choose(board: (Kind | null)[][], kind: Kind, next: Kind | null): { rot: number; x: number } | null {
    const k = this.k
    const ptr = k.ai_io_ptr()
    const io = new Uint8Array(k.memory.buffer, ptr, ROWS * COLS)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) io[r * COLS + c] = board[r][c] ? 1 : 0
    const mv = k.ai_choose(KINDS.indexOf(kind), next ? KINDS.indexOf(next) : 7)
    return mv < 0 ? null : { rot: mv >> 4, x: mv & 15 }
  }
}

export type ToWorker =
  | { type: 'init'; epoch: number; seed: number; theta: number[] | null; progress: Progress; bounded: boolean; gps: number }
  | { type: 'speed'; gps: number }
  | { type: 'bounded'; bounded: boolean }
  | { type: 'pause'; paused: boolean }
  | { type: 'reset'; epoch: number; seed: number }
export type FromWorker = { type: 'gen'; epoch: number; theta: number[]; progress: Progress; evalCap: number; row: GenRow | null } | { type: 'error'; message: string }

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
const KEY = 'pearos.tetris.ai.v2'
const THETA_LEN = 24
const MAX_POINTS = 400

export interface Stats {
  generation: number
  mastered: boolean
  /** Difficulty rung the learner is on; it never stops climbing unless it is told to stop at the first. */
  level: number
  /** Pieces in the exam game at this level. */
  evalCap: number
  running: boolean
  /** One point per generation: the level it was on plus how much of that level's exam it survived. */
  mu: number[]
  /** Lines cleared in the latest exam. */
  lines: number
}

interface Saved {
  theta: number[]
  generation: number
  mastered: boolean
  level: number
  trainCap: number
  bounded: boolean
  mu: number[]
  lines: number
  learn: number
  watch: number
  resets: number
}

const blank = (): Stats => ({ generation: 0, mastered: false, level: 0, evalCap: 1000, running: false, mu: [], lines: 0 })

function load(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
    if (!s || !Array.isArray(s.theta) || s.theta.length !== THETA_LEN || !s.theta.every(Number.isFinite)) return null
    return {
      theta: s.theta,
      generation: Math.max(0, s.generation | 0),
      mastered: !!s.mastered,
      level: Math.max(0, s.level | 0),
      trainCap: Math.max(0, s.trainCap | 0),
      bounded: !!s.bounded,
      mu: (s.mu ?? []).filter(Number.isFinite).slice(-MAX_POINTS),
      lines: Number.isFinite(s.lines) ? s.lines : 0,
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
  /** Off (the default): keep climbing forever. On: stop at the first level, as the old agent did. */
  bounded = false
  private trainCap = 0
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
        const level = saved.level
        this.stats = { generation: saved.generation, mastered: saved.mastered, level, evalCap: 0, running: false, mu: saved.mu, lines: saved.lines }
        this.bounded = saved.bounded
        this.trainCap = saved.trainCap
        this.learn = saved.learn
        this.watch = saved.watch
        this.resets = saved.resets
        theta = saved.theta
        this.resumed = saved.generation > 0
        this.core.setBounded(this.bounded)
        this.core.load(theta, this.progress())
        this.stats.evalCap = this.core.evalCap
      } else {
        this.core.reset(this.seed())
        this.core.setBounded(this.bounded)
        this.stats.evalCap = this.core.evalCap
        this.resumed = false
      }
      this.stats.running = true
      this.worker = new Worker(new URL('./tetrisWorker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data)
      this.worker.onerror = () => this.fail()
      this.post({ type: 'init', epoch: this.epoch, seed: this.seed(), theta, progress: this.progress(), bounded: this.bounded, gps: LEARN_SPEEDS[this.learn].gps })
      this.emit()
    })()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private progress(): Progress {
    return { generation: this.stats.generation, mastered: this.stats.mastered, level: this.stats.level, trainCap: this.trainCap }
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
    this.core?.load(m.theta, m.progress)
    const s = this.stats
    s.generation = m.progress.generation
    s.mastered = m.progress.mastered
    s.level = m.progress.level
    s.evalCap = m.evalCap
    this.trainCap = m.progress.trainCap
    if (m.row) {
      s.mu.push(m.row.level + m.row.survived)
      s.lines = m.row.mu
      if (s.mu.length > MAX_POINTS) s.mu.shift()
    }
    this.save()
    this.emit()
  }

  private save() {
    const s = this.stats
    if (!this.core) return
    const data: Saved = { theta: this.core.theta(), generation: s.generation, mastered: s.mastered, level: s.level, trainCap: this.trainCap, bounded: this.bounded, mu: s.mu, lines: s.lines, learn: this.learn, watch: this.watch, resets: this.resets }
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
  /** Bounded: stop learning once the first level is passed. Unbounded: raise the bar for ever. */
  setBounded(bounded: boolean) {
    this.bounded = bounded
    this.core?.setBounded(bounded)
    if (!bounded) this.stats.mastered = false
    this.post({ type: 'bounded', bounded })
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
    this.core?.setBounded(this.bounded)
    this.trainCap = 0
    this.stats = { ...blank(), running: this.stats.running }
    this.stats.evalCap = this.core?.evalCap ?? this.stats.evalCap
    this.resumed = false
    this.post({ type: 'reset', epoch: this.epoch, seed: this.seed() })
    this.save()
    this.emit()
  }

  choose(board: (Kind | null)[][], kind: Kind, next: Kind | null) {
    return this.core?.choose(board, kind, next) ?? null
  }
}

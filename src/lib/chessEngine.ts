
const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`

export interface Analysis {
  best: string
  cp: number
  mate: number | null
}

export interface SearchOptions {
  skill: number
  depth?: number
  movetime?: number
}

interface Active {
  res: (a: Analysis) => void
  rej: (e: Error) => void
  cp: number
  mate: number | null
}

export class Engine {
  private worker: Worker | null = null
  private ready: Promise<void> = Promise.resolve()
  private readyRes: (() => void) | null = null
  private active: Active | null = null
  // bestmove lines still owed by searches we cancelled with `stop`; they must not answer the next search.
  private stale = 0
  private skill = -1
  private failed = false

  get alive() {
    return this.worker !== null && !this.failed
  }

  start() {
    if (this.worker) return
    this.failed = false
    this.stale = 0
    this.skill = -1
    const w = new Worker(ENGINE_URL)
    this.worker = w
    w.onmessage = (e: MessageEvent) => this.line(typeof e.data === 'string' ? e.data : String(e.data))
    w.onerror = () => {
      this.failed = true
      this.active?.rej(new Error('engine failed to load'))
      this.active = null
    }
    this.ready = new Promise<void>((res) => {
      this.readyRes = res
    })
    w.postMessage('uci')
    w.postMessage('setoption name Hash value 16')
    w.postMessage('isready')
  }

  kill() {
    this.worker?.terminate()
    this.worker = null
    this.readyRes = null
    this.stale = 0
    this.active?.rej(new Error('engine killed'))
    this.active = null
  }

  private line(l: string) {
    if (l === 'readyok') {
      this.readyRes?.()
      this.readyRes = null
      return
    }
    if (l.startsWith('info') && l.includes(' score ') && !/(lowerbound|upperbound)/.test(l)) {
      const m = /score (cp|mate) (-?\d+)/.exec(l)
      if (m && this.active) {
        if (m[1] === 'cp') {
          this.active.cp = +m[2]
          this.active.mate = null
        } else this.active.mate = +m[2]
      }
      return
    }
    if (l.startsWith('bestmove')) {
      if (this.stale > 0) {
        this.stale--
        return
      }
      const a = this.active
      if (!a) return
      this.active = null
      a.res({ best: l.split(' ')[1], cp: a.cp, mate: a.mate })
    }
  }

  async search(fen: string, o: SearchOptions): Promise<Analysis> {
    const w = this.worker
    if (!w) throw new Error('engine is not running')
    if (this.active) {
      this.active.rej(new Error('cancelled'))
      this.active = null
      this.stale++
      w.postMessage('stop')
    }
    await Promise.race([this.ready, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('engine timed out')), 20000))])
    if (this.worker !== w) throw new Error('engine killed')
    if (o.skill !== this.skill) {
      w.postMessage(`setoption name Skill Level value ${o.skill}`)
      this.skill = o.skill
    }
    return new Promise<Analysis>((res, rej) => {
      this.active = { res, rej, cp: 0, mate: null }
      w.postMessage(`position fen ${fen}`)
      w.postMessage(o.depth ? `go depth ${o.depth}` : `go movetime ${o.movetime ?? 500}`)
    })
  }
}

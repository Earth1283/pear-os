// Runs the Tetris agent's learning off the main thread. One message per generation, with the new weights.

import { AgentCore, type FromWorker, type ToWorker } from './tetrisAI'

const ctx = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null }

let core: AgentCore | null = null
let gps = 1
let epoch = 0
let paused = false
let timer: ReturnType<typeof setTimeout> | undefined

function report(row: ReturnType<AgentCore['generation']>) {
  const c = core!
  ctx.postMessage({ type: 'gen', epoch, theta: c.theta(), generation: c.generations, mastered: c.mastered, row })
}

function tick() {
  timer = undefined
  const c = core
  if (!c || paused || c.mastered) return
  const t0 = performance.now()
  report(c.generation())
  if (c.mastered) return
  const gap = gps > 0 ? 1000 / gps : 0
  timer = setTimeout(tick, Math.max(0, gap - (performance.now() - t0)))
}

function schedule() {
  if (timer === undefined) timer = setTimeout(tick, 0)
}

ctx.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'init') {
      epoch = m.epoch
      core ??= await AgentCore.create()
      if (m.theta) core.load(m.theta, m.generation, m.mastered)
      else core.reset(m.seed)
      gps = m.gps
      paused = false
      report(null)
      // A brand-new agent gets a moment to flail before its first lesson.
      timer = setTimeout(tick, core.generations === 0 && gps > 0 ? Math.min(1000 / gps, 3000) : 0)
    } else if (m.type === 'speed') {
      gps = m.gps
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      schedule()
    } else if (m.type === 'pause') {
      paused = m.paused
      if (paused && timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      } else if (!paused) schedule()
    } else if (m.type === 'reset') {
      epoch = m.epoch
      core?.reset(m.seed)
      report(null)
      schedule()
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', message: String(err) })
  }
}

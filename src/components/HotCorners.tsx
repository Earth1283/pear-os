import { useEffect } from 'react'
import { os } from '../store'
import { CORNER_DWELL, CORNER_EXIT, cornerAt, modifierHeld, type Corner } from '../lib/hotCornerConfig'
import { runHotAction } from '../lib/hotCornerActions'

type Mods = { metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean }

export function HotCorners() {
  useEffect(() => {
    let current: Corner | null = null
    let fired = false
    let timer = 0
    let mods: Mods = { metaKey: false, altKey: false, ctrlKey: false, shiftKey: false }
    const remember = (e: Mods) => (mods = { metaKey: e.metaKey, altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey })

    const trigger = (c: Corner) => {
      if (fired || document.querySelector('.hc-backdrop')) return
      const cfg = os().hotCorners[c]
      if (cfg.action === 'none' || !modifierHeld(cfg.mod, mods)) return
      fired = true
      runHotAction(cfg.action)
    }

    const move = (e: PointerEvent) => {
      remember(e)
      const c = cornerAt(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
      if (c === current) return
      clearTimeout(timer)
      current = c
      fired = false
      if (!c || e.buttons !== 0) return
      timer = window.setTimeout(() => trigger(c), CORNER_DWELL)
    }

    const exit = (e: MouseEvent) => {
      remember(e)
      const c = cornerAt(e.clientX, e.clientY, window.innerWidth, window.innerHeight, CORNER_EXIT)
      if (!c || e.buttons !== 0) return
      if (c !== current) fired = false
      current = c
      clearTimeout(timer)
      trigger(c)
    }

    const leaveCorner = () => {
      clearTimeout(timer)
      current = null
      fired = false
    }

    const key = (e: KeyboardEvent) => remember(e)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    document.documentElement.addEventListener('mouseleave', exit)
    document.documentElement.addEventListener('mouseenter', leaveCorner)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
      document.documentElement.removeEventListener('mouseleave', exit)
      document.documentElement.removeEventListener('mouseenter', leaveCorner)
    }
  }, [])
  return null
}

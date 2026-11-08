import { useEffect, useRef, useState } from 'react'
import { AudioLines, Music2 } from 'lucide-react'
import { SPECTRUM_BINS, readSpectrum, type Track } from '../lib/player'
import { useCaptions } from '../lib/captions'

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export const trackHue = (t: Pick<Track, 'hue' | 'album' | 'artist' | 'title'>) => t.hue ?? hash(`${t.artist}|${t.album || t.title}`) % 360

/** Cover art, or a deterministic gradient when the file has none. */
export function Art({ track, size, radius }: { track: Pick<Track, 'art' | 'hue' | 'album' | 'artist' | 'title' | 'source'> | null; size: number; radius?: number }) {
  const r = radius ?? Math.max(4, Math.round(size * 0.1))
  const style = { width: size, height: size, borderRadius: r }
  if (track?.art) return <img className="m-art" src={track.art} alt="" draggable={false} style={style} />
  const hue = track ? trackHue(track) : 215
  const Glyph = track?.source === 'station' ? AudioLines : Music2
  return (
    <div
      className="m-art ph"
      style={{ ...style, background: `linear-gradient(145deg, hsl(${hue} 72% 64%), hsl(${(hue + 48) % 360} 66% 40%))` }}
      aria-hidden
    >
      <Glyph size={Math.round(size * 0.42)} strokeWidth={1.8} />
    </div>
  )
}

/** Live captions for the talk stations: the rant so far, with the line being spoken at full strength. */
export function Lyrics() {
  const lines = useCaptions((s) => s.lines)
  if (!lines.length) return null
  return (
    <div className="m-lyrics" aria-hidden>
      {lines.map((l, i) => (
        <p key={l.id} className={`${l.head ? 'head' : ''} ${i === lines.length - 1 ? 'now' : ''}`}>
          {l.text}
        </p>
      ))}
    </div>
  )
}

/** Three bouncing bars, shown next to whatever is playing. */
export function Eq({ playing }: { playing: boolean }) {
  return (
    <span className={`m-eq ${playing ? 'on' : ''}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

/** A thin draggable bar for seeking and volume. `value` is 0–1. */
export function Scrub({ value, onChange, onCommit, disabled, thumb = true, label }: { value: number; onChange?: (v: number) => void; onCommit: (v: number) => void; disabled?: boolean; thumb?: boolean; label: string }) {
  const [drag, setDrag] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  const shown = drag ?? Math.max(0, Math.min(1, value))
  return (
    <div
      ref={box}
      className={`m-scrub ${disabled ? 'off' : ''} ${drag !== null ? 'drag' : ''} ${thumb ? '' : 'nothumb'}`}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      tabIndex={disabled ? -1 : 0}
      data-nodrag
      onPointerDown={(e) => {
        if (disabled) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const v = at(e)
        setDrag(v)
        onChange?.(v)
      }}
      onPointerMove={(e) => {
        if (drag === null) return
        const v = at(e)
        setDrag(v)
        onChange?.(v)
      }}
      onPointerUp={(e) => {
        if (drag === null) return
        const v = at(e)
        setDrag(null)
        onCommit(v)
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (disabled) return
        const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0
        if (!step) return
        e.preventDefault()
        onCommit(Math.max(0, Math.min(1, value + step)))
      }}
    >
      <div className="m-scrub-track">
        <div className="m-scrub-fill" style={{ width: `${shown * 100}%` }} />
      </div>
      {thumb && <div className="m-scrub-thumb" style={{ left: `${shown * 100}%` }} />}
    </div>
  )
}

/** Frequency bars driven by the real analyser node. Idles gracefully when paused. */
export function Visualizer({ bars = 48, hue = 340, className }: { bars?: number; hue?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const buf = new Uint8Array(SPECTRUM_BINS)
    const level = new Float32Array(bars)
    let raf = 0
    let timer = 0
    let drawn = false
    let w = 0
    let h = 0
    const next = (slow: boolean) => {
      if (slow) timer = window.setTimeout(() => (raf = requestAnimationFrame(frame)), 250)
      else raf = requestAnimationFrame(frame)
    }
    const size = () => {
      const dpr = window.devicePixelRatio || 1
      w = cv.clientWidth
      h = cv.clientHeight
      cv.width = Math.max(1, Math.round(w * dpr))
      cv.height = Math.max(1, Math.round(h * dpr))
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawn = false
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(cv)

    const frame = () => {
      if (document.hidden || !w) return next(true)
      const live = readSpectrum(buf)
      let energy = 0
      for (let i = 0; i < bars; i++) {
        // A gentle curve so bass doesn't hog the left half and highs aren't invisible.
        const bin = Math.min(SPECTRUM_BINS - 1, Math.floor(((i + 0.5) / bars) ** 1.7 * SPECTRUM_BINS * 0.8))
        const target = live ? Math.min(1, (buf[bin] / 255) ** 1.25 * (1 + (i / bars) * 1.5)) : 0
        level[i] += (target - level[i]) * (target > level[i] ? 0.55 : 0.12)
        energy += level[i]
      }
      if (!live && energy < 0.02) {
        if (drawn) g.clearRect(0, 0, w, h)
        drawn = false
        return next(true)
      }
      g.clearRect(0, 0, w, h)
      drawn = true
      const gap = Math.max(2, w / bars * 0.28)
      const bw = (w - gap * (bars - 1)) / bars
      const base = h * 0.72
      const grad = g.createLinearGradient(0, 0, 0, base)
      grad.addColorStop(0, `hsl(${hue} 90% 66%)`)
      grad.addColorStop(1, `hsl(${(hue + 40) % 360} 85% 55%)`)
      for (let i = 0; i < bars; i++) {
        const quiet = level[i] < 0.03
        const bh = Math.max(3, level[i] * base)
        const x = i * (bw + gap)
        g.fillStyle = grad
        g.globalAlpha = quiet ? 0.3 : 1
        g.beginPath()
        g.roundRect(x, base - bh, bw, bh, Math.min(bw / 2, 4))
        g.fill()
        g.globalAlpha = quiet ? 0.06 : 0.18
        g.beginPath()
        g.roundRect(x, base + 3, bw, Math.min(bh * 0.55, h - base - 3), Math.min(bw / 2, 4))
        g.fill()
        g.globalAlpha = 1
      }
      next(false)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [bars, hue])
  return <canvas ref={canvas} className={`m-viz ${className ?? ''}`} />
}

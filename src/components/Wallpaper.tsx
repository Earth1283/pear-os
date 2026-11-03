import { useEffect, useRef } from 'react'
import { useOS } from '../store'
import { renderMandelbrot, DEFAULT_VIEW, kernelReady } from '../kernel'
import { GPU_MIN_SCALE, MandelbrotGL, WaveRenderer, gpuInfo, type WavePalette } from '../lib/gpu'

const LIGHT: WavePalette = {
  sky: ['#2c5fd0', '#6fb2ff'],
  bands: [
    ['#c4ecff', '#6fb4ff', '#3d7fe6'],
    ['#a9e1ff', '#3d8af0', '#1f4fc4'],
    ['#7fc6ff', '#2d6fe8', '#1a36a8'],
    ['#9a8bff', '#4b3fe0', '#24198a'],
    ['#ffb3d6', '#d65ab8', '#6a25c4'],
    ['#ffc89a', '#ff7a8a', '#c2307a'],
    ['#5b7cff', '#2338c4', '#0c1460'],
  ],
}
const DARK: WavePalette = {
  sky: ['#050a24', '#0f1d55'],
  bands: [
    ['#2f5fc0', '#14306e', '#0a1640'],
    ['#4a86e8', '#1a3f9e', '#0b1d5a'],
    ['#3d6fe0', '#162f96', '#0a1650'],
    ['#6b55e6', '#2c1c96', '#120a4a'],
    ['#d063b8', '#6e2392', '#2a0c52'],
    ['#ff8a7a', '#b03278', '#3d0d48'],
    ['#2a3dc0', '#0e176a', '#03051a'],
  ],
}
const CRESTS = [150, 300, 430, 560, 690, 810, 930]

const WAVES = [
  'M-200 150C200 60 500 260 820 160S1340 20 1800 120V1100H-200Z',
  'M-200 300C150 180 420 420 760 300S1300 120 1800 260V1100H-200Z',
  'M-200 430C200 300 520 560 860 430S1380 260 1800 390V1100H-200Z',
  'M-200 560C220 470 560 700 900 560S1420 380 1800 520V1100H-200Z',
  'M-200 690C260 600 600 820 960 690S1460 540 1800 660V1100H-200Z',
  'M-200 810C240 740 640 940 1000 820S1480 680 1800 800V1100H-200Z',
  'M-200 930C300 880 680 1040 1040 950S1500 840 1800 930V1100H-200Z',
]

function SequelWaves({ dark }: { dark: boolean }) {
  const p = dark ? DARK : LIGHT
  return (
    <svg className="wallpaper-svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="wp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} />
          <stop offset="1" stopColor={p.sky[1]} />
        </linearGradient>
        {p.bands.map(([a, b, c], i) => (
          <linearGradient key={i} id={`wp-b${i}`} gradientUnits="userSpaceOnUse" x1="0" y1={CRESTS[i] - 170} x2="0" y2={CRESTS[i] + 260}>
            <stop offset="0" stopColor={a} />
            <stop offset=".45" stopColor={b} />
            <stop offset="1" stopColor={c} />
          </linearGradient>
        ))}
        <linearGradient id="wp-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".35" stopColor="#fff" stopOpacity=".7" />
          <stop offset=".7" stopColor="#fff" stopOpacity=".2" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="wp-vignette" cx=".5" cy=".45" r=".75">
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity={dark ? 0.5 : 0.22} />
        </radialGradient>
        <filter id="wp-soft">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id="wp-shadow" x="-10%" y="-20%" width="120%" height="140%">
          <feDropShadow dx="0" dy="-14" stdDeviation="18" floodColor="#000" floodOpacity={dark ? 0.55 : 0.32} />
        </filter>
      </defs>
      <rect width="1600" height="1000" fill="url(#wp-sky)" />
      {WAVES.map((d, i) => (
        <g key={i} className={`wave wave-${i}`} filter="url(#wp-shadow)">
          <path d={d} fill={`url(#wp-b${i})`} />
          <path d={d.split('V')[0]} fill="none" stroke="url(#wp-sheen)" strokeOpacity={dark ? 0.35 : 0.8} strokeWidth="4" filter="url(#wp-soft)" />
        </g>
      ))}
      <rect width="1600" height="1000" fill="url(#wp-vignette)" />
    </svg>
  )
}

function LiveWaves({ dark, blur }: { dark: boolean; blur: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const r = useRef<WaveRenderer | null>(null)
  const motion = useOS((s) => s.liveWallpaper)
  useEffect(() => {
    const still = !motion || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const w = new WaveRenderer(ref.current!, blur ? 0.06 : 0.75, !still)
    r.current = w
    w.setPalette(dark ? DARK : LIGHT, dark)
    w.loop()
    return () => w.dispose()
  }, [blur, motion])
  useEffect(() => {
    r.current?.setPalette(dark ? DARK : LIGHT, dark)
  }, [dark])
  return <canvas ref={ref} className="wallpaper-canvas gpu" />
}

function Sequel({ dark, blur }: { dark: boolean; blur: boolean }) {
  return gpuInfo().available ? <LiveWaves dark={dark} blur={blur} /> : <SequelWaves dark={dark} />
}

function FractalWallpaper() {
  const ref = useRef<HTMLCanvasElement>(null)
  const view = useOS((s) => s.fractalWallpaper)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const v = view ?? DEFAULT_VIEW
    let gl: MandelbrotGL | null = null
    if (gpuInfo().available && v.scale > GPU_MIN_SCALE) {
      try {
        gl = new MandelbrotGL(c)
      } catch {
        gl = null
      }
    }
    if (!gl && !kernelReady()) return
    const draw = () => {
      const scale = gl ? Math.min(2, window.devicePixelRatio || 1) : Math.min(1, 1600 / window.innerWidth)
      c.width = Math.round(window.innerWidth * scale)
      c.height = Math.round(window.innerHeight * scale)
      if (gl) gl.render(v)
      else renderMandelbrot(c, v)
    }
    draw()
    let t: number
    const onResize = () => {
      clearTimeout(t)
      t = window.setTimeout(draw, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      gl?.dispose()
    }
  }, [view])
  return <canvas key={JSON.stringify(view)} ref={ref} className="wallpaper-canvas" />
}

export function Wallpaper({ blur = false }: { blur?: boolean }) {
  const wallpaper = useOS((s) => s.wallpaper)
  const theme = useOS((s) => s.theme)
  let inner: React.ReactNode
  switch (wallpaper) {
    case 'fractal':
      inner = <FractalWallpaper />
      break
    case 'orchard':
      inner = <div className="wallpaper-css orchard" />
      break
    case 'graphite':
      inner = <div className="wallpaper-css graphite" />
      break
    case 'sequel-dark':
      inner = <Sequel dark blur={blur} />
      break
    default:
      inner = <Sequel dark={theme === 'dark'} blur={blur} />
  }
  return <div className={`wallpaper${blur ? ' blurred' : ''}`}>{inner}</div>
}

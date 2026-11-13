import { useEffect, useRef, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Grid3x3, LayoutGrid, Square } from 'lucide-react'
import { os, useOS, type Win } from '../store'
import { compile } from '../lib/gpu'
import { HOME, addNode, mkdir, moveToTrash, resolve, type FileNode } from '../lib/fs'
import { blobToDataURL, encode } from '../lib/imaging'
import { shutterSound } from '../lib/shutter'
import { openPath } from './open'
import { menu } from '../lib/menu'
import { bumpDrive, drive, useBackend } from '../lib/backend'
import './PhotoBooth.css'

const LIBRARY = HOME + '/Pictures/Photo Booth Library'

interface Effect {
  name: string
  fx: number
  caption?: () => string
}

const stamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `CAM 03  ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const PAGES: Effect[][] = [
  [
    { name: 'Bulge', fx: 1 },
    { name: 'Twirl', fx: 2 },
    { name: 'Squeeze', fx: 3 },
    { name: 'Mirror', fx: 4 },
    { name: 'Normal', fx: 0 },
    { name: 'Thermal Camera', fx: 5 },
    { name: 'X-Ray', fx: 6 },
    { name: 'Pop Art', fx: 7 },
    { name: 'Comic Book', fx: 8 },
  ],
  [
    { name: 'Corporate Headshot', fx: 10 },
    { name: 'Low Battery', fx: 11 },
    { name: 'Video Call, 2020', fx: 12, caption: () => 'Your internet connection is unstable' },
    { name: 'Pear Intelligence Enhance', fx: 13, caption: () => 'Enhanced with Pear Intelligence (beta)' },
    { name: 'Normal', fx: 0 },
    { name: 'Deep Fried', fx: 14 },
    { name: 'Witness Protection', fx: 15, caption: () => 'Identity protected (probably)' },
    { name: 'Liquid Glass', fx: 16 },
    { name: 'Security Camera', fx: 17, caption: stamp },
  ],
]

const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D tex;
uniform vec2 res;
uniform vec2 vres;
uniform float t;
uniform int fx;
uniform float mirror;

vec2 asp() { return vec2(res.x / res.y, 1.0); }

vec3 cam(vec2 p) {
  float va = vres.x / vres.y, ra = res.x / res.y;
  vec2 s = ra > va ? vec2(1.0, va / ra) : vec2(ra / va, 1.0);
  p = (clamp(p, 0.0, 1.0) - 0.5) * s + 0.5;
  if (mirror > 0.5) p.x = 1.0 - p.x;
  return texture(tex, p).rgb;
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 sat(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }

vec3 blur(vec2 p, float r) {
  vec2 px = r / res;
  vec3 c = vec3(0.0);
  for (int x = -2; x <= 2; x++)
    for (int y = -2; y <= 2; y++) c += cam(p + vec2(x, y) * px);
  return c / 25.0;
}

float edge(vec2 p) {
  vec2 px = 1.5 / res;
  float tl = luma(cam(p + px * vec2(-1, 1))), tc = luma(cam(p + px * vec2(0, 1))), tr = luma(cam(p + px * vec2(1, 1)));
  float ml = luma(cam(p + px * vec2(-1, 0))), mr = luma(cam(p + px * vec2(1, 0)));
  float bl = luma(cam(p + px * vec2(-1, -1))), bc = luma(cam(p + px * vec2(0, -1))), br = luma(cam(p + px * vec2(1, -1)));
  float gx = tr + 2.0 * mr + br - tl - 2.0 * ml - bl;
  float gy = tl + 2.0 * tc + tr - bl - 2.0 * bc - br;
  return length(vec2(gx, gy));
}

vec2 warp(vec2 p, vec2 c, float R, float k) {
  vec2 d = (p - c) * asp();
  float r = length(d);
  if (r < R) d *= pow(r / R, k);
  return c + d / asp();
}

vec2 pixelate(vec2 p, float block) {
  vec2 b = block / res;
  return (floor(p / b) + 0.5) * b;
}

vec3 thermal(float l) {
  vec3 a = mix(vec3(0.05, 0.0, 0.25), vec3(0.45, 0.0, 0.7), smoothstep(0.0, 0.25, l));
  a = mix(a, vec3(0.95, 0.1, 0.25), smoothstep(0.25, 0.5, l));
  a = mix(a, vec3(1.0, 0.75, 0.0), smoothstep(0.5, 0.75, l));
  return mix(a, vec3(1.0, 1.0, 0.85), smoothstep(0.75, 1.0, l));
}

float rbox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = uv;
  vec2 a = asp();
  vec3 c;
  if (fx == 1) c = cam(warp(p, vec2(0.5), 0.5, 0.65));
  else if (fx == 2) {
    vec2 d = (p - 0.5) * a;
    float r = length(d);
    float ang = r < 0.55 ? pow(1.0 - r / 0.55, 2.0) * 4.5 : 0.0;
    d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;
    c = cam(0.5 + d / a);
  } else if (fx == 3) {
    vec2 d = (p - 0.5) * a;
    float r = length(d);
    if (r < 0.55) d *= 1.0 + 0.9 * pow(1.0 - r / 0.55, 2.0);
    c = cam(0.5 + d / a);
  } else if (fx == 4) c = cam(vec2(0.5 - abs(p.x - 0.5), p.y));
  else if (fx == 5) c = thermal(luma(blur(p, 1.5)));
  else if (fx == 6) {
    float l = 1.0 - luma(cam(p));
    c = vec3(0.55, 0.8, 1.0) * pow(l, 1.4) + vec3(0.7, 0.9, 1.0) * edge(p) * 0.8;
  } else if (fx == 7) {
    vec2 q = floor(p * 2.0);
    float l = luma(cam(fract(p * 2.0)));
    int i = int(q.x + q.y * 2.0);
    vec3 lo = i == 0 ? vec3(0.1, 0.1, 0.55) : i == 1 ? vec3(0.85, 0.05, 0.4) : i == 2 ? vec3(0.0, 0.45, 0.3) : vec3(0.95, 0.35, 0.0);
    vec3 hi = i == 0 ? vec3(1.0, 0.85, 0.1) : i == 1 ? vec3(0.3, 0.95, 0.95) : i == 2 ? vec3(1.0, 0.5, 0.75) : vec3(0.45, 0.85, 1.0);
    c = mix(lo, hi, smoothstep(0.38, 0.48, l));
  } else if (fx == 8) {
    vec3 s = floor(sat(cam(p), 1.4) * 4.0 + 0.5) / 4.0;
    vec2 g = fract(p * res / 6.0) - 0.5;
    float ht = step(length(g), 0.55 * (1.0 - luma(s)));
    c = mix(s, s * 0.6, ht * 0.5) * (1.0 - smoothstep(0.35, 0.6, edge(p)));
  } else if (fx == 10) {
    vec3 b = blur(p, 1.2);
    b = sat(b, 0.35) * vec3(0.93, 0.98, 1.06);
    b = 0.08 + b * 0.88;
    float v = length((p - 0.5) * a * vec2(0.8, 1.0));
    c = b * (1.0 - smoothstep(0.25, 0.75, v) * 0.75);
  } else if (fx == 11) {
    float flick = 0.85 + 0.15 * step(0.5, hash(vec2(floor(t * 9.0))));
    c = cam(p) * 0.28 * flick + vec3(0.06, 0.0, 0.0) + (hash(p * res + t) - 0.5) * 0.12;
  } else if (fx == 12) {
    float burst = step(0.6, hash(vec2(floor(t * 1.4), 3.1)));
    float block = mix(10.0, 46.0, burst);
    c = floor(cam(pixelate(p, block)) * 10.0) / 10.0;
  } else if (fx == 13) {
    vec3 s = cam(p);
    vec3 b = blur(p, 1.4);
    c = sat(s + (s - b) * 5.0, 2.1);
    c = floor(c * 7.0 + 0.5) / 7.0 + vec3(0.04, 0.02, 0.08);
  } else if (fx == 14) {
    vec2 q = warp(warp(p, vec2(0.41, 0.6), 0.12, 0.35), vec2(0.59, 0.6), 0.12, 0.35);
    vec3 s = sat(cam(q), 3.2);
    s = (s - 0.5) * 2.3 + 0.5 + vec3(0.12, 0.02, -0.12);
    c = floor(clamp(s, 0.0, 1.0) * 5.0 + 0.5) / 5.0 + (hash(floor(p * res / 3.0)) - 0.5) * 0.18;
  } else if (fx == 15) {
    vec2 d = (p - vec2(0.5, 0.58)) * a;
    float inside = step(length(d / vec2(0.2, 0.27)), 1.0);
    c = mix(cam(p) * 0.8, cam(pixelate(p, max(res.y / 14.0, 6.0))), inside);
  } else if (fx == 16) {
    vec2 d = (p - 0.5) * a;
    vec2 box = vec2(0.32 * a.x, 0.22);
    float sd = rbox(d, box, 0.12);
    if (sd < 0.0) {
      float depth = clamp(-sd / 0.06, 0.0, 1.0);
      vec2 n = normalize(d + 1e-5) * (1.0 - depth) * 0.06;
      vec2 q = 0.5 + (d * 0.82) / a - n / a;
      c = vec3(cam(q + vec2(0.004, 0.0)).r, cam(q).g, cam(q - vec2(0.004, 0.0)).b);
      c = c * 1.06 + 0.03 + pow(1.0 - depth, 6.0) * 0.55 * (0.6 + 0.4 * d.y / box.y);
    } else c = blur(p, 0.8) * (0.86 + 0.14 * smoothstep(0.0, 0.03, sd));
  } else if (fx == 17) {
    vec2 d = p - 0.5;
    vec2 q = 0.5 + d * (0.8 + 0.35 * dot(d, d));
    float l = luma(cam(q));
    c = vec3(0.75, 0.95, 0.8) * l * (0.85 + 0.15 * sin(p.y * res.y * 1.4));
    c += (hash(p * res + floor(t * 24.0)) - 0.5) * 0.14;
    c *= 1.0 - smoothstep(0.3, 0.8, length(d * a));
  } else c = cam(p);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

type Status = 'asking' | 'live' | 'denied' | 'nocam' | 'insecure' | 'error'

class BoothGL {
  gl: WebGL2RenderingContext
  u: ReturnType<typeof compile>
  tex: WebGLTexture
  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.u = compile(gl, FRAG)
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.uniform1i(this.u('tex'), 0)
  }
  upload(video: HTMLVideoElement) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
  }
  draw(fx: number, x: number, y: number, w: number, h: number, vw: number, vh: number, mirror: boolean, t: number) {
    const { gl, u } = this
    gl.viewport(x, y, w, h)
    gl.uniform2f(u('res'), w, h)
    gl.uniform2f(u('vres'), vw, vh)
    gl.uniform1f(u('t'), t)
    gl.uniform1i(u('fx'), fx)
    gl.uniform1f(u('mirror'), mirror ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}

function photoName(d: Date) {
  const h = d.getHours() % 12 || 12
  return `Photo on ${d.getMonth() + 1}-${d.getDate()}-${String(d.getFullYear()).slice(2)} at ${h}.${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}.jpg`
}

function burnCaption(c: HTMLCanvasElement, text: string) {
  const g = c.getContext('2d')!
  const s = Math.max(14, Math.round(c.height / 28))
  g.font = `600 ${s}px ui-monospace, Menlo, monospace`
  g.textBaseline = 'bottom'
  const w = g.measureText(text).width
  g.fillStyle = 'rgba(0,0,0,.55)'
  g.fillRect(s * 0.6, c.height - s * 2.3, w + s * 0.8, s * 1.6)
  g.fillStyle = '#fff'
  g.fillText(text, s, c.height - s)
}

export function PhotoBooth({ win }: { win: Win }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const glRef = useRef<BoothGL | null>(null)
  const pending = useRef<{ ok: (c: HTMLCanvasElement) => void; fail: (e: Error) => void }[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const alive = useRef(true)
  const [status, setStatus] = useState<Status>('asking')
  const [errorText, setErrorText] = useState('')
  const [page, setPage] = useState(0)
  const [effect, setEffect] = useState<Effect>(PAGES[0][4])
  const [grid, setGrid] = useState(false)
  const [mode, setMode] = useState<'single' | 'four'>('single')
  const [count, setCount] = useState<number | null>(null)
  const [flash, setFlash] = useState(0)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const [attempt, setAttempt] = useState(0)
  useOS((s) => s.fsVersion)
  const authed = useBackend((s) => s.present && s.authed)
  const state = useRef({ grid, page, effect, hidden: win.minimized })
  state.current = { grid, page, effect, hidden: win.minimized }

  const failCaptures = (why: string) => pending.current.splice(0).forEach((p) => p.fail(new Error(why)))
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      failCaptures('Photo Booth was closed')
    }
  }, [])

  const sleep = (ms: number) =>
    new Promise<void>((ok, fail) =>
      setTimeout(() => (alive.current ? ok() : fail(new Error('Photo Booth was closed'))), ms),
    )

  useEffect(() => {
    let dead = false
    setStatus('asking')
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('insecure')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        if (dead) return s.getTracks().forEach((t) => t.stop())
        streamRef.current = s
        s.getVideoTracks()[0]?.addEventListener('ended', () => {
          failCaptures('The camera stopped')
          setErrorText('The camera was disconnected or another app took it.')
          setStatus('error')
        })
        const v = videoRef.current!
        v.srcObject = s
        await v.play().catch(() => undefined)
        setStatus('live')
      })
      .catch((e: DOMException) => {
        if (dead) return
        setErrorText(e.message)
        setStatus(e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'denied' : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'nocam' : 'error')
      })
    return () => {
      dead = true
      stopCamera()
    }
  }, [attempt])

  useEffect(() => {
    if (status !== 'live') return
    const canvas = canvasRef.current!
    const video = videoRef.current!
    try {
      glRef.current = new BoothGL(canvas)
    } catch (e) {
      canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
      stopCamera()
      setErrorText((e as Error).message)
      setStatus('error')
      return
    }
    const r = glRef.current
    const lost = (e: Event) => {
      e.preventDefault()
      cancelAnimationFrame(raf)
      failCaptures('The GPU reset')
      stopCamera()
      setErrorText('The GPU reset its WebGL context. Try again to restart the camera.')
      setStatus('error')
    }
    canvas.addEventListener('webglcontextlost', lost)
    let raf = 0
    let caption = 0
    const t0 = performance.now()
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (video.readyState < 2 || !video.videoWidth) return
      if (state.current.hidden && !pending.current.length) return
      const dpr = Math.min(devicePixelRatio, 2)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const vw = video.videoWidth
      const vh = video.videoHeight
      const t = (performance.now() - t0) / 1000
      const { grid, page, effect } = state.current
      r.upload(video)
      if (grid) {
        r.gl.viewport(0, 0, w, h)
        r.gl.clearColor(0, 0, 0, 1)
        r.gl.clear(r.gl.COLOR_BUFFER_BIT)
        const cw = w / 3
        const ch = h / 3
        PAGES[page].forEach((e, i) => r.draw(e.fx, Math.round((i % 3) * cw), Math.round((2 - Math.floor(i / 3)) * ch), Math.round(cw) - 2, Math.round(ch) - 2, vw, vh, true, t))
      } else r.draw(effect.fx, 0, 0, w, h, vw, vh, true, t)
      if (pending.current.length) {
        const vwc = Math.min(vw, 1920)
        const vhc = Math.round((vh * vwc) / vw)
        canvas.width = vwc
        canvas.height = vhc
        r.draw(effect.fx, 0, 0, vwc, vhc, vw, vh, true, t)
        const out = document.createElement('canvas')
        out.width = vwc
        out.height = vhc
        out.getContext('2d')!.drawImage(canvas, 0, 0)
        if (effect.caption) burnCaption(out, effect.caption())
        pending.current.splice(0).forEach((p) => p.ok(out))
      }
      if (effect.caption && t - caption > 0.5) {
        caption = t
        setTick((n) => n + 1)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      cancelAnimationFrame(raf)
      r.gl.getExtension('WEBGL_lose_context')?.loseContext()
      glRef.current = null
    }
  }, [status])

  const grab = () => new Promise<HTMLCanvasElement>((ok, fail) => pending.current.push({ ok, fail }))

  const snap = async () => {
    if (!alive.current) throw new Error('Photo Booth was closed')
    setFlash((n) => n + 1)
    shutterSound()
    return grab()
  }

  const save = async (c: HTMLCanvasElement) => {
    const blob = await encode(c, 'image/jpeg', 0.9)
    const node: FileNode = { type: 'file', kind: 'image', content: await blobToDataURL(blob), size: blob.size, modified: Date.now() }
    if (!resolve(LIBRARY)) mkdir(LIBRARY)
    const name = addNode(LIBRARY, photoName(new Date()), node)
    if (!name) throw new Error('~/Pictures/Photo Booth Library is missing and couldn’t be recreated')
    os().bumpFs()
    return name
  }

  const shoot = async () => {
    if (busy || status !== 'live') return
    setBusy(true)
    setGrid(false)
    try {
      for (let n = 3; n > 0; n--) {
        setCount(n)
        await sleep(800)
      }
      setCount(null)
      if (mode === 'single') {
        await save(await snap())
      } else {
        const shots: HTMLCanvasElement[] = []
        for (let i = 0; i < 4; i++) {
          shots.push(await snap())
          if (i < 3) await sleep(700)
        }
        const w = shots[0].width
        const h = shots[0].height
        const sheet = document.createElement('canvas')
        sheet.width = w
        sheet.height = h
        const g = sheet.getContext('2d')!
        g.fillStyle = '#fff'
        g.fillRect(0, 0, w, h)
        const gap = Math.round(w / 120)
        shots.forEach((s, i) => g.drawImage(s, (i % 2) * (w / 2) + gap / 2, Math.floor(i / 2) * (h / 2) + gap / 2, w / 2 - gap, h / 2 - gap))
        await save(sheet)
      }
    } catch (e) {
      if (alive.current) os().notify({ app: 'photobooth', title: 'Photo Booth', body: `Couldn't take the photo: ${(e as Error).message}` })
    } finally {
      if (alive.current) {
        setCount(null)
        setBusy(false)
      }
    }
  }

  const lib = resolve(LIBRARY)
  const photos = lib && lib.type === 'dir' ? Object.entries(lib.children).filter((e): e is [string, FileNode] => e[1].type === 'file' && e[1].kind === 'image' && !!e[1].content) : []
  photos.sort((a, b) => a[1].modified - b[1].modified)

  const toDrive = async (name: string, node: FileNode) => {
    try {
      const blob = await (await fetch(node.content!)).blob()
      const dir = '/Pictures/Photo Booth'
      await drive.mkdir('/Pictures').catch(() => undefined)
      await drive.mkdir(dir).catch(() => undefined)
      const taken = new Set((await drive.list(dir)).map((e) => e.name))
      const dot = name.lastIndexOf('.')
      let target = name
      for (let i = 2; taken.has(target); i++) target = `${name.slice(0, dot)} ${i}${name.slice(dot)}`
      await drive.write(`${dir}/${target}`, blob)
      bumpDrive()
      os().notify({ app: 'photobooth', title: 'Saved to PearDrive', body: `"${target}" is in ${dir}. It's on a real disk now. Forever, probably.` })
    } catch (e) {
      os().notify({ app: 'photobooth', title: 'Photo Booth', body: `PearDrive said no: ${(e as Error).message}` })
    }
  }

  const blocked: Record<Exclude<Status, 'live' | 'asking'>, [string, string]> = {
    denied: ['Photo Booth can’t see you.', 'Camera access was denied. That’s fair. Allow it in your browser’s site settings, then try again.'],
    nocam: ['No camera found.', 'Plug one in, or open your laptop lid. Photo Booth will wait.'],
    insecure: ['Cameras need HTTPS.', 'Browsers only allow cameras on HTTPS pages or localhost. Pear didn’t make that rule, but would have.'],
    error: ['The camera didn’t start.', errorText || 'Something else is probably using it.'],
  }

  return (
    <div className="photobooth">
      <div className={`pb-stage ${grid ? 'grid' : ''}`}>
        <video ref={videoRef} muted playsInline className="pb-video" />
        {status === 'live' && <canvas ref={canvasRef} className="pb-canvas" />}
        {status === 'asking' && (
          <div className="pb-blocked">
            <Camera size={40} strokeWidth={1.4} />
            <b>Waiting for the camera…</b>
            <span>Your browser is asking if Photo Booth may see you.</span>
          </div>
        )}
        {status !== 'live' && status !== 'asking' && (
          <div className="pb-blocked">
            <Camera size={40} strokeWidth={1.4} />
            <b>{blocked[status][0]}</b>
            <span>{blocked[status][1]}</span>
            {status !== 'insecure' && (
              <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
                Try Again
              </button>
            )}
          </div>
        )}
        {status === 'live' && grid && (
          <div className="pb-grid">
            {PAGES[page].map((e) => (
              <button
                key={e.name}
                className={e.fx === effect.fx ? 'on' : ''}
                onClick={() => {
                  setEffect(e)
                  setGrid(false)
                }}
              >
                <span>{e.name}</span>
              </button>
            ))}
          </div>
        )}
        {status === 'live' && !grid && effect.caption && <div className="pb-caption">{effect.caption()}</div>}
        {count !== null && <div className="pb-count">{count}</div>}
        {flash > 0 && <div key={flash} className="pb-flash" />}
      </div>
      <div className="pb-bar">
        <div className="pb-modes">
          <button className={mode === 'four' ? 'on' : ''} title="Take four quick pictures" onClick={() => setMode('four')}>
            <LayoutGrid size={15} />
          </button>
          <button className={mode === 'single' ? 'on' : ''} title="Take a still picture" onClick={() => setMode('single')}>
            <Square size={15} />
          </button>
        </div>
        <div className="pb-center">
          {count !== null ? (
            <div className="pb-dots">
              {[3, 2, 1].map((n) => (
                <span key={n} className={n >= count ? 'lit' : ''}>
                  {n}
                </span>
              ))}
              <Camera size={14} />
            </div>
          ) : (
            <button className="pb-shutter" disabled={busy || status !== 'live'} onClick={shoot} aria-label="Take Photo">
              <Camera size={22} color="#fff" />
            </button>
          )}
        </div>
        <div className="pb-effects">
          {grid && (
            <>
              <button aria-label="Previous effects" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft size={14} />
              </button>
              <span className="pb-pages">
                {PAGES.map((_, i) => (
                  <i key={i} className={i === page ? 'on' : ''} />
                ))}
              </span>
              <button aria-label="More effects" disabled={page === PAGES.length - 1} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight size={14} />
              </button>
            </>
          )}
          <button className={`pb-fxbtn ${grid ? 'on' : ''}`} disabled={status !== 'live' || busy} onClick={() => setGrid((g) => !g)}>
            <Grid3x3 size={14} /> Effects
          </button>
        </div>
      </div>
      <div className="pb-strip">
        {photos.length === 0 ? (
          <span className="pb-empty">Photos you take show up here. They live until you close the tab, like most of your decisions.</span>
        ) : (
          photos.map(([name, node]) => (
            <button
              key={name}
              className="pb-thumb"
              title={name}
              onClick={() => openPath(`${LIBRARY}/${name}`)}
              onContextMenu={menu([
                { label: 'Open in Preview', run: () => openPath(`${LIBRARY}/${name}`) },
                { label: 'Save to PearDrive', disabled: !authed, run: () => toDrive(name, node) },
                'sep',
                {
                  label: 'Move to Trash',
                  run: () => {
                    moveToTrash(`${LIBRARY}/${name}`)
                    os().bumpFs()
                  },
                },
              ])}
            >
              <img src={node.content} alt={name} draggable={false} />
            </button>
          ))
        )}
      </div>
    </div>
  )
}

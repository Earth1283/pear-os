import { useEffect, useState } from 'react'
import { ArrowRight, Power } from 'lucide-react'
import { useOS, os } from '../store'
import { bootKernel } from '../kernel'
import { detect, login, useBackend } from '../lib/backend'
import { useBootCamp } from '../lib/bootcamp'
import { PearLogo } from './icons'
import { Wallpaper } from './Wallpaper'

export function chime() {
  try {
    const ctx = new AudioContext()
    const vol = os().volume
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, ctx.currentTime)
    master.gain.exponentialRampToValueAtTime(0.28 * vol + 0.0001, ctx.currentTime + 0.04)
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 3.6)
    master.connect(ctx.destination)
    for (const f of [92.5, 185, 233.08, 277.18, 369.99, 466.16]) {
      for (const detune of [-4, 4]) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = f
        o.detune.value = detune
        const lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.setValueAtTime(2400, ctx.currentTime)
        lp.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 3)
        const g = ctx.createGain()
        g.gain.value = 0.06
        o.connect(lp).connect(g).connect(master)
        o.start()
        o.stop(ctx.currentTime + 3.8)
      }
    }
  } catch {
    return
  }
}

export function PowerScreen() {
  return (
    <div className="screen power-screen">
      <button
        className="power-btn"
        onClick={() => {
          chime()
          os().setPhase('booting')
        }}
      >
        <Power size={28} />
      </button>
      <p>Press to power on your PearBook Pro</p>
      <small>Best experienced with sound on. Worst experienced with 8 GB of RAM.</small>
    </div>
  )
}

const BOOT_LINES = [
  'Loading pearnel.wasm',
  'Mounting Pear HD (8 GB, which is like 16 GB)',
  'Starting kernel_task at 400% CPU',
  'Indexing Spotlight (forever)',
  'Downloading Pear Intelligence model (0.3 B parameters)',
  'Reticulating splines',
]

export function BootScreen() {
  const [progress, setProgress] = useState(0)
  const [line, setLine] = useState(0)
  useEffect(() => {
    let done = false
    let p = 0
    Promise.allSettled([bootKernel(), detect()]).then(() => (done = true))
    const t = setInterval(() => {
      p = Math.min(done ? 100 : 92, p + Math.random() * (p > 68 && p < 80 ? 1.6 : 6.5))
      setProgress(p)
      setLine(Math.min(BOOT_LINES.length - 1, Math.floor(p / (100 / BOOT_LINES.length))))
      if (p >= 100) {
        clearInterval(t)
        setTimeout(() => os().setPhase(useBootCamp.getState().windows === 'none' ? 'login' : 'bootpicker'), 450)
      }
    }, 90)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="screen boot-screen">
      <PearLogo size={86} color="#f5f5f7" />
      <div className="boot-bar">
        <div style={{ width: `${progress}%` }} />
      </div>
      <small className="boot-line">{BOOT_LINES[line]}</small>
    </div>
  )
}

export function LoginScreen() {
  const [now, setNow] = useState(() => new Date())
  const [pw, setPw] = useState('')
  const [shake, setShake] = useState(0)
  const [hint, setHint] = useState(false)
  const panicReason = useOS((s) => s.panicReason)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const present = useBackend((s) => s.present)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (pw.length === 0) {
      setShake((s) => s + 1)
      setHint(true)
      return
    }
    if (present) {
      setBusy(true)
      try {
        await login(pw)
      } catch (e) {
        setBusy(false)
        setPw('')
        setError(e instanceof Error ? e.message : 'Incorrect password')
        setShake((s) => s + 1)
        return
      }
    }
    os().setPhase('desktop')
    if (panicReason) {
      setTimeout(() => {
        os().notify({ app: 'about', title: 'Your computer restarted because of a problem.', body: `Cause: ${panicReason}. Click Report to send a report to Pear. (It goes nowhere.)`, actions: [{ label: 'Report…' }, { label: 'Ignore' }] })
        os().set('panicReason', null)
      }, 800)
    }
  }
  return (
    <div className="screen login-screen">
      <Wallpaper blur />
      <div className="login-clock">
        <div className="login-date">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <div className="login-time">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}</div>
      </div>
      <div className="login-user">
        <div className="avatar">
          <PearLogo size={44} color="#fff" />
        </div>
        <div className="login-name">Pear User</div>
        <form
          key={shake}
          className={`login-pw ${shake ? 'shake' : ''}`}
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input type="password" autoFocus placeholder="Enter Password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button type="submit" aria-label="Log in">
            <ArrowRight size={14} />
          </button>
        </form>
        <div className="login-hint">
          {error ?? (present ? (busy ? 'Unlocking…' : 'Enter the pearosd password') : hint ? 'Hint: literally anything. Security is our top priority.' : 'Touch ID or Enter Password')}
        </div>
      </div>
      <div className="login-actions">
        <button onClick={() => os().setPhase('sleep')}>Sleep</button>
        <button
          onClick={() => {
            os().set('shutdownMode', 'restart')
            os().setPhase('shuttingdown')
          }}
        >
          Restart
        </button>
        <button
          onClick={() => {
            os().set('shutdownMode', 'off')
            os().setPhase('shuttingdown')
          }}
        >
          Shut Down
        </button>
      </div>
    </div>
  )
}

export function SleepScreen() {
  return (
    <div className="screen sleep-screen" onClick={() => os().setPhase('login')}>
      <small>zzz. Click to wake. Your Bluetooth headphones have reconnected to your phone.</small>
    </div>
  )
}

export function ShutdownScreen() {
  const mode = useOS((s) => s.shutdownMode)
  useEffect(() => {
    const t = setTimeout(() => {
      useOS.setState({ windows: [], focused: null, toasts: [] })
      os().setPhase(mode === 'off' ? 'off' : 'booting')
    }, 1600)
    return () => clearTimeout(t)
  }, [mode])
  return (
    <div className="screen shutdown-screen">
      <div className="spinner" />
    </div>
  )
}

const PANIC = [
  'You need to restart your computer. Hold down the Power button for several seconds or press the Restart button.',
  'Veuillez redémarrer votre ordinateur. Maintenez la touche de démarrage enfoncée pendant plusieurs secondes ou bien appuyez sur le bouton de réinitialisation.',
  'Sie müssen Ihren Computer neu starten. Halten Sie dazu die Einschalttaste einige Sekunden gedrückt oder drücken Sie die Neustart-Taste.',
  'コンピュータを再起動する必要があります。パワーボタンを数秒間押し続けるか、リセットボタンを押してください。',
]

export function PanicScreen() {
  const reason = useOS((s) => s.panicReason)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1500)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="screen panic-screen">
      <div className="panic-box">
        <Power size={64} strokeWidth={1.5} />
        {PANIC.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <code>panic(cpu 0 caller 0xffffff80002d1f5a): "{reason}" @pearnel.wasm:0x1337</code>
        {ready && (
          <button className="panic-restart" onClick={() => os().setPhase('booting')}>
            Restart
          </button>
        )}
      </div>
    </div>
  )
}

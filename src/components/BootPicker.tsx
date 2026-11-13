import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { os } from '../store'
import { useBootCamp, type Disk } from '../lib/bootcamp'
import { DiskIcon } from './icons'

const NAMES: Record<Disk, string> = { mac: 'Pear HD', windows: 'Windows' }
const SECONDS = 8

function WindowsDisk({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id="bpw" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f2f5" />
          <stop offset="1" stopColor="#a9a9b0" />
        </linearGradient>
      </defs>
      <rect x="10" y="30" width="80" height="42" rx="6" fill="url(#bpw)" stroke="#8e8e93" />
      <rect x="10" y="60" width="80" height="12" fill="#8e8e93" opacity=".35" />
      <circle cx="80" cy="66" r="2" fill="#30d158" />
      <g transform="translate(18 36)">
        <path d="M0 2l11-2.2v10L0 12z" fill="#f25022" />
        <path d="M13 -.3l11-2.2v10L13 9.8z" fill="#7fba00" transform="translate(0 2.5)" />
        <path d="M0 14l11-2.2v10L0 24z" fill="#00a4ef" transform="translate(0 -1)" />
        <path d="M13 11.5l11-2.2v10L13 21.5z" fill="#ffb900" transform="translate(0 1.5)" />
      </g>
    </svg>
  )
}

/** The Startup Manager. Real ones need you to hold ⌥ at the chime; this one shows up on its own. */
export function BootPicker() {
  const startup = useBootCamp((s) => s.startup)
  const version = useBootCamp((s) => s.version)
  const [sel, setSel] = useState<Disk>(startup)
  const [count, setCount] = useState(SECONDS)
  const [touched, setTouched] = useState(false)

  const go = (d: Disk) => os().setPhase(d === 'windows' ? 'windows' : 'login')

  useEffect(() => {
    if (touched) return
    if (count <= 0) return go(sel)
    const t = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(t)
    // `go` only touches the store, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, touched, sel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setTouched(true)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setSel((d) => (d === 'mac' ? 'windows' : 'mac'))
      else if (e.key === 'Enter') go(sel)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])

  return (
    <div className="screen bootpicker" onPointerDown={() => setTouched(true)}>
      <h1>Choose a Startup Disk</h1>
      <div className="bp-disks" role="listbox" aria-label="Startup disks">
        {(['mac', 'windows'] as Disk[]).map((d) => (
          <div key={d} className="bp-col">
            <button role="option" aria-selected={sel === d} className={`bp-disk ${sel === d ? 'sel' : ''}`} onClick={() => setSel(d)} onDoubleClick={() => go(d)}>
              {d === 'mac' ? <DiskIcon size={104} /> : <WindowsDisk size={104} />}
              <span>{NAMES[d]}</span>
              <small>{d === 'mac' ? 'PearOS Grove' : `Windows ${version}`}</small>
            </button>
            <button className="bp-go" aria-label={`Start up from ${NAMES[d]}`} style={{ visibility: sel === d ? 'visible' : 'hidden' }} onClick={() => go(d)}>
              <ArrowRight size={16} />
            </button>
          </div>
        ))}
      </div>
      <p className="bp-hint">
        {touched ? 'Click the arrow, or press Return.' : `Starting up from ${NAMES[sel]} in ${count}…`}
      </p>
      <small>Normally you would hold ⌥ at the chime to see this. We assumed you wouldn't.</small>
    </div>
  )
}

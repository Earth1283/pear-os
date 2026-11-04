import { useEffect, useRef, useState } from 'react'
import { useBootCamp, restartMac } from '../lib/bootcamp'
import { AppIcon } from '../components/icons'
import type { Win } from '../store'

type Step = 'intro' | 'tasks' | 'iso' | 'partition' | 'download' | 'copy' | 'ready' | 'installed' | 'removing'

const TOTAL_GB = 8
const DEFAULT_ISO = 'Win95_OSR2.iso'

const FILES = [
  { name: 'PEARDRV.CAB', kb: 1440 },
  { name: 'HFSPLUS.VXD', kb: 212 },
  { name: 'BOOTCAMP.INF', kb: 3 },
  { name: 'CLIPPY.EXE', kb: 9001 },
]

/** The modem is 56k, so the honest estimate is measured in days. */
function eta(remaining: number) {
  const s = Math.max(1, Math.round(remaining * 4.2 * 86_400))
  if (s > 86_400) return `About ${Math.round(s / 86_400)} days, ${Math.round((s % 86_400) / 3600)} hours`
  if (s > 3600) return `About ${Math.round(s / 3600)} hours`
  if (s > 90) return `About ${Math.round(s / 60)} minutes`
  return 'Less than a minute'
}

const COPY_STAGES = [
  'Partitioning Pear HD…',
  'Shrinking macOS (it will be fine)…',
  'Copying Windows installation files…',
  'Writing the boot sector…',
  'Convincing the firmware this is a good idea…',
]

function useTicker(active: boolean, ms: number, fn: () => void) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => ref.current(), ms)
    return () => clearInterval(t)
  }, [active, ms])
}

export function BootCamp({ win }: { win: Win }) {
  void win
  const installed = useBootCamp((s) => s.windows)
  const sizeGB = useBootCamp((s) => s.sizeGB)
  const [step, setStep] = useState<Step>(installed === 'none' ? 'intro' : 'installed')
  const [getDrivers, setGetDrivers] = useState(true)
  const [iso, setIso] = useState(DEFAULT_ISO)
  const fileRef = useRef<HTMLInputElement>(null)

  const [p, setP] = useState(0)
  const pv = useRef(0)
  const [note, setNote] = useState('')
  const retried = useRef(false)
  const hold = useRef(0)

  const progress = (v: number) => {
    pv.current = v
    setP(v)
  }

  const begin = (s: Step) => {
    progress(0)
    setNote('')
    retried.current = false
    hold.current = 0
    setStep(s)
  }

  // Download: smooth progress, a stall at 99%, a regression to 62%, then success.
  useTicker(step === 'download', 100, () => {
    if (hold.current > 0) {
      hold.current -= 1
      if (hold.current === 0) {
        retried.current = true
        setNote('Connection reset by peer. Retrying…')
        progress(0.62)
      }
      return
    }
    const v = pv.current
    const next = v + (v > 0.8 ? 0.004 : 0.006) + Math.random() * 0.004
    if (!retried.current && next >= 0.99) {
      hold.current = 16
      setNote('Almost there…')
      return progress(0.99)
    }
    progress(Math.min(1, next))
  })

  useTicker(step === 'copy', 100, () => progress(Math.min(1, pv.current + 0.011 + Math.random() * 0.008)))
  useTicker(step === 'removing', 100, () => progress(Math.min(1, pv.current + 0.03)))

  // What happens when a bar fills up.
  useEffect(() => {
    if (p < 1) return
    const t = setTimeout(() => {
      if (step === 'download') begin('copy')
      else if (step === 'copy') setStep('ready')
      else if (step === 'removing') {
        useBootCamp.getState().set({ windows: 'none', startup: 'mac' })
        setStep('intro')
      }
    }, 400)
    return () => clearTimeout(t)
    // `begin` only touches state setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, step])

  const windowsGB = sizeGB
  const macGB = +(TOTAL_GB - windowsGB).toFixed(1)
  const quip =
    windowsGB < 0.2
      ? 'Windows 95 needs about 50 MB. You gave it 100. It is thrilled.'
      : windowsGB < 2
        ? 'That is more space than most Windows 95 users had in total in 1995.'
        : windowsGB < 5
          ? 'macOS will have to live in a much smaller house now.'
          : 'macOS can have the broom closet.'

  const fileIdx = Math.min(FILES.length - 1, Math.floor(p * FILES.length))
  const file = FILES[fileIdx]

  let heading = ''
  let body: React.ReactNode = null
  let back: Step | null = null
  let next: { label: string; run: () => void; disabled?: boolean } | null = null

  switch (step) {
    case 'intro':
      heading = 'Introduction'
      body = (
        <>
          <p>Boot Camp Assistant helps you install Windows 95 or Windows 98 on your PearBook Pro.</p>
          <p>
            You will need a Windows 95 disk image (an ISO), about 100 MB of free space, and the ability to look your
            computer in the eye afterwards.
          </p>
          <p className="bc-dim">Back up your files first. Back up this tab, too. It is the whole computer.</p>
        </>
      )
      next = { label: 'Continue', run: () => setStep('tasks') }
      break
    case 'tasks':
      heading = 'Select Tasks'
      body = (
        <>
          <label className="bc-check disabled">
            <input type="checkbox" disabled checked={false} readOnly />
            <span>
              Create a Windows 95 or later install disk
              <small>No floppy drive found. The 1990s called; they want it back.</small>
            </span>
          </label>
          <label className="bc-check">
            <input type="checkbox" checked={getDrivers} onChange={(e) => setGetDrivers(e.target.checked)} />
            <span>
              Download the latest Windows support software from Pear
              <small>Over a 56k modem. We do not have another kind.</small>
            </span>
          </label>
          <label className="bc-check disabled">
            <input type="checkbox" checked readOnly disabled />
            <span>
              Install Windows 95 or later version
              <small>This one is not optional. You started this.</small>
            </span>
          </label>
        </>
      )
      back = 'intro'
      next = { label: 'Continue', run: () => setStep('iso') }
      break
    case 'iso':
      heading = 'ISO Image'
      body = (
        <>
          <p>Locate the Windows ISO file and choose where to install it.</p>
          <div className="bc-row">
            <span className="bc-label">ISO Image:</span>
            <div className="bc-field">
              <AppIcon app="bootcamp" size={20} />
              <span>{iso}</span>
            </div>
            <button className="bc-btn" onClick={() => fileRef.current?.click()}>
              Choose…
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) setIso(f.name)
              }}
            />
          </div>
          <div className="bc-row">
            <span className="bc-label">Destination Disk:</span>
            <div className="bc-field">
              <span>Pear HD (8 GB, which is like 16 GB)</span>
            </div>
          </div>
          <p className="bc-dim">
            {iso === DEFAULT_ISO
              ? 'Found "Win95_OSR2.iso" in Downloads. It was there the whole time.'
              : `"${iso}" will be treated as Windows 95. We do not check. Nobody checked in 1995 either.`}
          </p>
        </>
      )
      back = 'tasks'
      next = { label: 'Continue', run: () => setStep('partition') }
      break
    case 'partition':
      heading = 'Create a Partition for Windows'
      body = (
        <>
          <div className="bc-split" aria-hidden>
            <div className="bc-seg mac" style={{ flex: macGB }}>
              <b>macOS</b>
              <span>{macGB.toFixed(1)} GB</span>
            </div>
            <div className="bc-seg win" style={{ flex: windowsGB }}>
              <b>Windows</b>
              <span>{windowsGB.toFixed(1)} GB</span>
            </div>
          </div>
          <input
            className="bc-range"
            type="range"
            min={0.1}
            max={7}
            step={0.1}
            value={windowsGB}
            aria-label="Windows partition size in gigabytes"
            onChange={(e) => useBootCamp.getState().set({ sizeGB: +e.target.value })}
          />
          <div className="bc-row bc-tight">
            <button className="bc-btn" onClick={() => useBootCamp.getState().set({ sizeGB: 0.1 })}>
              Use Minimum
            </button>
            <button className="bc-btn" onClick={() => useBootCamp.getState().set({ sizeGB: TOTAL_GB / 2 })}>
              Divide Equally
            </button>
          </div>
          <p className="bc-dim">{quip}</p>
        </>
      )
      back = 'iso'
      next = { label: 'Install', run: () => begin(getDrivers ? 'download' : 'copy') }
      break
    case 'download':
      heading = 'Downloading Windows Support Software'
      body = (
        <>
          <p>
            Downloading file {fileIdx + 1} of {FILES.length}: <code>{file.name}</code>
          </p>
          <div className="bc-bar">
            <div style={{ width: `${p * 100}%` }} />
          </div>
          <div className="bc-meta">
            <span>
              {Math.round(p * file.kb * 10) / 10} of {file.kb} KB · 5.6 KB/s
            </span>
            <span>{eta(1 - p)} remaining</span>
          </div>
          {note && <p className="bc-note">{note}</p>}
        </>
      )
      back = null
      break
    case 'copy':
      heading = 'Installing Windows'
      body = (
        <>
          <p>{COPY_STAGES[Math.min(COPY_STAGES.length - 1, Math.floor(p * COPY_STAGES.length))]}</p>
          <div className="bc-bar">
            <div style={{ width: `${p * 100}%` }} />
          </div>
          <p className="bc-dim">Do not quit Boot Camp Assistant. Or do. We are a progress bar, not a cop.</p>
        </>
      )
      break
    case 'ready':
      heading = 'Almost Done'
      body = (
        <>
          <p>The Windows installation files have been copied to a {windowsGB.toFixed(1)} GB partition.</p>
          <p>Your Mac needs to restart so that Windows Setup can begin. Setup is going to ask you several questions and one of them will be about a Product Key.</p>
          <p className="bc-dim">Hint: the key is on the sticker on the CD case. You have no CD case. This will be fine.</p>
        </>
      )
      next = {
        label: 'Restart',
        run: () => {
          useBootCamp.getState().set({ windows: 'pending', startup: 'windows', welcome: true })
          restartMac()
        },
      }
      break
    case 'installed':
      heading = installed === 'pending' ? 'Windows Setup Is Pending' : 'Windows 95 Is Installed'
      body = (
        <>
          <p>
            {installed === 'pending'
              ? 'The installation files are in place. Restart in Windows to finish Setup.'
              : `Windows 95 lives on a ${windowsGB.toFixed(1)} GB partition and is, as far as anyone can tell, fine.`}
          </p>
          <p className="bc-dim">When you restart, the Startup Manager will offer a choice of disks. If you do nothing, it picks the one you chose here.</p>
          <div className="bc-row bc-tight">
            <button
              className="bc-btn primary"
              onClick={() => {
                useBootCamp.getState().set({ startup: 'windows' })
                restartMac()
              }}
            >
              Restart in Windows
            </button>
            <button className="bc-btn" onClick={() => begin('removing')}>
              Remove Windows 95…
            </button>
          </div>
        </>
      )
      break
    case 'removing':
      heading = 'Restoring Disk'
      body = (
        <>
          <p>Removing Windows 95 and restoring Pear HD to a single volume…</p>
          <div className="bc-bar">
            <div style={{ width: `${p * 100}%` }} />
          </div>
        </>
      )
      break
  }

  return (
    <div className="bc">
      <div className="bc-art">
        <AppIcon app="bootcamp" size={92} />
      </div>
      <div className="bc-main">
        <h2>{heading}</h2>
        <div className="bc-body">{body}</div>
        <div className="bc-foot">
          {step === 'download' && (
            <button className="bc-btn" onClick={() => begin('intro')}>
              Cancel
            </button>
          )}
          {back && (
            <button className="bc-btn" onClick={() => setStep(back)}>
              Go Back
            </button>
          )}
          {next && (
            <button className="bc-btn primary" onClick={next.run} disabled={next.disabled}>
              {next.label}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

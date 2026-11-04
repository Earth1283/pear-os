import { useEffect, useRef, useState } from 'react'
import { useBootCamp, restartMac, type Version } from '../lib/bootcamp'
import { AppIcon } from '../components/icons'
import type { Win } from '../store'
import { deleteMachine, downloadSupport, formatBytes, formatEta, hasSupport, isoInfo, saveIso, savedMachine, wipe, type Progress } from '../lib/v86store'

type Step = 'intro' | 'tasks' | 'iso' | 'partition' | 'download' | 'copy' | 'ready' | 'installed' | 'removing'

const TOTAL_GB = 8
const DEFAULT_ISO = 'Win95_OSR2.iso'

const FILES = [
  { name: 'PEARDRV.CAB', kb: 1440 },
  { name: 'HFSPLUS.VXD', kb: 212 },
  { name: 'BOOTCAMP.INF', kb: 3 },
  { name: 'CLIPPY.EXE', kb: 9001 },
]

/** The modem is 56k, so the honest estimate is measured in days. (Windows 95 only. 98 gets real numbers.) */
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

/** A progress bar fed by real byte counts. */
function RealBar({ p, what }: { p: Progress | null; what: string }) {
  const done = p?.doneAll ?? 0
  const total = p?.totalAll ?? 0
  const frac = total ? Math.min(1, done / total) : 0
  const remaining = p && p.speed > 0 ? (total - done) / p.speed : Infinity
  return (
    <>
      <div className="bc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label={what}>
        <div style={{ width: `${frac * 100}%` }} />
      </div>
      <div className="bc-meta">
        <span>
          {formatBytes(done)} of {total ? formatBytes(total) : '…'} · {p && p.speed > 0 ? `${formatBytes(p.speed)}/s` : 'starting…'}
        </span>
        <span>{Math.round(frac * 100)}% · {formatEta(remaining)}</span>
      </div>
    </>
  )
}

export function BootCamp({ win }: { win: Win }) {
  void win
  const installed = useBootCamp((s) => s.windows)
  const storedVersion = useBootCamp((s) => s.version)
  const sizeGB = useBootCamp((s) => s.sizeGB)
  const [step, setStep] = useState<Step>(installed === 'none' ? 'intro' : 'installed')
  const [ver, setVer] = useState<Version>(storedVersion)
  const [getDrivers, setGetDrivers] = useState(true)
  const [iso, setIso] = useState(DEFAULT_ISO)
  const [isoFile, setIsoFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const real = ver === '98'
  const name = `Windows ${ver}`

  const [p, setP] = useState(0)
  const pv = useRef(0)
  const [note, setNote] = useState('')
  const retried = useRef(false)
  const hold = useRef(0)

  // Real progress (Windows 98): bytes actually moved.
  const [live, setLive] = useState<Progress | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const [info, setInfo] = useState<{ iso?: string; isoSize?: number; savedAt?: number; used?: number } | null>(null)

  const progress = (v: number) => {
    pv.current = v
    setP(v)
  }

  const begin = (s: Step) => {
    progress(0)
    setNote('')
    setLive(null)
    setErr(null)
    retried.current = false
    hold.current = 0
    setStep(s)
  }

  const cancel = () => {
    abort.current?.abort()
    begin('intro')
  }

  // Fake modem download (Windows 95): smooth progress, a stall at 99%, a regression to 62%, then success.
  useTicker(step === 'download' && !real, 100, () => {
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

  useTicker(step === 'copy' && !real, 100, () => progress(Math.min(1, pv.current + 0.011 + Math.random() * 0.008)))
  useTicker(step === 'removing', 100, () => progress(Math.min(1, pv.current + 0.03)))

  // Real download (Windows 98): the emulator and its BIOS, streamed with byte counts.
  useEffect(() => {
    if (step !== 'download' || !real) return
    const ctl = new AbortController()
    abort.current = ctl
    downloadSupport(setLive, ctl.signal)
      .then(() => !ctl.signal.aborted && begin('copy'))
      .catch((e) => !ctl.signal.aborted && setErr(e instanceof Error ? e.message : String(e)))
    return () => ctl.abort()
    // `begin` only touches state setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, real, attempt])

  // Real copy (Windows 98): the ISO goes into this browser's storage, chunk by chunk.
  useEffect(() => {
    if (step !== 'copy' || !real || !isoFile) return
    const ctl = new AbortController()
    abort.current = ctl
    deleteMachine()
      .then(() => saveIso(isoFile, setLive, ctl.signal))
      .then(() => !ctl.signal.aborted && setStep('ready'))
      .catch((e) => !ctl.signal.aborted && setErr(e instanceof Error ? e.message : String(e)))
    return () => ctl.abort()
  }, [step, real, isoFile, attempt])

  // What happens when a fake bar fills up.
  useEffect(() => {
    if (p < 1) return
    const t = setTimeout(() => {
      if (step === 'download' && !real) begin('copy')
      else if (step === 'copy' && !real) setStep('ready')
      else if (step === 'removing') {
        useBootCamp.getState().set({ windows: 'none', startup: 'mac' })
        setStep('intro')
      }
    }, 400)
    return () => clearTimeout(t)
    // `begin` only touches state setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, step, real])

  // What the installed screen shows about a real machine.
  useEffect(() => {
    if (step !== 'installed' || storedVersion !== '98') return
    let live = true
    Promise.all([isoInfo(), savedMachine(), navigator.storage?.estimate?.()]).then(([i, m, est]) => {
      if (live) setInfo({ iso: i?.name, isoSize: i?.size, savedAt: m?.at, used: est?.usage })
    }).catch(() => undefined)
    return () => {
      live = false
    }
  }, [step, storedVersion])

  // The real 98 disk is sparse, so the partition has sensible limits.
  const minGB = real ? 0.5 : 0.1
  const maxGB = real ? 2 : 7
  const windowsGB = Math.min(maxGB, Math.max(minGB, sizeGB))
  const macGB = +(TOTAL_GB - windowsGB).toFixed(1)
  const quip = real
    ? windowsGB < 1
      ? 'Windows 98 will install into this. It will complain about it, but it will install.'
      : windowsGB < 1.6
        ? 'A comfortable amount of room. Windows 98 has never been this comfortable.'
        : 'That is more space than Windows 98 knows what to do with. It will find something.'
    : windowsGB < 0.2
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

  const errorBlock = err && (
    <>
      <p className="bc-note">{err}</p>
      <div className="bc-row bc-tight">
        <button
          className="bc-btn"
          onClick={() => {
            setErr(null)
            setLive(null)
            setAttempt((a) => a + 1)
          }}
        >
          Try Again
        </button>
      </div>
    </>
  )

  switch (step) {
    case 'intro':
      heading = 'Introduction'
      body = (
        <>
          <p>Boot Camp Assistant helps you install Windows 95 or Windows 98 on your PearBook Pro.</p>
          <p>
            Windows 95 comes in the box (it is a very faithful impression). Windows 98 is the real thing: it runs in an
            x86 emulator inside this tab, and you bring your own disk image.
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
          <label className={`bc-check ${real ? 'disabled' : ''}`}>
            <input type="checkbox" checked={real ? true : getDrivers} disabled={real} onChange={(e) => setGetDrivers(e.target.checked)} />
            <span>
              Download the latest Windows support software from Pear
              <small>{real ? 'Required for Windows 98: the emulator and its BIOS, about 2 MB. A real download with a real progress bar.' : 'Over a 56k modem. We do not have another kind.'}</small>
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
      heading = 'Windows Version and ISO Image'
      body = (
        <>
          <div className="bc-seg2" role="radiogroup" aria-label="Windows version">
            <label className={`bc-opt ${ver === '95' ? 'on' : ''}`}>
              <input type="radio" name="ver" checked={ver === '95'} onChange={() => setVer('95')} />
              <span>
                <b>Windows 95</b>
                <small>Simulated. No disk image needed.</small>
              </span>
            </label>
            <label className={`bc-opt ${ver === '98' ? 'on' : ''}`}>
              <input type="radio" name="ver" checked={ver === '98'} onChange={() => setVer('98')} />
              <span>
                <b>Windows 98</b>
                <small>Real, in an emulator. Bring your own ISO.</small>
              </span>
            </label>
          </div>
          <div className="bc-row">
            <span className="bc-label">ISO Image:</span>
            <div className="bc-field">
              <AppIcon app="bootcamp" size={20} />
              <span>{real ? (isoFile ? `${isoFile.name} (${formatBytes(isoFile.size)})` : 'No file chosen') : iso}</span>
            </div>
            <button className="bc-btn" onClick={() => fileRef.current?.click()}>
              Choose…
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={real ? '.iso,.img,.bin' : undefined}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setIso(f.name)
                setIsoFile(f)
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
            {real
              ? 'Your ISO is copied into this browser’s storage. It is never uploaded anywhere, and Pear does not ship Windows. Setup runs for real and takes a while.'
              : iso === DEFAULT_ISO
                ? 'Found "Win95_OSR2.iso" in Downloads. It was there the whole time.'
                : `"${iso}" will be treated as Windows 95. We do not check. Nobody checked in 1995 either.`}
          </p>
        </>
      )
      back = 'tasks'
      next = { label: 'Continue', run: () => setStep('partition'), disabled: real && !isoFile }
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
            min={minGB}
            max={maxGB}
            step={0.1}
            value={windowsGB}
            aria-label="Windows partition size in gigabytes"
            onChange={(e) => useBootCamp.getState().set({ sizeGB: +e.target.value })}
          />
          <div className="bc-row bc-tight">
            <button className="bc-btn" onClick={() => useBootCamp.getState().set({ sizeGB: minGB })}>
              Use Minimum
            </button>
            <button className="bc-btn" onClick={() => useBootCamp.getState().set({ sizeGB: real ? 1 : TOTAL_GB / 2 })}>
              {real ? 'Use 1 GB' : 'Divide Equally'}
            </button>
          </div>
          <p className="bc-dim">{quip}</p>
        </>
      )
      back = 'iso'
      next = {
        label: 'Install',
        run: async () => {
          useBootCamp.getState().set({ sizeGB: windowsGB })
          if (real) return begin((await hasSupport().catch(() => false)) ? 'copy' : 'download')
          begin(getDrivers ? 'download' : 'copy')
        },
      }
      break
    case 'download':
      heading = 'Downloading Windows Support Software'
      body = real ? (
        <>
          <p>
            Downloading file {(live?.index ?? 0) + 1} of {live?.count ?? 3}: <code>{live?.label ?? 'v86.wasm'}</code>
          </p>
          <RealBar p={live} what="Download progress" />
          {err ? errorBlock : <p className="bc-dim">This is the emulator and its BIOS. It is saved in this browser, so Windows 98 also starts offline.</p>}
        </>
      ) : (
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
      heading = real ? 'Copying Windows Files' : 'Installing Windows'
      body = real ? (
        <>
          <p>
            Copying <code>{isoFile?.name ?? 'the Windows disc'}</code> into this browser…
          </p>
          <RealBar p={live} what="Copy progress" />
          {err ? errorBlock : <p className="bc-dim">Do not close this tab. A disc image is a lot of bytes, and every one of them is being written by hand.</p>}
        </>
      ) : (
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
      body = real ? (
        <>
          <p>The Windows disc is in place and a {windowsGB.toFixed(1)} GB disk is ready for it.</p>
          <p>Your Mac needs to restart so that Windows Setup can begin. This is the real Windows 98 Setup, so it will ask real questions and take a real while (expect 30 to 60 minutes).</p>
          <p className="bc-dim">Progress is saved automatically, and again whenever you return to Pear OS, so you can stop and resume.</p>
        </>
      ) : (
        <>
          <p>The Windows installation files have been copied to a {windowsGB.toFixed(1)} GB partition.</p>
          <p>Your Mac needs to restart so that Windows Setup can begin. Setup is going to ask you several questions and one of them will be about a Product Key.</p>
          <p className="bc-dim">Hint: the key is on the sticker on the CD case. You have no CD case. This will be fine.</p>
        </>
      )
      next = {
        label: 'Restart',
        run: () => {
          useBootCamp.getState().set({ windows: 'pending', startup: 'windows', welcome: true, version: ver, sizeGB: windowsGB })
          restartMac()
        },
      }
      break
    case 'installed':
      heading = installed === 'pending' ? 'Windows Setup Is Pending' : `Windows ${storedVersion} Is Installed`
      body = (
        <>
          <p>
            {storedVersion === '98'
              ? installed === 'pending'
                ? 'The disc is in place. Restart in Windows to begin the real Windows 98 Setup.'
                : `A real Windows 98 machine lives in this browser, on a ${windowsGB.toFixed(1)} GB disk.`
              : installed === 'pending'
                ? 'The installation files are in place. Restart in Windows to finish Setup.'
                : `Windows 95 lives on a ${windowsGB.toFixed(1)} GB partition and is, as far as anyone can tell, fine.`}
          </p>
          {storedVersion === '98' && info && (
            <p className="bc-dim">
              {info.iso ? `Disc: ${info.iso} (${formatBytes(info.isoSize ?? 0)}). ` : ''}
              {info.savedAt ? `Last saved ${new Date(info.savedAt).toLocaleString()}. ` : 'Not saved yet. '}
              {info.used ? `This site is using ${formatBytes(info.used)} of browser storage.` : ''}
            </p>
          )}
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
            <button
              className="bc-btn"
              onClick={() => {
                setVer(storedVersion)
                // Wiping storage is the real part of "removing Windows 98".
                if (storedVersion === '98') void wipe().catch(() => undefined)
                begin('removing')
              }}
            >
              Remove Windows {storedVersion}…
            </button>
          </div>
        </>
      )
      break
    case 'removing':
      heading = 'Restoring Disk'
      body = (
        <>
          <p>Removing Windows {ver} and restoring Pear HD to a single volume…</p>
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
          {(step === 'download' || (step === 'copy' && real)) && (
            <button className="bc-btn" onClick={cancel}>
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

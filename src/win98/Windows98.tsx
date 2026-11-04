import { useCallback, useEffect, useRef, useState } from 'react'
import { os } from '../store'
import { useBootCamp } from '../lib/bootcamp'
import { formatBytes } from '../lib/v86store'
import { startMachine, type Machine } from './machine'
import './win98.css'

const AUTOSAVE_MS = 5 * 60_000
const CTRL_ALT_DEL = [0x1d, 0x38, 0xe0, 0x53, 0xe0, 0xd3, 0xb8, 0x9d]

/**
 * The real Windows 98: an x86 emulator (v86) running the user's own ISO, with a disk image that lives in
 * IndexedDB. This is the one place in Pear OS where the parody steps aside.
 */
export function Windows98() {
  const screen = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const machine = useRef<Machine | null>(null)
  const lastSave = useRef(0)
  const [status, setStatus] = useState('Starting…')
  const [error, setError] = useState<string | null>(null)
  const [booted, setBooted] = useState(false)
  const [resumed, setResumed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [canForce, setCanForce] = useState(false)
  const [dims, setDims] = useState<[number, number]>([640, 480])

  const fit = useCallback(() => {
    const m = machine.current
    const box = stage.current
    if (!m || !box) return
    const [w, h] = dims
    const s0 = Math.min(box.clientWidth / w, box.clientHeight / h)
    // Whole-number scaling stays crisp; below 2x it is the best we can do.
    const s = s0 >= 2 ? Math.floor(s0) : Math.max(0.5, s0)
    m.emulator.screen_set_scale(s, s)
  }, [dims])

  // Boot (or resume) the machine.
  useEffect(() => {
    const ctl = new AbortController()
    const el = screen.current
    if (!el) return
    const diskBytes = Math.round(useBootCamp.getState().sizeGB * 1024 ** 3)
    startMachine(el, diskBytes, setStatus, ctl.signal)
      .then((m) => {
        if (ctl.signal.aborted) return m.destroy()
        machine.current = m
        setResumed(m.resumed)
        setBooted(true)
        m.emulator.add_listener('screen-set-size', (size: number[]) => size[0] && size[1] && setDims([size[0], size[1]]))
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      ctl.abort()
      machine.current?.destroy()
      machine.current = null
    }
  }, [])

  useEffect(() => {
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit, booted])

  const save = useCallback(async () => {
    const m = machine.current
    if (!m) return
    setBusy(true)
    setNote('Saving…')
    try {
      const bytes = await m.save()
      lastSave.current = Date.now()
      // The first save is what makes this a machine that can be resumed.
      if (useBootCamp.getState().windows === 'pending') useBootCamp.getState().set({ windows: 'installed' })
      setNote(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${formatBytes(bytes)})`)
      setCanForce(false)
      return true
    } catch (e) {
      setNote(`Could not save: ${e instanceof Error ? e.message : String(e)}`)
      setCanForce(true)
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  // Autosave, and a warning before the tab closes on unsaved progress.
  useEffect(() => {
    if (!booted) return
    lastSave.current = Date.now()
    const t = setInterval(() => void save(), AUTOSAVE_MS)
    const warn = (e: BeforeUnloadEvent) => {
      if (Date.now() - lastSave.current > 60_000) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      clearInterval(t)
      window.removeEventListener('beforeunload', warn)
    }
  }, [booted, save])

  const leave = useCallback(
    async (force = false) => {
      if (!force && booted && !(await save())) return
      machine.current?.destroy()
      machine.current = null
      useBootCamp.getState().set({ startup: 'mac' })
      os().setPhase('booting')
    },
    [booted, save],
  )

  return (
    <div className="w98">
      <header className="w98-bar">
        <b>Windows 98</b>
        <span className="w98-sub">
          {error ? 'Could not start' : !booted ? status : resumed ? 'Resumed your saved machine' : 'Booting from the Windows disc'}
        </span>
        <span className="w98-note" role="status">{note}</span>
        <div className="w98-btns">
          <button disabled={!booted} onClick={() => machine.current?.emulator.keyboard_send_scancodes(CTRL_ALT_DEL)}>Ctrl+Alt+Del</button>
          <button disabled={!booted || busy} onClick={() => void save()}>Save</button>
          <button className="go" disabled={busy} onClick={() => void leave()}>
            Return to Pear OS
          </button>
          {canForce && <button onClick={() => void leave(true)}>Leave without saving</button>}
        </div>
      </header>
      <div className="w98-stage" ref={stage} onClick={() => booted && machine.current?.emulator.lock_mouse()}>
        {/* v86 needs exactly this shape: a text-mode div and a canvas inside the container. */}
        <div ref={screen} className="w98-screen" style={{ visibility: booted ? 'visible' : 'hidden' }}>
          <div className="w98-text" />
          <canvas />
        </div>
        {!booted && (
          <div className="w98-load">
            {error ? (
              <>
                <p className="err">{error}</p>
                <button onClick={() => void leave(true)}>Return to Pear OS</button>
              </>
            ) : (
              <>
                <div className="spinner" />
                <p>{status}</p>
              </>
            )}
          </div>
        )}
        {booted && <p className="w98-hint">Click the screen to capture the mouse. Esc lets go. Setup is real, so it is slow, and it is saved automatically.</p>}
      </div>
    </div>
  )
}

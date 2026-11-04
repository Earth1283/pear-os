import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { useW95 } from './store'

/* ------------------------------------------------------------------ text-mode phase */

function ScanDisk({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<'ask' | 'scan' | 'done'>('ask')
  const [pct, setPct] = useState(0)
  const finish = useRef(onDone)
  finish.current = onDone

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stage === 'ask' && e.key === 'Enter') setStage('scan')
      else if (stage === 'done') finish.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage])

  useEffect(() => {
    if (stage !== 'scan') return
    const t = setInterval(() => setPct((p) => Math.min(100, p + 2 + Math.random() * 5)), 110)
    return () => clearInterval(t)
  }, [stage])
  useEffect(() => {
    if (stage === 'scan' && pct >= 100) setStage('done')
  }, [stage, pct])

  const blocks = Math.round((pct / 100) * 48)
  return (
    <div className="w95-text" onPointerDown={() => (stage === 'ask' ? setStage('scan') : stage === 'done' ? finish.current() : undefined)}>
      <div className="w95-text-head">Windows 95 Setup</div>
      <div className="w95-text-body">
        {stage === 'ask' && (
          <>
            <p>Setup is now going to perform a routine check on your system.</p>
            <p>To continue, press ENTER (or click, if you have worked out how the mouse works).</p>
            <p>To quit Setup, press F3. You cannot quit Setup.</p>
          </>
        )}
        {stage !== 'ask' && (
          <>
            <p>Please wait while Setup checks your computer's hardware, software, and ambitions.</p>
            <p>Checking drive C: (Pear HD)</p>
            <p className="w95-text-bar">[{'█'.repeat(blocks)}{'░'.repeat(48 - blocks)}] {Math.floor(pct)}%</p>
          </>
        )}
        {stage === 'done' && (
          <>
            <p>ScanDisk found 1 error and fixed it: the file system was called APFS. It is now called FAT.</p>
            <p>Press any key to continue.</p>
          </>
        )}
      </div>
      <div className="w95-text-foot">ENTER=Continue F3=Exit</div>
    </div>
  )
}

/* ------------------------------------------------------------------ wizard */

const EULA = `END-USER LICENSE AGREEMENT FOR WINDOWS 95

IMPORTANT - READ CAREFULLY: This End-User License Agreement ("EULA") is a legal agreement between you and Redmond Corp.

1. GRANT OF LICENSE. You may install one copy of Windows 95 on one computer. You may not install it on a computer you like.

2. RESTRICTIONS. You may not reverse engineer, decompile or disassemble Windows 95. You will not need to. It will do this to itself.

3. NO WARRANTY. Windows 95 is provided "as is". It is not provided as "working".

4. LIMITATION OF LIABILITY. Under no circumstances shall Redmond Corp. be liable for any lost data, lost time, lost sleep, lost friendships, or the Blue Screen.

5. TERMINATION. This license terminates automatically when you open the second Minesweeper window.

By clicking "I accept", you agree that you have read this agreement, which you have not.`

const SLIDES = [
  ['Windows 95 is easy to use.', 'Nobody has ever said that during Setup.'],
  ['Plug and Play.', 'Your hardware will be detected. Your hardware will not be understood.'],
  ['Long file names.', 'Resume (final) (final2) (really final).doc is now supported.'],
  ['Multitasking.', 'Do two things at once, slowly.'],
  ['Wait, there is more.', 'There is not more. This is the end of the slides.'],
]

type Step = 'welcome' | 'license' | 'key' | 'name' | 'copy' | 'restart'

function Wizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [agree, setAgree] = useState(false)
  const [key, setKey] = useState('')
  const [bad, setBad] = useState(false)
  const [name, setName] = useState('PEARBOOK')
  const [pct, setPct] = useState(0)
  const [count, setCount] = useState(6)
  const [nag, setNag] = useState(false)
  const finish = useRef(onDone)
  finish.current = onDone
  const setComputer = useW95.getState().set

  useEffect(() => {
    if (step !== 'copy') return
    const t = setInterval(() => setPct((p) => Math.min(100, p + 1.2 + Math.random() * 2.6)), 120)
    return () => clearInterval(t)
  }, [step])
  useEffect(() => {
    if (step === 'copy' && pct >= 100) {
      const t = setTimeout(() => setStep('restart'), 600)
      return () => clearTimeout(t)
    }
  }, [step, pct])
  useEffect(() => {
    if (step !== 'restart') return
    if (count <= 0) return finish.current()
    const t = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [step, count])

  const remaining = Math.max(1, Math.round((100 - pct) * 0.35))
  const slide = SLIDES[Math.min(SLIDES.length - 1, Math.floor((pct / 100) * SLIDES.length))]
  const next = () => {
    if (step === 'welcome') setStep('license')
    else if (step === 'license') setStep('key')
    else if (step === 'key') {
      if (/^\d{3}-\d{7}$/.test(key.trim())) setStep('name')
      else setBad(true)
    } else if (step === 'name') {
      setComputer('computer', name.trim().toUpperCase() || 'PEARBOOK')
      setStep('copy')
    }
  }
  const order: Step[] = ['welcome', 'license', 'key', 'name']
  const back = () => setStep(order[Math.max(0, order.indexOf(step) - 1)])
  const canNext = step === 'welcome' || (step === 'license' && agree) || step === 'key' || step === 'name'

  return (
    <div className="w95-setup-bg">
      <div className="w95-setup-title">Windows 95 Setup</div>
      <div className="w95-win w95-wizard on" role="dialog" aria-label="Windows 95 Setup Wizard">
        <div className="w95-title">
          <Icon name="flag" size={16} />
          <span>Windows 95 Setup</span>
        </div>
        <div className="w95-wizard-body">
          <div className="w95-wizard-art">
            <Icon name="computer" size={64} />
            <Icon name="flag" size={48} />
          </div>
          <div className="w95-wizard-main">
            {step === 'welcome' && (
              <>
                <h3>Welcome to the Windows 95 Setup Wizard</h3>
                <p>Setup will now guide you through installing Windows 95 on this computer. This will take about 30 minutes, in 1995. In 2026 it takes about a minute and a half.</p>
                <p>It is strongly recommended that you exit all Windows programs before running Setup. You have no Windows programs. This is easy.</p>
                <p>Click Next to continue.</p>
              </>
            )}
            {step === 'license' && (
              <>
                <h3>Software License Agreement</h3>
                <textarea className="w95-eula sunken" readOnly value={EULA} />
                <label className="w95-check">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I accept the agreement and have not read it
                </label>
              </>
            )}
            {step === 'key' && (
              <>
                <h3>Product Identification</h3>
                <p>Enter the 10-digit Product Key from your Certificate of Authenticity or the sticker on the back of your CD case.</p>
                <label className="w95-keyrow">
                  Product Key:
                  <input
                    className={`w95-input sunken ${bad ? 'bad' : ''}`}
                    value={key}
                    placeholder="000-0000000"
                    maxLength={11}
                    onChange={(e) => {
                      setKey(e.target.value)
                      setBad(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        next()
                      }
                    }}
                    autoFocus
                  />
                </label>
                {bad ? <p className="w95-bad">The Product Key you entered is not valid. Check it and try again. (Hint: 111-1111111 has worked since 1995.)</p> : <p className="w95-dim">Format: three digits, a dash, seven digits.</p>}
              </>
            )}
            {step === 'name' && (
              <>
                <h3>Computer Name</h3>
                <p>Windows uses the computer name to identify your computer on the network. You are not on a network.</p>
                <label className="w95-keyrow">
                  Computer name:
                  <input className="w95-input sunken" value={name} maxLength={15} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        next()
                      }
                    }} autoFocus />
                </label>
                <label className="w95-keyrow">
                  Workgroup:
                  <input className="w95-input sunken" defaultValue="WORKGROUP" />
                </label>
              </>
            )}
            {step === 'copy' && (
              <>
                <h3>Copying Windows 95 files to your computer</h3>
                <div className="w95-prog sunken"><i style={{ width: `${pct}%` }} /></div>
                <p className="w95-dim">Time remaining: about {remaining} {remaining === 1 ? 'minute' : 'minutes'} (this is a lie, it is seconds)</p>
                <div className="w95-slide">
                  <b>{slide[0]}</b>
                  <span>{slide[1]}</span>
                </div>
              </>
            )}
            {step === 'restart' && (
              <>
                <h3>Setup is restarting your computer</h3>
                <p>Windows Setup has finished the first part. Your computer will now restart to complete the installation.</p>
                <p>Restarting in {count}…</p>
                <p className="w95-dim">Please do not touch anything. Please do not look at it either.</p>
              </>
            )}
          </div>
        </div>
        {nag && step !== 'restart' && <p className="w95-bad nag">Setup cannot be cancelled. You pressed the button that says Windows. There is no going back. There is only Next.</p>}
        <div className="w95-row end wizard-foot">
          {step === 'restart' ? (
            <button className="w95-btn def" onClick={onDone}>Restart Now</button>
          ) : (
            <>
              <button className="w95-btn" disabled={step === 'welcome' || step === 'copy'} onClick={back}>&lt; Back</button>
              <button className="w95-btn def" disabled={!canNext} onClick={next}>Next &gt;</button>
              <button className="w95-btn" disabled={step === 'copy'} onClick={() => setNag(true)}>Cancel</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function Setup({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'scan' | 'wizard'>('scan')
  return phase === 'scan' ? <ScanDisk onDone={() => setPhase('wizard')} /> : <Wizard onDone={onDone} />
}

/* ------------------------------------------------------------------ first run */

const ITEMS = ['Control Panel', 'Programs on the Start menu', 'Windows Help', 'MS-DOS program settings', 'Time zone', 'Pear Silicon (unsupported)', 'System configuration']

export function FirstRun({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (n >= ITEMS.length) {
      const t = setTimeout(() => done.current(), 800)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setN((v) => v + 1), 650)
    return () => clearTimeout(t)
  }, [n])
  return (
    <div className="w95-setup-bg firstrun">
      <div className="w95-win w95-wizard on firstrun-box">
        <div className="w95-title"><Icon name="flag" size={16} /><span>Windows 95</span></div>
        <div className="w95-wizard-body col">
          <h3>Getting ready to run Windows for the first time</h3>
          <p>Windows is now setting up the following items:</p>
          <ul className="w95-steps">
            {ITEMS.map((it, i) => (
              <li key={it} className={i < n ? 'done' : ''}>
                <span>{i < n ? '✓' : ''}</span>
                {it}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

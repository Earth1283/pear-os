import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, FolderOpen, Link, Monitor, Radio, Send, ShieldCheck, Trash2, Unplug, X } from 'lucide-react'
import { AirPear, type AirTransfer } from '../lib/airpear'
import { formatBytes, useBackend } from '../lib/backend'
import { os, useOS, type Win } from '../store'
import { validateFiles } from '../lib/airpearProtocol'
import './AirPear.css'

type View = 'nearby' | 'transfers' | 'pair'
const active = (t: AirTransfer) => ['connecting', 'waiting', 'offered', 'transferring'].includes(t.status)
const statusText = (t: AirTransfer) => ({ connecting: 'Connecting…', waiting: 'Waiting for acceptance…', offered: 'Would like to send you files', transferring: t.direction === 'send' ? 'Sending…' : 'Receiving…', complete: t.direction === 'send' ? 'Delivered' : 'Received', declined: 'Declined', cancelled: 'Cancelled', failed: 'Transfer interrupted' })[t.status]

export function AirPearApp({ win }: { win: Win }) {
  const server = useBackend((s) => s.present && s.authed)
  // The keyed session also releases transfers when logging into a different backend.
  return <AirPearSession key={String(server)} server={server} win={win} />
}

function AirPearSession({ server, win }: { server: boolean; win: Win }) {
  const [controller] = useState(() => new AirPear(server, (name, count) => os().notify({ app: 'airpear', title: 'AirPear', body: `${name} would like to send you ${count === 1 ? 'a file' : `${count} files`}. Open AirPear to accept.`, actions: [{ label: 'Open AirPear', run: () => os().openApp('airpear') }] })))
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [view, setView] = useState<View>('nearby')
  const [name, setName] = useState(snapshot.name)
  const [files, setFiles] = useState<globalThis.File[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [drop, setDrop] = useState(false)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { controller.start(); return () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); controller.dispose() } }, [controller])
  useEffect(() => {
    if (Array.isArray(win.props.files) && win.props.files.every((f) => f instanceof globalThis.File)) {
      stage(win.props.files as globalThis.File[]); setView('nearby')
      // Release the window manager's reference after consuming shared files.
      useOS.setState((s) => ({ windows: s.windows.map((w) => w.id === win.id ? { ...w, props: { ...w.props, files: undefined } } : w) }))
    }
  }, [win.props.files])

  const stage = (chosen: globalThis.File[]) => {
    try { validateFiles(chosen.map((f) => ({ name: f.name, size: f.size, type: f.type }))); setFiles(chosen); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not select these files.') }
  }
  const send = (peer: string, chosen = files) => {
    if (!chosen.length) { setSelected(peer); picker.current?.click(); return }
    void controller.send(peer, chosen)
    setView('transfers')
  }
  const receiveDrop = (e: DragEvent, peer?: string) => {
    e.preventDefault(); e.stopPropagation(); setDrop(false)
    const chosen = Array.from(e.dataTransfer.files)
    if (!chosen.length) return
    stage(chosen)
    if (peer) send(peer, chosen)
  }
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Select the code below and copy it with your keyboard.')
      await navigator.clipboard.writeText(snapshot.pair.code)
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1800)
    } catch { setError('Select the code below and copy it with your keyboard.') }
  }
  const pending = snapshot.transfers.filter((t) => t.status === 'offered').length
  const shownTransfers = view === 'transfers' ? snapshot.transfers : snapshot.transfers.filter((t) => t.status === 'offered')
  const peer = snapshot.peers.find((p) => p.id === selected)
  const available = snapshot.peers.filter((p) => p.status !== 'failed')
  const total = files.reduce((n, f) => n + f.size, 0)

  return (
    <div className="airpear">
      <aside className="sidebar ap-sidebar" data-drag>
        <div className="sidebar-spacer" />
        <div className="sb-group"><div className="sb-head">AirPear</div>
          <button className={`sb-item ${view === 'nearby' ? 'active' : ''}`} onClick={() => setView('nearby')}><Radio size={15} /><span>Nearby</span></button>
          <button className={`sb-item ${view === 'transfers' ? 'active' : ''}`} onClick={() => setView('transfers')}><ArrowDownToLine size={15} /><span>Transfers</span>{pending > 0 && <b className="ap-count">{pending}</b>}</button>
          <button className={`sb-item ${view === 'pair' ? 'active' : ''}`} onClick={() => setView('pair')}><Link size={15} /><span>Pair a Device</span></button>
        </div>
        <div className="ap-identity" data-nodrag>
          <label htmlFor={`ap-name-${win.id}`}>Discoverable as</label>
          <input id={`ap-name-${win.id}`} maxLength={48} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { controller.rename(name); setName(controller.getSnapshot().name) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          <span>{snapshot.discovery === 'server' ? 'Devices on this PearOS server' : snapshot.discovery === 'connecting' ? 'Connecting to discovery…' : 'Other tabs on this site'}</span>
        </div>
        <div className="ap-sidebar-note"><ShieldCheck size={15} /><span>Files travel directly.<br />Your pears stay your pears.</span></div>
      </aside>
      <section className="ap-main">
        <header className="toolbar" data-drag><Radio size={17} /><div className="toolbar-title">{view === 'nearby' ? 'AirPear' : view === 'transfers' ? 'Transfers' : 'Pair a Device'}</div><span className="ap-toolbar-note">Pear to Pear</span></header>
        <div className="ap-scroll">
          {(error || snapshot.error) && <div className="ap-error" role="alert"><span>{error || snapshot.error}</span><button aria-label="Dismiss error" onClick={() => { setError(null); controller.clearError() }}><X size={14} /></button></div>}
          {view === 'nearby' && <>
            <div className="ap-intro"><h2>A little less cloud.</h2><p>Send files straight to another PearOS. No upload queue. No subscription.</p></div>
            <div className={`ap-drop ${drop ? 'over' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrop(true) } }} onDragLeave={() => setDrop(false)} onDrop={(e) => receiveDrop(e)}>
              <ArrowUpFromLine size={25} strokeWidth={1.5} />
              <div><strong>{files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} ready to send` : 'Drop files here'}</strong><span>{files.length ? `${formatBytes(total)} · Choose a device below` : 'Or choose files from your computer'}</span></div>
              <button className="btn" onClick={() => picker.current?.click()}>{files.length ? 'Change Files…' : 'Choose Files…'}</button>
            </div>
            {files.length > 0 && <div className="ap-files"><span title={files.map((f) => f.name).join(', ')}>{files.map((f) => f.name).join(', ')}</span><button aria-label="Clear selected files" onClick={() => setFiles([])}><X size={13} /></button></div>}
            <div className="ap-section-title"><h3>Nearby devices</h3><span>{available.length} found</span></div>
            {available.length ? <div className="ap-peers">{available.map((p) => <div key={p.id} className={`ap-peer ${selected === p.id ? 'selected' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={(e) => receiveDrop(e, p.id)}>
              <button className="ap-peer-pick" aria-label={`Select ${p.name}`} aria-pressed={selected === p.id} onClick={() => setSelected(p.id)}><span className="ap-device"><Monitor size={31} strokeWidth={1.3} /></span><strong>{p.name}</strong><span>{p.status === 'connected' ? p.route === 'local' ? 'Local network' : 'Connected directly' : p.status === 'connecting' ? 'Connecting…' : p.local ? 'You, but in another tab' : 'Ready to receive'}</span></button>
              {p.status === 'connected' && <button className="ap-disconnect" title={`Disconnect ${p.name}`} aria-label={`Disconnect ${p.name}`} onClick={() => controller.disconnect(p.id)}><Unplug size={13} /></button>}
            </div>)}</div> : <div className="ap-no-peers"><Radio size={36} strokeWidth={1.1} /><strong>No other pears yet.</strong><p>{server ? 'Open AirPear on another device signed into this PearOS server.' : 'Open AirPear in another tab on this site, or pair another device.'}</p><button className="btn" onClick={() => setView('pair')}>Pair a Device…</button></div>}
            {peer && <div className="ap-send"><span>To: <strong>{peer.name}</strong></span><button className="btn primary" onClick={() => send(peer.id)}><Send size={13} />{files.length ? 'Send Files' : 'Choose Files…'}</button></div>}
            <p className="ap-footnote">On the same reachable network, files can travel over your LAN. Keep AirPear open on both devices. Up to 32 files and 256 MiB per transfer.</p>
          </>}
          {view === 'pair' && <div className="ap-pair">
            <div className="ap-intro"><h2>Meet outside the cloud.</h2><p>Pair another device, even on the static site. Exchange an invitation and a reply using your own messaging app.</p></div>
            <div className="ap-pair-section"><h3>Start on this device</h3><p>Create an invitation and send its code to the other device. Codes expire after 10 minutes.</p><button className="btn" disabled={snapshot.pair.busy} onClick={() => void controller.createInvitation()}><Link size={13} />{snapshot.pair.busy ? 'Preparing connection…' : 'Create Invitation'}</button></div>
            {snapshot.pair.code && <div className="ap-pair-section ap-code"><div className="ap-section-title"><h3>{snapshot.pair.kind === 'offer' ? 'Send this invitation' : 'Send this reply'}</h3><button className="btn small" onClick={() => void copy()}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy Code'}</button></div><textarea aria-label="Your pairing code" readOnly value={snapshot.pair.code} onFocus={(e) => e.currentTarget.select()} /><p>{snapshot.pair.kind === 'offer' ? 'The other device pastes this below, then sends you its reply. Paste that reply below to connect.' : 'Send this reply back to the device that invited you. It pastes your reply below to finish pairing.'}</p></div>}
            <div className="ap-pair-section"><h3>Have an invitation or reply?</h3><label htmlFor={`ap-pair-${win.id}`}>Paste the entire code from the other device.</label><textarea id={`ap-pair-${win.id}`} aria-label="Code from the other device" placeholder="AIRPEAR1.…" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn primary" disabled={!code.trim() || snapshot.pair.busy} onClick={() => { void controller.usePairCode(code); setCode('') }}>Use Code</button></div>
            {available.some((p) => p.status === 'connected') && <div className="ap-paired"><Check size={16} /><span>Device connected.</span><button className="btn" onClick={() => setView('nearby')}>Choose Files…</button></div>}
            <p className="ap-footnote">Some networks block direct connections. If pairing fails, try the same Wi-Fi. No file relay is used.</p>
          </div>}
          {shownTransfers.length > 0 && <div className="ap-transfers">{view !== 'transfers' && <h3>Incoming files</h3>}{[...shownTransfers].reverse().map((t) => <article className="ap-transfer" key={t.id}>
            <div className="ap-transfer-top"><span className="ap-file-icon">{t.direction === 'send' ? <ArrowUpFromLine size={19} /> : <ArrowDownToLine size={19} />}</span><div><strong>{t.files.length === 1 ? t.files[0].name : `${t.files.length} files`}</strong><span>{t.direction === 'send' ? 'To' : 'From'} {t.peerName} · {formatBytes(t.total)}</span></div>{active(t) ? <button className="ap-icon-button" aria-label={`Cancel transfer of ${t.files[0].name}`} onClick={() => controller.cancel(t.id)}><X size={15} /></button> : <button className="ap-icon-button" aria-label={`Remove transfer of ${t.files[0].name}`} onClick={() => controller.remove(t.id)}><Trash2 size={14} /></button>}</div>
            <div className="ap-transfer-status"><span>{statusText(t)}</span>{t.status === 'transferring' && <span>{Math.round(t.total ? t.bytes / t.total * 100 : 0)}%</span>}{t.status === 'complete' && <Check size={14} />}</div>
            {t.status === 'transferring' && <progress aria-label={`Transfer progress for ${t.files[0].name}`} max={Math.max(1, t.total)} value={t.bytes} />}
            {t.error && <p className="ap-transfer-error">{t.error}</p>}
            {t.status === 'offered' && <div className="ap-actions"><button className="btn" onClick={() => controller.cancel(t.id)}>Decline</button><button className="btn primary" onClick={() => { controller.accept(t.id); setView('transfers') }}>Accept</button></div>}
            {t.downloads && <div className="ap-downloads">{t.downloads.map((f, i) => <a className="btn" key={i} href={f.url} download={f.name}><ArrowDownToLine size={13} />Save {f.name}</a>)}</div>}
          </article>)}</div>}
          {view === 'transfers' && snapshot.transfers.length === 0 && <div className="ap-no-peers"><FolderOpen size={40} strokeWidth={1.1} /><strong>No transfers yet.</strong><p>Send something to someone. Or to yourself. We don’t judge.</p><button className="btn" onClick={() => setView('nearby')}>Find a Device</button></div>}
          {view === 'transfers' && snapshot.transfers.some((t) => t.downloads?.length) && <p className="ap-footnote">Save received files before closing AirPear. Remove old transfers to release memory.</p>}
        </div>
        <input ref={picker} type="file" multiple hidden aria-label="Choose files to send" onChange={(e) => { const chosen = Array.from(e.target.files ?? []); if (chosen.length) stage(chosen); e.target.value = '' }} />
      </section>
    </div>
  )
}

import { BUFFER_LOW, CHUNK_BYTES, MAX_BYTES, MAX_CONTROL, cleanName, decodePairCode, encodePairCode, newId, validId, validateFiles, waitForBuffer, type FileMeta } from './airpearProtocol'

export type TransferStatus = 'connecting' | 'waiting' | 'offered' | 'transferring' | 'complete' | 'declined' | 'cancelled' | 'failed'
export interface AirPeer { id: string; name: string; local: boolean; server: boolean; seen: number; status: 'nearby' | 'connecting' | 'connected' | 'failed'; route?: 'local' | 'direct' }
export interface AirTransfer { id: string; peerId: string; peerName: string; direction: 'send' | 'receive'; files: FileMeta[]; total: number; bytes: number; status: TransferStatus; error?: string; downloads?: { name: string; url: string }[] }
export interface AirSnapshot { id: string; name: string; peers: AirPeer[]; transfers: AirTransfer[]; discovery: 'tabs' | 'connecting' | 'server'; error: string | null; pair: { busy: boolean; code: string; kind: 'offer' | 'answer' | null } }
interface Signal { kind: 'request' | 'description' | 'candidate'; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
interface Link {
  peer: AirPeer; pc: RTCPeerConnection; dc: RTCDataChannel | null; manual: boolean; offering: boolean; closed: boolean
  candidates: RTCIceCandidateInit[]; chain: Promise<void>; ready: Promise<void>; resolve(): void; reject(error: Error): void
  timer: ReturnType<typeof setTimeout> | null; disconnectTimer: ReturnType<typeof setTimeout> | null; incoming: string | null; outgoing: string | null
}
interface TransferRuntime { view: AirTransfer; link: Link; files: File[]; blobs: Blob[]; chunks: ArrayBuffer[]; index: number; fileBytes: number; readingFile: boolean; abort: AbortController; timer: ReturnType<typeof setTimeout> | null }
const ACTIVE = new Set<TransferStatus>(['connecting', 'waiting', 'offered', 'transferring'])
const message = (error: unknown) => error instanceof Error ? error.message : 'AirPear could not finish that operation.'

export class AirPear {
  readonly id = newId()
  private name: string
  private peers = new Map<string, AirPeer>()
  private links = new Map<string, Link>()
  private transfers = new Map<string, TransferRuntime>()
  private bus: BroadcastChannel | null = null
  private socket: WebSocket | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private publishTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private discovery: AirSnapshot['discovery'] = 'tabs'
  private error: string | null = null
  private pair: AirSnapshot['pair'] = { busy: false, code: '', kind: null }
  private invitation: { token: string; link: Link; created: number } | null = null
  private listeners = new Set<() => void>()
  private snapshot: AirSnapshot

  constructor(private server: boolean, private offered?: (peer: string, files: number) => void) {
    try { this.name = cleanName(localStorage.getItem('pearos.airpear.name') ?? `PearBook ${this.id.slice(-4).toUpperCase()}`) }
    catch { this.name = `PearBook ${this.id.slice(-4).toUpperCase()}` }
    this.snapshot = this.makeSnapshot()
  }
  getSnapshot = () => this.snapshot
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private makeSnapshot(): AirSnapshot { return { id: this.id, name: this.name, peers: [...this.peers.values()].map((p) => ({ ...p })), transfers: [...this.transfers.values()].map((t) => ({ ...t.view })), discovery: this.discovery, error: this.error, pair: { ...this.pair } } }
  private publish(progress = false) {
    if (!this.running) return
    if (progress) { if (!this.publishTimer) this.publishTimer = setTimeout(() => { this.publishTimer = null; this.publish() }, 100); return }
    if (this.publishTimer) { clearTimeout(this.publishTimer); this.publishTimer = null }
    this.snapshot = this.makeSnapshot()
    this.listeners.forEach((fn) => fn())
  }
  clearError() { this.error = null; this.publish() }
  private report(error: unknown) { this.error = message(error); this.publish() }

  start() {
    this.running = true
    if (typeof RTCPeerConnection === 'undefined') { this.report(new Error('This browser cannot use WebRTC. Try a current browser over HTTPS or localhost.')); return }
    if (typeof BroadcastChannel !== 'undefined') {
      this.bus = new BroadcastChannel('pearos.airpear.v1')
      this.bus.onmessage = (e) => {
        const packet = e.data
        if (!packet || !validId(packet.from) || packet.from === this.id) return
        if (packet.type === 'presence' && typeof packet.name === 'string') {
          const fresh = !this.peers.has(packet.from)
          this.remember(packet.from, packet.name, true)
          if (fresh) this.presence()
        } else if (packet.type === 'bye') {
          const peer = this.peers.get(packet.from)
          if (peer) { peer.local = false; this.prune(peer); this.publish() }
        } else if (packet.type === 'signal' && packet.to === this.id) {
          void this.receiveSignal(packet.from, packet.signal).catch((error) => this.failPeer(packet.from, error))
        }
      }
      this.presence()
    }
    if (this.server) this.openSocket()
    this.heartbeat = setInterval(() => {
      this.presence()
      let changed = false
      for (const peer of this.peers.values()) if (peer.local && Date.now() - peer.seen > 20_000) { peer.local = false; this.prune(peer); changed = true }
      if (changed) this.publish()
    }, 5_000)
    this.publish()
  }
  private presence() { this.bus?.postMessage({ type: 'presence', from: this.id, name: this.name }) }
  rename(name: string) {
    if (cleanName(name) === this.name) return
    this.name = cleanName(name)
    try { localStorage.setItem('pearos.airpear.name', this.name) } catch { /* Session-only name. */ }
    this.presence()
    for (const link of this.links.values()) if (link.dc?.readyState === 'open') this.control(link, { type: 'hello', name: this.name, version: 1 })
    if (this.server) { const socket = this.socket; this.socket = null; socket?.close(); this.openSocket() }
    this.publish()
  }
  private remember(id: string, name: string, local = false, server = false) {
    if (id === this.id || !validId(id)) return
    const peer = this.peers.get(id)
    if (peer) { peer.name = cleanName(name); if (local) { peer.local = true; peer.seen = Date.now() }; if (server) peer.server = true }
    else if (this.peers.size < 64) this.peers.set(id, { id, name: cleanName(name), local, server, seen: Date.now(), status: 'nearby' })
    this.publish()
  }
  private prune(peer: AirPeer) { if (!peer.local && !peer.server && !this.links.has(peer.id)) this.peers.delete(peer.id) }
  private openSocket() {
    if (!this.running || this.socket) return
    this.discovery = 'connecting'
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/airpear?id=${this.id}&name=${encodeURIComponent(this.name)}`)
    this.socket = socket
    socket.onopen = () => { if (this.socket === socket) { this.discovery = 'server'; this.publish() } }
    socket.onmessage = (e) => {
      if (this.socket !== socket) return
      try {
        const packet = JSON.parse(e.data)
        if (packet.type === 'peers' && Array.isArray(packet.peers)) {
          for (const peer of this.peers.values()) peer.server = false
          for (const peer of packet.peers.slice(0, 64)) if (validId(peer.id) && typeof peer.name === 'string') this.remember(peer.id, peer.name, false, true)
          for (const peer of this.peers.values()) this.prune(peer)
          this.publish()
        } else if (packet.type === 'signal' && validId(packet.from)) void this.receiveSignal(packet.from, packet.signal).catch((error) => this.failPeer(packet.from, error))
      } catch { /* An invalid signaling frame carries no file data. */ }
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.discovery = 'tabs'
      for (const peer of this.peers.values()) { peer.server = false; this.prune(peer) }
      this.publish()
      if (this.running) this.retry = setTimeout(() => { this.retry = null; this.openSocket() }, 5_000)
    }
    socket.onerror = () => socket.close()
    this.publish()
  }
  private signal(link: Link, signal: Signal) {
    if (link.manual || link.closed) return
    if (link.peer.local && this.bus) this.bus.postMessage({ type: 'signal', from: this.id, to: link.peer.id, signal })
    else if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'signal', to: link.peer.id, signal }))
    else throw new Error('That device is no longer discoverable. Open AirPear on both devices and try again.')
  }
  private makeLink(peer: AirPeer, manual = false): Link {
    if (!this.running) throw new Error('AirPear is closed.')
    if (this.links.size >= 4) throw new Error('AirPear can connect to four devices at a time. Disconnect one first.')
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    let resolve!: () => void, reject!: (error: Error) => void
    const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    void ready.catch(() => {})
    const link: Link = { peer, pc, dc: null, manual, offering: false, closed: false, candidates: [], chain: Promise.resolve(), ready, resolve, reject, timer: null, disconnectTimer: null, incoming: null, outgoing: null }
    peer.status = 'connecting'
    this.peers.set(peer.id, peer)
    this.links.set(peer.id, link)
    this.armConnection(link, manual ? 10 * 60_000 : 30_000)
    pc.onicecandidate = (e) => { if (e.candidate && !manual && !link.closed) { try { this.signal(link, { kind: 'candidate', candidate: e.candidate.toJSON() }) } catch (error) { this.failLink(link, error) } } }
    pc.ondatachannel = (e) => { if (!link.dc && e.channel.label === 'airpear-v1') this.attach(link, e.channel); else e.channel.close() }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.failLink(link, new Error('A direct connection could not be established. Try the same Wi-Fi network or pair again.'))
      else if (pc.connectionState === 'disconnected') {
        if (!link.disconnectTimer) link.disconnectTimer = setTimeout(() => this.failLink(link, new Error('The other device disconnected.')), 10_000)
      } else if (pc.connectionState === 'connected' && link.disconnectTimer) { clearTimeout(link.disconnectTimer); link.disconnectTimer = null }
    }
    this.publish()
    return link
  }
  private armConnection(link: Link, delay: number) {
    if (link.timer) clearTimeout(link.timer)
    link.timer = setTimeout(() => this.failLink(link, new Error('Connection timed out. Keep AirPear open on both devices and try the same Wi-Fi.')), delay)
  }
  private ensureLink(id: string): Link {
    const old = this.links.get(id)
    if (old && !old.closed) return old
    const peer = this.peers.get(id)
    if (!peer) throw new Error('That device is no longer nearby.')
    const link = this.makeLink(peer)
    if (this.id < id) void this.offer(link).catch((error) => this.failLink(link, error))
    else this.signal(link, { kind: 'request' })
    return link
  }
  private async offer(link: Link) {
    if (link.offering || link.closed) return
    link.offering = true
    this.attach(link, link.pc.createDataChannel('airpear-v1', { ordered: true }))
    await link.pc.setLocalDescription(await link.pc.createOffer())
    this.signal(link, { kind: 'description', description: link.pc.localDescription!.toJSON() })
  }
  private async receiveSignal(id: string, raw: unknown) {
    if (!raw || typeof raw !== 'object' || !this.running) return
    const signal = raw as Signal
    let link = this.links.get(id)
    if (!link) {
      if (!this.peers.has(id)) return
      if (signal.kind === 'request') { this.ensureLink(id); return }
      if (signal.kind !== 'description' || signal.description?.type !== 'offer') return
      link = this.makeLink(this.peers.get(id)!)
    }
    if (link.manual || link.closed) return
    const current = link
    current.chain = current.chain.then(async () => {
      if (current.closed) return
      if (signal.kind === 'description' && signal.description && ['offer', 'answer'].includes(signal.description.type) && (signal.description.sdp?.length ?? 0) <= 60_000) {
        await current.pc.setRemoteDescription(signal.description)
        for (const candidate of current.candidates.splice(0)) await current.pc.addIceCandidate(candidate)
        if (signal.description.type === 'offer') {
          await current.pc.setLocalDescription(await current.pc.createAnswer())
          this.signal(current, { kind: 'description', description: current.pc.localDescription!.toJSON() })
        }
      } else if (signal.kind === 'candidate' && signal.candidate && (signal.candidate.candidate?.length ?? 0) <= 2048) {
        if (current.pc.remoteDescription) await current.pc.addIceCandidate(signal.candidate)
        else if (current.candidates.length < 64) current.candidates.push(signal.candidate)
      }
    }).catch((error) => this.failLink(current, error))
    await current.chain
  }
  private attach(link: Link, dc: RTCDataChannel) {
    link.dc = dc
    dc.binaryType = 'arraybuffer'
    dc.bufferedAmountLowThreshold = BUFFER_LOW
    dc.onopen = () => {
      if (link.closed || !this.running) return
      if (link.timer) { clearTimeout(link.timer); link.timer = null }
      link.peer.status = 'connected'
      this.control(link, { type: 'hello', version: 1, name: this.name })
      link.resolve()
      if (link.manual) { this.pair = { busy: false, code: '', kind: null }; this.invitation = null }
      void this.inspectRoute(link)
      this.publish()
    }
    dc.onmessage = (e) => { try { this.receiveData(link, e.data) } catch (error) { this.failLink(link, error) } }
    dc.onclose = () => this.failLink(link, new Error('The other device closed AirPear.'))
    dc.onerror = () => this.failLink(link, new Error('The file connection was interrupted.'))
  }
  private async inspectRoute(link: Link) {
    try {
      const stats = await link.pc.getStats()
      let pair: RTCStats | undefined
      stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId) })
      if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s })
      if (pair) {
        const p = pair as RTCStats & { localCandidateId: string; remoteCandidateId: string }
        link.peer.route = stats.get(p.localCandidateId)?.candidateType === 'host' && stats.get(p.remoteCandidateId)?.candidateType === 'host' ? 'local' : 'direct'
        this.publish()
      }
    } catch { /* Route inspection is cosmetic and runs only once per connection. */ }
  }
  private control(link: Link, data: object) {
    const text = JSON.stringify(data)
    if (text.length > MAX_CONTROL) throw new Error('AirPear control message is too large.')
    if (link.dc?.readyState !== 'open') throw new Error('The connection is not open.')
    link.dc.send(text)
  }
  private runtime(link: Link, files: FileMeta[], direction: 'send' | 'receive', id = newId()): TransferRuntime {
    if (this.transfers.size >= 32) throw new Error('Clear an old transfer before starting another.')
    const view: AirTransfer = { id, peerId: link.peer.id, peerName: link.peer.name, files, direction, total: files.reduce((n, f) => n + f.size, 0), bytes: 0, status: direction === 'send' ? 'connecting' : 'offered' }
    const transfer: TransferRuntime = { view, link, files: [], blobs: [], chunks: [], index: 0, fileBytes: 0, readingFile: false, abort: new AbortController(), timer: null }
    this.transfers.set(id, transfer)
    return transfer
  }
  private armTransfer(t: TransferRuntime, delay = 60_000) {
    if (t.timer) clearTimeout(t.timer)
    t.timer = setTimeout(() => this.stopTransfer(t, 'failed', 'The transfer timed out. Please try again.'), delay)
  }
  async send(id: string, files: File[]) {
    try {
      const metadata = validateFiles(files.map((f) => ({ name: f.name, size: f.size, type: f.type })))
      const link = this.ensureLink(id)
      if (link.outgoing) throw new Error('Wait for the current send to this device, or cancel it first.')
      const transfer = this.runtime(link, metadata, 'send')
      transfer.files = files
      link.outgoing = transfer.view.id
      this.publish()
      try {
        await link.ready
        if (transfer.abort.signal.aborted) return
        transfer.view.status = 'waiting'
        this.control(link, { type: 'offer', id: transfer.view.id, files: metadata })
        this.armTransfer(transfer, 120_000)
        this.publish()
      } catch (error) { this.stopTransfer(transfer, 'failed', message(error)) }
    } catch (error) { this.report(error) }
  }
  accept(id: string) {
    const t = this.transfers.get(id)
    if (!t || t.view.direction !== 'receive' || t.view.status !== 'offered') return
    const used = [...this.transfers.values()].filter((r) => r.view.direction === 'receive' && ['transferring', 'complete'].includes(r.view.status)).reduce((n, r) => n + r.view.total, 0)
    if (used + t.view.total > MAX_BYTES) { this.stopTransfer(t, 'declined', 'Remove a received transfer to free memory, then ask the sender to try again.'); return }
    if (t.link.incoming) { this.stopTransfer(t, 'declined', 'Another file is arriving from this device. Try again when it finishes.'); return }
    t.view.status = 'transferring'
    t.link.incoming = id
    try { this.control(t.link, { type: 'accept', id }); this.armTransfer(t); this.publish() }
    catch (error) { this.stopTransfer(t, 'failed', message(error)) }
  }
  cancel(id: string) { const t = this.transfers.get(id); if (t && ACTIVE.has(t.view.status)) this.stopTransfer(t, t.view.status === 'offered' ? 'declined' : 'cancelled') }
  remove(id: string) {
    const t = this.transfers.get(id)
    if (!t) return
    if (ACTIVE.has(t.view.status)) this.cancel(id)
    for (const f of t.view.downloads ?? []) URL.revokeObjectURL(f.url)
    this.transfers.delete(id)
    this.publish()
  }
  private stopTransfer(t: TransferRuntime, status: TransferStatus, error?: string, send = true) {
    if (!ACTIVE.has(t.view.status)) return
    t.abort.abort()
    if (t.timer) { clearTimeout(t.timer); t.timer = null }
    t.files = []; t.blobs = []; t.chunks = []
    t.view.status = status
    t.view.error = error
    if (t.link.incoming === t.view.id) t.link.incoming = null
    if (t.link.outgoing === t.view.id) t.link.outgoing = null
    if (send && t.link.dc?.readyState === 'open') {
      try { this.control(t.link, { type: status === 'declined' ? 'decline' : 'cancel', id: t.view.id }) } catch { /* The peer may already be gone. */ }
    }
    this.publish()
  }
  private receiveData(link: Link, data: unknown) {
    if (data instanceof ArrayBuffer) {
      const t = link.incoming ? this.transfers.get(link.incoming) : undefined
      // A recipient can cancel while old chunks are still in flight. Drain those chunks.
      if (!t || t.view.status !== 'transferring') return
      const meta = t.view.files[t.index]
      if (!t.readingFile || !meta || data.byteLength > CHUNK_BYTES || t.fileBytes + data.byteLength > meta.size) throw new Error('The sender sent more data than agreed.')
      t.chunks.push(data); t.fileBytes += data.byteLength; t.view.bytes += data.byteLength
      this.armTransfer(t)
      this.publish(true)
      return
    }
    if (typeof data !== 'string' || data.length > MAX_CONTROL) throw new Error('Invalid AirPear message.')
    const packet = JSON.parse(data)
    if (packet.type === 'hello' && packet.version === 1 && typeof packet.name === 'string') { link.peer.name = cleanName(packet.name); this.publish(); return }
    if (!validId(packet.id)) throw new Error('Invalid transfer identifier.')
    if (packet.type === 'offer') {
      if (this.transfers.has(packet.id)) return
      const files = validateFiles(packet.files)
      if (link.incoming || [...this.transfers.values()].some((t) => t.link === link && t.view.direction === 'receive' && t.view.status === 'offered') || this.transfers.size >= 32) { this.control(link, { type: 'decline', id: packet.id }); return }
      const transfer = this.runtime(link, files, 'receive', packet.id)
      this.armTransfer(transfer, 120_000)
      this.offered?.(link.peer.name, files.length)
      this.publish()
      return
    }
    const t = this.transfers.get(packet.id)
    if (!t || t.link !== link || !ACTIVE.has(t.view.status)) return
    if (packet.type === 'cancel' || packet.type === 'decline') { this.stopTransfer(t, packet.type === 'cancel' ? 'cancelled' : 'declined', undefined, false); return }
    if (packet.type === 'accept' && t.view.direction === 'send' && t.view.status === 'waiting') {
      t.view.status = 'transferring'
      this.armTransfer(t)
      this.publish()
      void this.pump(t).catch((error) => this.stopTransfer(t, 'failed', message(error)))
    } else if (packet.type === 'file' && t.view.direction === 'receive' && t.view.status === 'transferring') {
      if (link.incoming !== t.view.id || t.readingFile || packet.index !== t.index || t.index >= t.view.files.length) throw new Error('Files arrived out of order.')
      t.readingFile = true; t.fileBytes = 0; t.chunks = []
      this.armTransfer(t)
    } else if (packet.type === 'file-end' && t.view.direction === 'receive' && t.view.status === 'transferring') {
      const meta = t.view.files[t.index]
      if (!t.readingFile || packet.index !== t.index || !meta || t.fileBytes !== meta.size) throw new Error('A file was incomplete. Nothing was saved.')
      t.blobs.push(new Blob(t.chunks, { type: meta.type }))
      t.chunks = []; t.index++; t.readingFile = false
      this.armTransfer(t)
    } else if (packet.type === 'end' && t.view.direction === 'receive' && t.view.status === 'transferring') {
      if (t.readingFile || t.index !== t.view.files.length || t.view.bytes !== t.view.total) throw new Error('The transfer was incomplete. Nothing was saved.')
      t.view.downloads = t.blobs.map((blob, i) => ({ name: t.view.files[i].name, url: URL.createObjectURL(blob) }))
      t.blobs = []; t.view.status = 'complete'; link.incoming = null
      if (t.timer) { clearTimeout(t.timer); t.timer = null }
      this.control(link, { type: 'complete', id: t.view.id })
      this.publish()
    } else if (packet.type === 'complete' && t.view.direction === 'send' && t.view.status === 'transferring') {
      if (t.view.bytes !== t.view.total) throw new Error('The peer acknowledged an incomplete transfer.')
      t.view.status = 'complete'; t.files = []; link.outgoing = null
      if (t.timer) { clearTimeout(t.timer); t.timer = null }
      this.publish()
    }
  }
  private async pump(t: TransferRuntime) {
    const { link, abort } = t
    const dc = link.dc!
    const chunkSize = Math.min(CHUNK_BYTES, link.pc.sctp?.maxMessageSize || CHUNK_BYTES)
    for (let index = 0; index < t.files.length; index++) {
      if (abort.signal.aborted) return
      const file = t.files[index]
      this.control(link, { type: 'file', id: t.view.id, index })
      for (let offset = 0; offset < file.size; offset += 256 * 1024) {
        const block = await file.slice(offset, Math.min(offset + 256 * 1024, file.size)).arrayBuffer()
        for (let start = 0; start < block.byteLength; start += chunkSize) {
          await waitForBuffer(dc, abort.signal)
          if (abort.signal.aborted) return
          const chunk = block.slice(start, Math.min(start + chunkSize, block.byteLength))
          dc.send(chunk)
          t.view.bytes += chunk.byteLength
          this.armTransfer(t)
          this.publish(true)
        }
      }
      if (abort.signal.aborted) return
      this.control(link, { type: 'file-end', id: t.view.id, index })
    }
    if (abort.signal.aborted) return
    this.control(link, { type: 'end', id: t.view.id })
    this.armTransfer(t)
  }
  private failPeer(id: string, error: unknown) { const link = this.links.get(id); if (link) this.failLink(link, error); else this.report(error) }
  private failLink(link: Link, error: unknown) {
    if (link.closed) return
    if (link.manual && link.peer.status === 'connecting') {
      this.error = message(error)
      this.pair = { busy: false, code: '', kind: null }
    }
    link.closed = true
    link.reject(new Error(message(error)))
    if (link.timer) clearTimeout(link.timer)
    if (link.disconnectTimer) clearTimeout(link.disconnectTimer)
    link.pc.onicecandidate = null; link.pc.onconnectionstatechange = null; link.pc.ondatachannel = null
    if (link.dc) { link.dc.onopen = null; link.dc.onclose = null; link.dc.onerror = null; link.dc.onmessage = null; link.dc.close() }
    link.pc.close()
    this.links.delete(link.peer.id)
    link.peer.status = 'failed'
    for (const t of this.transfers.values()) if (t.link === link) this.stopTransfer(t, 'failed', message(error), false)
    if (this.invitation?.link === link) this.invitation = null
    this.prune(link.peer)
    this.publish()
  }
  disconnect(id: string) { const link = this.links.get(id); if (link) this.failLink(link, new Error('Disconnected.')) }

  private async gather(link: Link) {
    if (link.pc.iceGatheringState === 'complete') return
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        if (link.pc.iceGatheringState === 'complete') { cleanup(); resolve() }
        else if (link.pc.connectionState === 'closed') { cleanup(); reject(new Error('Pairing was cancelled.')) }
      }
      // Host candidates remain usable on a LAN even if the STUN server is offline.
      const timer = setTimeout(() => { cleanup(); link.pc.localDescription?.sdp.includes('a=candidate:') ? resolve() : reject(new Error('Could not gather connection details. Try again.')) }, 6_000)
      const cleanup = () => { clearTimeout(timer); link.pc.removeEventListener('icegatheringstatechange', done); link.pc.removeEventListener('connectionstatechange', done) }
      link.pc.addEventListener('icegatheringstatechange', done)
      link.pc.addEventListener('connectionstatechange', done)
      done()
    })
  }
  async createInvitation() {
    try {
      if (this.pair.busy) return
      if (this.invitation) this.failLink(this.invitation.link, new Error('A new invitation was created.'))
      this.pair = { busy: true, code: '', kind: 'offer' }; this.error = null; this.publish()
      const token = newId()
      const peer: AirPeer = { id: token, name: 'Invited device', local: false, server: false, seen: Date.now(), status: 'connecting' }
      const link = this.makeLink(peer, true)
      this.invitation = { token, link, created: Date.now() }
      this.attach(link, link.pc.createDataChannel('airpear-v1', { ordered: true }))
      await link.pc.setLocalDescription(await link.pc.createOffer())
      await this.gather(link)
      if (!this.running || link.closed) return
      this.pair = { busy: false, kind: 'offer', code: encodePairCode({ v: 1, token, from: this.id, name: this.name, type: 'offer', sdp: link.pc.localDescription!.sdp, created: this.invitation!.created }) }
      this.publish()
    } catch (error) { if (this.invitation) this.failLink(this.invitation.link, error); this.pair.busy = false; this.report(error) }
  }
  async usePairCode(text: string) {
    let created: Link | undefined
    try {
      if (this.pair.busy) return
      const code = decodePairCode(text)
      if (code.from === this.id) throw new Error('Paste the code from the other device, not your own.')
      this.error = null
      if (code.type === 'answer') {
        const invitation = this.invitation
        if (!invitation || invitation.token !== code.token) throw new Error('This reply belongs to a different invitation. Create a new invitation.')
        const link = invitation.link
        if (this.links.has(code.from)) throw new Error('That device is already paired.')
        this.links.delete(link.peer.id); this.peers.delete(link.peer.id)
        link.peer.id = code.from; link.peer.name = cleanName(code.name)
        this.links.set(code.from, link); this.peers.set(code.from, link.peer)
        await link.pc.setRemoteDescription({ type: 'answer', sdp: code.sdp })
        this.armConnection(link, 30_000)
        this.pair = { busy: false, code: '', kind: null }
      } else {
        if (this.links.has(code.from)) throw new Error('That device is already paired. Disconnect it before pairing again.')
        this.pair = { busy: true, code: '', kind: 'answer' }; this.publish()
        const peer: AirPeer = { id: code.from, name: cleanName(code.name), local: false, server: false, seen: Date.now(), status: 'connecting' }
        const link = this.makeLink(peer, true)
        created = link
        await link.pc.setRemoteDescription({ type: 'offer', sdp: code.sdp })
        await link.pc.setLocalDescription(await link.pc.createAnswer())
        await this.gather(link)
        if (!this.running || link.closed) return
        this.pair = { busy: false, kind: 'answer', code: encodePairCode({ v: 1, token: code.token, from: this.id, name: this.name, type: 'answer', sdp: link.pc.localDescription!.sdp, created: Date.now() }) }
      }
      this.publish()
    } catch (error) { if (created) this.failLink(created, error); this.pair.busy = false; this.report(error) }
  }
  dispose() {
    this.running = false
    this.bus?.postMessage({ type: 'bye', from: this.id }); this.bus?.close(); this.bus = null
    this.socket?.close(); this.socket = null
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.retry) clearTimeout(this.retry)
    if (this.publishTimer) clearTimeout(this.publishTimer)
    for (const link of [...this.links.values()]) this.failLink(link, new Error('AirPear was closed.'))
    for (const t of this.transfers.values()) { if (t.timer) clearTimeout(t.timer); t.abort.abort(); for (const f of t.view.downloads ?? []) URL.revokeObjectURL(f.url) }
    this.transfers.clear(); this.peers.clear(); this.listeners.clear()
  }
}

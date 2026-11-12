// Protocol limits are shared by the UI and receiver. No file data enters signaling.
export const MAX_BYTES = 256 * 1024 * 1024
export const MAX_FILES = 32
export const CHUNK_BYTES = 16 * 1024
export const BUFFER_HIGH = 1024 * 1024
export const BUFFER_LOW = 256 * 1024
export const MAX_CONTROL = 16 * 1024
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{16,64}$/i.test(id)
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
export const cleanName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 48) || 'PearBook'
export const safeFilename = (name: string) => name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || 'untitled'

export interface FileMeta { name: string; size: number; type: string }
export function validateFiles(value: unknown): FileMeta[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) throw new Error('Choose between 1 and 32 files.')
  let total = 0
  const files = value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid file information.')
    const file = raw as Record<string, unknown>
    if (typeof file.name !== 'string' || file.name.length > 180 || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.type !== 'string' || file.type.length > 100) throw new Error('Invalid file information.')
    total += file.size
    if (total > MAX_BYTES) throw new Error('Each transfer can contain up to 256 MiB. Choose fewer or smaller files.')
    return { name: safeFilename(file.name), size: file.size, type: file.type }
  })
  return files
}

export interface PairCode { v: 1; token: string; from: string; name: string; type: 'offer' | 'answer'; sdp: string; created: number }
export function encodePairCode(code: PairCode): string {
  const bytes = new TextEncoder().encode(JSON.stringify(code))
  return 'AIRPEAR1.' + btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function decodePairCode(text: string): PairCode {
  try {
    const code = text.trim()
    if (!code.startsWith('AIRPEAR1.') || code.length > 100_000) throw new Error()
    const bytes = Uint8Array.from(atob(code.slice(9).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const value = JSON.parse(new TextDecoder().decode(bytes))
    if (value.v !== 1 || !validId(value.token) || !validId(value.from) || typeof value.name !== 'string' || value.name.length > 48 || !['offer', 'answer'].includes(value.type) || typeof value.sdp !== 'string' || value.sdp.length > 60_000 || !value.sdp.startsWith('v=0') || !Number.isFinite(value.created)) throw new Error()
    if (Date.now() - value.created > 10 * 60_000 || value.created - Date.now() > 60_000) throw new Error('This pairing code has expired. Create a new invitation.')
    return value as PairCode
  } catch (error) {
    if (error instanceof Error && error.message.includes('expired')) throw error
    throw new Error('That is not an AirPear pairing code. Copy the entire code and try again.')
  }
}

/** Event-driven backpressure: about 1 MiB is queued, with no polling loop. */
export function waitForBuffer(channel: RTCDataChannel, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Transfer cancelled.'))
  if (channel.readyState !== 'open') return Promise.reject(new Error('The connection closed.'))
  if (channel.bufferedAmount <= BUFFER_HIGH) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer)
      channel.removeEventListener('bufferedamountlow', low)
      channel.removeEventListener('close', closed)
      channel.removeEventListener('error', closed)
      signal.removeEventListener('abort', cancelled)
      error ? reject(error) : resolve()
    }
    const low = () => { if (channel.bufferedAmount <= BUFFER_LOW) finish() }
    const closed = () => finish(new Error('The connection closed.'))
    const cancelled = () => finish(new Error('Transfer cancelled.'))
    const timer = setTimeout(() => finish(new Error('The transfer stalled. Try again.')), 30_000)
    channel.addEventListener('bufferedamountlow', low)
    channel.addEventListener('close', closed)
    channel.addEventListener('error', closed)
    signal.addEventListener('abort', cancelled, { once: true })
    if (signal.aborted) cancelled()
    else if (channel.readyState !== 'open') closed()
    else low()
  })
}

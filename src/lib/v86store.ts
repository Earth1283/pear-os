import wasmUrl from 'v86/build/v86.wasm?url'

/**
 * Everything the real Windows 98 machine needs lives in IndexedDB, so it survives reloads and works offline:
 *  - the emulator support files (v86.wasm and two BIOS images), downloaded by Boot Camp
 *  - the user's own Windows ISO, copied in 8 MB chunks so the progress bar can be honest
 *  - the saved machine state (RAM, CPU, and every disk block the guest has written)
 * Nothing here ever leaves the browser.
 */

const DB_NAME = 'pearos-v86'
const STORE = 'blobs'
const CHUNK = 8 * 1024 * 1024

let dbp: Promise<IDBDatabase> | null = null
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is unavailable'))
  })
  return dbp
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const r = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(r.result)
    t.onerror = () => reject(t.error ?? new Error('IndexedDB write failed'))
    t.onabort = () => reject(t.error ?? new Error('IndexedDB write aborted (is the disk full?)'))
  })
}

export const put = (key: string, value: Blob | ArrayBuffer | object) => run('readwrite', (s) => s.put(value, key))
export const get = <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key))
export const del = (key: string) => run('readwrite', (s) => s.delete(key))
const keys = () => run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())

/* ------------------------------------------------------------------ support files */

export interface SupportFile {
  name: string
  url: string
  /** Used for the bar when the server does not send Content-Length. */
  approx: number
}

export const SUPPORT: SupportFile[] = [
  { name: 'v86.wasm', url: wasmUrl, approx: 2_007_347 },
  { name: 'seabios.bin', url: `${import.meta.env.BASE_URL}v86/seabios.bin`, approx: 131_072 },
  { name: 'vgabios.bin', url: `${import.meta.env.BASE_URL}v86/vgabios.bin`, approx: 36_352 },
]

export interface Progress {
  /** What is happening, e.g. "v86.wasm". */
  label: string
  index: number
  count: number
  /** Bytes done and bytes expected for the current file. */
  loaded: number
  total: number
  /** Bytes done and expected for the whole job. */
  doneAll: number
  totalAll: number
  /** Bytes per second, smoothed. */
  speed: number
}

/** Smooths bytes/sec so the readout does not flicker. */
function meter() {
  let last = performance.now()
  let bytes = 0
  let speed = 0
  return (n: number) => {
    bytes += n
    const now = performance.now()
    if (now - last >= 250) {
      const inst = (bytes / (now - last)) * 1000
      speed = speed ? speed * 0.6 + inst * 0.4 : inst
      bytes = 0
      last = now
    }
    return speed
  }
}

/** Downloads the emulator and its BIOS images with real, streamed progress, and stores them. */
export async function downloadSupport(onProgress: (p: Progress) => void, signal?: AbortSignal) {
  const tick = meter()
  const totalAll = SUPPORT.reduce((a, f) => a + f.approx, 0)
  let doneAll = 0
  for (const [index, f] of SUPPORT.entries()) {
    const res = await fetch(f.url, { signal, cache: 'no-cache' })
    if (!res.ok) throw new Error(`${f.name}: server said ${res.status}`)
    const header = Number(res.headers.get('content-length'))
    const total = Number.isFinite(header) && header > 0 ? header : f.approx
    const parts: Uint8Array<ArrayBuffer>[] = []
    let loaded = 0
    const reader = res.body?.getReader()
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer())
      parts.push(buf)
      loaded = buf.length
      doneAll += loaded
      onProgress({ label: f.name, index, count: SUPPORT.length, loaded, total: loaded, doneAll, totalAll, speed: tick(loaded) })
    } else {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value as Uint8Array<ArrayBuffer>)
        loaded += value.length
        doneAll += value.length
        onProgress({ label: f.name, index, count: SUPPORT.length, loaded, total: Math.max(total, loaded), doneAll, totalAll: Math.max(totalAll, doneAll), speed: tick(value.length) })
      }
    }
    await put(`support:${f.name}`, new Blob(parts))
  }
}

export async function hasSupport() {
  const k = new Set(await keys())
  return SUPPORT.every((f) => k.has(`support:${f.name}`))
}

/** Object URLs for the stored support files. Revoke them when the machine is destroyed. */
export async function supportUrls(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of SUPPORT) {
    const b = await get<Blob>(`support:${f.name}`)
    if (!b) throw new Error(`Support file ${f.name} is missing. Run Boot Camp Assistant again.`)
    out[f.name] = URL.createObjectURL(b)
  }
  return out
}

/* ------------------------------------------------------------------ the ISO */

interface IsoMeta {
  name: string
  size: number
  chunks: number
}

/** Copies the user's ISO into IndexedDB in chunks, reporting real bytes written. */
export async function saveIso(file: File, onProgress: (p: Progress) => void, signal?: AbortSignal) {
  await deleteIso()
  const tick = meter()
  const chunks = Math.max(1, Math.ceil(file.size / CHUNK))
  for (let i = 0; i < chunks; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const slice = file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK))
    await put(`iso:${i}`, slice)
    const loaded = Math.min(file.size, (i + 1) * CHUNK)
    onProgress({ label: file.name, index: 0, count: 1, loaded, total: file.size, doneAll: loaded, totalAll: file.size, speed: tick(slice.size) })
  }
  await put('iso:meta', { name: file.name, size: file.size, chunks } satisfies IsoMeta)
}

/** The Windows 98 SE disc on the Internet Archive. pearosd fetches it, because browsers are not allowed to. */
export const ARCHIVE_ISO = {
  name: 'Windows 98 Second Edition.iso',
  url: 'https://archive.org/download/windows-98-se-isofile/Windows%2098%20Second%20Edition.iso',
  /** The item page. It lists the product key Setup asks for, so Boot Camp points there instead of repeating it. */
  page: 'https://archive.org/details/windows-98-se-isofile',
}

/** What pearosd's download endpoint is called for a given archive.org URL. */
export const archiveEndpoint = (url: string) => `/api/download?url=${encodeURIComponent(url)}`

/**
 * Streams a disc image from `url` into IndexedDB as it arrives, so only one chunk is ever held in memory and the
 * progress bar reports bytes that actually landed. Stores it the same way saveIso does.
 */
export async function downloadIso(url: string, name: string, onProgress: (p: Progress) => void, signal?: AbortSignal) {
  await deleteIso()
  const res = await fetch(url, { signal, credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw new Error((await res.text().catch(() => '')).trim() || `The server said ${res.status}.`)
  if (!res.body) throw new Error('This browser cannot stream downloads.')
  const total = Number(res.headers.get('content-length')) || 0

  // Fail early and clearly if the disc cannot fit, instead of half way through.
  const est = await navigator.storage?.estimate?.().catch(() => undefined)
  if (total && est?.quota && est.usage !== undefined && est.quota - est.usage < total * 1.05) {
    throw new Error(`This browser will only let this site store ${formatBytes(est.quota - est.usage)} more, and the disc is ${formatBytes(total)}.`)
  }

  const tick = meter()
  const reader = res.body.getReader()
  let pending: Uint8Array<ArrayBuffer>[] = []
  let pendingBytes = 0
  let loaded = 0
  let chunks = 0
  const flush = async () => {
    if (!pendingBytes) return
    await put(`iso:${chunks++}`, new Blob(pending))
    pending = []
    pendingBytes = 0
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending.push(value as Uint8Array<ArrayBuffer>)
    pendingBytes += value.length
    loaded += value.length
    onProgress({ label: name, index: 0, count: 1, loaded, total: Math.max(total, loaded), doneAll: loaded, totalAll: Math.max(total, loaded), speed: tick(value.length) })
    if (pendingBytes >= CHUNK) await flush()
  }
  await flush()
  if (total && loaded !== total) throw new Error(`The download stopped at ${formatBytes(loaded)} of ${formatBytes(total)}. Try again.`)
  await put('iso:meta', { name, size: loaded, chunks } satisfies IsoMeta)
}

export async function isoInfo() {
  return get<IsoMeta>('iso:meta')
}

/** Reassembles the stored ISO. The result is backed by the stored blobs, not loaded into memory. */
export async function loadIso(): Promise<File> {
  const meta = await isoInfo()
  if (!meta) throw new Error('The Windows ISO is not in this browser. Run Boot Camp Assistant again.')
  const parts: Blob[] = []
  for (let i = 0; i < meta.chunks; i++) {
    const b = await get<Blob>(`iso:${i}`)
    if (!b) throw new Error(`The Windows ISO is damaged (chunk ${i + 1} of ${meta.chunks} is missing).`)
    parts.push(b)
  }
  return new File(parts, meta.name)
}

export async function deleteIso() {
  const k = (await keys()).filter((x) => typeof x === 'string' && x.startsWith('iso:'))
  for (const key of k) await del(key as string)
}

/* ------------------------------------------------------------------ saved machine */

export interface SavedMachine {
  at: number
  diskBytes: number
}

export async function saveMachine(state: ArrayBuffer, diskBytes: number) {
  await put('state', state)
  await put('state:meta', { at: Date.now(), diskBytes } satisfies SavedMachine)
}

export async function deleteMachine() {
  await del('state')
  await del('state:meta')
}

export const savedMachine = () => get<SavedMachine>('state:meta')
export const loadState = () => get<ArrayBuffer>('state')

/** Removes everything Windows 98 stored. */
export async function wipe() {
  for (const key of await keys()) await del(key as string)
}

export function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Calculating…'
  if (seconds < 2) return 'Less than a second'
  if (seconds < 90) return `About ${Math.round(seconds)} seconds`
  if (seconds < 5400) return `About ${Math.round(seconds / 60)} minutes`
  return `About ${Math.round(seconds / 3600)} hours`
}

export const formatBytes = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`)

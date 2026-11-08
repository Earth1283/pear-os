import { os, useOS, type Note } from '../store'
import { beforeLogout, drive, useBackend } from './backend'

const LOCAL_KEY = 'pearos.notes.v1'
export const NOTES_FILE = '/.pearos/notes.json'

type Mode = 'idle' | 'loading' | 'remote' | 'blocked'
let mode: Mode = 'idle'
let applying = false
let timer: ReturnType<typeof setTimeout> | undefined
let dirty = false
let failing = false

function parse(v: unknown): Note[] | null {
  if (!Array.isArray(v)) return null
  const ok = v.every((n) => n && typeof n.id === 'string' && typeof n.text === 'string' && Number.isFinite(n.updated))
  return ok ? (v as Note[]).map(({ id, text, updated }) => ({ id, text, updated })) : null
}

function apply(notes: Note[]) {
  applying = true
  useOS.setState({ notes })
  applying = false
}

const notify = (body: string) => os().notify({ app: 'notes', title: 'Notes', body })
const body = () => JSON.stringify(useOS.getState().notes, null, 1)

async function load() {
  mode = 'loading'
  clearTimeout(timer)
  dirty = false
  try {
    const res = await fetch(drive.url(NOTES_FILE), { credentials: 'same-origin', cache: 'no-store' })
    if (res.status === 404) {
      mode = 'remote'
      return
    }
    if (!res.ok) throw new Error(`PearDrive answered ${res.status}`)
    const notes = parse(JSON.parse(await res.text()))
    if (!notes) {
      mode = 'blocked'
      return notify(`PearDrive${NOTES_FILE} isn't a notes file Pear understands, so Notes won't save over it. Fix or delete it, then log in again.`)
    }
    apply(notes)
    mode = 'remote'
  } catch (e) {
    mode = 'blocked'
    notify(`Couldn't load your notes from PearDrive (${(e as Error).message}). Changes won't be saved until you log in again.`)
  }
}

async function flush() {
  clearTimeout(timer)
  if (mode !== 'remote' || !dirty) return
  dirty = false
  try {
    await drive.write(NOTES_FILE, new Blob([body()], { type: 'application/json' }))
    if (failing) notify('Notes are saving to PearDrive again.')
    failing = false
  } catch (e) {
    dirty = true
    if (!failing) notify(`Couldn't save notes to PearDrive: ${(e as Error).message}. Pear will retry on your next edit.`)
    failing = true
  }
}

function loadLocal() {
  try {
    const local = parse(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'))
    if (local) apply(local)
  } catch {
    return
  }
}
loadLocal()
beforeLogout.push(flush)

useOS.subscribe((s, prev) => {
  if (s.notes === prev.notes || applying) return
  const b = useBackend.getState()
  if (b.present) {
    if (mode !== 'remote') return
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(flush, 700)
    return
  }
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s.notes))
  } catch {
    return
  }
})

useBackend.subscribe((b, prev) => {
  if (b.authed && !prev.authed) void load()
  if (!b.authed && prev.authed) {
    clearTimeout(timer)
    mode = 'idle'
  }
})

addEventListener('pagehide', () => {
  if (mode !== 'remote' || !dirty) return
  const data = body()
  if (data.length < 60_000) fetch(`/api/fs/write?path=${encodeURIComponent(NOTES_FILE)}`, { method: 'PUT', body: data, credentials: 'same-origin', keepalive: true })
  else void flush()
})

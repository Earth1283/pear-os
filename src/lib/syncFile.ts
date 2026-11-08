import type { StoreApi } from 'zustand'
import { os } from '../store'
import { beforeLogout, drive, useBackend } from './backend'

interface Options<T> {
  title: string
  file: string
  localKey: string
  seedWhenMissing: boolean
  store: Pick<StoreApi<T>, 'getState' | 'setState' | 'subscribe'>
  pick: (s: T) => unknown
  parse: (v: unknown) => Partial<T> | null
}

type Mode = 'idle' | 'loading' | 'remote' | 'blocked'

export function syncFile<T>(o: Options<T>) {
  let mode: Mode = 'idle'
  let applying = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  let failing = false
  let localTimer: ReturnType<typeof setTimeout> | undefined
  let localPending = false

  const notify = (body: string) => os().notify({ app: 'notes', title: o.title, body })
  const body = () => JSON.stringify(o.pick(o.store.getState()), null, 1)

  function apply(v: Partial<T>) {
    applying = true
    o.store.setState(v)
    applying = false
  }

  async function flush() {
    clearTimeout(timer)
    if (mode !== 'remote' || !dirty) return
    dirty = false
    try {
      await drive.write(o.file, new Blob([body()], { type: 'application/json' }))
      if (failing) notify(`${o.title} are saving to PearDrive again.`)
      failing = false
    } catch (e) {
      dirty = true
      if (!failing) notify(`Couldn't save ${o.title.toLowerCase()} to PearDrive: ${(e as Error).message}. Pear will retry on your next edit.`)
      failing = true
    }
  }

  async function load() {
    mode = 'loading'
    clearTimeout(timer)
    dirty = false
    try {
      const res = await fetch(drive.url(o.file), { credentials: 'same-origin', cache: 'no-store' })
      if (res.status === 404) {
        mode = 'remote'
        if (o.seedWhenMissing) {
          dirty = true
          void flush()
        }
        return
      }
      if (!res.ok) throw new Error(`PearDrive answered ${res.status}`)
      const parsed = o.parse(JSON.parse(await res.text()))
      if (!parsed) {
        mode = 'blocked'
        return notify(`PearDrive${o.file} isn't a file Pear understands, so ${o.title} won't save over it. Fix or delete it, then log in again.`)
      }
      apply(parsed)
      mode = 'remote'
    } catch (e) {
      mode = 'blocked'
      notify(`Couldn't load your ${o.title.toLowerCase()} from PearDrive (${(e as Error).message}). Changes won't be saved until you log in again.`)
    }
  }

  function saveLocal() {
    clearTimeout(localTimer)
    if (!localPending) return
    localPending = false
    try {
      localStorage.setItem(o.localKey, JSON.stringify(o.pick(o.store.getState())))
    } catch {
      return
    }
  }

  beforeLogout.push(flush)

  o.store.subscribe((s, prev) => {
    if (o.pick(s) === o.pick(prev) || applying) return
    if (useBackend.getState().present) {
      if (mode !== 'remote') return
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(flush, 700)
      return
    }
    localPending = true
    clearTimeout(localTimer)
    localTimer = setTimeout(saveLocal, 300)
  })

  useBackend.subscribe((b, prev) => {
    if (b.authed && !prev.authed) void load()
    if (!b.authed && prev.authed) {
      clearTimeout(timer)
      mode = 'idle'
    }
  })

  addEventListener('pagehide', () => {
    saveLocal()
    if (mode !== 'remote' || !dirty) return
    const data = body()
    if (data.length < 60_000) fetch(`/api/fs/write?path=${encodeURIComponent(o.file)}`, { method: 'PUT', body: data, credentials: 'same-origin', keepalive: true })
    else void flush()
  })
}

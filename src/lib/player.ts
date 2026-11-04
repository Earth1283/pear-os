import { create } from 'zustand'
import { onQuit, os, useOS } from '../store'
import { drive, music, useBackend } from './backend'
import { readTags } from './id3'
import { STATIONS, startStation, stationById, type StationHandle, type StationId } from './synth'

export type Repeat = 'off' | 'all' | 'one'

export interface Track {
  id: string
  source: 'drive' | 'local' | 'station'
  title: string
  artist: string
  album: string
  src: string
  path?: string
  station?: StationId
  duration?: number
  art?: string
  track?: number
  hue?: number
  file?: File
}

export const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus)$/i

export const stationTrack = (id: StationId): Track => {
  const s = stationById(id)!
  return { id: `station:${id}`, source: 'station', title: s.title, artist: s.artist, album: 'Pear Radio', src: '', station: id, hue: s.hue }
}
export const STATION_TRACKS: Track[] = STATIONS.map((s) => stationTrack(s.id))

const GENERIC_DIRS = new Set(['music', 'documents', 'downloads', 'desktop', 'audio', 'songs'])

export function trackFromPath(path: string): Track {
  const parts = path.split('/').filter(Boolean)
  const file = parts[parts.length - 1] ?? path
  let base = file.replace(AUDIO_EXT, '').replace(/_/g, ' ')
  base = base.replace(/^\d{1,3}\s*[-.)]?\s+(?=\S)/, '')
  let artist = ''
  let title = base
  const dash = base.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (dash) {
    artist = dash[1].trim()
    title = dash[2].trim()
  }
  const album = parts.length >= 2 && !GENERIC_DIRS.has(parts[parts.length - 2].toLowerCase()) ? parts[parts.length - 2] : ''
  if (!artist && parts.length >= 3 && !GENERIC_DIRS.has(parts[parts.length - 3].toLowerCase())) artist = parts[parts.length - 3]
  const lead = file.match(/^(\d{1,3})\s*[-.)]?\s+\S/)
  return {
    id: `drive:${path}`,
    source: 'drive',
    title: title || file,
    artist: artist || 'Unknown Artist',
    album: album || 'Unknown Album',
    src: drive.url(path),
    path,
    track: lead ? parseInt(lead[1], 10) : undefined,
  }
}

export function trackFromFile(f: File): Track {
  const t = trackFromPath(f.name)
  return { ...t, id: `local:${f.name}:${f.size}:${f.lastModified}`, source: 'local', src: URL.createObjectURL(f), path: undefined, file: f, album: 'Unknown Album' }
}

export function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return '--:--'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

const FAV_KEY = 'pearos.music.favorites'
const loadFavs = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
const saveFavs = (f: string[]) => {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(f))
  } catch {
    // Private mode and friends: favourites just won't survive a reload.
  }
}

interface PlayerState {
  drive: Track[]
  local: Track[]
  driveState: 'idle' | 'loading' | 'ready' | 'error'
  driveError: string | null
  queue: Track[]
  index: number
  playing: boolean
  buffering: boolean
  position: number
  duration: number
  shuffle: boolean
  repeat: Repeat
  favorites: string[]
  durations: Record<string, number>

  loadDrive(): Promise<void>
  addLocal(files: File[]): number
  play(queue: Track[], index: number): void
  playTrack(track: Track, within?: Track[]): void
  playStation(id: StationId): void
  playNext(track: Track): void
  toggle(): void
  pause(): void
  stop(): void
  next(auto?: boolean): void
  prev(): void
  seek(seconds: number): void
  toggleShuffle(): void
  cycleRepeat(): void
  toggleFavorite(id: string): void
  ensureArt(ids: string[]): void
}

// ───────────────────────────── audio graph ─────────────────────────────

const el = new Audio()
el.preload = 'auto'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let analyser: AnalyserNode | null = null
let spectrumBuf: Uint8Array<ArrayBuffer> | null = null

export const SPECTRUM_BINS = 128

function applyVolume() {
  if (!ctx || !master) return
  const v = useOS.getState().volume
  master.gain.setTargetAtTime(v * v, ctx.currentTime, 0.02)
}

function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }
  ctx = new AudioContext({ latencyHint: 'playback' })
  master = ctx.createGain()
  analyser = ctx.createAnalyser()
  analyser.fftSize = SPECTRUM_BINS * 2
  analyser.smoothingTimeConstant = 0.78
  spectrumBuf = new Uint8Array(analyser.frequencyBinCount)
  master.connect(analyser)
  analyser.connect(ctx.destination)
  ctx.createMediaElementSource(el).connect(master)
  master.gain.value = useOS.getState().volume ** 2
  applyMono()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// Accessibility › Audio › Play stereo audio as mono: fold everything into one channel at the
// master gain; the destination then plays that channel out of both speakers.
let mono = false
function applyMono() {
  if (!master) return
  master.channelCount = mono ? 1 : 2
  master.channelCountMode = mono ? 'explicit' : 'max'
  master.channelInterpretation = 'speakers'
}
export function setMonoAudio(on: boolean) {
  mono = on
  applyMono()
}

useOS.subscribe((s, prev) => {
  if (s.volume !== prev.volume) applyVolume()
  if (s.phase === prev.phase) return
  // Locking the screen keeps the music going, like the real thing. Everything else ends it.
  if (s.phase === 'sleep') usePlayer.getState().pause()
  else if (s.phase !== 'desktop' && s.phase !== 'login') usePlayer.getState().stop()
})

onQuit('music', () => usePlayer.getState().stop())

/** Fills `out` with the current spectrum (0–255 per bin). Returns false when nothing is playing. */
export function readSpectrum(out: Uint8Array<ArrayBuffer>): boolean {
  if (!analyser || !usePlayer.getState().playing) return false
  analyser.getByteFrequencyData(out)
  return true
}

// ───────────────────────────── stations ─────────────────────────────

let station: StationHandle | null = null
let stationStartedAt = 0
let stationElapsed = 0

function startStationAudio(id: StationId) {
  stopStationAudio()
  const c = ensureAudio()
  station = startStation(c, master!, id)
  stationStartedAt = performance.now()
}

function stopStationAudio() {
  if (!station) return
  station.stop()
  station = null
  stationElapsed += (performance.now() - stationStartedAt) / 1000
}

// ───────────────────────────── metadata enrichment ─────────────────────────────

let generation = 0
const artByAlbum = new Map<string, string>()
const artTried = new Set<string>()
const pending = new Map<string, Partial<Track>>()
let flushTimer: ReturnType<typeof setTimeout> | undefined

function patchTracks(map: Map<string, Partial<Track>>) {
  const apply = (list: Track[]) => (list.some((t) => map.has(t.id)) ? list.map((t) => (map.has(t.id) ? { ...t, ...map.get(t.id) } : t)) : list)
  usePlayer.setState((s) => ({ drive: apply(s.drive), local: apply(s.local), queue: apply(s.queue) }))
}

function queuePatch(id: string, p: Partial<Track>) {
  pending.set(id, { ...pending.get(id), ...p })
  flushTimer ??= setTimeout(() => {
    flushTimer = undefined
    const batch = new Map(pending)
    pending.clear()
    patchTracks(batch)
  }, 250)
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>, alive: () => boolean) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (alive() && i < items.length) await fn(items[i++])
    }),
  )
}

const isMp3 = (name: string) => /\.mp3$/i.test(name)
const albumKey = (t: Track) => (t.album !== 'Unknown Album' ? `${t.artist}|${t.album}` : null)

async function enrich(tracks: Track[]) {
  const gen = generation
  await pool(
    tracks.filter((t) => isMp3(t.path ?? t.file?.name ?? '')),
    4,
    async (t) => {
      const tags = await readTags(t.file ? { blob: t.file } : { url: t.src })
      const p: Partial<Track> = {}
      if (tags.title) p.title = tags.title
      if (tags.artist) p.artist = tags.artist
      if (tags.album) p.album = tags.album
      if (tags.track) p.track = tags.track
      if (Object.keys(p).length) queuePatch(t.id, p)
    },
    () => gen === generation,
  )
}

async function fetchArt(t: Track) {
  if (t.art || artTried.has(t.id) || t.source === 'station' || !isMp3(t.path ?? t.file?.name ?? '')) return
  artTried.add(t.id)
  const key = albumKey(t)
  const shared = key && artByAlbum.get(key)
  if (shared) return queuePatch(t.id, { art: shared })
  const tags = await readTags(t.file ? { blob: t.file } : { url: t.src }, true)
  if (!tags.art) return
  const url = URL.createObjectURL(tags.art)
  if (key) artByAlbum.set(key, url)
  queuePatch(t.id, { art: url })
}

// ───────────────────────────── the store ─────────────────────────────

let token = 0
let failures = 0
const history: number[] = []

export const usePlayer = create<PlayerState>((set, get) => {
  const load = (track: Track, autoplay = true) => {
    const my = ++token
    ensureAudio()
    stopStationAudio()
    stationElapsed = 0
    if (track.source === 'station') {
      el.pause()
      el.removeAttribute('src')
      el.load()
      if (autoplay) startStationAudio(track.station!)
      set({ position: 0, duration: 0, playing: autoplay, buffering: false })
      return
    }
    el.src = track.src
    set({ position: 0, duration: track.duration ?? get().durations[track.id] ?? 0, buffering: true })
    if (autoplay) {
      el.play().catch((e: unknown) => {
        if (my !== token || (e as Error).name === 'AbortError') return
        fail(track)
      })
    }
  }

  const fail = (track: Track) => {
    failures++
    set({ playing: false, buffering: false })
    if (failures === 1) os().notify({ app: 'music', title: 'Music', body: `“${track.title}” can't be played. Maybe the file is damaged, or maybe it was just never good.` })
    const { queue } = get()
    if (queue.length > 1 && failures < queue.length) get().next(true)
  }

  el.addEventListener('loadedmetadata', () => {
    const cur = get().queue[get().index]
    if (!cur || cur.source === 'station' || !Number.isFinite(el.duration)) return
    set((s) => ({ duration: el.duration, durations: { ...s.durations, [cur.id]: el.duration } }))
  })
  el.addEventListener('playing', () => {
    failures = 0
    set({ playing: true, buffering: false })
  })
  el.addEventListener('waiting', () => set({ buffering: true }))
  el.addEventListener('canplay', () => set({ buffering: false }))
  el.addEventListener('pause', () => {
    if (!el.ended && get().queue[get().index]?.source !== 'station' && el.getAttribute('src')) set({ playing: false })
  })
  el.addEventListener('ended', () => get().next(true))
  el.addEventListener('error', () => {
    const cur = get().queue[get().index]
    if (cur && cur.source !== 'station' && el.getAttribute('src')) fail(cur)
  })

  setInterval(() => {
    const s = get()
    if (!s.playing) return
    const cur = s.queue[s.index]
    if (!cur) return
    if (cur.source === 'station') set({ position: stationElapsed + (performance.now() - stationStartedAt) / 1000 })
    else set({ position: el.currentTime })
  }, 250)

  return {
    drive: [],
    local: [],
    driveState: 'idle',
    driveError: null,
    queue: [],
    index: -1,
    playing: false,
    buffering: false,
    position: 0,
    duration: 0,
    shuffle: false,
    repeat: 'off',
    favorites: loadFavs(),
    durations: {},

    async loadDrive() {
      if (!useBackend.getState().authed) return set({ driveState: 'idle', drive: [] })
      if (get().driveState === 'loading') return
      set({ driveState: 'loading', driveError: null })
      try {
        const rows = await music.library()
        generation++
        const known = new Map(get().drive.map((t) => [t.id, t]))
        const tracks = rows.map((r) => {
          const fresh = trackFromPath(r.path)
          const old = known.get(fresh.id)
          return old ? { ...fresh, title: old.title, artist: old.artist, album: old.album, track: old.track, art: old.art } : fresh
        })
        set({ drive: tracks, driveState: 'ready' })
        void enrich(tracks.filter((t) => !known.has(t.id)))
      } catch (e) {
        set({ driveState: 'error', driveError: e instanceof Error ? e.message : String(e) })
      }
    },

    addLocal(files) {
      const have = new Set(get().local.map((t) => t.id))
      const fresh = files.filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/')).map(trackFromFile).filter((t) => !have.has(t.id))
      if (!fresh.length) return 0
      set({ local: [...get().local, ...fresh] })
      void enrich(fresh)
      return fresh.length
    },

    play(queue, index) {
      if (!queue[index]) return
      history.length = 0
      set({ queue, index })
      load(queue[index])
      get().ensureArt([queue[index].id])
    },

    playTrack(track, within) {
      const list = within ?? [track]
      const i = list.findIndex((t) => t.id === track.id)
      get().play(list, i < 0 ? 0 : i)
    },

    playStation(id) {
      const i = STATION_TRACKS.findIndex((t) => t.station === id)
      get().play(STATION_TRACKS, i)
    },

    playNext(track) {
      const { queue, index } = get()
      const cur = queue[index]
      if (!cur) return get().playTrack(track)
      if (track.id === cur.id) return
      // Drop any earlier copy of the track, then slot it in right after the current one.
      const rest = queue.filter((t) => t.id !== track.id)
      const at = rest.findIndex((t) => t.id === cur.id)
      set({ queue: [...rest.slice(0, at + 1), track, ...rest.slice(at + 1)], index: at })
    },

    toggle() {
      const s = get()
      const cur = s.queue[s.index]
      if (!cur) return s.playStation('lofi')
      if (s.playing) return s.pause()
      ensureAudio()
      if (cur.source === 'station') {
        startStationAudio(cur.station!)
        set({ playing: true })
      } else {
        el.play().catch(() => {})
      }
    },

    pause() {
      const cur = get().queue[get().index]
      if (!cur) return
      if (cur.source === 'station') stopStationAudio()
      else el.pause()
      set({ playing: false })
    },

    stop() {
      token++
      stopStationAudio()
      el.pause()
      el.removeAttribute('src')
      el.load()
      history.length = 0
      set({ queue: [], index: -1, playing: false, buffering: false, position: 0, duration: 0 })
    },

    next(auto = false) {
      const { queue, index, shuffle, repeat } = get()
      if (!queue.length) return
      if (auto && repeat === 'one') {
        el.currentTime = 0
        if (queue[index].source === 'station') return
        void el.play().catch(() => {})
        return
      }
      let n = index + 1
      if (shuffle && queue.length > 1) {
        do n = Math.floor(Math.random() * queue.length)
        while (n === index)
      }
      if (n >= queue.length) {
        if (auto && repeat === 'off') {
          el.pause()
          set({ playing: false, position: 0 })
          return
        }
        n = 0
      }
      history.push(index)
      set({ index: n })
      load(queue[n])
      get().ensureArt([queue[n].id])
    },

    prev() {
      const { queue, index, position } = get()
      if (!queue.length) return
      const cur = queue[index]
      if (cur.source !== 'station' && position > 3) return get().seek(0)
      const n = history.pop() ?? (index - 1 + queue.length) % queue.length
      set({ index: n })
      load(queue[n])
      get().ensureArt([queue[n].id])
    },

    seek(seconds) {
      const cur = get().queue[get().index]
      if (!cur || cur.source === 'station' || !Number.isFinite(el.duration)) return
      el.currentTime = Math.max(0, Math.min(el.duration, seconds))
      set({ position: el.currentTime })
    },

    toggleShuffle: () => set({ shuffle: !get().shuffle }),
    cycleRepeat: () => set({ repeat: ({ off: 'all', all: 'one', one: 'off' } as const)[get().repeat] }),

    toggleFavorite(id) {
      const f = get().favorites
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id]
      saveFavs(next)
      set({ favorites: next })
    },

    ensureArt(ids) {
      const all = [...get().queue, ...get().drive, ...get().local]
      const want = new Set(ids)
      const tracks = all.filter((t, i) => want.has(t.id) && all.findIndex((x) => x.id === t.id) === i)
      void pool(tracks, 3, fetchArt, () => true)
    },
  }
})

export const currentTrack = () => {
  const s = usePlayer.getState()
  return s.queue[s.index] ?? null
}
export const useCurrent = () => usePlayer((s) => s.queue[s.index] ?? null)

/** Plays a PearDrive file (by drive path) inside the whole PearDrive library, so Next works. */
export async function playDriveFile(path: string) {
  const p = usePlayer.getState()
  if (p.driveState !== 'ready') await p.loadDrive()
  const lib = usePlayer.getState().drive
  const found = lib.find((t) => t.path === path)
  if (found) usePlayer.getState().playTrack(found, lib)
  else usePlayer.getState().playTrack(trackFromPath(path))
}

// ───────────────────────────── OS integration ─────────────────────────────

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession
  const p = () => usePlayer.getState()
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => p().toggle()],
    ['pause', () => p().pause()],
    ['previoustrack', () => p().prev()],
    ['nexttrack', () => p().next()],
    ['seekto', (d) => d.seekTime != null && p().seek(d.seekTime)],
  ]
  for (const [action, fn] of handlers) {
    try {
      ms.setActionHandler(action, fn)
    } catch {
      // Not every browser supports every action.
    }
  }
  let lastId = ''
  let lastArt: string | undefined
  usePlayer.subscribe((s) => {
    const t = s.queue[s.index]
    ms.playbackState = t ? (s.playing ? 'playing' : 'paused') : 'none'
    if (!t) return
    if (t.id === lastId && t.art === lastArt) return
    lastId = t.id
    lastArt = t.art
    ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: t.art ? [{ src: t.art }] : [] })
  })
}

import { create } from 'zustand'
import type { AppId } from '../apps/ids'
import { os } from '../store'

export type Bucket = AppId | 'desktop'
export interface DayLog {
  secs: Partial<Record<Bucket, number>>
  pickups: number
}
export type ScreenData = Record<string, DayLog>

export const SCREEN_KEY = 'pearos.screentime.v1'
const KEEP_DAYS = 60
const IDLE_MS = 180_000
const COMMIT_MS = 10_000
const AWAY_PICKUP_MS = 15_000
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

export function parseScreenData(v: unknown): ScreenData | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: ScreenData = {}
  for (const [day, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!DAY_KEY.test(day) || !raw || typeof raw !== 'object') return null
    const { secs, pickups } = raw as { secs?: unknown; pickups?: unknown }
    if (!secs || typeof secs !== 'object' || !Number.isFinite(pickups)) return null
    const clean: DayLog['secs'] = {}
    for (const [k, n] of Object.entries(secs as Record<string, unknown>)) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
      clean[k as Bucket] = Math.min(n, 86_400)
    }
    out[day] = { secs: clean, pickups: Math.max(0, Math.round(pickups as number)) }
  }
  return out
}

export function mergeScreenData(a: ScreenData, b: ScreenData): ScreenData {
  const out: ScreenData = { ...a }
  for (const [day, log] of Object.entries(b)) {
    const mine = out[day]
    if (!mine) {
      out[day] = log
      continue
    }
    const secs = { ...mine.secs }
    for (const [k, n] of Object.entries(log.secs)) secs[k as Bucket] = Math.max(secs[k as Bucket] ?? 0, n)
    out[day] = { secs, pickups: Math.max(mine.pickups, log.pickups) }
  }
  return out
}

function loadLocal(): ScreenData {
  try {
    return parseScreenData(JSON.parse(localStorage.getItem(SCREEN_KEY) ?? 'null')) ?? {}
  } catch {
    return {}
  }
}

interface ScreenState {
  data: ScreenData
  add(day: string, secs: Partial<Record<Bucket, number>>, pickups: number): void
  reset(): void
}

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const useScreenTime = create<ScreenState>((set, get) => ({
  data: loadLocal(),
  add(day, secs, pickups) {
    const data = { ...get().data }
    const cur = data[day] ?? { secs: {}, pickups: 0 }
    const next: DayLog['secs'] = { ...cur.secs }
    for (const [k, n] of Object.entries(secs)) next[k as Bucket] = (next[k as Bucket] ?? 0) + n
    data[day] = { secs: next, pickups: cur.pickups + pickups }
    const keys = Object.keys(data).sort()
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete data[k]
    set({ data })
  },
  reset: () => set({ data: {} }),
}))

let pendingDay = dayKey()
let pending: Partial<Record<Bucket, number>> = {}
let pendingPickups = 0

export function commitScreenTime() {
  if (!Object.keys(pending).length && !pendingPickups) return
  const secs = pending
  const pickups = pendingPickups
  pending = {}
  pendingPickups = 0
  useScreenTime.getState().add(pendingDay, secs, pickups)
}

let lastInput = Date.now()
let lastTick = Date.now()
let awaySince: number | null = null

function currentBucket(): Bucket | null {
  const s = os()
  if (s.phase !== 'desktop') return null
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return null
  if (Date.now() - lastInput > IDLE_MS) return null
  const w = s.windows.find((x) => x.id === s.focused && !x.minimized)
  return w ? w.app : 'desktop'
}

function tick() {
  const now = Date.now()
  const dt = Math.min(2, (now - lastTick) / 1000)
  lastTick = now
  const today = dayKey()
  if (today !== pendingDay) {
    commitScreenTime()
    pendingDay = today
  }
  const b = currentBucket()
  if (b) pending[b] = (pending[b] ?? 0) + dt
}

function away() {
  awaySince ??= Date.now()
  commitScreenTime()
}

function back() {
  if (awaySince !== null && Date.now() - awaySince > AWAY_PICKUP_MS && os().phase === 'desktop') pendingPickups++
  awaySince = null
  lastInput = Date.now()
}

const seen = () => {
  lastInput = Date.now()
}

let started = false
export function startScreenTime() {
  if (started) return
  started = true
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const) addEventListener(ev, seen, { capture: true, passive: true })
  setInterval(tick, 1000)
  setInterval(commitScreenTime, COMMIT_MS)
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? away() : back()))
  addEventListener('blur', away)
  addEventListener('focus', back)
  addEventListener('pagehide', commitScreenTime)
}

export const APP_NAMES: Record<Bucket, string> = {
  desktop: 'The Desktop',
  finder: 'Finder',
  launchpad: 'Launchpad',
  safari: 'Sapphari',
  music: 'Music',
  chess: 'Chess',
  tetris: 'Tetris',
  notes: 'Notes',
  textedit: 'TextEdit',
  calculator: 'Calculator',
  terminal: 'Terminal',
  intelligence: 'Pear Intelligence',
  passwords: 'Passwords',
  mirroring: 'pPhone Mirroring',
  activity: 'Activity Monitor',
  fractals: 'Fractals',
  settings: 'System Settings',
  about: 'About This Pear',
  preview: 'Preview',
  bootcamp: 'Boot Camp Assistant',
  photobooth: 'Photo Booth',
  mail: 'Mail',
  diskutility: 'Disk Utility',
  softwareupdate: 'Software Update',
  trash: 'Trash',
}

const ROASTS: Partial<Record<Bucket, (t: string) => string>> = {
  desktop: (t) => `${t} looking at the desktop with no app open. It was a nice wallpaper.`,
  terminal: (t) => `${t} in Terminal. Nobody has ever needed this long to run ls.`,
  chess: (t) => `${t} of Chess. Stockfish is, quote, “not even trying”.`,
  tetris: (t) => `${t} of Tetris. The rows cleared; the to-do list did not.`,
  notes: (t) => `${t} in Notes, the app where good ideas go to be reread once.`,
  mail: (t) => `${t} in Mail. All of it was spam.`,
  music: (t) => `${t} of Music, and you still haven't picked a song.`,
  safari: (t) => `${t} on Sapphari. The internet is not a hobby.`,
  calculator: (t) => `${t} in Calculator. It is not that kind of long division.`,
  passwords: (t) => `${t} in Passwords, mostly looking at password123.`,
  settings: (t) => `${t} in System Settings. The settings were fine.`,
  activity: (t) => `${t} watching a CPU graph. It is not going to do anything interesting.`,
  fractals: (t) => `${t} zooming into a fractal. It goes on forever; so, apparently, do you.`,
  photobooth: (t) => `${t} in Photo Booth. We kept the photos.`,
  bootcamp: (t) => `${t} in Boot Camp, planning to leave and never actually leaving.`,
  finder: (t) => `${t} in Finder, looking for a file you already knew was not there.`,
  intelligence: (t) => `${t} asking Pear Intelligence for answers it also does not have.`,
  textedit: (t) => `${t} in TextEdit, as if Notes were a personal insult.`,
  preview: (t) => `${t} in Preview. You have looked at that picture enough.`,
  diskutility: (t) => `${t} in Disk Utility, checking a disk that is fine.`,
  softwareupdate: (t) => `${t} watching Software Update. The bar moves when you look away.`,
  mirroring: (t) => `${t} on pPhone Mirroring, so you could ignore the real one more comfortably.`,
}

export const fmtDur = (secs: number, long = false) => {
  const m = Math.round(secs / 60)
  if (m < 1) return secs < 5 ? (long ? 'no time at all' : '0m') : `${Math.round(secs)}s`
  const h = Math.floor(m / 60)
  if (!h) return `${m}m`
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

export interface WeekSummary {
  days: { key: string; label: string; secs: number }[]
  apps: [Bucket, number][]
  total: number
  pickups: number
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export function weekSummary(data: ScreenData, end = new Date(), weeksBack = 0): WeekSummary {
  const last = addDays(end, -7 * weeksBack)
  const byApp = new Map<Bucket, number>()
  let total = 0
  let pickups = 0
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(last, i - 6)
    const key = dayKey(d)
    const log = data[key]
    let secs = 0
    if (log) {
      for (const [k, n] of Object.entries(log.secs)) {
        byApp.set(k as Bucket, (byApp.get(k as Bucket) ?? 0) + n)
        secs += n
      }
      pickups += log.pickups
    }
    total += secs
    return { key, label: d.toLocaleDateString('en-US', { weekday: 'short' }), secs }
  })
  return { days, apps: [...byApp].sort((a, b) => b[1] - a[1]), total, pickups }
}

export function verdict(dailyAvgSecs: number) {
  const h = dailyAvgSecs / 3600
  if (h < 1 / 6) return 'Barely any. Either you are very disciplined or this computer is a prop.'
  if (h < 1) return 'Under an hour a day. Healthy. Honestly a little suspicious.'
  if (h < 3) return 'A normal amount. We are not saying it is a good amount.'
  if (h < 6) return 'That is a part-time job, and this one does not pay.'
  if (h < 10) return 'That is a full-time job, and this one does not pay either.'
  return 'You are living in here. The browser tab is now your primary residence.'
}

export function trend(cur: number, prev: number) {
  if (prev < 60 || cur < 60) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (Math.abs(pct) < 3) return 'about the same as last week'
  return `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% from last week`
}

export interface Report {
  subject: string
  summary: string
  body: string
  total: number
}

export function buildReport(data: ScreenData, now = new Date()): Report | null {
  const wk = weekSummary(data, now)
  if (wk.total < 60) return null
  const prev = weekSummary(data, now, 1)
  const activeDays = wk.days.filter((d) => d.secs > 0).length || 1
  const avg = wk.total / activeDays
  const tr = trend(wk.total, prev.total)
  const top = wk.apps[0]
  const rows = wk.apps.slice(0, 6).map(([app, secs], i) => `${i + 1}. ${APP_NAMES[app]}: ${fmtDur(secs)} (${Math.round((secs / wk.total) * 100)}%)`)
  const worst = ROASTS[top[0]]?.(fmtDur(top[1], true)) ?? `${fmtDur(top[1], true)} in ${APP_NAMES[top[0]]}. We have nothing to add.`
  const body = [
    'Hi,',
    '',
    'Here is your weekly Screen Time report. Every number below was measured. The judgement is free.',
    '',
    `Daily average: ${fmtDur(avg)}${tr ? ` (${tr})` : ''}`,
    `Total: ${fmtDur(wk.total)} over ${activeDays} day${activeDays === 1 ? '' : 's'}`,
    `Pickups: ${wk.pickups}${wk.pickups > 20 ? ' (you keep coming back)' : ''}`,
    '',
    'Where it went',
    ...rows,
    '',
    `Verdict: ${verdict(avg)}`,
    '',
    worst,
    '',
    'Screen Time only counts time this tab was in front of you and you were actually moving. Time spent reading it is included. Yes, this one too.',
  ].join('\n')
  return {
    subject: `Your Screen Time was ${fmtDur(avg)} a day${tr ? `, ${tr}` : ''}`,
    summary: `You used ${APP_NAMES[top[0]]} for ${fmtDur(top[1])}. We are worried.`,
    body,
    total: wk.total,
  }
}

export function shameToast(data: ScreenData): string {
  const wk = weekSummary(data)
  if (wk.total < 60) return 'Screen Time is still learning your habits. So far: nothing. Suspicious.'
  const days = wk.days.filter((d) => d.secs > 0).length || 1
  const [app, secs] = wk.apps[0]
  return `You averaged ${fmtDur(wk.total / days)} a day this week, and ${Math.round((secs / wk.total) * 100)}% of it was ${APP_NAMES[app]}.`
}

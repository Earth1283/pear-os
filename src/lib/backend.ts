import { create } from 'zustand'

export interface SysInfo {
  hostname: string
  os: string
  kernel: string
  arch: string
  user: string
  cpu: string
  cores: number
  physicalCores: number | null
  cpuUsage: number
  memTotal: number
  memUsed: number
  uptime: number
  load: [number, number, number] | null
  diskTotal: number | null
  diskFree: number | null
  root: string
}

export interface DriveEntry {
  name: string
  dir: boolean
  size: number
  modified: number
}

export interface RealProc {
  pid: number
  name: string
  cpu: number
  mem: number
  threads: number
  mine: boolean
  status: string
}

interface BackendState {
  present: boolean
  authed: boolean
  proxyToken: string | null
  version: string | null
  sys: SysInfo | null
  driveVersion: number
}

export const useBackend = create<BackendState>(() => ({ present: false, authed: false, proxyToken: null, version: null, sys: null, driveVersion: 0 }))
export const backend = () => useBackend.getState()
export const bumpDrive = () => useBackend.setState((s) => ({ driveVersion: s.driveVersion + 1 }))

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (res.status === 401) useBackend.setState({ authed: false })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      msg = res.statusText
    }
    throw new ApiError(res.status, msg)
  }
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const q = (p: string) => `path=${encodeURIComponent(p)}`

export async function detect() {
  try {
    const res = await fetch('/api/health', { credentials: 'same-origin' })
    if (!res.ok) throw new Error()
    const h = await res.json()
    if (!h.pearosd) throw new Error()
    useBackend.setState({ present: true, authed: h.authed, proxyToken: h.proxyToken, version: h.version })
    if (h.authed) refreshSys()
  } catch {
    useBackend.setState({ present: false, authed: false, proxyToken: null })
  }
}

export async function login(password: string) {
  const r = await post<{ proxyToken: string }>('/api/login', { password })
  useBackend.setState({ authed: true, proxyToken: r.proxyToken })
  refreshSys()
}

export async function logout() {
  await post('/api/logout', {}).catch(() => {})
  useBackend.setState({ authed: false, proxyToken: null })
}

export async function refreshSys() {
  try {
    useBackend.setState({ sys: await call<SysInfo>('/api/sys') })
  } catch {
    useBackend.setState({ sys: null })
  }
}

export const drive = {
  list: (path: string) => call<DriveEntry[]>(`/api/fs/list?${q(path)}`),
  readText: async (path: string) => {
    const res = await fetch(`/api/fs/read?${q(path)}`, { credentials: 'same-origin' })
    if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'File not found' : res.statusText)
    return res.text()
  },
  url: (path: string, download = false) => `/api/fs/read?${q(path)}${download ? '&download=true' : ''}`,
  write: (path: string, body: BodyInit) => call(`/api/fs/write?${q(path)}`, { method: 'PUT', body }),
  mkdir: (path: string) => post('/api/fs/mkdir', { path }),
  rename: (from: string, to: string) => post('/api/fs/rename', { from, to }),
  trash: (path: string) => post('/api/fs/trash', { path }),
  remove: (path: string) => post('/api/fs/delete', { path }),
}

export interface DriveSong {
  path: string
  size: number
  modified: number
}

export const music = {
  library: () => call<DriveSong[]>('/api/music/library'),
}

export const procs = {
  list: () => call<RealProc[]>('/api/procs'),
  kill: (pid: number, force = false) => post<{ ok: boolean }>('/api/procs/kill', { pid, force }),
}

export function ptyUrl(cols: number, rows: number) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/api/pty?cols=${cols}&rows=${rows}`
}

export function proxyUrl(url: string): string | null {
  const token = backend().proxyToken
  if (!token) return null
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    if (!/^https?:$/.test(u.protocol)) return null
    return `/p/${token}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}${u.hash}`
  } catch {
    return null
  }
}

export const TEXT_EXT = /\.(txt|md|markdown|json|js|mjs|ts|tsx|jsx|css|scss|html?|xml|ya?ml|toml|ini|cfg|conf|rs|py|rb|go|c|h|cpp|hpp|java|kt|swift|sh|zsh|bash|fish|sql|csv|tsv|log|env|gitignore|dockerfile|makefile|lock)$/i

export function formatBytes(n: number) {
  if (n < 1000) return `${n} bytes`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1000
  let u = 0
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`
}

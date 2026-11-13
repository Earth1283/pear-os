import type { AppId } from '../apps/ids'

export type FileKind = 'text' | 'image' | 'archive' | 'audio' | 'video' | 'app' | 'disk' | 'binary'

export interface FileNode {
  type: 'file'
  kind: FileKind
  content?: string
  poster?: string
  size: number
  app?: AppId
  modified: number
  tags?: string[]
}

export interface DirNode {
  type: 'dir'
  children: Record<string, FsNode>
  modified: number
  tags?: string[]
}

export type FsNode = FileNode | DirNode

export const HOME = '/Users/pear'

const day = 86_400_000
const now = Date.now()
const f = (kind: FileKind, size: number, content?: string, ago = 3): FileNode => ({ type: 'file', kind, size, content, modified: now - ago * day })
const d = (children: Record<string, FsNode>, ago = 2): DirNode => ({ type: 'dir', children, modified: now - ago * day })
const txt = (content: string, ago?: number) => f('text', content.length, content, ago)
const app = (id: AppId): FileNode => ({ type: 'file', kind: 'app', app: id, size: 48_000_000, modified: now - 40 * day })

export const root: DirNode = d({
  Applications: d({
    'Finder.app': app('finder'),
    'AirPear.app': app('airpear'),
    'Sapphari.app': app('safari'),
    'Music.app': app('music'),
    'Chess.app': app('chess'),
    'Tetris.app': app('tetris'),
    'Notes.app': app('notes'),
    'TextEdit.app': app('textedit'),
    'Preview.app': app('preview'),
    'Calculator.app': app('calculator'),
    'Terminal.app': app('terminal'),
    'Pear Intelligence.app': app('intelligence'),
    'Passwords.app': app('passwords'),
    'pPhone Mirroring.app': app('mirroring'),
    'Activity Monitor.app': app('activity'),
    'Fractals.app': app('fractals'),
    'Boot Camp Assistant.app': app('bootcamp'),
    'Photo Booth.app': app('photobooth'),
    'Mail.app': app('mail'),
    'Disk Utility.app': app('diskutility'),
    'Software Update.app': app('softwareupdate'),
    'Screenshot.app': app('screenshot'),
    'System Settings.app': app('settings'),
  }),
  System: d({
    Library: d({
      Kernels: d({ 'pearnel.wasm': f('binary', 63_691) }),
      'CoreServices': d({ 'SystemVersion.plist': txt('ProductName: PearOS\nProductVersion: 15.1\nProductNickname: Grove\nBuildVersion: 24B83\n') }),
    }),
  }),
  Library: d({ Caches: d({ 'everything.cache': f('binary', 31_000_000_000) }) }),
  Users: d({
    pear: d({
      Desktop: d({
        'Screenshot 2025-09-16 at 9.41.07 AM.png': f('image', 2_400_000, undefined, 1),
        'Screenshot 2025-09-16 at 9.41.08 AM.png': f('image', 2_400_000, undefined, 1),
        'TODO.txt': txt('1. Learn Rust\n2. Rewrite everything in Rust\n3. Compile Rust to WebAssembly\n4. Run an operating system in a browser tab\n5. ???\n6. Profit\n', 0),
      }, 0),
      Documents: d({
        'Resume_final_FINAL_v3 (2).txt': txt('PEAR USER\nExperienced in: closing windows, opening windows, minimising windows.\nSkills: Microsoft Word (on a Pear), dragging things to the Trash.\nReferences available upon request (no).\n', 9),
        'Novel (chapter 1 of 1).txt': txt('Chapter 1\n\nIt was a dark and stormy night. The beach ball spun.\nIt spun for a very long time.\n\nThe End.\n', 30),
        'taxes.txt': txt('Income: yes\nExpenses: PearBook Pro 16" (8 GB, like 16 GB)\nDeductions: RAM upgrade ($200 per 8 GB)\n', 60),
        'Passwords (definitely not).txt': txt('password123\npassword1234\nhunter2\n', 100),
        Projects: d({
          'pear-os': d({
            'README.md': txt('# pear-os\nAn operating system inside an operating system inside a browser.\n'),
            'Cargo.toml': txt('[package]\nname = "pearnel"\nversion = "15.0.0"\n'),
          }),
        }),
      }, 5),
      Downloads: d({
        'Xcode_16.xip': f('archive', 40_100_000_000, undefined, 20),
        'Install PearOS Grove.app': app('settings'),
        'installer (3).dmg': f('disk', 120_000_000, undefined, 12),
        'installer (4).dmg': f('disk', 120_000_000, undefined, 12),
        'definitely-not-malware.zip': f('archive', 1337, undefined, 4),
        'lofi beats to debug to.mp3': f('audio', 7_200_000, undefined, 7),
      }, 1),
      Music: d({ 'U2 - Songs of Innocence (you own this now).mp3': f('audio', 9_000_000, undefined, 4000) }),
      Movies: d({ 'Screen Recording 2025-10-02 (14 hours).mov': f('video', 88_000_000_000, undefined, 30) }),
      Pictures: d({ 'Photo Booth Library': d({}), 'pear.png': f('image', 840_000) }),
      '.Trash': d({
        'feelings.txt': txt('i used to have these\n', 80),
        'Old Wallpaper (Sonoma).heic': f('image', 14_000_000, undefined, 400),
        'Untitled 14.txt': txt('', 12),
      }),
      '.zsh_history': txt('ls\ncd ..\nls\ncd -\nls\nsudo !!\n'),
    }),
  }),
})

export function normalise(path: string, cwd = HOME): string {
  let p = path.trim()
  if (p === '' ) return cwd
  if (p.startsWith('~')) p = HOME + p.slice(1)
  if (!p.startsWith('/')) p = cwd.replace(/\/$/, '') + '/' + p
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

export function resolve(path: string, cwd = HOME): FsNode | null {
  const abs = normalise(path, cwd)
  let node: FsNode = root
  for (const part of abs.split('/').filter(Boolean)) {
    if (node.type !== 'dir') return null
    const next: FsNode | undefined = node.children[part]
    if (!next) return null
    node = next
  }
  return node
}

export function parentOf(path: string) {
  const abs = normalise(path)
  const i = abs.lastIndexOf('/')
  return { dir: abs.slice(0, i) || '/', name: abs.slice(i + 1) }
}

export function writeFile(path: string, content: string, cwd = HOME): boolean {
  const abs = normalise(path, cwd)
  const { dir, name } = parentOf(abs)
  const parent = resolve(dir)
  if (!parent || parent.type !== 'dir' || !name) return false
  const existing = parent.children[name]
  if (existing && existing.type === 'dir') return false
  parent.children[name] = { type: 'file', kind: 'text', content, size: content.length, modified: Date.now() }
  parent.modified = Date.now()
  return true
}

export function mkdir(path: string, cwd = HOME): boolean {
  const { dir, name } = parentOf(normalise(path, cwd))
  const parent = resolve(dir)
  if (!parent || parent.type !== 'dir' || !name || parent.children[name]) return false
  parent.children[name] = { type: 'dir', children: {}, modified: Date.now() }
  return true
}

export function remove(path: string, cwd = HOME): boolean {
  const { dir, name } = parentOf(normalise(path, cwd))
  const parent = resolve(dir)
  if (!parent || parent.type !== 'dir' || !parent.children[name]) return false
  delete parent.children[name]
  return true
}

export function moveToTrash(path: string): boolean {
  const abs = normalise(path)
  const node = resolve(abs)
  const trash = resolve(HOME + '/.Trash')
  if (!node || !trash || trash.type !== 'dir' || abs.startsWith(HOME + '/.Trash')) return false
  const { name } = parentOf(abs)
  let target = name
  for (let i = 2; trash.children[target]; i++) target = `${name} ${i}`
  trash.children[target] = node
  return remove(abs)
}

export function canRename(path: string) {
  const abs = normalise(path)
  return abs.startsWith(HOME + '/') && abs !== HOME + '/.Trash' && !!resolve(abs)
}

export function rename(path: string, to: string): { path: string } | { error: string } | null {
  const abs = normalise(path)
  const { dir, name } = parentOf(abs)
  const parent = resolve(dir)
  const next = to.trim()
  if (!next || next === name || !parent || parent.type !== 'dir' || !parent.children[name] || !canRename(abs)) return null
  if (next.includes('/')) return { error: 'Names can’t contain “/”. The slash is reserved for paths, and for fan fiction.' }
  if (next === '.' || next === '..') return { error: `“${next}” is reserved by the system. It was here first.` }
  if (parent.children[next]) return { error: `The name “${next}” is already taken. Please choose a different name.` }
  const children = Object.fromEntries(Object.entries(parent.children).map(([k, v]) => (k === name ? [next, v] : [k, v])))
  parent.children = children
  parent.modified = Date.now()
  return { path: `${dir === '/' ? '' : dir}/${next}` }
}

export function listDir(node: DirNode, showHidden = false) {
  return Object.entries(node.children)
    .filter(([name]) => showHidden || !name.startsWith('.'))
    .sort(([a, an], [b, bn]) => (an.type === bn.type ? a.localeCompare(b) : an.type === 'dir' ? -1 : 1))
}

export function sizeOf(node: FsNode): number {
  return node.type === 'file' ? node.size : Object.values(node.children).reduce((s, c) => s + sizeOf(c), 0)
}

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

export function addNode(dirPath: string, name: string, node: FsNode): string | null {
  const dir = resolve(dirPath)
  if (!dir || dir.type !== 'dir') return null
  const dot = node.type === 'file' && name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length
  const base = name.slice(0, dot)
  const ext = name.slice(dot)
  let target = name
  for (let i = 2; dir.children[target]; i++) target = `${base} ${i}${ext}`
  dir.children[target] = node
  dir.modified = Date.now()
  return target
}

export function cloneNode<T extends FsNode>(n: T): T {
  return structuredClone(n)
}

export function toggleTag(path: string, tag: string) {
  const n = resolve(path)
  if (!n) return
  const tags = new Set(n.tags ?? [])
  if (tags.has(tag)) tags.delete(tag)
  else tags.add(tag)
  n.tags = [...tags]
}

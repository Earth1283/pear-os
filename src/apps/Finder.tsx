import { useEffect, useState } from 'react'
import { AppWindow, ChevronLeft, ChevronRight, Clock, Cloud, Download, FileText, HardDrive, LayoutGrid, List, Monitor, Radio, Search, Trash2, House } from 'lucide-react'
import { useOS, os, type Win } from '../store'
import { HOME, formatBytes, listDir, normalise, resolve, sizeOf } from '../lib/fs'
import { FileIcon, FolderIcon, AppIcon } from '../components/icons'
import { TAG_COLORS } from '../components/ContextMenu'
import { menu } from '../lib/menu'
import { fileMenu, folderMenu } from '../lib/menus'
import { openPath } from './open'
import { DriveView } from './Drive'
import { useBackend } from '../lib/backend'
import { Server } from 'lucide-react'

const SIDEBAR = [
  {
    head: 'Favorites',
    items: [
      { label: 'AirDrop', icon: Radio, path: 'airdrop' },
      { label: 'Recents', icon: Clock, path: 'recents' },
      { label: 'Applications', icon: AppWindow, path: '/Applications' },
      { label: 'Desktop', icon: Monitor, path: HOME + '/Desktop' },
      { label: 'Documents', icon: FileText, path: HOME + '/Documents' },
      { label: 'Downloads', icon: Download, path: HOME + '/Downloads' },
      { label: 'pear', icon: House, path: HOME },
    ],
  },
  {
    head: 'Locations',
    items: [
      { label: 'Pear HD', icon: HardDrive, path: '/' },
      { label: 'iCloud Drive (Full)', icon: Cloud, path: 'icloud' },
      { label: 'Trash', icon: Trash2, path: HOME + '/.Trash' },
    ],
  },
]

const TAGS = [
  ['Red', '#ff453a'],
  ['Orange', '#ff9f0a'],
  ['Yellow', '#ffd60a'],
  ['Green', '#30d158'],
  ['Blue', '#0a84ff'],
  ['Purple', '#bf5af2'],
]

function prettyName(path: string) {
  if (path === '/') return 'Pear HD'
  if (path === HOME + '/.Trash') return 'Trash'
  return path.split('/').pop()!
}

function Special({ path }: { path: string }) {
  if (path === 'airdrop')
    return (
      <div className="finder-special">
        <Radio size={64} strokeWidth={1.2} />
        <h3>AirDrop</h3>
        <p>Looking for people nearby… found 14 strangers on this train. All of them want to send you a picture.</p>
      </div>
    )
  if (path === 'icloud')
    return (
      <div className="finder-special">
        <Cloud size={64} strokeWidth={1.2} />
        <h3>iCloud Drive is Full</h3>
        <p>You are using 5 GB of 5 GB. Upgrade to iCloud+ to store your photos of receipts for iCloud+.</p>
        <button className="btn primary">Upgrade for $0.99/month forever</button>
      </div>
    )
  return null
}

export function Finder({ win }: { win: Win }) {
  useOS((s) => s.fsVersion)
  const [history, setHistory] = useState<string[]>([(win.props.path as string) ?? HOME + '/Desktop'])
  const [idx, setIdx] = useState(0)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('')
  const path = history[idx]
  const authed = useBackend((s) => s.authed)
  const host = useBackend((s) => s.sys?.hostname)
  const isDrive = path.startsWith('drive:')
  const driveRel = isDrive ? path.slice(6) || '/' : ''
  const special = !path.startsWith('/') && path !== 'recents' && !isDrive
  const groups = authed
    ? [
        ...SIDEBAR,
        {
          head: host ? `On ${host}` : 'pearosd',
          items: [
            { label: 'PearDrive', icon: Server, path: 'drive:/' },
            { label: 'PearDrive Trash', icon: Trash2, path: 'drive:/.Trash' },
          ],
        },
      ]
    : SIDEBAR
  const setTitle = useOS((s) => s.setTitle)

  useEffect(() => {
    const p = win.props.path as string | undefined
    if (p && p !== history[idx]) go(p)
  }, [win.props.path])

  useEffect(() => {
    setTitle(win.id, isDrive ? (driveRel === '/' ? 'PearDrive' : driveRel === '/.Trash' ? 'PearDrive Trash' : driveRel.split('/').pop()!) : path === 'recents' ? 'Recents' : special ? (path === 'icloud' ? 'iCloud Drive' : 'AirDrop') : prettyName(path))
  }, [path])

  const go = (p: string) => {
    const next = p.startsWith('/') ? normalise(p) : p
    setHistory([...history.slice(0, idx + 1), next])
    setIdx(idx + 1)
    setSel(null)
  }

  let entries: [string, ReturnType<typeof resolve>][] = []
  if (path === 'recents') {
    const all: [string, NonNullable<ReturnType<typeof resolve>>][] = []
    const walk = (dir: string) => {
      const n = resolve(dir)
      if (!n || n.type !== 'dir') return
      for (const [name, c] of listDir(n)) {
        if (c.type === 'dir') walk(`${dir}/${name}`)
        else all.push([`${dir}/${name}`, c])
      }
    }
    walk(HOME)
    entries = all.sort((a, b) => b[1].modified - a[1].modified).slice(0, 12)
  } else if (!special) {
    const n = resolve(path)
    if (n?.type === 'dir') entries = listDir(n).map(([name, c]) => [`${path === '/' ? '' : path}/${name}`, c])
  }
  if (q) entries = entries.filter(([p]) => p.split('/').pop()!.toLowerCase().includes(q.toLowerCase()))
  if (sort) {
    const key = (p: string, n: NonNullable<ReturnType<typeof resolve>>): string | number =>
      sort === 'Size' ? -sizeOf(n) : sort === 'Date Modified' ? -n.modified : sort === 'Kind' ? (n.type === 'dir' ? ' ' : n.kind) + p : p.split('/').pop()!.toLowerCase()
    entries = [...entries].sort(([a, an], [b, bn]) => {
      const ka = key(a, an!)
      const kb = key(b, bn!)
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })
  }
  const tagDots = (n: NonNullable<ReturnType<typeof resolve>>) => (n.tags ?? []).map((t) => <i key={t} className="tag-dot" style={{ background: TAG_COLORS[t] }} />)

  const icon = (p: string, node: NonNullable<ReturnType<typeof resolve>>, size: number) => {
    const name = p.split('/').pop()!
    if (node.type === 'dir') return <FolderIcon size={size} />
    if (node.kind === 'app' && node.app) return <AppIcon app={node.app} size={size} />
    return <FileIcon size={size} kind={node.kind} ext={name.includes('.') ? name.split('.').pop()! : ''} />
  }

  return (
    <div className="finder" onPointerDown={() => setSel(null)}>
      <aside className="sidebar" data-drag>
        <div className="sidebar-spacer" />
        {groups.map((g) => (
          <div key={g.head} className="sb-group">
            <div className="sb-head">{g.head}</div>
            {g.items.map((it) => (
              <button key={it.path} className={`sb-item ${path === it.path ? 'active' : ''}`} onClick={() => go(it.path)}>
                <it.icon size={15} strokeWidth={2} />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="sb-group">
          <div className="sb-head">Tags</div>
          {TAGS.map(([name, c]) => (
            <div key={name} className="sb-item tag">
              <span className="dot" style={{ background: c }} />
              <span>{name}</span>
            </div>
          ))}
        </div>
      </aside>
      <section className="finder-main">
        <div className="toolbar" data-drag>
          <div className="nav-btns">
            <button disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label="Back">
              <ChevronLeft size={18} />
            </button>
            <button disabled={idx === history.length - 1} onClick={() => setIdx(idx + 1)} aria-label="Forward">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="toolbar-title">{win.title}</div>
          <div className="seg">
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="Icons">
              <LayoutGrid size={14} />
            </button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="List">
              <List size={14} />
            </button>
          </div>
          <label className="search-field">
            <Search size={13} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
          </label>
        </div>
        <div className="finder-content" onContextMenu={special || isDrive || path === 'recents' ? undefined : menu(() => folderMenu(path, { view, setView, sort, setSort }))}>
          {isDrive ? (
            <DriveView rel={driveRel} view={view} setView={setView} q={q} onOpenDir={(r) => go('drive:' + r)} />
          ) : special ? (
            <Special path={path} />
          ) : entries.length === 0 ? (
            <div className="finder-empty">{q ? 'No results. Spotlight is still indexing (since 2019).' : 'This folder is empty, like the promises in the keynote.'}</div>
          ) : view === 'grid' ? (
            <div className="icon-grid">
              {entries.map(([p, node]) => (
                <button
                  key={p}
                  className={`grid-item ${sel === p ? 'sel' : ''}`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setSel(p)
                  }}
                  onDoubleClick={() => (node!.type === 'dir' ? go(p) : openPath(p))}
                  onContextMenu={(e) => {
                    setSel(p)
                    menu(fileMenu(p))(e)
                  }}
                >
                  {icon(p, node!, 56)}
                  <span>
                    {p.split('/').pop()}
                    {tagDots(node!)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <table className="list-view">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Date Modified</th>
                  <th>Size</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([p, node]) => (
                  <tr
                    key={p}
                    className={sel === p ? 'sel' : ''}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      setSel(p)
                    }}
                    onDoubleClick={() => (node!.type === 'dir' ? go(p) : openPath(p))}
                    onContextMenu={(e) => {
                      setSel(p)
                      menu(fileMenu(p))(e)
                    }}
                  >
                    <td>
                      <span className="lv-name">
                        {icon(p, node!, 18)}
                        {p.split('/').pop()}
                        {tagDots(node!)}
                      </span>
                    </td>
                    <td>{new Date(node!.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td>{node!.type === 'dir' ? '--' : formatBytes(sizeOf(node!))}</td>
                    <td>{node!.type === 'dir' ? 'Folder' : node!.kind === 'app' ? 'Application' : node!.kind[0].toUpperCase() + node!.kind.slice(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="statusbar" hidden={isDrive}>
          {entries.length} items, 0.1 GB available (of 8 GB, which is like 16 GB)
          {path === HOME + '/.Trash' && entries.length > 0 && (
            <button
              className="btn small"
              onClick={() =>
                os().notify({ app: 'trash', title: 'Empty Trash', body: 'Are you sure? Items in the Trash have feelings. (One of them literally is feelings.txt.)' })
              }
            >
              Empty
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

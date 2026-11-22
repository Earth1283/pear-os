import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { AppWindow, ChevronLeft, ChevronRight, Clock, Cloud, Download, FileText, HardDrive, LayoutGrid, List, Monitor, Radio, Search, Trash2, House, Columns3, GalleryHorizontal, Plus, X, Server } from 'lucide-react'
import { useOS, os, type Win } from '../store'
import { HOME, canRename, formatBytes, listDir, moveNode, moveToTrash, normalise, parentOf, rename, resolve, sizeOf, type FsNode } from '../lib/fs'
import { playTrashMove } from '../lib/sounds'
import { RenameField, useEnterToRename } from '../components/RenameField'
import { FileIcon, FolderIcon, AppIcon, fileThumb } from '../components/icons'
import { TAG_COLORS } from '../components/ContextMenu'
import { menu } from '../lib/menu'
import { fileMenu, folderMenu } from '../lib/menus'
import { openPath } from './open'
import { DriveView } from './Drive'
import { drive, useBackend } from '../lib/backend'
import { openVirtualQuickLook, virtualLookItem, type QuickLookItem } from '../lib/quickLook'
import { useQuickLookShortcut } from '../components/useQuickLookShortcut'
import { QuickLookContent, QuickLookIcon } from '../components/QuickLook'
import { FINDER_VIEWS, finderCommands, showFileInfo, type FinderView } from './finderCommands'
import './Finder.css'

const SIDEBAR = [
  {
    head: 'Favorites',
    items: [
      { label: 'AirPear', icon: Radio, path: 'airdrop' },
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
        <h3>AirPear</h3>
        <p>Send files directly to another PearOS, including over your local network.</p>
        <button className="btn" onClick={() => os().openApp('airpear')}>Open AirPear</button>
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

const VIEW_ICONS = { grid: LayoutGrid, list: List, columns: Columns3, gallery: GalleryHorizontal }
const DEFAULT_PATH = HOME + '/Desktop'

interface FinderTab {
  id: number
  history: string[]
  index: number
  selection: string | null
  view: FinderView
  columnRoot: string
  query: string
  sort: string
}

function newTab(id: number, path: string, view: FinderView = 'grid', selection: string | null = null): FinderTab {
  return { id, history: [path], index: 0, selection, view, columnRoot: path, query: '', sort: '' }
}

function locationName(path: string) {
  if (path === 'recents') return 'Recents'
  if (path === 'icloud') return 'iCloud Drive'
  if (path === 'airdrop') return 'AirPear'
  if (path === 'drive:/') return 'PearDrive'
  if (path === 'drive:/.Trash') return 'PearDrive Trash'
  return prettyName(path)
}

function icon(path: string, node: FsNode, size: number) {
  const name = parentOf(path).name
  if (node.type === 'dir') return <FolderIcon size={size} />
  if (node.app) return <AppIcon app={node.app} size={size} />
  return <FileIcon size={size} kind={node.kind} ext={name.includes('.') ? name.split('.').pop()! : ''} thumb={fileThumb(node)} />
}

function entriesIn(path: string): [string, FsNode][] {
  const node = resolve(path)
  return node?.type === 'dir' ? listDir(node).map(([name, child]) => [`${path.replace(/\/$/, '')}/${name}`, child]) : []
}

function columnPaths(path: string, anchor: string) {
  const root = anchor.startsWith('/') && (path === anchor || path.startsWith(anchor.replace(/\/$/, '') + '/')) ? anchor : path
  const paths = [path]
  while (paths[0] !== root) paths.unshift(parentOf(paths[0]).dir)
  return paths
}

function kindName(item: QuickLookItem) {
  return item.dir ? 'Folder' : item.kind === 'app' ? 'Application' : item.kind[0].toUpperCase() + item.kind.slice(1)
}

export function Finder({ win }: { win: Win }) {
  if (typeof win.props.infoPath === 'string') return <FileInfo win={win} path={win.props.infoPath} />
  return <FinderBrowser win={win} />
}

function FileInfo({ win, path }: { win: Win; path: string }) {
  const version = useOS((s) => s.fsVersion)
  const driveRoot = useBackend((s) => s.sys?.root)
  const item = path.startsWith('drive:') ? win.props.infoItem as QuickLookItem | undefined : virtualLookItem(path)
  const location = item?.source === 'drive' ? (driveRoot ?? 'PearDrive') + parentOf(item.path).dir : parentOf(path).dir
  const tags = item?.source === 'virtual' ? resolve(path)?.tags : undefined
  useEffect(() => {
    os().setTitle(win.id, item ? `${item.name} Info` : 'Get Info')
  }, [win.id, item?.name])
  if (!item) return <div className="finder-empty">This item is no longer available.</div>
  return (
    <div className="file-info">
      <header data-drag><QuickLookIcon item={item} size={46} /><div><strong>{item.name}</strong><small>{kindName(item)} · {formatBytes(item.size)}</small></div></header>
      <div className="file-info-body">
        <details open>
          <summary>General</summary>
          <dl>
            <dt>Kind</dt><dd>{kindName(item)}</dd>
            <dt>Size</dt><dd>{formatBytes(item.size)}</dd>
            <dt>Where</dt><dd>{location}</dd>
            <dt>Modified</dt><dd>{new Date(item.modified).toLocaleString()}</dd>
            {tags?.length ? <><dt>Tags</dt><dd>{tags.join(', ')}</dd></> : null}
          </dl>
        </details>
        <details>
          <summary>Preview</summary>
          <div className="file-info-preview"><QuickLookContent key={version} item={item} /></div>
        </details>
      </div>
    </div>
  )
}

function FinderBrowser({ win }: { win: Win }) {
  const version = useOS((s) => s.fsVersion)
  const [tabs, setTabs] = useState(() => [newTab(1, typeof win.props.path === 'string' ? win.props.path : DEFAULT_PATH, 'grid', typeof win.props.reveal === 'string' ? win.props.reveal : null)])
  const [activeId, setActiveId] = useState(1)
  const nextId = useRef(2)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [goFolder, setGoFolder] = useState(!!win.props.goToFolder)
  const [folderInput, setFolderInput] = useState('')
  const [folderError, setFolderError] = useState('')
  const [checkingFolder, setCheckingFolder] = useState(false)
  const folderRequest = useRef(0)
  const folderField = useRef<HTMLInputElement>(null)
  const goOpener = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const columns = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const driveInfo = useRef<(() => void) | null>(null)
  const tab = tabs.find((item) => item.id === activeId) ?? tabs[0]
  const path = tab.history[tab.index]
  const { view, selection: sel, query: q, sort } = tab
  const authed = useBackend((s) => s.authed)
  const host = useBackend((s) => s.sys?.hostname)
  const focused = useOS((s) => s.focused === win.id)
  const showPathBar = useOS((s) => s.finderPathBar)
  const showStatusBar = useOS((s) => s.finderStatusBar)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const isDrive = path.startsWith('drive:')
  const driveRel = isDrive ? path.slice(6) || '/' : ''
  const special = !path.startsWith('/') && path !== 'recents' && !isDrive
  const inColumns = view === 'columns' && path.startsWith('/') && !q
  const patch = (values: Partial<FinderTab>) => setTabs((all) => all.map((item) => item.id === tab.id ? { ...item, ...values } : item))
  const setSel = (selection: string | null) => patch({ selection })
  const setView = (next: FinderView) => patch({ view: next, columnRoot: path })
  const currentId = tab.id
  const activateTab = (id: number) => {
    setActiveId(id)
    setRenaming(null)
  }
  const createTab = () => {
    const id = nextId.current++
    setTabs((all) => [...all, newTab(id, path, view)])
    activateTab(id)
  }
  const closeTab = (id: number) => {
    if (tabs.length === 1) return false
    if (id === tab.id) {
      const i = tabs.findIndex((item) => item.id === id)
      activateTab(tabs[i + 1]?.id ?? tabs[i - 1].id)
    }
    setTabs((all) => all.filter((item) => item.id !== id))
    return true
  }
  const go = (p: string, selection: string | null = null, keepColumns = false) => {
    const next = p.startsWith('/') ? normalise(p) : p
    patch({
      selection, query: '',
      ...(next !== path ? { history: [...tab.history.slice(0, tab.index + 1), next], index: tab.index + 1 } : {}),
      ...(keepColumns ? {} : { columnRoot: next }),
    })
    setRenaming(null)
  }
  const step = (by: number) => {
    const index = tab.index + by
    if (index < 0 || index >= tab.history.length) return
    patch({ index, selection: null, query: '' })
    setRenaming(null)
  }
  const startRename = (p: string) => canRename(p) && setRenaming(p)
  useEnterToRename(focused && !goFolder && !isDrive && renaming === null, sel, startRename)

  const commit = (from: string, to: string) => {
    setRenaming(null)
    const res = rename(from, to)
    if (!res) return
    if ('error' in res) return os().notify({ app: 'finder', title: 'Finder', body: res.error })
    const relocated = (value: string) => value === from || value.startsWith(from + '/') ? res.path + value.slice(from.length) : value
    setTabs((all) => all.map((item) => ({
      ...item,
      history: item.history.map(relocated),
      columnRoot: relocated(item.columnRoot),
      selection: item.id === tab.id ? res.path : item.selection && relocated(item.selection),
    })))
    os().bumpFs()
  }
  const showGo = () => {
    if (goFolder) return
    goOpener.current = document.activeElement as HTMLElement
    setFolderInput('')
    setFolderError('')
    setGoFolder(true)
  }
  const closeGo = () => {
    folderRequest.current++
    setCheckingFolder(false)
    setGoFolder(false)
    const opener = goOpener.current
    requestAnimationFrame(() => {
      if (opener?.isConnected && root.current?.contains(opener)) opener.focus()
      else content.current?.focus()
    })
  }
  const submitGo = async () => {
    if (!folderInput.trim() || checkingFolder) return
    if (folderInput.startsWith('drive:') || (isDrive && !folderInput.startsWith('~'))) {
      const target = folderInput.replace(/^drive:/, '')
      const next = normalise(target, driveRel || '/')
      const request = ++folderRequest.current
      setCheckingFolder(true)
      try {
        await drive.list(next)
        if (folderRequest.current !== request) return
        go('drive:' + next)
        closeGo()
      } catch {
        if (folderRequest.current !== request) return
        setFolderError('The folder could not be found on PearDrive.')
        setCheckingFolder(false)
        folderField.current?.focus()
      }
      return
    }
    const next = normalise(folderInput, path.startsWith('/') ? path : HOME)
    if (resolve(next)?.type !== 'dir') {
      setFolderError('The folder could not be found.')
      folderField.current?.focus()
      return
    }
    go(next)
    closeGo()
  }

  useEffect(() => {
    finderCommands.set(win.id, {
      hasTabs: tabs.length > 1,
      newTab: createTab,
      closeTab: () => closeTab(tab.id),
      getInfo: () => {
        if (isDrive) driveInfo.current?.()
        else if (selectedPath) showFileInfo(selectedPath)
      },
      goToFolder: showGo,
      setView,
    })
    return () => { finderCommands.delete(win.id) }
  })
  useEffect(() => () => { folderRequest.current++ }, [])
  useEffect(() => { os().setTitle(win.id, locationName(path)) }, [win.id, path])
  useEffect(() => {
    const p = win.props.path
    if (typeof p === 'string' && p !== path) go(p, typeof win.props.reveal === 'string' ? win.props.reveal : null)
  }, [win.props.path, win.props.reveal])
  useLayoutEffect(() => {
    if (columns.current) columns.current.scrollLeft = columns.current.scrollWidth
  }, [path, view, currentId, sel])
  useLayoutEffect(() => {
    if (!win.props.reveal) return
    content.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [win.props.reveal])

  let entries: [string, FsNode][] = []
  if (path === 'recents') {
    const all: [string, FsNode][] = []
    const walk = (dir: string) => {
      for (const [p, node] of entriesIn(dir)) {
        if (node.type === 'dir') walk(p)
        else all.push([p, node])
      }
    }
    walk(HOME)
    entries = all.sort((a, b) => b[1].modified - a[1].modified).slice(0, 12)
  } else if (path.startsWith('/')) entries = entriesIn(path)
  if (q) entries = entries.filter(([p]) => parentOf(p).name.toLowerCase().includes(q.toLowerCase()))
  if (sort) {
    const key = (p: string, n: FsNode) =>
      sort === 'Size' ? -sizeOf(n) : sort === 'Date Modified' ? -n.modified : sort === 'Kind' ? (n.type === 'dir' ? ' ' : n.kind) + p : parentOf(p).name.toLowerCase()
    entries = entries.map((row) => ({ row, k: key(...row) }))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
      .map(({ row }) => row)
  }
  const paths = entries.map(([p]) => p)
  const quickLook = (p: string) => openVirtualQuickLook(p, paths.includes(p) ? paths : undefined, (item) => {
    if (inColumns && parentOf(item.path).dir !== path) go(parentOf(item.path).dir, item.path, true)
    else setSel(item.path)
  })
  const gallery = view === 'gallery' && !isDrive && !special
  const galleryPath = gallery ? (sel && paths.includes(sel) ? sel : paths[0]) : undefined
  const selectedPath = galleryPath ?? sel
  useQuickLookShortcut(focused && !goFolder && !isDrive && !special && renaming === null, selectedPath, quickLook)
  const preview = (gallery || inColumns) && selectedPath && selectedPath !== path ? virtualLookItem(selectedPath) : null
  const activeColumns = inColumns ? columnPaths(path, tab.columnRoot) : []

  const fileName = (p: string, node: FsNode) => renaming === p
    ? <RenameField name={parentOf(p).name} dir={node.type === 'dir'} onDone={(to) => commit(p, to)} onCancel={() => setRenaming(null)} />
    : <span>{parentOf(p).name}{(node.tags ?? []).map((t) => <i key={t} className="tag-dot" style={{ background: TAG_COLORS[t] }} />)}</span>
  const open = (p: string, node: FsNode) => node.type === 'dir' ? go(p, null, inColumns) : openPath(p)
  const dropOnDir = (fromPath: string, targetDir: string) => {
    if (!fromPath || !targetDir.startsWith('/')) return
    if (targetDir === HOME + '/.Trash') {
      if (moveToTrash(fromPath)) {
        playTrashMove()
        setSel(null)
        os().bumpFs()
      }
      return
    }
    const moved = moveNode(fromPath, targetDir)
    if (moved) {
      setSel(null)
      os().bumpFs()
    }
  }
  const dragProps = (p: string, isDir: boolean) => ({
    draggable: canRename(p),
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('application/x-pearos-path', p)
      e.dataTransfer.effectAllowed = 'move'
    },
    ...(isDir ? {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('application/x-pearos-path')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropTarget(p)
      },
      onDragLeave: () => setDropTarget((cur) => (cur === p ? null : cur)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        setDropTarget(null)
        const from = e.dataTransfer.getData('application/x-pearos-path')
        if (from && from !== p) dropOnDir(from, p)
      },
    } : {}),
  })
  const pathCrumbs = path.startsWith('/') ? (() => {
    const parts = path.split('/').filter(Boolean)
    const list = [{ label: 'Pear HD', path: '/' }]
    let acc = ''
    for (const part of parts) {
      acc += '/' + part
      list.push({ label: part === '.Trash' ? 'Trash' : part, path: acc })
    }
    return list
  })() : []
  const itemMenu = (e: MouseEvent, p: string) => {
    setSel(p)
    menu(fileMenu(p, { rename: () => startRename(p), quickLook: () => quickLook(p) }))(e)
  }
  const selectColumn = (p: string, node: FsNode, directory: string) => node.type === 'dir' ? go(p, p, true) : go(directory, p, true)
  const browseKeys = (e: KeyboardEvent) => {
    if ((!gallery && !inColumns) || e.metaKey || e.ctrlKey || e.altKey || renaming || (e.target as HTMLElement).matches('input, textarea, audio, video, [contenteditable], pre')) return
    const direction = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
    if (!direction) return
    if (inColumns && e.key === 'ArrowLeft' && activeColumns.length > 1) {
      e.preventDefault()
      go(parentOf(path).dir, path, true)
      content.current?.focus()
      return
    }
    if (inColumns && e.key === 'ArrowRight') {
      const node = sel && resolve(sel)
      if (node && node.type === 'dir') { e.preventDefault(); go(sel!, null, true) }
      return
    }
    if (!paths.length) return
    e.preventDefault()
    const index = selectedPath ? paths.indexOf(selectedPath) : -1
    setSel(paths[Math.max(0, Math.min(paths.length - 1, index + direction))])
    content.current?.focus()
  }
  useLayoutEffect(() => {
    if (galleryPath) content.current?.querySelector('.finder-filmstrip .sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [galleryPath])

  const groups = authed ? [...SIDEBAR, { head: host ? `On ${host}` : 'pearosd', items: [
    { label: 'PearDrive', icon: Server, path: 'drive:/' },
    { label: 'PearDrive Trash', icon: Trash2, path: 'drive:/.Trash' },
  ] }] : SIDEBAR

  const previewPane = preview && <div className="finder-preview-pane" data-nodrag>
    <div className="finder-preview-content"><QuickLookContent key={`${preview.path}:${version}`} item={preview} /></div>
    <footer><strong title={preview.name}>{preview.name}</strong><span>{kindName(preview)} · {formatBytes(preview.size)}</span>
      <button className="btn small" onClick={() => quickLook(preview.path)}>Quick Look</button></footer>
  </div>

  return (
    <div ref={root} className="finder">
      <aside className="sidebar" data-drag>
        <div className="sidebar-spacer" />
        {groups.map((g) => (
          <div key={g.head} className="sb-group">
            <div className="sb-head">{g.head}</div>
            {g.items.map((it) => {
              const canDrop = it.path.startsWith('/') && (it.path.startsWith(HOME) || it.path === '/')
              return (
                <button
                  key={it.path}
                  className={`sb-item ${path === it.path ? 'active' : ''} ${dropTarget === it.path ? 'drop-target' : ''}`}
                  onClick={() => it.path === 'airdrop' ? os().openApp('airpear') : go(it.path)}
                  onDragOver={canDrop ? (e) => {
                    if (!e.dataTransfer.types.includes('application/x-pearos-path')) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDropTarget(it.path)
                  } : undefined}
                  onDragLeave={canDrop ? () => setDropTarget((cur) => (cur === it.path ? null : cur)) : undefined}
                  onDrop={canDrop ? (e) => {
                    e.preventDefault()
                    setDropTarget(null)
                    const from = e.dataTransfer.getData('application/x-pearos-path')
                    if (from) dropOnDir(from, it.path)
                  } : undefined}
                >
                  <it.icon size={15} strokeWidth={2} /><span>{it.label}</span>
                </button>
              )
            })}
          </div>
        ))}
        <div className="sb-group">
          <div className="sb-head">Tags</div>
          {TAGS.map(([name, color]) => <div key={name} className="sb-item tag"><span className="dot" style={{ background: color }} /><span>{name}</span></div>)}
        </div>
      </aside>
      <section className="finder-main">
        <div className="toolbar" data-drag>
          <div className="nav-btns">
            <button disabled={tab.index === 0} onClick={() => step(-1)} aria-label="Back"><ChevronLeft size={18} /></button>
            <button disabled={tab.index === tab.history.length - 1} onClick={() => step(1)} aria-label="Forward"><ChevronRight size={18} /></button>
          </div>
          <div className="toolbar-title">{win.title}</div>
          <div className="seg finder-views">
            {FINDER_VIEWS.map(({ id, label }) => {
              const Icon = VIEW_ICONS[id]
              return <button key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)} aria-label={label} title={label} aria-pressed={view === id}><Icon size={14} /></button>
            })}
          </div>
          <label className="search-field"><Search size={13} /><input value={q} onChange={(e) => patch({ query: e.target.value, selection: null })} placeholder="Search" /></label>
        </div>
        {tabs.length > 1 && <div className="finder-tabs">
          <div role="tablist" aria-label="Finder tabs">
            {tabs.map((item, index) => <div key={item.id} className={item.id === tab.id ? 'active' : ''}>
              <button id={`finder-tab-${win.id}-${item.id}`} type="button" role="tab" aria-selected={item.id === tab.id} aria-controls={`finder-content-${win.id}`} tabIndex={item.id === tab.id ? 0 : -1}
                onClick={() => activateTab(item.id)} title={item.history[item.index]} onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                  e.preventDefault()
                  const next = tabs[(index + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length].id
                  activateTab(next)
                  document.getElementById(`finder-tab-${win.id}-${next}`)?.focus()
                }}>{locationName(item.history[item.index])}</button>
              <button type="button" className="finder-tab-close" aria-label={`Close ${locationName(item.history[item.index])} tab`} onClick={() => closeTab(item.id)}><X size={12} /></button>
            </div>)}
          </div>
          <button type="button" aria-label="New Tab" onClick={createTab}><Plus size={15} /></button>
        </div>}
        <div ref={content} id={`finder-content-${win.id}`} role={tabs.length > 1 ? 'tabpanel' : undefined} aria-labelledby={tabs.length > 1 ? `finder-tab-${win.id}-${tab.id}` : undefined}
          className={`finder-content ${inColumns || gallery || (isDrive && (view === 'columns' || view === 'gallery')) ? 'finder-preview-view' : ''}`} tabIndex={-1} onKeyDown={browseKeys}
          onPointerDown={(e) => { if (e.target === e.currentTarget) setSel(null) }}
          onContextMenu={special || isDrive || path === 'recents' ? undefined : menu(() => folderMenu(path, { view, setView, sort, setSort: (value) => patch({ sort: value }) }))}>
          {isDrive ? <DriveView key={tab.id} rel={driveRel} columnRoot={tab.columnRoot.startsWith('drive:') ? tab.columnRoot.slice(6) : driveRel} revealName={sel}
            view={view} setView={setView} q={q} active={focused && !goFolder} onOpenDir={(rel, selection) => go('drive:' + rel, selection, view === 'columns')} infoCommand={driveInfo} />
            : special ? <Special path={path} />
            : inColumns ? <div ref={columns} className="finder-columns">
              {activeColumns.map((dir, i) => <div className="finder-column" key={dir} aria-label={prettyName(dir)}>
                <div className="finder-column-title">{prettyName(dir)}</div>
                {(i === activeColumns.length - 1 ? entries : entriesIn(dir)).map(([p, node]) => (
                  <button key={p} className={`finder-column-item ${(activeColumns[i + 1] ?? sel) === p ? 'sel' : ''}`} onClick={() => selectColumn(p, node, dir)}
                    onDoubleClick={() => { if (node.type === 'file') openPath(p) }} onContextMenu={(e) => itemMenu(e, p)}>
                    {icon(p, node, 18)}{fileName(p, node)}{node.type === 'dir' && <ChevronRight size={13} />}
                  </button>
                ))}
              </div>)}
              {previewPane}
            </div>
            : !entries.length ? <div className="finder-empty">{q ? 'No results.' : 'This folder is empty, like the promises in the keynote.'}</div>
            : gallery ? <div className="finder-gallery">
              {previewPane}
              <div className="finder-filmstrip">{entries.map(([p, node]) => (
                <button key={p} className={`grid-item ${galleryPath === p ? 'sel' : ''}`} onClick={() => setSel(p)} onDoubleClick={() => open(p, node)} onContextMenu={(e) => itemMenu(e, p)} title={parentOf(p).name}>
                  {icon(p, node, 42)}{fileName(p, node)}
                </button>
              ))}</div>
            </div>
            : view === 'grid' ? <div className="icon-grid">{entries.map(([p, node]) => (
              <button key={p} {...dragProps(p, node.type === 'dir')} className={`grid-item ${sel === p ? 'sel' : ''} ${dropTarget === p ? 'drop-target' : ''}`} onClick={() => setSel(p)} onDoubleClick={() => open(p, node)} onContextMenu={(e) => itemMenu(e, p)}>
                {icon(p, node, 56)}{fileName(p, node)}
              </button>
            ))}</div> : <table className="list-view">
              <thead><tr><th>Name</th><th>Date Modified</th><th>Size</th><th>Kind</th></tr></thead>
              <tbody>{entries.map(([p, node]) => (
                <tr key={p} tabIndex={0} {...dragProps(p, node.type === 'dir')} className={`${sel === p ? 'sel' : ''} ${dropTarget === p ? 'drop-target' : ''}`} onClick={() => setSel(p)} onDoubleClick={() => open(p, node)} onContextMenu={(e) => itemMenu(e, p)}>
                  <td><span className="lv-name">{icon(p, node, 18)}{fileName(p, node)}</span></td>
                  <td>{new Date(node.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td>{node.type === 'dir' ? '--' : formatBytes(sizeOf(node))}</td>
                  <td>{node.type === 'dir' ? 'Folder' : node.kind === 'app' ? 'Application' : node.kind[0].toUpperCase() + node.kind.slice(1)}</td>
                </tr>
              ))}</tbody>
            </table>}
        </div>
        {showPathBar && !isDrive && pathCrumbs.length > 0 && (
          <nav className="finder-pathbar" aria-label="Path">
            {pathCrumbs.map((c, idx) => (
              <span key={c.path} className="finder-crumb-wrap">
                {idx > 0 && <ChevronRight size={11} className="finder-crumb-sep" aria-hidden />}
                <button
                  type="button"
                  className={`finder-crumb ${c.path === path ? 'current' : ''}`}
                  onClick={() => go(c.path)}
                >
                  {idx === 0 ? <HardDrive size={12} /> : <FolderIcon size={13} />}
                  <span>{c.label}</span>
                </button>
              </span>
            ))}
          </nav>
        )}
        <div className="statusbar" hidden={isDrive || !showStatusBar}>
          {entries.length} {entries.length === 1 ? 'item' : 'items'}, 0.1 GB available (of 8 GB, which is like 16 GB)
          {path === HOME + '/.Trash' && entries.length > 0 && <button className="btn small" onClick={() => os().openDialog({ kind: 'empty-trash' })}>Empty</button>}
        </div>
      </section>
      {goFolder && <div className="finder-sheet-wrap" data-nodrag onPointerDown={(e) => { if (e.target === e.currentTarget) closeGo() }}>
        <form className="finder-sheet glass" role="dialog" aria-modal="true" aria-label="Go to Folder" onSubmit={(e) => { e.preventDefault(); submitGo() }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeGo() }
            if (e.key === 'Tab') {
              const fields = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)')]
              const next = (fields.indexOf(document.activeElement as HTMLElement) + (e.shiftKey ? -1 : 1) + fields.length) % fields.length
              e.preventDefault()
              fields[next]?.focus()
            }
          }}>
          <label htmlFor={`finder-path-${win.id}`}>Go to Folder</label>
          <input ref={folderField} autoFocus id={`finder-path-${win.id}`} value={folderInput} readOnly={checkingFolder} onChange={(e) => { setFolderInput(e.target.value); setFolderError('') }}
            placeholder="~/Documents" autoComplete="off" spellCheck={false} aria-invalid={!!folderError} />
          {folderError && <small role="alert">{folderError}</small>}
          <div><button className="btn" type="button" onClick={closeGo}>Cancel</button><button className="btn primary" disabled={!folderInput.trim() || checkingFolder}>{checkingFolder ? 'Checking…' : 'Go'}</button></div>
        </form>
      </div>}
    </div>
  )
}

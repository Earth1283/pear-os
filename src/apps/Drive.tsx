import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Upload } from 'lucide-react'
import { os } from '../store'
import { TEXT_EXT, bumpDrive, drive, formatBytes, useBackend, type DriveEntry } from '../lib/backend'
import { FileIcon, FolderIcon } from '../components/icons'
import { menu, type MenuEntry } from '../lib/menu'
import { parentOf, type FileKind } from '../lib/fs'
import { playDriveFile } from '../lib/player'
import { RenameField, useEnterToRename } from '../components/RenameField'
import { MAX_BYTES } from '../lib/airpearProtocol'
import { openQuickLook, type QuickLookItem } from '../lib/quickLook'
import { useQuickLookShortcut } from '../components/useQuickLookShortcut'
import { QuickLookContent } from '../components/QuickLook'
import { FINDER_VIEWS, showFileInfo, type FinderView } from './finderCommands'

export const join = (dir: string, name: string) => `${dir.replace(/\/$/, '')}/${name}`

export function kindFor(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (/^(png|jpe?g|gif|webp|svg|avif|bmp|ico|heic)$/.test(ext)) return 'image'
  if (/^(mp3|wav|flac|m4a|ogg|aac|opus)$/.test(ext)) return 'audio'
  if (/^(mp4|mov|webm|mkv|m4v|avi)$/.test(ext)) return 'video'
  if (/^(zip|tar|gz|tgz|xz|bz2|7z|rar|zst)$/.test(ext)) return 'archive'
  if (/^(dmg|iso|img)$/.test(ext)) return 'disk'
  if (TEXT_EXT.test(name) || !name.includes('.')) return 'text'
  return 'binary'
}

export function openDriveFile(rel: string) {
  const name = rel.split('/').pop() ?? ''
  const kind = kindFor(name)
  if (kind === 'text') return os().openApp('textedit', { props: { drive: rel } })
  if (kind === 'audio') {
    void playDriveFile(rel)
    return os().openApp('music', { props: { view: 'now' } })
  }
  if (kind === 'image' || kind === 'video') return os().openApp('preview', { props: { drive: rel }, forceNew: true })
  window.open(drive.url(rel, true), '_blank', 'noopener')
}

const fail = (e: unknown) => os().notify({ app: 'finder', title: 'PearDrive', body: e instanceof Error ? e.message : String(e) })

interface DriveViewProps {
  rel: string
  columnRoot: string
  revealName: string | null
  view: FinderView
  q: string
  active: boolean
  onOpenDir: (rel: string, selection?: string) => void
  setView: (view: FinderView) => void
  infoCommand: { current: (() => void) | null }
}

export function DriveView({ rel, columnRoot, revealName, view, q, active, onOpenDir, setView, infoCommand }: DriveViewProps) {
  const version = useBackend((s) => s.driveVersion)
  const root = useBackend((s) => s.sys?.root)
  const free = useBackend((s) => (s.sys?.diskFree != null ? `, ${formatBytes(s.sys.diskFree)} available on ${s.sys.hostname}` : ''))
  const [listing, setListing] = useState<{ path: string; entries: DriveEntry[] | null; error: string | null } | null>(null)
  const entries = listing?.path === rel ? listing.entries : null
  const error = listing?.path === rel ? listing.error : null
  const [parents, setParents] = useState<{ path: string; entries: DriveEntry[] }[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const columns = useRef<HTMLDivElement>(null)
  const inTrash = rel === '/.Trash' || rel.startsWith('/.Trash/')

  useEffect(() => {
    let live = true
    drive
      .list(rel)
      .then((entries) => { if (live) setListing({ path: rel, entries, error: null }) })
      .catch((e) => { if (live) setListing({ path: rel, entries: null, error: e.message }) })
    return () => {
      live = false
    }
  }, [rel, version])
  useEffect(() => {
    if (view !== 'columns' || q) return
    let live = true
    const paths: string[] = []
    const root = rel === columnRoot || rel.startsWith(columnRoot.replace(/\/$/, '') + '/') ? columnRoot : rel
    for (let p = rel; p !== root;) {
      p = parentOf(p).dir
      paths.unshift(p)
    }
    void Promise.all(paths.map(async (path) => ({ path, entries: await drive.list(path) })))
      .then((value) => { if (live) setParents(value) }).catch(() => { if (live) setParents([]) })
    return () => { live = false }
  }, [view, q, rel, columnRoot, version])
  useEffect(() => {
    if (columns.current) columns.current.scrollLeft = columns.current.scrollWidth
  }, [rel, parents, view, sel])

  const upload = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      setUploading(`Uploading “${f.name}” (${formatBytes(f.size)})…`)
      try {
        await drive.write(join(rel, f.name), f)
      } catch (e) {
        fail(e)
      }
    }
    setUploading(null)
    bumpDrive()
  }

  const newFolder = async () => {
    const names = new Set(entries?.map((e) => e.name))
    let name = 'untitled folder'
    for (let i = 2; names.has(name); i++) name = `untitled folder ${i}`
    try {
      await drive.mkdir(join(rel, name))
      bumpDrive()
      setSel(name)
      setRenaming(name)
    } catch (e) {
      fail(e)
    }
  }

  useEnterToRename(active && renaming === null, sel, setRenaming)
  useEffect(() => {
    setSel(revealName)
    setRenaming(null)
  }, [rel, revealName])

  const commitRename = async (from: string, to: string) => {
    setRenaming(null)
    to = to.trim()
    if (!to || to === from) return
    if (to.includes('/')) return fail(new Error('Names can’t contain “/”. The slash is reserved for paths, and for fan fiction.'))
    try {
      await drive.rename(join(rel, from), join(rel, to))
      setSel(to)
      bumpDrive()
    } catch (e) {
      fail(e)
    }
  }

  const lookItem = (e: DriveEntry): QuickLookItem => ({
    source: 'drive', path: join(rel, e.name), name: e.name, dir: e.dir, kind: kindFor(e.name), size: e.size, modified: e.modified,
  })
  const itemMenu = (e: DriveEntry): MenuEntry[] => {
    const p = join(rel, e.name)
    return [
      { label: 'Open', run: () => (e.dir ? onOpenDir(p) : openDriveFile(p)) },
      { label: 'Quick Look', shortcut: 'Space', run: () => quickLook(e.name) },
      { label: 'Download', disabled: e.dir, run: () => window.open(drive.url(p, true), '_blank', 'noopener') },
      { label: 'Send with AirPear…', disabled: e.dir || e.size > MAX_BYTES, run: async () => {
        try {
          const response = await fetch(drive.url(p), { credentials: 'same-origin' })
          if (!response.ok) throw new Error('Could not read this PearDrive file.')
          const blob = await response.blob()
          if (blob.size > MAX_BYTES) throw new Error('AirPear supports up to 256 MiB per transfer.')
          os().openApp('airpear', { props: { files: [new File([blob], e.name, { type: blob.type })] } })
        } catch (error) { fail(error) }
      } },
      'sep',
      inTrash
        ? { label: 'Delete Immediately…', run: () => drive.remove(p).then(bumpDrive, fail) }
        : { label: 'Move to Trash', shortcut: '⌘⌫', run: () => drive.trash(p).then(bumpDrive, fail) },
      'sep',
      { label: 'Get Info', shortcut: '⌘I', run: () => showFileInfo(lookItem(e)) },
      { label: 'Rename', shortcut: '↩', run: () => setRenaming(e.name) },
      'sep',
      { label: 'Copy Path', run: () => navigator.clipboard?.writeText(`${root ?? ''}${p}`) },
    ]
  }

  const bgMenu: MenuEntry[] = [
    { label: 'New Folder', shortcut: '⇧⌘N', run: newFolder },
    { label: 'Upload Files…', run: () => picker.current?.click() },
    'sep',
    { label: 'Refresh', shortcut: '⌘R', run: bumpDrive },
    { label: 'View', submenu: FINDER_VIEWS.map(({ id, label, shortcut }) => ({ label: `as ${label}`, shortcut, checked: view === id, run: () => setView(id) })) },
    'sep',
    { label: 'Open in Terminal', run: () => os().openApp('terminal', { forceNew: true }) },
  ]

  const shown = (entries ?? []).filter((e) => !e.name.startsWith('.') || inTrash).filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
  const selected = shown.find((e) => e.name === sel) ?? (view === 'gallery' ? shown[0] : undefined)
  const preview = selected && lookItem(selected)
  useEffect(() => {
    infoCommand.current = () => { if (preview) showFileInfo(preview) }
    return () => { infoCommand.current = null }
  })
  const quickLook = (name: string) => {
    const items = shown.map(lookItem)
    openQuickLook(items, join(rel, name), (item) => setSel(item.name))
  }
  useQuickLookShortcut(active && renaming === null, selected?.name ?? null, quickLook)
  const icon = (e: DriveEntry, size: number) => (e.dir ? <FolderIcon size={size} /> : <FileIcon size={size} kind={kindFor(e.name)} ext={e.name.includes('.') ? e.name.split('.').pop()! : ''} />)
  const label = (e: DriveEntry) =>
    renaming === e.name ? (
      <RenameField name={e.name} dir={e.dir} onDone={(to) => commitRename(e.name, to)} onCancel={() => setRenaming(null)} />
    ) : (
      e.name
    )
  const handlers = (e: DriveEntry) => ({
    onPointerDown: (ev: React.PointerEvent) => {
      ev.stopPropagation()
      setSel(e.name)
    },
    onDoubleClick: () => (e.dir ? onOpenDir(join(rel, e.name)) : openDriveFile(join(rel, e.name))),
    onContextMenu: (ev: React.MouseEvent) => {
      setSel(e.name)
      menu(itemMenu(e))(ev)
    },
    onKeyDown: (ev: React.KeyboardEvent) => {
      if (ev.key === 'Enter' && renaming === null) setRenaming(e.name)
    },
  })
  const previewPane = preview && <div className="finder-preview-pane" onPointerDown={(e) => e.stopPropagation()}>
    <div className="finder-preview-content"><QuickLookContent key={`${preview.path}:${version}`} item={preview} /></div>
    <footer><strong>{preview.name}</strong><span>{preview.dir ? 'Folder' : formatBytes(preview.size)}</span>
      <button className="btn small" onClick={() => quickLook(preview.name)}>Quick Look</button></footer>
  </div>

  return (
    <div
      className={`drive ${drag ? 'drag' : ''} ${view === 'gallery' || view === 'columns' ? 'drive-preview-view' : ''}`}
      onPointerDown={() => setSel(null)}
      onContextMenu={menu(bgMenu)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDrag(true)
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        if (e.dataTransfer.files.length) upload(e.dataTransfer.files)
      }}
    >
      <input ref={picker} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      {error ? (
        <div className="finder-empty">{error}</div>
      ) : entries === null ? (
        <div className="finder-empty">
          <div className="spinner dark" />
        </div>
      ) : view === 'columns' && !q ? (
        <div className="finder-columns" ref={columns}>
          {parents.filter((parent) => rel.startsWith(parent.path.replace(/\/$/, '') + '/') && parent.path !== rel).map(({ path, entries }) => (
            <div className="finder-column" key={path}>
              <div className="finder-column-title">{parentOf(path).name || 'PearDrive'}</div>
              {entries.filter((item) => !item.name.startsWith('.')).map((item) => {
                const p = join(path, item.name)
                return <button key={p} className={`finder-column-item ${(rel === p || rel.startsWith(p + '/')) ? 'sel' : ''}`}
                  onClick={() => item.dir ? onOpenDir(p) : onOpenDir(path, item.name)}>
                  {icon(item, 18)}<span>{item.name}</span>{item.dir && <ChevronRight size={13} />}
                </button>
              })}
            </div>
          ))}
          <div className="finder-column">
            <div className="finder-column-title">{parentOf(rel).name || 'PearDrive'}</div>
            {shown.map((item) => <button key={item.name} className={`finder-column-item ${sel === item.name ? 'sel' : ''}`}
              {...handlers(item)} onClick={() => item.dir ? onOpenDir(join(rel, item.name)) : setSel(item.name)}>
              {icon(item, 18)}<span>{label(item)}</span>{item.dir && <ChevronRight size={13} />}
            </button>)}
          </div>
          {previewPane}
        </div>
      ) : shown.length === 0 ? (
        <div className="finder-empty drop-hint">
          <Upload size={28} strokeWidth={1.4} />
          {q ? 'No results.' : 'Drop files from your actual computer here.'}
        </div>
      ) : view === 'gallery' ? (
        <div className="finder-gallery">
          {previewPane}
          <div className="finder-filmstrip">{shown.map((e) => (
            <button key={e.name} className={`grid-item ${selected?.name === e.name ? 'sel' : ''}`} {...handlers(e)} onClick={() => setSel(e.name)}>
              {icon(e, 42)}<span>{label(e)}</span>
            </button>
          ))}</div>
        </div>
      ) : view === 'grid' ? (
        <div className="icon-grid">
          {shown.map((e) => (
            <button key={e.name} className={`grid-item ${sel === e.name ? 'sel' : ''}`} {...handlers(e)}>
              {icon(e, 56)}
              <span>{label(e)}</span>
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
            {shown.map((e) => (
              <tr key={e.name} className={sel === e.name ? 'sel' : ''} tabIndex={0} {...handlers(e)}>
                <td>
                  <span className="lv-name">
                    {icon(e, 18)}
                    {label(e)}
                  </span>
                </td>
                <td>{new Date(e.modified).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                <td>{e.dir ? '--' : formatBytes(e.size)}</td>
                <td>{e.dir ? 'Folder' : kindFor(e.name)[0].toUpperCase() + kindFor(e.name).slice(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="drive-status">
        {uploading ?? `${shown.length} items${free}`}
      </div>
    </div>
  )
}

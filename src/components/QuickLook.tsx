import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, CircleX, CircleArrowOutUpRight, CircleArrowOutDownLeft, PencilLine } from 'lucide-react'
import { os, useOS } from '../store'
import { drive } from '../lib/backend'
import { formatBytes, HOME, listDir, resolve } from '../lib/fs'
import { moveQuickLook, previewKind, type QuickLookItem } from '../lib/quickLook'
import { nodeImageURL } from '../lib/samples'
import { openPath } from '../apps/open'
import { openDriveFile } from '../apps/Drive'
import { AppIcon, FileIcon, FolderIcon } from './icons'
import { readPreviewText, TEXT_LIMIT } from '../lib/quickLookText'
import { QuickLookMedia } from './QuickLookMedia'
import './QuickLook.css'

function ItemIcon({ item, size = 96 }: { item: QuickLookItem; size?: number }) {
  if (item.dir) return <FolderIcon size={size} />
  const node = item.source === 'virtual' ? resolve(item.path) : null
  if (node?.type === 'file' && node.app) return <AppIcon app={node.app} size={size} />
  return <FileIcon size={size} kind={item.kind} ext={item.name.includes('.') ? item.name.split('.').pop()! : ''} />
}

function PreviewContent({ item, onImageSize }: { item: QuickLookItem; onImageSize: (size: { width: number; height: number }) => void }) {
  const kind = previewKind(item)
  const node = item.source === 'virtual' ? resolve(item.path) : null
  const [text, setText] = useState<{ text: string; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const url = item.source === 'drive' ? drive.url(item.path) : node?.type === 'file' ? (kind === 'image' ? nodeImageURL(item.name, node) : /^(data|blob):/.test(node.content ?? '') ? node.content : null) : null

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    if (kind === 'text') {
      if (item.source === 'virtual' && node?.type === 'file') {
        const content = node.content ?? ''
        setText({ text: content.slice(0, TEXT_LIMIT), truncated: content.length > TEXT_LIMIT })
      } else if (item.size === 0) {
        setText({ text: '', truncated: false })
      } else if (url) {
        readPreviewText(url, controller.signal).then((value) => live && setText(value)).catch((e) => {
          if (live && !controller.signal.aborted) setError(e.message)
        })
      }
    } else if (kind === 'folder') {
      if (node?.type === 'dir') setCount(listDir(node).length)
      else drive.list(item.path).then((entries) => live && setCount(entries.length)).catch((e) => live && setError(e.message))
    }
    return () => { live = false; controller.abort() }
  }, [item.path, item.source])

  const fallback = (message: string) => (
    <div className="ql-info">
      <ItemIcon item={item} />
      <div className="ql-file-details"><h2>{item.name}</h2><p>{message}</p><dl>
          <div><dt>Size</dt><dd>{formatBytes(item.size)}</dd></div>
          <div><dt>Modified</dt><dd>{new Date(item.modified).toLocaleString()}</dd></div>
        </dl></div>
    </div>
  )

  if (error) return <div role="status">{fallback(error)}</div>
  if (kind === 'folder') return fallback(count === null ? 'Reading folder…' : `${count} ${count === 1 ? 'item' : 'items'}`)
  if (kind === 'text') {
    if (!text) return <div className="ql-loading" role="status"><span className="spinner dark" />Loading preview…</div>
    return <div className="ql-document"><pre tabIndex={0} aria-label={`Contents of ${item.name}`}>{text.text || <span className="ql-empty">This file is empty.</span>}</pre>{text.truncated && <div className="ql-text-limit">Showing the first 256 KB. Open the file to read more.</div>}</div>
  }
  if (!url) return fallback(kind === 'info' ? 'No preview available for this file type.' : 'This sample file has no media data to preview.')
  if (kind === 'image') return <div className="ql-image"><img src={url} alt={item.name} onLoad={(e) => onImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} onError={() => setError('Your browser could not decode this image.')} /></div>
  if (kind === 'pdf') return <object className="ql-pdf" data={`${url}#toolbar=0&navpanes=0&view=FitH`} type="application/pdf" aria-label={`PDF preview of ${item.name}`}><div className="ql-pdf-fallback"><p>Your browser cannot display this PDF here.</p><a className="btn" href={url} target="_blank" rel="noopener noreferrer">Open PDF</a></div></object>
  if (kind === 'audio' || kind === 'video') return <QuickLookMedia url={url} name={item.name} size={item.size} video={kind === 'video'} onError={() => setError(`Your browser could not play this ${kind} format.`)} />
  return fallback('No preview available for this file type.')
}

export function QuickLook() {
  const session = useOS((s) => s.quickLook)
  const panel = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [imageSize, setImageSize] = useState<{ width: number; height: number; path: string } | null>(null)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const visible = session !== null
  useEffect(() => {
    if (!visible) return
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panel.current) return
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'))
      const index = focusable.indexOf(document.activeElement as HTMLElement)
      if (index < 0 || (!e.shiftKey && index === focusable.length - 1) || (e.shiftKey && index === 0)) {
        e.preventDefault()
        const next = e.shiftKey ? focusable.at(-1) : focusable[0]
        next?.focus()
      }
    }
    window.addEventListener('keydown', trap, true)
    return () => {
      window.removeEventListener('keydown', trap, true)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
      setExpanded(false)
    }
  }, [visible])
  useEffect(() => {
    if (!visible) return
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [visible])
  if (!session) return null
  const item = session.items[session.index]
  const close = () => useOS.setState({ quickLook: null })
  const open = () => {
    close()
    if (item.source === 'virtual') openPath(item.path)
    else if (item.dir) os().openApp('finder', { props: { path: 'drive:' + item.path }, forceNew: true })
    else openDriveFile(item.path)
  }
  const location = item.source === 'drive' ? `PearDrive${item.path}` : item.path.replace(HOME, '~')
  const kind = previewKind(item)
  const openLabel = item.dir ? 'Open in Finder' : kind === 'text' ? 'Open with TextEdit' : kind === 'image' || kind === 'video' ? 'Open with Preview' : kind === 'audio' ? 'Open with Music' : item.source === 'drive' ? 'Download' : 'Open'
  let size: CSSProperties | undefined
  if (!expanded && kind === 'image' && imageSize?.path === `${item.source}:${item.path}`) {
    const scale = Math.min(1, Math.min(960, viewport.width - 40) / imageSize.width, (viewport.height - 150) / imageSize.height)
    size = { '--ql-preview-width': `${Math.max(320, imageSize.width * scale + 10)}px`, '--ql-preview-height': `${imageSize.height * scale + 44}px` } as CSSProperties
  }
  return (
    <div className="ql-backdrop" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) close() }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
      <section ref={panel} style={size} data-preview-kind={kind} className={`ql-panel ${expanded ? 'ql-expanded' : ''}`} role="dialog" aria-modal="true" aria-labelledby="ql-title" aria-describedby="ql-hint" tabIndex={-1}>
        <header className="ql-toolbar" onDoubleClick={(e) => { if (!(e.target as Element).closest('button')) setExpanded(!expanded) }}>
          <div className="ql-actions">
            <button className="ql-icon-button ql-window-control" aria-label="Close Quick Look" title="Close (Space or Esc)" onClick={close}><CircleX size={13} strokeWidth={2.5} /></button>
            <button className="ql-icon-button ql-window-control" title={expanded ? 'Exit Full Screen' : 'Full Screen'} aria-label={expanded ? 'Restore preview size' : 'Expand preview'} onClick={() => setExpanded(!expanded)}>{expanded ? <CircleArrowOutDownLeft size={13} strokeWidth={2.5} /> : <CircleArrowOutUpRight size={13} strokeWidth={2.5} />}</button>
          </div>
          {session.items.length > 1 && <nav className="ql-navigation" aria-label="Browse previews">
            <button className="ql-icon-button" title="Previous file (←)" disabled={session.index === 0} aria-label="Previous file" onClick={() => moveQuickLook(-1)}><ChevronLeft size={15} /></button>
            <button className="ql-icon-button" title="Next file (→)" disabled={session.index === session.items.length - 1} aria-label="Next file" onClick={() => moveQuickLook(1)}><ChevronRight size={15} /></button>
          </nav>}
          <h1 id="ql-title" title={`${item.name}\n${location}`}>{item.name}</h1>
          {kind === 'image' && <button className="ql-icon-button ql-markup" aria-label="Markup in Preview" title="Markup in Preview" onClick={open}><PencilLine size={16} /></button>}
          <button className="ql-open" onClick={open}>{openLabel}</button>
        </header>
        <div className={`ql-content ql-kind-${kind}`}><PreviewContent key={`${item.source}:${item.path}`} item={item} onImageSize={(value) => setImageSize({ ...value, path: `${item.source}:${item.path}` })} /></div>
        <span id="ql-hint" className="ql-accessible">Space or Escape to close. Arrow keys to browse files.</span>
        <span className="ql-accessible" aria-live="polite">{session.index + 1} of {session.items.length}</span>
      </section>
    </div>
  )
}

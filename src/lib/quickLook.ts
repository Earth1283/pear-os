import { CLOSED, os, useOS } from '../store'
import { listDir, normalise, parentOf, resolve, sizeOf, type FileKind } from './fs'

export interface QuickLookItem {
  source: 'virtual' | 'drive'
  path: string
  name: string
  dir: boolean
  kind: FileKind
  size: number
  modified: number
}

export interface QuickLookSession {
  items: QuickLookItem[]
  index: number
  onSelect?: (item: QuickLookItem) => void
}

export function virtualLookItem(path: string): QuickLookItem | null {
  const abs = normalise(path)
  const node = resolve(abs)
  if (!node) return null
  return { source: 'virtual', path: abs, name: parentOf(abs).name || 'Pear HD', dir: node.type === 'dir', kind: node.type === 'file' ? node.kind : 'binary', size: sizeOf(node), modified: node.modified }
}

export function openQuickLook(items: QuickLookItem[], path: string, onSelect?: QuickLookSession['onSelect']) {
  const index = items.findIndex((item) => item.path === path)
  if (index < 0) return
  useOS.setState({ quickLook: { items, index, onSelect }, overlay: CLOSED, contextMenu: null })
}

export function openVirtualQuickLook(path: string, paths?: string[], onSelect?: QuickLookSession['onSelect']) {
  const abs = normalise(path)
  const parent = resolve(parentOf(abs).dir)
  const siblings = paths ?? (parent?.type === 'dir' ? listDir(parent).map(([name]) => `${parentOf(abs).dir.replace(/\/$/, '')}/${name}`) : [abs])
  const items = siblings.map(virtualLookItem).filter((item): item is QuickLookItem => item !== null)
  if (!items.some((item) => item.path === abs)) {
    const item = virtualLookItem(abs)
    if (item) items.unshift(item)
  }
  openQuickLook(items, abs, onSelect)
}

export function moveQuickLook(delta: number) {
  const session = os().quickLook
  if (!session) return
  const index = Math.max(0, Math.min(session.items.length - 1, session.index + delta))
  if (index === session.index) return
  useOS.setState({ quickLook: { ...session, index } })
  session.onSelect?.(session.items[index])
}

export function previewKind(item: QuickLookItem): 'folder' | 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'info' {
  if (item.dir) return 'folder'
  if (/\.pdf$/i.test(item.name)) return 'pdf'
  if (['image', 'text', 'audio', 'video'].includes(item.kind)) return item.kind as 'image' | 'text' | 'audio' | 'video'
  return 'info'
}

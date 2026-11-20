import { listDir, root, type DirNode } from './fs.ts'

interface IndexedFile {
  path: string
  name: string
  file: string
  location: string
  tags: string
  content: string
}

const TEXT_INDEX_LIMIT = 64 * 1024

export function indexVirtualFiles() {
  const files: IndexedFile[] = []
  const visit = (dir: DirNode, parent: string) => {
    for (const [name, node] of listDir(dir)) {
      const path = parent + '/' + name
      if (node.type === 'file' && node.kind === 'app') continue
      files.push({
        path, name,
        file: name.toLowerCase(),
        location: parent.toLowerCase(),
        tags: node.tags?.join(' ').toLowerCase() ?? '',
        content: node.type === 'file' && node.kind === 'text' ? (node.content ?? '').slice(0, TEXT_INDEX_LIMIT).toLowerCase() : '',
      })
      if (node.type === 'dir') visit(node, path)
    }
  }
  visit(root, '')
  return files
}

export function searchVirtualFiles(files: IndexedFile[], query: string, limit = 8) {
  const text = query.trim().toLowerCase()
  if (!text) return []
  const terms = text.split(/\s+/)
  return files.flatMap((file) => {
    const { file: name, location, tags, content } = file
    if (!terms.every((term) => name.includes(term) || location.includes(term) || tags.includes(term) || content.includes(term))) return []
    const score = name === text ? 5 : name.startsWith(text) ? 4 : terms.every((term) => name.includes(term)) ? 3
      : terms.every((term) => name.includes(term) || tags.includes(term)) ? 2
      : terms.every((term) => name.includes(term) || tags.includes(term) || location.includes(term)) ? 1 : 0
    return [{ file, score }]
  }).sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name) || a.file.path.localeCompare(b.file.path))
    .slice(0, limit).map(({ file }) => file.path)
}

import { os } from '../store'
import { normalise, resolve } from '../lib/fs'
import { usePlayer } from '../lib/player'
import { openVirtualQuickLook } from '../lib/quickLook'

export function openPath(path: string) {
  const abs = normalise(path)
  const node = resolve(abs)
  if (!node) return
  const name = abs.split('/').pop() ?? ''
  if (node.type === 'dir') return os().openApp('finder', { props: { path: abs }, forceNew: true })
  switch (node.kind) {
    case 'app':
      return os().openApp(node.app!)
    case 'text':
      return os().openApp('textedit', { props: { path: abs } })
    case 'image':
      return os().openApp('preview', { props: { path: abs }, forceNew: true })
    case 'archive':
      return os().notify({ app: 'finder', title: 'Archive Utility', body: `Expanding "${name}"… Estimated time remaining: about 3 days.` })
    case 'disk':
      return os().notify({ app: 'finder', title: 'DiskImageMounter', body: `"${name}" is damaged and can't be opened. You should move it to the Trash, or download it a 5th time.` })
    case 'audio':
      // The virtual disk has no real audio, so these files become a station with the same vibe.
      usePlayer.getState().playStation(/lofi|beats/i.test(name) ? 'lofi' : /u2|innocence/i.test(name) ? 'waltz' : 'panic')
      return os().openApp('music', { props: { view: 'now' } })
    case 'video':
      if (/^(data|blob):/.test(node.content ?? '')) return openVirtualQuickLook(abs, [abs])
      return os().notify({ app: 'finder', title: 'QuickTime Player', body: `"${name}" is 14 hours long. Maybe later.` })
    default:
      return os().notify({ app: 'terminal', title: 'Finder', body: `There is no application set to open "${name}". Try Terminal. Or don't.` })
  }
}

import { useOS, type Note } from '../store'
import { syncFile } from './syncFile'

export const NOTES_FILE = '/.pearos/notes.json'

function parse(v: unknown): Note[] | null {
  if (!Array.isArray(v)) return null
  const ok = v.every((n) => n && typeof n.id === 'string' && typeof n.text === 'string' && Number.isFinite(n.updated))
  return ok ? (v as Note[]).map(({ id, text, updated }) => ({ id, text, updated })) : null
}

const LOCAL_KEY = 'pearos.notes.v1'

try {
  const local = parse(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'))
  if (local) useOS.setState({ notes: local })
} catch {
  // Corrupt local copy: keep the defaults.
}

syncFile({
  title: 'Notes',
  file: NOTES_FILE,
  localKey: LOCAL_KEY,
  seedWhenMissing: false,
  store: useOS,
  pick: (s) => s.notes,
  parse: (v) => {
    const notes = parse(v)
    return notes && { notes }
  },
})

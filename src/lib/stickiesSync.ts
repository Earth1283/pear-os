import { STICKIES_KEY, parseStickies, useStickies } from './stickies'
import { syncFile } from './syncFile'

export const STICKIES_FILE = '/.pearos/stickies.json'

syncFile({
  title: 'Stickies',
  file: STICKIES_FILE,
  localKey: STICKIES_KEY,
  seedWhenMissing: true,
  store: useStickies,
  pick: (s) => s.list,
  parse: (v) => {
    const list = parseStickies(v)
    return list && { list }
  },
})

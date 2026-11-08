import { SCREEN_KEY, mergeScreenData, parseScreenData, startScreenTime, useScreenTime } from './screenTime'
import { syncFile } from './syncFile'

export const SCREEN_FILE = '/.pearos/screentime.json'

startScreenTime()

syncFile({
  title: 'Screen Time',
  file: SCREEN_FILE,
  localKey: SCREEN_KEY,
  seedWhenMissing: true,
  store: useScreenTime,
  pick: (s) => s.data,
  parse: (v) => {
    const remote = parseScreenData(v)
    return remote && { data: mergeScreenData(remote, useScreenTime.getState().data) }
  },
})

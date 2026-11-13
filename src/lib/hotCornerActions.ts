import { os, useOS } from '../store'
import type { HotAction } from './hotCornerConfig'
import { logout } from './backend'
import { useStickies } from './stickies'

function appWindows() {
  const s = os()
  if (s.overlay.missionControl) return s.closeOverlays()
  const win = s.windows.find((w) => w.id === s.focused) ?? s.windows.filter((w) => w.space === s.activeSpace && !w.minimized).sort((a, b) => b.z - a.z)[0]
  if (!win) return
  useOS.setState({ mcApp: win.app })
  s.setOverlay({ missionControl: true })
}

export function runHotAction(action: HotAction) {
  const s = os()
  switch (action) {
    case 'missionControl':
      return s.setOverlay({ missionControl: !s.overlay.missionControl })
    case 'appWindows':
      return appWindows()
    case 'desktop':
      if (s.overlay.missionControl) s.closeOverlays()
      return os().toggleDesktop()
    case 'notificationCenter':
      return s.setOverlay({ notificationCenter: !s.overlay.notificationCenter, controlCenter: false, menu: null })
    case 'launchpad':
      return s.setOverlay({ launchpad: !s.overlay.launchpad })
    case 'quickNote':
      useStickies.getState().add({ x: window.innerWidth - 230, y: window.innerHeight - 250 })
      return
    case 'lock':
      logout()
      return s.setPhase('login')
    case 'sleep':
      return s.setPhase('sleep')
    default:
  }
}

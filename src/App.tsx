import { useEffect } from 'react'
import { useOS } from './store'
import { Desktop } from './components/Desktop'
import { A11yLayer } from './components/Accessibility'
import { BootPicker } from './components/BootPicker'
import { Windows95 } from './win95/Windows95'
import { Windows98 } from './win98/Windows98'
import { useBootCamp } from './lib/bootcamp'
import { BootScreen, LoginScreen, PanicScreen, PowerScreen, ShutdownScreen, SleepScreen } from './components/Screens'

export default function App() {
  const phase = useOS((s) => s.phase)
  const theme = useOS((s) => s.theme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', block)
    return () => document.removeEventListener('contextmenu', block)
  }, [])
  return (
    <>
      <A11yLayer />
      <Screen phase={phase} />
    </>
  )
}

function Screen({ phase }: { phase: ReturnType<typeof useOS.getState>['phase'] }) {
  switch (phase) {
    case 'off':
      return <PowerScreen />
    case 'booting':
      return <BootScreen />
    case 'bootpicker':
      return <BootPicker />
    case 'windows':
      return <WindowsPhase />
    case 'login':
      return <LoginScreen />
    case 'sleep':
      return <SleepScreen />
    case 'shuttingdown':
      return <ShutdownScreen />
    case 'panic':
      return <PanicScreen />
    default:
      return <Desktop />
  }
}

function WindowsPhase() {
  const version = useBootCamp((s) => s.version)
  return version === '98' ? <Windows98 /> : <Windows95 />
}

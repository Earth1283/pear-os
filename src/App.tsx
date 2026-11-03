import { useEffect } from 'react'
import { useOS } from './store'
import { Desktop } from './components/Desktop'
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
  switch (phase) {
    case 'off':
      return <PowerScreen />
    case 'booting':
      return <BootScreen />
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

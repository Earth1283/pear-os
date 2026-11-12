import { useEffect, useRef } from 'react'
import { os } from '../store'

export function useQuickLookShortcut(active: boolean, selected: string | null, open: (path: string) => void) {
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (!active || !selected) return
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.altKey || e.shiftKey) return
      const space = e.code === 'Space' && !e.metaKey && !e.ctrlKey
      const commandY = e.key.toLowerCase() === 'y' && (e.metaKey || e.ctrlKey)
      if (!space && !commandY) return
      const target = document.activeElement
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      const s = os()
      if (s.quickLook || s.contextMenu || Object.values(s.overlay).some(Boolean)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      openRef.current(selected)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, selected])
}

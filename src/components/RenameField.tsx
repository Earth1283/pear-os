import { useEffect, useRef } from 'react'
import { os } from '../store'

export function RenameField({ name, dir, onDone, onCancel }: { name: string; dir: boolean; onDone: (name: string) => void; onCancel: () => void }) {
  const cancelled = useRef(false)
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <input
      className="rename-field"
      autoFocus
      spellCheck={false}
      defaultValue={name}
      aria-label={`Rename ${name}`}
      onFocus={(e) => {
        const dot = name.lastIndexOf('.')
        e.target.setSelectionRange(0, dir || dot <= 0 ? name.length : dot)
      }}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onContextMenu={stop}
      onBlur={(e) => {
        if (!cancelled.current) onDone(e.target.value)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          cancelled.current = true
          onCancel()
        }
      }}
    />
  )
}

function typing(el: Element | null) {
  return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable)
}

export function useEnterToRename(active: boolean, sel: string | null, start: (sel: string) => void) {
  const startRef = useRef(start)
  startRef.current = start
  useEffect(() => {
    if (!active || sel === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (typing(document.activeElement) || Object.values(os().overlay).some(Boolean)) return
      e.preventDefault()
      startRef.current(sel)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, sel])
}

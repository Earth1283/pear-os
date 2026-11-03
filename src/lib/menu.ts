import type { MouseEvent } from 'react'
import { useOS } from '../store'

export type MenuEntry =
  | 'sep'
  | { header: string }
  | { tags: string[]; onPick: (tag: string) => void }
  | {
      label: string
      run?: () => void
      disabled?: boolean
      checked?: boolean
      shortcut?: string
      submenu?: MenuEntry[]
    }

export function openContextMenu(x: number, y: number, items: MenuEntry[]) {
  useOS.setState((s) => ({ contextMenu: { x, y, items }, overlay: { ...s.overlay, menu: null, controlCenter: false } }))
}

export const closeContextMenu = () => useOS.setState({ contextMenu: null })

export function menu(items: MenuEntry[] | ((e: MouseEvent) => MenuEntry[])) {
  return (e: MouseEvent) => {
    if (isTextField(e.target as Element) || window.getSelection()?.toString().trim()) return
    e.preventDefault()
    e.stopPropagation()
    openContextMenu(e.clientX, e.clientY, typeof items === 'function' ? items(e) : items)
  }
}

export type Field = HTMLInputElement | HTMLTextAreaElement

export function isTextField(el: Element | null): el is Field {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return !el.readOnly
  return el instanceof HTMLInputElement && ['text', 'search', 'password', 'email', 'url', ''].includes(el.type) && !el.readOnly
}

export function setFieldValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function replaceInField(el: Field, start: number, end: number, fn: (s: string) => string) {
  const whole = start === end
  const a = whole ? 0 : start
  const b = whole ? el.value.length : end
  const out = fn(el.value.slice(a, b))
  setFieldValue(el, el.value.slice(0, a) + out + el.value.slice(b))
  el.focus()
  el.setSelectionRange(a, a + out.length)
}

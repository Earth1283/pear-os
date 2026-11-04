// Applies the Accessibility settings to the whole OS: display filters, pointer, full-screen zoom,
// Hover Text, spoken content and visual alerts. Mounted once at the app root so it works on the
// login screen too.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { os, useOS } from '../store'
import { a11y, cursorURL, filterMatrix, speak, useA11y } from '../lib/a11y'
import { setMonoAudio } from '../lib/player'

const LABELLED = '[aria-label], [title], button, a, input, select, textarea, label, h1, h2, h3, h4, p, li, td, th, dt, dd, b, small, span, [role]'

/** Roughly what VoiceOver would say for the element under the pointer. */
export function describe(el: Element | null, withRole = true): string {
  const t = el?.closest(LABELLED) as HTMLElement | null
  if (!t || t.closest('.a11y-hover')) return ''
  const role = t.getAttribute('role')
  const tag = t.tagName.toLowerCase()
  let text = t.getAttribute('aria-label') || t.getAttribute('title') || ''
  if (!text && (tag === 'input' || tag === 'textarea')) {
    const f = t as HTMLInputElement
    text = f.type === 'password' ? 'secure text field' : f.value || f.placeholder || 'text field'
  }
  if (!text && tag === 'select') text = (t as HTMLSelectElement).selectedOptions[0]?.text ?? ''
  if (!text) text = (t.innerText || t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)
  // Unlabelled controls in a settings row take the row's label, the way a <label> would.
  if (!text) text = t.closest('.set-row')?.querySelector(':scope > div > div')?.textContent?.trim() ?? ''
  if (!text) {
    const btn = t.closest('button')
    if (btn && btn !== t) return describe(btn, withRole)
    return ''
  }
  if (!withRole) return text
  if (role === 'switch') return `${text}, switch, ${t.getAttribute('aria-checked') === 'true' ? 'on' : 'off'}`
  if (tag === 'button' || role === 'button') return `${text}, button`
  if (tag === 'a') return `${text}, link`
  if (tag === 'input' && (t as HTMLInputElement).type === 'range') return `${text || 'slider'}, ${(t as HTMLInputElement).value}`
  return text
}

function useClass(name: string, on: boolean) {
  useEffect(() => {
    document.documentElement.classList.toggle(name, on)
    return () => document.documentElement.classList.remove(name)
  }, [name, on])
}

export function A11yLayer() {
  const s = useA11y()
  const [shaking, setShaking] = useState(false)
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null)
  const [flash, setFlash] = useState(0)
  const pointer = useRef({ x: innerWidth / 2, y: innerHeight / 2 })

  useClass('a11y-reduce-motion', s.reduceMotion)
  useClass('a11y-solid', s.reduceTransparency)
  useClass('a11y-contrast', s.increaseContrast)
  useClass('a11y-kbd', s.keyboardNav)
  useClass('a11y-smart-invert', s.invert === 'smart')

  // Whole-screen filters live on <html>: it's the one element whose filter doesn't turn it into a
  // containing block for position: fixed, so menus and portals keep working.
  const matrix = filterMatrix(s.colorFilter, s.filterIntensity, s.tint)
  useEffect(() => {
    const parts: string[] = []
    if (s.displayContrast !== 1) parts.push(`contrast(${s.displayContrast})`)
    if (s.invert !== 'off') parts.push('invert(1) hue-rotate(180deg)')
    if (s.colorFilter === 'grayscale') parts.push(`grayscale(${s.filterIntensity})`)
    else if (matrix) parts.push('url(#a11y-color-filter)')
    document.documentElement.style.filter = parts.join(' ')
    return () => {
      document.documentElement.style.filter = ''
    }
  }, [s.displayContrast, s.invert, s.colorFilter, s.filterIntensity, matrix?.join(',')])

  // Pointer size and colours. Shaking the mouse blows it up for a moment so you can find it.
  const custom = s.pointerSize > 1.01 || s.pointerFill !== '#000000' || s.pointerOutline !== '#ffffff'
  useEffect(() => {
    const active = custom || shaking
    const el = document.getElementById('a11y-cursor') ?? Object.assign(document.head.appendChild(document.createElement('style')), { id: 'a11y-cursor' })
    el.textContent = active ? `html, html * { cursor: ${cursorURL(shaking ? Math.max(4.5, s.pointerSize * 2) : s.pointerSize, s.pointerFill, s.pointerOutline)} !important; }` : ''
    return () => {
      el.textContent = ''
    }
  }, [custom, shaking, s.pointerSize, s.pointerFill, s.pointerOutline])

  useEffect(() => {
    if (!s.shakeToLocate) return
    let lastX = 0
    let dir = 0
    let flips: number[] = []
    let calm: number | undefined
    const move = (e: PointerEvent) => {
      const dx = e.clientX - lastX
      lastX = e.clientX
      if (Math.abs(dx) < 6) return
      const d = Math.sign(dx)
      if (d !== dir) {
        dir = d
        const now = performance.now()
        flips = [...flips.filter((t) => now - t < 700), now]
        if (flips.length >= 5) {
          setShaking(true)
          clearTimeout(calm)
          calm = window.setTimeout(() => setShaking(false), 900)
        }
      }
    }
    addEventListener('pointermove', move, { passive: true })
    return () => {
      removeEventListener('pointermove', move)
      clearTimeout(calm)
    }
  }, [s.shakeToLocate])

  // Full-screen zoom: scale <body> around the pointer, so the edge of the screen is always reachable.
  useEffect(() => {
    const b = document.body
    if (s.zoom <= 1.001) {
      b.style.transform = ''
      b.style.transformOrigin = ''
      return
    }
    let raf = 0
    const place = () => {
      raf = 0
      b.style.transformOrigin = `${pointer.current.x}px ${pointer.current.y}px`
    }
    const move = (e: PointerEvent) => {
      // clientX is in screen space; with origin o, screen = o + (x − o)·z, and we keep o = screen point.
      pointer.current = { x: e.clientX, y: e.clientY }
      if (!raf) raf = requestAnimationFrame(place)
    }
    b.style.transform = `scale(${s.zoom})`
    place()
    addEventListener('pointermove', move, { passive: true })
    return () => {
      removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
      b.style.transform = ''
    }
  }, [s.zoom])

  useEffect(() => {
    const track = (e: PointerEvent) => (pointer.current = { x: e.clientX, y: e.clientY })
    addEventListener('pointermove', track, { passive: true })
    return () => removeEventListener('pointermove', track)
  }, [])

  // Keyboard: zoom, speak selection, Hover Text, and the Accessibility Shortcut.
  useEffect(() => {
    const zoomTo = (z: number) => useA11y.setState({ zoom: Math.min(20, Math.max(1, Math.round(z * 100) / 100)) })
    let lastZoom = 2
    const down = (e: KeyboardEvent) => {
      const st = a11y()
      const cmd = e.metaKey || e.ctrlKey
      if (st.zoomKeys && cmd && e.altKey && ['Equal', 'Minus', 'Digit8'].includes(e.code)) {
        e.preventDefault()
        e.stopPropagation()
        if (e.code === 'Digit8') {
          if (st.zoom > 1) {
            lastZoom = st.zoom
            zoomTo(1)
          } else zoomTo(lastZoom)
        } else zoomTo(e.code === 'Equal' ? st.zoom * 1.25 : st.zoom / 1.25)
        return
      }
      if (cmd && e.altKey && e.key === 'F5') {
        e.preventDefault()
        os().openApp('settings', { props: { pane: 'accessibility' } })
        return
      }
      if (st.speakSelection && e.altKey && e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (speechSynthesis.speaking) return speechSynthesis.cancel()
        const f = document.activeElement
        let text = window.getSelection()?.toString() ?? ''
        if (!text && (f instanceof HTMLTextAreaElement || f instanceof HTMLInputElement) && f.type !== 'password') {
          text = f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0) || f.value
        }
        if (!text) text = describe(document.elementFromPoint(pointer.current.x, pointer.current.y), false)
        speak(text || 'Nothing selected')
        return
      }
      if (st.hoverText && (e.key === 'Meta' || e.key === 'Control') && !e.repeat) showHover()
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') setHover(null)
    }
    const showHover = () => {
      const { x, y } = pointer.current
      const text = describe(document.elementFromPoint(x, y), false)
      setHover(text ? { text, x, y } : null)
    }
    const move = (e: PointerEvent) => {
      if (a11y().hoverText && (e.metaKey || e.ctrlKey)) showHover()
    }
    const blur = () => setHover(null)
    addEventListener('keydown', down, true)
    addEventListener('keyup', up, true)
    addEventListener('pointermove', move, { passive: true })
    addEventListener('blur', blur)
    return () => {
      removeEventListener('keydown', down, true)
      removeEventListener('keyup', up, true)
      removeEventListener('pointermove', move)
      removeEventListener('blur', blur)
    }
  }, [])

  // Zoom with modifier + scroll (captured before apps like Preview see the wheel).
  useEffect(() => {
    if (!s.zoomScroll) return
    const wheel = (e: WheelEvent) => {
      const mod = s.zoomModifier === 'ctrl' ? e.ctrlKey : s.zoomModifier === 'alt' ? e.altKey : e.metaKey
      if (!mod) return
      e.preventDefault()
      e.stopPropagation()
      const z = a11y().zoom * Math.exp(-e.deltaY * 0.004)
      useA11y.setState({ zoom: Math.min(20, Math.max(1, z < 1.02 ? 1 : z)) })
    }
    addEventListener('wheel', wheel, { passive: false, capture: true })
    return () => removeEventListener('wheel', wheel, { capture: true })
  }, [s.zoomScroll, s.zoomModifier])

  // Speak items under the pointer.
  useEffect(() => {
    if (!s.speakPointer) return
    let t: number | undefined
    let last = ''
    const over = (e: PointerEvent) => {
      clearTimeout(t)
      t = window.setTimeout(() => {
        const text = describe(e.target as Element)
        if (text && text !== last) {
          last = text
          speak(text)
        }
      }, 220)
    }
    addEventListener('pointerover', over, { passive: true })
    return () => {
      removeEventListener('pointerover', over)
      clearTimeout(t)
    }
  }, [s.speakPointer])

  // Announcements and visual alerts follow the notification stream.
  useEffect(
    () =>
      useOS.subscribe((st, prev) => {
        const fresh = st.toasts.filter((t) => !prev.toasts.some((p) => p.id === t.id))
        if (!fresh.length) return
        const cfg = a11y()
        if (cfg.flashAlerts) setFlash((n) => n + 1)
        if (cfg.speakAnnouncements) for (const t of fresh) speak(`${t.title}. ${t.body}`, { interrupt: false })
      }),
    [],
  )

  useEffect(() => setMonoAudio(s.monoAudio), [s.monoAudio])

  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <filter id="a11y-color-filter" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={(matrix ?? [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]).join(' ')} />
        </filter>
      </svg>
      {hover &&
        createPortal(
          <div className="a11y-hover" style={{ left: Math.min(hover.x + 12, innerWidth - 40), top: hover.y + 24 }}>
            {hover.text}
          </div>,
          document.body,
        )}
      {flash > 0 && <div key={flash} className="a11y-flash" onAnimationEnd={() => setFlash(0)} />}
    </>
  )
}

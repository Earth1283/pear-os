import type { Rect, Win } from '../store'

export interface OverviewRect extends Rect { scale: number }

/** Fit the existing window surfaces into a non-overlapping overview. */
export function missionLayout(windows: Win[], width: number, height: number): Map<string, OverviewRect> {
  const layout = new Map<string, OverviewRect>()
  if (!windows.length) return layout
  const margin = width < 600 ? 18 : 48
  const top = height < 550 ? 156 : 192
  const gap = width < 600 ? 18 : 36
  const availableW = Math.max(1, width - margin * 2)
  const availableH = Math.max(1, height - top - 64)
  let columns = 1
  let bestArea = -1
  for (let cols = 1; cols <= windows.length; cols++) {
    const rows = Math.ceil(windows.length / cols)
    const cellW = (availableW - gap * (cols - 1)) / cols
    const cellH = (availableH - gap * (rows - 1)) / rows - 30
    if (cellW <= 0 || cellH <= 0) continue
    const area = windows.reduce((sum, w) => sum + w.w * w.h * Math.min(1, cellW / w.w, cellH / w.h) ** 2, 0)
    if (area > bestArea) { bestArea = area; columns = cols }
  }
  const rows = Math.ceil(windows.length / columns)
  const cellW = Math.max(1, (availableW - gap * (columns - 1)) / columns)
  const cellH = Math.max(1, (availableH - gap * (rows - 1)) / rows)
  windows.forEach((win, i) => {
    const row = Math.floor(i / columns)
    const inRow = Math.min(columns, windows.length - row * columns)
    const scale = Math.max(0.001, Math.min(1, cellW / win.w, Math.max(1, cellH - 30) / win.h))
    const w = win.w * scale
    const h = win.h * scale
    layout.set(win.id, {
      x: margin + (availableW - inRow * cellW - (inRow - 1) * gap) / 2 + (i % columns) * (cellW + gap) + (cellW - w) / 2,
      y: top + row * (cellH + gap) + Math.max(0, (cellH - 30 - h) / 2),
      w, h, scale,
    })
  })
  return layout
}

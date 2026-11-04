import { useEffect, useRef, useState } from 'react'
import { MenuBar95 } from './ui'
import { w95, type W95Win } from './store'

interface Level {
  name: string
  cols: number
  rows: number
  mines: number
}
const LEVELS: Level[] = [
  { name: 'Beginner', cols: 9, rows: 9, mines: 10 },
  { name: 'Intermediate', cols: 16, rows: 16, mines: 40 },
  { name: 'Expert', cols: 30, rows: 16, mines: 99 },
]

interface Cell {
  mine: boolean
  open: boolean
  flag: boolean
  n: number
  boom?: boolean
}
type Status = 'ready' | 'playing' | 'won' | 'lost'

const COLORS = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080']

function blank(l: Level): Cell[] {
  return Array.from({ length: l.cols * l.rows }, () => ({ mine: false, open: false, flag: false, n: 0 }))
}

function neighbours(i: number, l: Level) {
  const x = i % l.cols
  const y = Math.floor(i / l.cols)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < l.cols && ny < l.rows) out.push(ny * l.cols + nx)
    }
  return out
}

/** Mines go down after the first click so that click is always safe (and so is its neighbourhood). */
function plant(cells: Cell[], l: Level, safe: number): Cell[] {
  const c = cells.map((x) => ({ ...x }))
  const banned = new Set([safe, ...neighbours(safe, l)])
  const spots = c.map((_, i) => i).filter((i) => !banned.has(i))
  for (let k = spots.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1))
    ;[spots[k], spots[j]] = [spots[j], spots[k]]
  }
  spots.slice(0, l.mines).forEach((i) => (c[i].mine = true))
  c.forEach((cell, i) => (cell.n = neighbours(i, l).filter((j) => c[j].mine).length))
  return c
}

function flood(c: Cell[], l: Level, start: number) {
  const stack = [start]
  while (stack.length) {
    const i = stack.pop()!
    if (c[i].open || c[i].flag) continue
    c[i].open = true
    if (c[i].n === 0 && !c[i].mine) stack.push(...neighbours(i, l))
  }
}

const led = (n: number) => {
  const v = Math.max(-99, Math.min(999, Math.trunc(n)))
  return (v < 0 ? '-' + String(-v).padStart(2, '0') : String(v).padStart(3, '0')).split('')
}

function Face({ mood }: { mood: 'smile' | 'oh' | 'dead' | 'cool' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" shapeRendering="crispEdges" aria-hidden>
      <circle cx="10" cy="10" r="8.5" fill="#ff0" stroke="#000" />
      {mood === 'cool' ? (
        <>
          <rect x="4" y="7" width="12" height="3" fill="#000" />
          <path d="M6 14c2 2 6 2 8 0" stroke="#000" fill="none" />
        </>
      ) : mood === 'dead' ? (
        <>
          <path d="M6 6l3 3M9 6l-3 3M11 6l3 3M14 6l-3 3" stroke="#000" />
          <path d="M6 15c2-2 6-2 8 0" stroke="#000" fill="none" />
        </>
      ) : (
        <>
          <rect x="6" y="6" width="2" height="3" fill="#000" />
          <rect x="12" y="6" width="2" height="3" fill="#000" />
          {mood === 'oh' ? <circle cx="10" cy="14" r="2" fill="#000" /> : <path d="M5.5 12c1.5 4 7.5 4 9 0" stroke="#000" fill="none" />}
        </>
      )}
    </svg>
  )
}

function Mine() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" shapeRendering="crispEdges" aria-hidden>
      <path d="M7 0v14M0 7h14M2 2l10 10M12 2L2 12" stroke="#000" strokeWidth="1.5" />
      <circle cx="7" cy="7" r="4.5" fill="#000" />
      <rect x="4.5" y="4.5" width="2" height="2" fill="#fff" />
    </svg>
  )
}

function Flag() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" shapeRendering="crispEdges" aria-hidden>
      <path d="M7 2l-4 3 4 3z" fill="#f00" />
      <rect x="7" y="2" width="1" height="8" fill="#000" />
      <rect x="4" y="10" width="7" height="2" fill="#000" />
    </svg>
  )
}

export function Minesweeper({ win }: { win: W95Win }) {
  const [level, setLevel] = useState(LEVELS[0])
  const [cells, setCells] = useState<Cell[]>(() => blank(LEVELS[0]))
  const [status, setStatus] = useState<Status>('ready')
  const [secs, setSecs] = useState(0)
  const [press, setPress] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const reset = (l: Level = level) => {
    setLevel(l)
    setCells(blank(l))
    setStatus('ready')
    setSecs(0)
  }

  useEffect(() => {
    if (status !== 'playing') return
    timer.current = window.setInterval(() => setSecs((s) => Math.min(999, s + 1)), 1000)
    return () => clearInterval(timer.current)
  }, [status])

  const flags = cells.filter((c) => c.flag).length

  const finish = (c: Cell[], hit?: number) => {
    if (hit !== undefined) {
      c.forEach((x) => {
        if (x.mine && !x.flag) x.open = true
      })
      c[hit].boom = true
      setStatus('lost')
    } else if (c.every((x) => x.mine || x.open)) {
      c.forEach((x) => {
        if (x.mine) x.flag = true
      })
      setStatus('won')
    }
    setCells(c)
  }

  const reveal = (i: number) => {
    if (status === 'won' || status === 'lost') return
    let c = cells
    if (status === 'ready') {
      c = plant(cells, level, i)
      setStatus('playing')
    } else c = cells.map((x) => ({ ...x }))
    if (c[i].flag || c[i].open) return setCells(c)
    if (c[i].mine) return finish(c, i)
    flood(c, level, i)
    finish(c)
  }

  const chord = (i: number) => {
    if (status !== 'playing' || !cells[i].open || !cells[i].n) return
    const around = neighbours(i, level)
    if (around.filter((j) => cells[j].flag).length !== cells[i].n) return
    const c = cells.map((x) => ({ ...x }))
    for (const j of around) {
      if (c[j].flag || c[j].open) continue
      if (c[j].mine) return finish(c, j)
      flood(c, level, j)
    }
    finish(c)
  }

  const toggleFlag = (i: number) => {
    if (status === 'won' || status === 'lost' || cells[i].open) return
    // Flagging before the first click must not start the game: the mines are only planted by that click.
    setCells(cells.map((x, k) => (k === i ? { ...x, flag: !x.flag } : x)))
  }

  const mood = status === 'won' ? 'cool' : status === 'lost' ? 'dead' : press ? 'oh' : 'smile'

  return (
    <div className="w95-col mines">
      <MenuBar95
        menus={[
          {
            label: 'Game',
            items: [
              { label: 'New', keys: 'F2', run: () => reset() },
              'sep',
              ...LEVELS.map((l) => ({ label: l.name, checked: l.name === level.name, run: () => reset(l) })),
              'sep',
              { label: 'Exit', run: () => w95().close(win.id) },
            ],
          },
          { label: 'Help', items: [{ label: 'About Minesweeper…', run: () => w95().open('msgbox', { title: 'About Minesweeper', icon: 'info', text: 'Minesweeper\nVersion 3.1\nThe only game that has ever ended a career.', buttons: [{ label: 'OK' }] }) }] },
        ]}
      />
      <div className="mines-board sunken-out" onPointerUp={() => setPress(false)} onPointerLeave={() => setPress(false)}>
        <div className="mines-head sunken">
          <div className="led">{led(level.mines - flags).map((d, i) => <b key={i}>{d}</b>)}</div>
          <button className="mines-face" onClick={() => reset()} aria-label="New game"><Face mood={mood} /></button>
          <div className="led">{led(secs).map((d, i) => <b key={i}>{d}</b>)}</div>
        </div>
        <div className="mines-grid sunken" style={{ gridTemplateColumns: `repeat(${level.cols}, 16px)` }} onContextMenu={(e) => e.preventDefault()}>
          {cells.map((c, i) => (
            <button
              key={i}
              className={`mc ${c.open ? 'open' : ''} ${c.boom ? 'boom' : ''}`}
              style={c.open && c.n && !c.mine ? { color: COLORS[c.n] } : undefined}
              onPointerDown={(e) => {
                if (status === 'won' || status === 'lost') return
                if (e.button === 2) {
                  e.preventDefault()
                  toggleFlag(i)
                } else if (e.button === 0) setPress(true)
              }}
              onPointerUp={(e) => {
                setPress(false)
                if (e.button !== 0) return
                if (c.open) chord(i)
                else reveal(i)
              }}
            >
              {c.open ? (c.mine ? <Mine /> : c.n || '') : c.flag ? <Flag /> : ''}
              {!c.open && status === 'lost' && c.flag && !c.mine && <span className="cross">✕</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

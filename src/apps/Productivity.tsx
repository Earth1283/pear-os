import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, SquarePen, Trash2, Save } from 'lucide-react'
import { useOS, os, type Win } from '../store'
import { calc, formatNumber } from '../kernel'
import { resolve, writeFile } from '../lib/fs'

type Op = '+' | '−' | '×' | '÷'

export function Calculator() {
  const [display, setDisplay] = useState('0')
  const [acc, setAcc] = useState<string | null>(null)
  const [op, setOp] = useState<Op | null>(null)
  const [fresh, setFresh] = useState(true)
  const [tape, setTape] = useState<string[]>([])

  const evaluate = (a: string, o: Op, b: string) => {
    const expr = `(${a})${o}(${b})`
    const v = calc(expr)
    setTape((t) => [`${a} ${o} ${b} = ${v === null ? 'Error' : formatNumber(v)}`, ...t].slice(0, 6))
    return v === null ? 'Error' : String(Number(v.toPrecision(12)))
  }

  const press = (k: string) => {
    if (/^[0-9]$/.test(k)) {
      setDisplay((d) => (fresh || d === '0' ? k : d.length < 12 ? d + k : d))
      setFresh(false)
    } else if (k === '.') {
      setDisplay((d) => (fresh ? '0.' : d.includes('.') ? d : d + '.'))
      setFresh(false)
    } else if (k === 'AC') {
      if (!fresh && display !== '0') {
        setDisplay('0')
        setFresh(true)
      } else {
        setDisplay('0')
        setAcc(null)
        setOp(null)
        setFresh(true)
      }
    } else if (k === '±') {
      setDisplay((d) => (d.startsWith('-') ? d.slice(1) : d === '0' ? d : '-' + d))
    } else if (k === '%') {
      const v = calc(`${display}/100`)
      if (v !== null) setDisplay(String(v))
    } else if (k === '=') {
      if (acc !== null && op) {
        setDisplay(evaluate(acc, op, display))
        setAcc(null)
        setOp(null)
        setFresh(true)
      }
    } else {
      const o = k as Op
      if (acc !== null && op && !fresh) {
        const r = evaluate(acc, op, display)
        setDisplay(r)
        setAcc(r)
      } else setAcc(display)
      setOp(o)
      setFresh(true)
    }
  }

  useEffect(() => {
    const map: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', Enter: '=', '=': '=', Escape: 'AC', Backspace: 'AC', '%': '%', '.': '.' }
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key]
      if (k) {
        e.preventDefault()
        press(k)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const n = Number(display)
  const shown = display === 'Error' ? 'Error' : display.endsWith('.') || display.includes('.') && /0$/.test(display) && !fresh ? display : Number.isFinite(n) ? formatNumber(n) : display
  const fontSize = shown.length > 9 ? Math.max(26, 56 - (shown.length - 9) * 5) : 56
  const keys: [string, string][] = [
    [acc !== null && !fresh ? 'C' : fresh && display === '0' ? 'AC' : 'C', 'fn'],
    ['±', 'fn'],
    ['%', 'fn'],
    ['÷', 'op'],
    ['7', ''],
    ['8', ''],
    ['9', ''],
    ['×', 'op'],
    ['4', ''],
    ['5', ''],
    ['6', ''],
    ['−', 'op'],
    ['1', ''],
    ['2', ''],
    ['3', ''],
    ['+', 'op'],
    ['0', 'zero'],
    ['.', ''],
    ['=', 'op'],
  ]

  return (
    <div className="calculator" data-drag>
      <div className="calc-tape">{tape[0] ?? ''}</div>
      <div className="calc-display" style={{ fontSize }}>
        {shown}
      </div>
      <div className="calc-keys">
        {keys.map(([k, cls]) => (
          <button key={k + cls} className={`ck ${cls} ${cls === 'op' && op === k && fresh ? 'active' : ''}`} onClick={() => press(k === 'C' ? 'AC' : k)}>
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}

function mathify(text: string) {
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(/^(.*?)(=\s*)$/)
      if (!m) return line
      const lhs = m[1].includes('=') ? m[1].slice(m[1].lastIndexOf('=') + 1) : m[1].replace(/^[^=]*?:\s*/, '')
      const v = calc(lhs)
      return v === null ? line : `${line.replace(/\s*$/, '')} ${formatNumber(v)}`
    })
    .join('\n')
}

function annotate(text: string) {
  return text.split('\n').map((line) => {
    const tail = line.match(/^(.*?)=\s*$/)
    if (tail) {
      const v = calc(tail[1].includes('=') ? tail[1].slice(tail[1].lastIndexOf('=') + 1) : tail[1])
      return v === null ? null : formatNumber(v)
    }
    const m = line.match(/^(.+?)\s*=\s*([^=]+)$/)
    if (!m) return null
    const v = calc(m[2])
    if (v === null || /^\s*-?[\d.,]+\s*$/.test(m[2])) return null
    return formatNumber(v)
  })
}

export function Notes() {
  const notes = useOS((s) => s.notes)
  const [active, setActive] = useState<string | null>(notes[0]?.id ?? null)
  const [q, setQ] = useState('')
  const note = notes.find((n) => n.id === active) ?? null
  const list = notes.filter((n) => n.text.toLowerCase().includes(q.toLowerCase()))
  const hints = useMemo(() => (note ? annotate(note.text) : []), [note?.text])

  const update = (text: string) => {
    if (!note) return
    const next = text.endsWith('=') || /=\s*\n$/.test(text) ? mathify(text) : text
    os().saveNote({ ...note, text: next, updated: Date.now() })
  }

  const fmtDate = (t: number) => {
    const d = new Date(t)
    return Date.now() - t < 86_400_000 ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
  }

  return (
    <div className="notes">
      <aside className="notes-list" data-drag>
        <div className="sidebar-spacer" />
        <label className="search-field wide">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        </label>
        <div className="sb-head">Today</div>
        {list.map((n) => {
          const [title, ...rest] = n.text.split('\n')
          return (
            <button key={n.id} className={`note-row ${n.id === active ? 'active' : ''}`} onClick={() => setActive(n.id)}>
              <b>{title || 'New Note'}</b>
              <span>
                <time>{fmtDate(n.updated)}</time> {rest.join(' ').trim().slice(0, 40) || 'No additional text'}
              </span>
            </button>
          )
        })}
      </aside>
      <section className="notes-editor">
        <div className="toolbar" data-drag>
          <div style={{ flex: 1 }} />
          <button
            className="tb-btn"
            aria-label="Delete note"
            onClick={() => {
              if (!note) return
              os().deleteNote(note.id)
              setActive(notes.find((n) => n.id !== note.id)?.id ?? null)
            }}
          >
            <Trash2 size={16} />
          </button>
          <button
            className="tb-btn"
            aria-label="New note"
            onClick={() => {
              const id = Math.random().toString(36).slice(2)
              os().saveNote({ id, text: '', updated: Date.now() })
              setActive(id)
            }}
          >
            <SquarePen size={16} />
          </button>
        </div>
        {note ? (
          <div className="note-body">
            <div className="note-date">{new Date(note.updated).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            <div className="note-wrap">
              <textarea value={note.text} onChange={(e) => update(e.target.value)} spellCheck={false} placeholder="Type 2+2= and watch a Rust kernel do arithmetic" />
              <div className="note-hints" aria-hidden>
                {note.text.split('\n').map((line, i) => (
                  <div key={i}>
                    <span className="ghost">{line || ' '}</span>
                    {hints[i] && <span className="math-hint">{/=\s*$/.test(line) ? ' ' : ' = '}{hints[i]}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="finder-empty">
            <button className="btn" onClick={() => os().saveNote({ id: 'n' + Date.now(), text: '', updated: Date.now() })}>
              <Plus size={14} /> New Note
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

export function TextEdit({ win }: { win: Win }) {
  const path = win.props.path as string | undefined
  const node = path ? resolve(path) : null
  const [text, setText] = useState(node && node.type === 'file' ? node.content ?? '' : '')
  const [dirty, setDirty] = useState(false)
  const setTitle = useOS((s) => s.setTitle)
  useEffect(() => {
    const n = path ? resolve(path) : null
    setText(n && n.type === 'file' ? n.content ?? '' : '')
    setDirty(false)
  }, [path])
  useEffect(() => {
    setTitle(win.id, `${path ? path.split('/').pop() : 'Untitled'}${dirty ? ' — Edited' : ''}`)
  }, [path, dirty])
  const save = () => {
    writeFile(path ?? '/Users/pear/Documents/Untitled.txt', text)
    os().bumpFs()
    setDirty(false)
  }
  return (
    <div className="textedit">
      <div className="te-ruler" data-drag>
        <select defaultValue="Helvetica">
          <option>Helvetica</option>
          <option>Comic Sans MS</option>
          <option>Papyrus</option>
        </select>
        <select defaultValue="12">
          {[10, 12, 14, 18, 24].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button className="tb-btn" onClick={save} aria-label="Save">
          <Save size={15} />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault()
            save()
          }
        }}
        spellCheck={false}
      />
    </div>
  )
}

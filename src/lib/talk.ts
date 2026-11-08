// Talk stations: endless scripts read aloud by the browser's speech synthesiser.

import { useCaptions } from './captions'
import type { Rant } from './lkml'

/** Spoken text, seconds of silence, or a byline (spoken, and starts a new caption page). */
export type Beat = string | number | { head: string }

export interface Show {
  rate: number
  pitch: number
  /** Picks which of the installed English voices reads this show. */
  voiceSalt: number
  /** One segment of the broadcast: strings are spoken, numbers are seconds of silence. */
  script(r: () => number, mem: Record<string, unknown>): Beat[]
}

export interface TalkHandle {
  stop(): void
}

const pick = <T,>(a: readonly T[], r: () => number) => a[Math.floor(r() * a.length)]
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const spell = (n: number) => String(n).split('').map((d) => DIGITS[+d]).join(', ')

// ───────────────────────── numbers station ─────────────────────────

export const numbers: Show = {
  rate: 0.78,
  pitch: 0.55,
  voiceSalt: 0,
  script(r) {
    const out: Beat[] = [6, 'Attention. Attention.', 1.5, `${pick(['Lima', 'Oscar', 'Tango', 'Papa'], r)}. ${pick(['Echo', 'Delta', 'Victor', 'Zulu'], r)}. ${spell(int(r, 10, 99))}.`, 2.5]
    const groups = int(r, 6, 11)
    for (let i = 0; i < groups; i++) {
      out.push(spell(int(r, 10000, 99999)) + '.', 1.4)
    }
    out.push('End of message. End of message.', int(r, 10, 20))
    return out
  },
}

// ───────────────────────── Pear News Network ─────────────────────────

const WHO = ['A local pear', 'The mayor of Mountain Lake', 'A senior engineer', 'An unpaid intern', 'The Orchard Council', 'A very confident toaster', 'Three squirrels', 'The last remaining floppy disk', 'A man in a lanyard', 'The kernel']
const DID = [
  'has declared the clipboard "a public utility"',
  'refuses to leave the standup',
  'was found asleep inside the build server',
  'has been promoted to regional manager of nothing',
  'accidentally merged to main',
  'is asking everyone to please stop pressing the button',
  'announced a bold new strategy of waiting',
  'has banned Tuesdays',
  'reportedly typed "sudo" at a stranger',
  'is now legally a database',
]
const REACT = ['Experts are baffled.', 'Analysts say this is fine.', 'The market responded by shrugging.', 'Nobody has been notified.', 'Officials urge calm and a hard refresh.', 'A spokesperson said "no comment, but also yes".', 'Markets are closed, spiritually.']
const SPORT = ['In sport, the Heap Garbage Collectors beat the Stack Overflowers three to null.', 'In sport, the Segfaults are undefeated, but only on Mondays.', 'In sport, the local pear-throwing championship was postponed due to ripeness.']
const WEATHER = ['Tonight: partly cloudy, with a ninety percent chance of vibes.', 'The forecast: light drizzle of semicolons, clearing by morning.', 'Weather: it will be exactly as warm as you are expecting, give or take a warm.']
const SIGN = ['That was the news. It was, at best, news-adjacent.', 'Stay tuned. Or do not. The news happens either way.', 'This has been P N N. All the news that is fit to compile.']

export const news: Show = {
  rate: 0.98,
  pitch: 1.05,
  voiceSalt: 1,
  script(r) {
    const out: Beat[] = [4, 'This is P N N, the Pear News Network.', 1.2]
    for (let i = 0; i < 3; i++) {
      out.push(`${pick(['Breaking news.', 'In other news.', 'Developing story.', 'And finally.'], r)} ${pick(WHO, r)} ${pick(DID, r)}.`, 0.6, pick(REACT, r), 2.5)
    }
    out.push(pick(r() < 0.5 ? SPORT : WEATHER, r), 1.5, pick(SIGN, r), int(r, 8, 14))
    return out
  },
}

// ───────────────────────── Radio Free Kernel ─────────────────────────

const LOG: readonly (readonly [string, readonly string[]])[] = [
  ['ACPI', ['tables found, mostly', 'a pear was detected in thermal zone zero', 'power button pressed, feelings hurt']],
  ['pear F S', ['mounted volume read-write, optimistically', 'journal replay complete, nothing was lost, probably', 'orphan inode cleaned up, with respect']],
  ['O O M killer', ['killed process four two four two, chrome, to feel something', 'out of memory, out of patience', 'sacrificed a background tab']],
  ['systemd', ['started Regret', 'reached target Existential Dread', 'failed to start Hope. Retrying in five seconds', 'stopped Being Productive']],
  ['U S B one dash one', ['new high-speed device number seven, it is a pear', 'device descriptor read error, it is shy']],
  ['random', ['C R N G init done, entropy is up to no good', 'ran out of ideas']],
  ['eth zero', ['link is up, one thousand megabit, full duplex, smug', 'carrier lost, it said it needed space']],
  ['kernel', ['panic not syncing, just kidding', 'tainted, but emotionally', 'unable to handle null pointer dereference, handling it anyway']],
]

export const dmesg: Show = {
  rate: 1.05,
  pitch: 0.9,
  voiceSalt: 2,
  script(r, mem) {
    let t = (mem.t as number | undefined) ?? 0
    const out: Beat[] = [3, pick(['Radio Free Kernel. The boot log, read aloud.', 'You are listening to Radio Free Kernel.', 'Kernel log, live from ring buffer zero.'], r), 1.5]
    const lines = int(r, 5, 9)
    for (let i = 0; i < lines; i++) {
      t += r() * 3.2
      const [sub, msgs] = pick(LOG, r)
      out.push(`At ${t.toFixed(1).replace('.', ' point ')} seconds, ${sub}: ${pick(msgs, r)}.`, 1.1 + r() * 1.6)
    }
    mem.t = t
    out.push(int(r, 5, 10))
    return out
  },
}

// ───────────────────────── Marine forecast ─────────────────────────

const AREAS = ['Cupertino', 'Heap', 'Stack Overflow', 'Segfault', 'Null Pointer', 'Dangling Reference', 'Buffer', 'Cache Miss', 'Mountain Lake', 'Deep Orchard', 'Legacy', 'Race Condition']
const DIR = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest', 'Variable']
const SEA = ['Smooth.', 'Slight.', 'Moderate.', 'Moderate or rough.', 'Rough, occasionally very rough.', 'High, or at least confident.', 'Phenomenal. Please do not.']
const WX = ['Fair.', 'Rain at times.', 'Showers, with segfaults.', 'Thundery outbreaks of merge conflicts.', 'Fog patches, mostly legacy.', 'Squally showers of semicolons.', 'Snow. Why is there snow.']
const VIS = ['Good.', 'Good, occasionally poor.', 'Moderate, becoming poor.', 'Very poor, or hidden behind a modal.', 'Good, until you look closer.']

export const marine: Show = {
  rate: 0.85,
  pitch: 0.92,
  voiceSalt: 3,
  script(r) {
    const out: Beat[] = [5, 'And now the Pear marine forecast, issued by the Mountain Lake Weather Centre.', 1.5, 'There are warnings of gales in Segfault, Heap and Null Pointer.', 2.5, 'The general synopsis: a low is deepening slowly, and has questions.', 2.5]
    const start = int(r, 0, AREAS.length - 1)
    const areas = int(r, 5, 7)
    for (let i = 0; i < areas; i++) {
      const lo = int(r, 2, 6)
      const wind = `${pick(DIR, r)} ${lo}${r() < 0.6 ? ` to ${lo + int(r, 1, 3)}` : ''}${r() < 0.25 ? `, occasionally gale ${int(r, 8, 9)} later` : ''}.`
      out.push(`${AREAS[(start + i) % AREAS.length]}.`, 0.5, wind, 0.4, pick(SEA, r), 0.4, pick(WX, r), 0.4, pick(VIS, r), 1.8)
    }
    out.push('That completes the forecast.', int(r, 9, 15))
    return out
  },
}

// ───────────────────────── LKML Radio ─────────────────────────

/** Bleeps the archive's own f*cking-style censoring (or spells it out), drops emphasis marks, reads snake_case as words. */
const clean = (t: string, raw: boolean) =>
  (raw
    ? t.replace(/\bf\*ck/gi, (m) => m.replace('*', /[A-Z]/.test(m[2]) ? 'U' : 'u')).replace(/\bsh\*t/gi, (m) => m.replace('*', /[A-Z]/.test(m[3]) ? 'I' : 'i'))
    : t.replace(/\b\w\*\w*ing\b/g, 'bleeping').replace(/\b\w\*\w+\b/g, 'bleep')
  )
    .replace(/(?<=\w)[*_](?=\w)/g, ' ')
    .replace(/[*_]/g, '')

function read(text: string, raw: boolean): Beat[] {
  const out: Beat[] = []
  for (const part of clean(text, raw).split(/\s*(?:\.\.\.|…)\s*/)) {
    for (const sentence of part.split(/(?<=[.!?])\s+/)) if (sentence.trim()) out.push(sentence, 0.25)
    out.push(0.5)
  }
  return out
}

const LEAD = ['From the archive.', 'Another one from the archive.', 'Reading from the mailing list.', 'And from the mailing list.']

function attribution(rant: Rant, r: () => number): Beat[] {
  return [{ head: rant.when ? `${rant.by}, ${rant.when}.` : pick(LEAD, r) }, 0.8]
}

let archive: typeof import('./lkml') | undefined
let fetching: Promise<unknown> | undefined

function rantShow(raw: boolean, intro: string): Show {
  return {
    rate: raw ? 1.15 : 1.08,
    pitch: raw ? 0.72 : 0.8,
    voiceSalt: raw ? 5 : 4,
    script(r, mem) {
      if (!archive) {
        fetching ??= import('./lkml').then(
          (m) => (archive = m),
          () => (fetching = undefined),
        )
        return [0.3]
      }
      const { RANTS, SIGN_OFF, UNFILTERED } = archive
      const pool = raw ? [...RANTS, ...UNFILTERED] : RANTS
      // A shuffled bag, so a rant doesn't come round again until all the others have.
      let bag = (mem.bag as Rant[] | undefined) ?? []
      const out: Beat[] = [4, intro, 1.5]
      for (let i = 0; i < 3; i++) {
        if (!bag.length) bag = pool.map((x) => [r(), x] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1])
        const rant = bag.pop()!
        out.push(...attribution(rant, r), ...read(rant.text, raw), 2.5)
      }
      mem.bag = bag
      if (r() < 0.12) out.push('And now, something different.', 1, ...attribution(SIGN_OFF, r), ...read(SIGN_OFF.text, raw), 2)
      out.push(int(r, 6, 12))
      return out
    },
  }
}

export const lkml = rantShow(false, 'You are listening to L K M L Radio. All rants, all the time.')
export const lkmlRaw = rantShow(true, 'L K M L Radio, after dark. Nothing has been bleeped. You were warned.')

// ───────────────────────── speaker ─────────────────────────

function voiceFor(salt: number) {
  const all = speechSynthesis.getVoices().filter((v) => /^en\b/i.test(v.lang.replace('_', '-')))
  return all.length ? all[salt % all.length] : undefined
}

export function startTalk(show: Show, getVolume: () => number, r: () => number = Math.random): TalkHandle | null {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const mem: Record<string, unknown> = {}
  let queue: Beat[] = []

  const later = (s: number, fn: () => void) => {
    clearTimeout(timer)
    timer = setTimeout(() => !stopped && fn(), s * 1000)
  }

  const next = () => {
    if (stopped) return
    if (!queue.length) queue = show.script(r, mem)
    const b = queue.shift()!
    if (typeof b === 'number') return later(b, next)
    const v = getVolume()
    if (v <= 0.001) return later(1, next)

    const head = typeof b === 'object'
    const text = head ? b.head : b
    useCaptions.getState().say(text, head)
    const u = new SpeechSynthesisUtterance(text)
    const voice = voiceFor(show.voiceSalt)
    if (voice) u.voice = voice
    u.rate = show.rate
    u.pitch = show.pitch
    u.volume = Math.min(1, v * v * 1.4)
    const done = () => later(0.15, next)
    u.onend = done
    u.onerror = done
    speechSynthesis.speak(u)
    // Some engines never fire onend; don't let one stall the whole broadcast.
    later(Math.max(12, text.length * 0.35), () => {
      speechSynthesis.cancel()
      next()
    })
  }
  next()

  return {
    stop() {
      stopped = true
      clearTimeout(timer)
      speechSynthesis.cancel()
      useCaptions.getState().clear()
    },
  }
}

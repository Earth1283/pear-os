import { create } from 'zustand'

export interface Caption {
  id: number
  text: string
  /** A byline like "Linus Torvalds, December 2012." rather than something said in the broadcast. */
  head?: boolean
}

interface CaptionState {
  lines: Caption[]
  say(text: string, head?: boolean): void
  clear(): void
}

const KEEP = 9
let seq = 0

/** What a talk station is saying right now, for the Now Playing views. */
export const useCaptions = create<CaptionState>((set) => ({
  lines: [],
  // A byline starts a fresh page, so each rant builds up on its own.
  say: (text, head) => set((s) => ({ lines: [...(head ? [] : s.lines), { id: ++seq, text, head }].slice(-KEEP) })),
  clear: () => set((s) => (s.lines.length ? { lines: [] } : s)),
}))

/** The line being spoken, or null when nothing is. */
export const useSpoken = () => useCaptions((s) => s.lines[s.lines.length - 1]?.text ?? null)

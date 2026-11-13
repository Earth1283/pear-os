import { create } from 'zustand'

export const useFlights = create<{ ids: string[] }>(() => ({ ids: [] }))

export const startFlight = (id: string) => useFlights.setState((s) => (s.ids.includes(id) ? s : { ids: [...s.ids, id] }))
export const endFlight = (id: string) => useFlights.setState((s) => (s.ids.includes(id) ? { ids: s.ids.filter((x) => x !== id) } : s))

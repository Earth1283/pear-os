export function normaliseDock<T extends string>(list: T[], valid: (id: T) => boolean, pinned: T[]): T[] {
  const out = [...new Set(list)].filter(valid)
  const [first, ...rest] = pinned
  const body = out.filter((id) => id !== first)
  for (const id of rest) if (!body.includes(id) && valid(id)) body.splice(Math.min(pinned.indexOf(id) - 1, body.length), 0, id)
  return [first, ...body]
}

export function dropIndex(centers: number[], x: number, min = 1) {
  let n = 0
  for (const c of centers) if (c < x) n++
  return Math.max(min, n)
}

export function insertAt<T>(list: T[], id: T, index: number): T[] {
  const without = list.filter((x) => x !== id)
  without.splice(Math.max(0, Math.min(index, without.length)), 0, id)
  return without
}

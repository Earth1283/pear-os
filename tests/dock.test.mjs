import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quadMatrix, genieQuad, genieFrames, rectQuad, solve } from '../src/lib/genie.ts'
import { dropIndex, insertAt, normaliseDock } from '../src/lib/dockOrder.ts'

const parse = (m) => m.slice(9, -1).split(',').map(Number)
const apply = (m, x, y) => {
  const v = parse(m)
  const w = v[3] * x + v[7] * y + v[15]
  return { x: (v[0] * x + v[4] * y + v[12]) / w, y: (v[1] * x + v[5] * y + v[13]) / w }
}

test('solve handles a plain system and rejects a singular one', () => {
  assert.deepEqual(solve([[2, 0], [0, 4]], [6, 8]), [3, 2])
  assert.equal(solve([[1, 1], [2, 2]], [1, 2]), null)
})

test('the matrix sends the window corners exactly onto the quad', () => {
  const quad = [{ x: 120, y: 80 }, { x: 640, y: 120 }, { x: 500, y: 600 }, { x: 200, y: 560 }]
  const m = quadMatrix(400, 300, quad)
  for (const [i, [x, y]] of [[0, 0], [400, 0], [400, 300], [0, 300]].entries()) {
    const p = apply(m, x, y)
    assert.ok(Math.abs(p.x - quad[i].x) < 1e-3 && Math.abs(p.y - quad[i].y) < 1e-3)
  }
})

test('the genie starts as the window and ends inside the Dock icon, bottom edge first', () => {
  const win = { x: 200, y: 100, w: 700, h: 450 }
  const icon = { x: 900, y: 820, w: 52, h: 52 }
  const start = genieQuad(win, icon, 0)
  assert.deepEqual(start, rectQuad(win))
  const mid = genieQuad(win, icon, 0.4)
  const bottomWidth = mid[2].x - mid[3].x
  const topWidth = mid[1].x - mid[0].x
  assert.ok(bottomWidth < topWidth, 'bottom narrower than top mid-flight')
  const end = genieQuad(win, icon, 1)
  for (const p of end) assert.ok(p.x >= icon.x - 1 && p.x <= icon.x + icon.w + 1 && p.y >= icon.y && p.y <= icon.y + icon.h)
  assert.ok(end[2].y > end[0].y, 'never inverts')
})

test('every generated frame is a usable matrix and the last one is transparent', () => {
  for (const mode of ['genie', 'scale']) {
    const frames = genieFrames({ x: 50, y: 60, w: 800, h: 500 }, { x: 600, y: 840, w: 52, h: 52 }, mode)
    assert.ok(frames.length > 30)
    for (const f of frames) assert.ok(parse(f.transform).every(Number.isFinite))
    assert.equal(frames.at(-1).opacity < 0.2, true)
  }
})

test('dock order keeps Finder first, Launchpad second and drops unknown apps', () => {
  const valid = (id) => id !== 'ghost'
  assert.deepEqual(normaliseDock(['mail', 'ghost', 'finder', 'mail', 'notes'], valid, ['finder', 'launchpad']), ['finder', 'launchpad', 'mail', 'notes'])
  assert.deepEqual(normaliseDock([], valid, ['finder', 'launchpad']), ['finder', 'launchpad'])
})

test('drop index counts the icons left of the pointer but never lands before Finder', () => {
  assert.equal(dropIndex([50, 110, 170, 230], 140), 2)
  assert.equal(dropIndex([50, 110, 170, 230], 10), 1)
  assert.equal(dropIndex([50, 110, 170, 230], 900), 4)
})

test('insertAt moves an existing item rather than duplicating it', () => {
  assert.deepEqual(insertAt(['a', 'b', 'c', 'd'], 'd', 1), ['a', 'd', 'b', 'c'])
  assert.deepEqual(insertAt(['a', 'b'], 'z', 9), ['a', 'b', 'z'])
})

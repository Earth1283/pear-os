import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cornerAt, modifierHeld, parseCorners, defaultCorners, CORNER_ZONE } from '../src/lib/hotCornerConfig.ts'

test('only the four corner squares count, not the edges', () => {
  assert.equal(cornerAt(0, 0, 1440, 900), 'tl')
  assert.equal(cornerAt(1439, 0, 1440, 900), 'tr')
  assert.equal(cornerAt(0, 899, 1440, 900), 'bl')
  assert.equal(cornerAt(1439, 899, 1440, 900), 'br')
  assert.equal(cornerAt(720, 0, 1440, 900), null)
  assert.equal(cornerAt(0, 450, 1440, 900), null)
  assert.equal(cornerAt(CORNER_ZONE, CORNER_ZONE, 1440, 900), null)
  assert.equal(cornerAt(CORNER_ZONE - 1, CORNER_ZONE - 1, 1440, 900), 'tl')
})

test('the exit tolerance is wider than the live zone', () => {
  assert.equal(cornerAt(14, 10, 1440, 900), null)
  assert.equal(cornerAt(14, 10, 1440, 900, 18), 'tl')
})

test('a modifier is required only when the corner asks for one', () => {
  const none = { metaKey: false, altKey: false, ctrlKey: false, shiftKey: false }
  assert.equal(modifierHeld('none', none), true)
  assert.equal(modifierHeld('meta', none), false)
  assert.equal(modifierHeld('meta', { ...none, metaKey: true }), true)
  assert.equal(modifierHeld('alt', { ...none, metaKey: true }), false)
})

test('saved corners are validated and fall back per corner', () => {
  assert.equal(parseCorners(null), null)
  const parsed = parseCorners({ tl: { action: 'missionControl', mod: 'meta' }, tr: { action: 'format-disk', mod: 'hax' }, br: 7 })
  assert.deepEqual(parsed.tl, { action: 'missionControl', mod: 'meta' })
  assert.deepEqual(parsed.tr, { action: 'none', mod: 'none' })
  assert.deepEqual(parsed.bl, defaultCorners().bl)
  assert.deepEqual(parsed.br, { action: 'none', mod: 'none' })
})

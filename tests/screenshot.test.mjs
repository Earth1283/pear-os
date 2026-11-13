import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shotName, spanBox, resizeBox, clampBox, centredBox, sourceBox, windowShotSize, thumbSize, pickMime, clock } from '../src/lib/screenshotCore.ts'

test('file names match macOS 15, including the narrow no-break space before AM/PM', () => {
  assert.equal(shotName(new Date(2026, 10, 13, 15, 42, 10), 'Screenshot', 'png'), 'Screenshot 2026-11-13 at 3.42.10 PM.png')
  assert.equal(shotName(new Date(2026, 0, 2, 0, 5, 9), 'Screen Recording', 'mov'), 'Screen Recording 2026-01-02 at 12.05.09 AM.mov')
  assert.equal(shotName(new Date(2026, 0, 2, 12, 0, 0), 'Screenshot', 'png'), 'Screenshot 2026-01-02 at 12.00.00 PM.png')
})

test('dragging in any direction gives the same box', () => {
  assert.deepEqual(spanBox(300, 200, 100, 50), { x: 100, y: 50, w: 200, h: 150 })
  assert.deepEqual(spanBox(10, 10, 10, 10), { x: 10, y: 10, w: 0, h: 0 })
})

test('resize handles move only their own edges and respect the minimum and the screen', () => {
  const b = { x: 100, y: 100, w: 300, h: 200 }
  assert.deepEqual(resizeBox(b, 'se', 50, -20, 1440, 900), { x: 100, y: 100, w: 350, h: 180 })
  assert.deepEqual(resizeBox(b, 'nw', 40, 30, 1440, 900), { x: 140, y: 130, w: 260, h: 170 })
  assert.deepEqual(resizeBox(b, 'e', -9999, 0, 1440, 900), { x: 100, y: 100, w: 20, h: 200 })
  assert.deepEqual(resizeBox(b, 'w', -9999, 0, 1440, 900), { x: 0, y: 100, w: 400, h: 200 })
  assert.deepEqual(resizeBox(b, 's', 0, 9999, 1440, 900), { x: 100, y: 100, w: 300, h: 800 })
})

test('boxes are clamped onto the screen without changing size', () => {
  assert.deepEqual(clampBox({ x: -50, y: 880, w: 200, h: 100 }, 1440, 900), { x: 0, y: 800, w: 200, h: 100 })
  assert.deepEqual(clampBox({ x: 0, y: 0, w: 5000, h: 100 }, 1440, 900), { x: 0, y: 0, w: 1440, h: 100 })
  const c = centredBox(1440, 900)
  assert.equal(c.x * 2 + c.w, 1440)
  assert.equal(c.y * 2 + c.h, 900)
})

test('retina capture maps CSS pixels onto video pixels', () => {
  assert.deepEqual(sourceBox({ x: 10.4, y: 20, w: 100.2, h: 50 }, 2), { x: 21, y: 40, w: 200, h: 100 })
  assert.deepEqual(windowShotSize({ x: 0, y: 0, w: 400, h: 300 }, 2), { margin: 108, w: 1016, h: 816 })
})

test('thumbnails shrink to the corner size and never upscale', () => {
  assert.deepEqual(thumbSize(2880, 1800), { w: 190, h: 119 })
  assert.deepEqual(thumbSize(100, 60), { w: 100, h: 60 })
  assert.deepEqual(thumbSize(500, 2000), { w: 38, h: 150 })
})

test('recordings prefer MP4 as .mov and fall back to WebM', () => {
  assert.deepEqual(pickMime((t) => t.startsWith('video/mp4')), { mime: 'video/mp4;codecs=avc1', ext: 'mov' })
  assert.deepEqual(pickMime((t) => t === 'video/webm'), { mime: 'video/webm', ext: 'webm' })
  assert.deepEqual(pickMime(() => false), { mime: '', ext: 'webm' })
  assert.equal(clock(125_000), '2:05')
})

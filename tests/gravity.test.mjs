import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const bytes = await readFile(new URL('../src/kernel/pearnel.wasm', import.meta.url))
const { instance } = await WebAssembly.instantiate(bytes, {})
const kernel = instance.exports

function poses() {
  const values = new Float32Array(kernel.memory.buffer, kernel.gravity_poses_ptr(), kernel.gravity_poses_len())
  return Array.from({ length: values.length / 6 }, (_, i) => {
    const [id, x, y, angle, scale, asleep] = values.slice(i * 6, i * 6 + 6)
    return { id, x, y, angle, scale, asleep }
  })
}

beforeEach(() => {
  kernel.gravity_reset()
  kernel.gravity_bounds(1440, 900, 26, 86)
})

test('the shipped WASM exposes falling and sleeping poses through its memory ABI', () => {
  kernel.gravity_put(1, 200, 80, 300, 200, 0)
  kernel.gravity_step(0)
  const initial = poses()[0]
  for (let i = 0; i < 600; i++) kernel.gravity_step(1 / 60)
  const landed = poses()[0]
  assert.equal(landed.id, 1)
  assert.ok(landed.y > initial.y + 100)
  assert.ok(Math.abs(landed.y + 200 - 814) < 3)
  assert.equal(landed.asleep, 1)
  assert.equal(kernel.gravity_step(0), 0)
})

test('the WASM grab API produces rotation and cleans up a removed grabbed body', () => {
  kernel.gravity_put(7, 300, 150, 300, 200, 0)
  assert.equal(kernel.gravity_grab(7, 315, 160), 1)
  kernel.gravity_pointer(850, 180)
  for (let i = 0; i < 30; i++) kernel.gravity_step(1 / 120)
  assert.ok(Math.abs(poses()[0].angle) > .1)
  kernel.gravity_remove(7)
  kernel.gravity_release()
  assert.equal(kernel.gravity_step(1 / 60), 0)
  assert.deepEqual(poses(), [])
  assert.equal(kernel.gravity_grab(7, 315, 160), 0)
})

test('upright mode and crowded narrow screens remain finite in the shipped kernel', () => {
  kernel.gravity_upright(1)
  for (let id = 1; id <= 6; id++) kernel.gravity_put(id, 200, 100, 860, 540, .4)
  kernel.gravity_bounds(390, 844, 26, 86)
  for (let i = 0; i < 180; i++) kernel.gravity_step(1 / 60)
  const result = poses()
  assert.equal(result.length, 6)
  for (const pose of result) {
    assert.ok(Object.values(pose).every(Number.isFinite))
    assert.ok(pose.scale > 0 && pose.scale < .4)
    assert.ok(Math.abs(pose.angle) < .001)
    const centerX = pose.x + 430
    const centerY = pose.y + 270
    assert.ok(centerX - 430 * pose.scale >= -1)
    assert.ok(centerX + 430 * pose.scale <= 391)
    assert.ok(centerY - 270 * pose.scale >= 25)
    assert.ok(centerY + 270 * pose.scale <= 759)
  }
})

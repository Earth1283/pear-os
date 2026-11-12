import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_BYTES, MAX_FILES, CHUNK_BYTES, BUFFER_HIGH, BUFFER_LOW, cleanName, safeFilename, newId, validId, validateFiles, encodePairCode, decodePairCode, waitForBuffer } from '../src/lib/airpearProtocol.ts'

const file = (overrides = {}) => ({ name: 'hello.txt', type: 'text/plain', size: 12, ...overrides })

test('file offers are bounded before the receiver allocates memory', () => {
  assert.deepEqual(validateFiles([file({ size: 0 })]), [file({ size: 0 })])
  assert.equal(validateFiles([file({ size: MAX_BYTES })])[0].size, MAX_BYTES)
  assert.throws(() => validateFiles([file({ size: MAX_BYTES }), file()]), /256 MiB/)
  for (const size of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateFiles([file({ size })]))
  assert.throws(() => validateFiles([]))
  assert.throws(() => validateFiles(Array.from({ length: MAX_FILES + 1 }, () => file())))
  assert.throws(() => validateFiles([file({ name: 'x'.repeat(181) })]))
  assert.throws(() => validateFiles([file({ type: 'x'.repeat(101) })]))
  assert.throws(() => validateFiles([null]))
  assert.throws(() => validateFiles('hello'))
  assert.ok(CHUNK_BYTES <= 16 * 1024 && BUFFER_LOW < BUFFER_HIGH)
})

test('received filenames cannot contain paths or control characters', () => {
  assert.equal(safeFilename('../../Documents/hello.txt'), 'hello.txt')
  assert.equal(safeFilename('C:\\Users\\pear\\hi.txt'), 'hi.txt')
  assert.equal(safeFilename('\u0000\n'), 'untitled')
  assert.equal(cleanName('  My\u0000 PearBook\n '), 'My PearBook')
  assert.equal(cleanName('x'.repeat(100)).length, 48)
  assert.deepEqual(validateFiles([file({ name: '../hello.txt' })]), [file()])
})

test('pairing codes preserve Unicode names and expire after ten minutes', () => {
  const code = { v: 1, token: newId(), from: newId(), name: '梨 PearBook 🍐', type: 'offer', sdp: 'v=0\r\na=candidate:host', created: Date.now() }
  assert.ok(validId(code.from))
  assert.notEqual(newId(), newId())
  assert.deepEqual(decodePairCode(encodePairCode(code)), code)
  assert.deepEqual(decodePairCode(' \n' + encodePairCode({ ...code, type: 'answer' }) + '\n '), { ...code, type: 'answer' })
  assert.throws(() => decodePairCode(encodePairCode({ ...code, created: Date.now() - 601_000 })), /expired/)
  assert.throws(() => decodePairCode(encodePairCode({ ...code, created: Date.now() + 61_000 })), /expired/)
  assert.throws(() => decodePairCode('AIRPEAR1.bad'))
  assert.throws(() => decodePairCode(encodePairCode({ ...code, sdp: 'not an SDP' })))
})

class Channel extends EventTarget { readyState = 'open'; bufferedAmount = 0 }

test('backpressure waits for the low-buffer event, then cleans up', async () => {
  const dc = new Channel()
  const abort = new AbortController()
  await waitForBuffer(dc, abort.signal)
  dc.bufferedAmount = BUFFER_HIGH + CHUNK_BYTES
  let resolved = false
  const waiting = waitForBuffer(dc, abort.signal).then(() => { resolved = true })
  await Promise.resolve()
  assert.equal(resolved, false)
  dc.bufferedAmount = BUFFER_LOW + 1
  dc.dispatchEvent(new Event('bufferedamountlow'))
  await Promise.resolve()
  assert.equal(resolved, false)
  dc.bufferedAmount = BUFFER_LOW
  dc.dispatchEvent(new Event('bufferedamountlow'))
  await waiting
  assert.equal(resolved, true)
})

test('closing or cancelling unblocks a sender waiting for buffer capacity', async () => {
  for (const how of ['close', 'abort']) {
    const dc = new Channel()
    dc.bufferedAmount = BUFFER_HIGH + 1
    const abort = new AbortController()
    const waiting = waitForBuffer(dc, abort.signal)
    if (how === 'abort') abort.abort()
    else { dc.readyState = 'closed'; dc.dispatchEvent(new Event('close')) }
    await assert.rejects(waiting, /closed|cancelled/)
  }
  const dc = new Channel()
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(waitForBuffer(dc, abort.signal), /cancelled/)
  dc.readyState = 'closed'
  await assert.rejects(waitForBuffer(dc, new AbortController().signal), /closed/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readPreviewText, TEXT_LIMIT } from '../src/lib/quickLookText.ts'

test('text previews request a bounded range and preserve Unicode', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/fs/read?path=test')
    assert.equal(options.headers.Range, `bytes=0-${TEXT_LIMIT}`)
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.signal, controller.signal)
    return new Response('pears 🍐\n日本語')
  })
  const controller = new AbortController()
  assert.deepEqual(await readPreviewText('/api/fs/read?path=test', controller.signal), { text: 'pears 🍐\n日本語', truncated: false })
})

test('an oversized response is cut off and its stream is cancelled even if Range is ignored', async (t) => {
  let cancelled = false
  let pulled = 0
  const chunk = new TextEncoder().encode('x'.repeat(64 * 1024))
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) { pulled++; controller.enqueue(chunk) },
    cancel() { cancelled = true },
  })))
  const result = await readPreviewText('/large', new AbortController().signal)
  assert.equal(result.text.length, TEXT_LIMIT)
  assert.equal(result.truncated, true)
  assert.equal(cancelled, true)
  assert.ok(pulled <= 6, `Read ${pulled} chunks from an unbounded stream`)
})

test('a complete preview at the limit is not marked as truncated', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(TEXT_LIMIT)))
  const result = await readPreviewText('/exact', new AbortController().signal)
  assert.equal(result.text.length, TEXT_LIMIT)
  assert.equal(result.truncated, false)
})

test('empty files with an unsatisfiable byte range still preview as empty', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 416, headers: { 'content-range': 'bytes */0' } }))
  assert.deepEqual(await readPreviewText('/empty', new AbortController().signal), { text: '', truncated: false })
})

test('read errors are surfaced and cancelled requests stay cancelled', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('missing', { status: 404 }))
  await assert.rejects(readPreviewText('/missing', new AbortController().signal), /could not be found/)
  t.mock.method(globalThis, 'fetch', async (_url, options) => { options.signal.throwIfAborted() })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readPreviewText('/cancelled', controller.signal), { name: 'AbortError' })
})

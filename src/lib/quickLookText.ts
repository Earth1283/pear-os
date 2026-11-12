export const TEXT_LIMIT = 256 * 1024

export async function readPreviewText(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, credentials: 'same-origin', headers: { Range: `bytes=0-${TEXT_LIMIT}` } })
  if (response.status === 416 && response.headers.get('content-range') === 'bytes */0') return { text: '', truncated: false }
  if (!response.ok) throw new Error(response.status === 404 ? 'This file could not be found.' : 'This file could not be read.')
  if (!response.body) throw new Error('This file could not be read.')
  const reader = response.body.getReader()
  const bytes = new Uint8Array(TEXT_LIMIT + 1)
  let length = 0
  try {
    while (length < bytes.length) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, bytes.length - length)
      bytes.set(value.subarray(0, take), length)
      length += take
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return { text: new TextDecoder().decode(bytes.subarray(0, Math.min(length, TEXT_LIMIT))), truncated: length > TEXT_LIMIT }
}


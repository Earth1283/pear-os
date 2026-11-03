// A small ID3v2 reader: title, artist, album, track number and embedded cover art.
// Only MP3 (and anything else that carries an ID3v2 header) has tags we can read here;
// everything else falls back to the filename, which is what the player does anyway.

export interface Tags {
  title?: string
  artist?: string
  album?: string
  track?: number
  art?: Blob
}

type Source = { url: string } | { blob: Blob }

async function bytes(src: Source, start: number, end: number): Promise<Uint8Array> {
  if ('blob' in src) return new Uint8Array(await src.blob.slice(start, end).arrayBuffer())
  const res = await fetch(src.url, { credentials: 'same-origin', headers: { Range: `bytes=${start}-${end - 1}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // A server that ignores Range sends the whole file; don't pull megabytes through the parser.
  const buf = new Uint8Array(await res.arrayBuffer())
  return res.status === 206 ? buf : buf.subarray(start, end)
}

const synchsafe = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0

function decode(data: Uint8Array, enc: number) {
  try {
    const label = enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'windows-1252'
    return new TextDecoder(label).decode(data).replace(/\0+$/g, '').trim()
  } catch {
    return ''
  }
}

function textFrame(body: Uint8Array) {
  return body.length > 1 ? decode(body.subarray(1), body[0]) : ''
}

/** Finds the end of a null-terminated string in the given encoding. */
function terminator(b: Uint8Array, from: number, enc: number) {
  const wide = enc === 1 || enc === 2
  for (let i = from; i < b.length - (wide ? 1 : 0); i += wide ? 2 : 1) {
    if (b[i] === 0 && (!wide || b[i + 1] === 0)) return i
  }
  return -1
}

function pictureFrame(body: Uint8Array): Blob | undefined {
  const enc = body[0]
  const mimeEnd = body.indexOf(0, 1)
  if (mimeEnd < 0) return undefined
  const mime = new TextDecoder('latin1').decode(body.subarray(1, mimeEnd)) || 'image/jpeg'
  const descStart = mimeEnd + 2 // skip the terminator and the picture-type byte
  const descEnd = terminator(body, descStart, enc)
  if (descEnd < 0) return undefined
  const data = body.subarray(descEnd + (enc === 1 || enc === 2 ? 2 : 1))
  if (data.length < 16) return undefined
  const type = /^image\//.test(mime) ? mime : data[0] === 0x89 ? 'image/png' : 'image/jpeg'
  return new Blob([data.slice().buffer], { type })
}

export function parseId3(buf: Uint8Array, wantArt = true): Tags {
  const tags: Tags = {}
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return tags
  const version = buf[3]
  if (version < 2 || version > 4) return tags
  const flags = buf[5]
  const total = Math.min(synchsafe(buf, 6) + 10, buf.length)
  const unsync = (flags & 0x80) !== 0
  let pos = 10
  if (version >= 3 && flags & 0x40) pos += version === 4 ? synchsafe(buf, 10) : be32(buf, 10) + 4

  const idLen = version === 2 ? 3 : 4
  const hdrLen = version === 2 ? 6 : 10
  while (pos + hdrLen <= total) {
    const id = new TextDecoder('latin1').decode(buf.subarray(pos, pos + idLen))
    if (!/^[A-Z0-9]+$/.test(id)) break
    const size = version === 2 ? (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5] : version === 4 ? synchsafe(buf, pos + 4) : be32(buf, pos + 4)
    const start = pos + hdrLen
    if (size <= 0 || start + size > total) break
    const body = buf.subarray(start, start + size)
    switch (id) {
      case 'TIT2':
      case 'TT2':
        tags.title = textFrame(body)
        break
      case 'TPE1':
      case 'TP1':
        tags.artist = textFrame(body)
        break
      case 'TALB':
      case 'TAL':
        tags.album = textFrame(body)
        break
      case 'TRCK':
      case 'TRK': {
        const n = parseInt(textFrame(body), 10)
        if (!Number.isNaN(n)) tags.track = n
        break
      }
      case 'APIC':
        // Unsynchronised tags have escaped bytes in the image; skip art rather than show garbage.
        if (wantArt && !tags.art && !unsync) tags.art = pictureFrame(body)
        break
    }
    pos = start + size
  }
  return tags
}

const MAX_TAG = 4 * 1024 * 1024

/** Text tags only by default (a 48 KB read); pass `art` to also pull the embedded cover. */
export async function readTags(src: Source, art = false): Promise<Tags> {
  try {
    const head = await bytes(src, 0, art ? 512 * 1024 : 48 * 1024)
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {}
    const need = synchsafe(head, 6) + 10
    if (!art || need <= head.length || need > MAX_TAG) return parseId3(head, art)
    return parseId3(await bytes(src, 0, need), art)
  } catch {
    return {}
  }
}

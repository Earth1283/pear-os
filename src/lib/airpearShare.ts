import { os } from '../store'
import { resolve } from './fs'
import { nodeImageURL } from './samples'
import { MAX_BYTES, safeFilename } from './airpearProtocol'

/** Adapt real virtual-disk contents into files; never manufacture sample binary data. */
export async function shareWithAirPear(what: string) {
  try {
    const node = resolve(what)
    let file: File
    if (node?.type === 'dir') throw new Error('Choose individual files to send with AirPear.')
    if (node?.type === 'file') {
      const name = safeFilename(what)
      if (node.kind === 'image') {
        const blob = await (await fetch(nodeImageURL(name, node))).blob()
        file = new File([blob], blob.type.includes('svg') ? name.replace(/\.[^.]+$/, '') + '.svg' : name, { type: blob.type })
      } else if (node.content !== undefined) file = new File([node.content], name, { type: 'text/plain' })
      else throw new Error('This sample file has no real contents. Choose a file from your computer in AirPear.')
    } else file = new File([what], 'Shared text.txt', { type: 'text/plain' })
    if (file.size > MAX_BYTES) throw new Error('AirPear supports up to 256 MiB per transfer.')
    os().openApp('airpear', { props: { files: [file] } })
  } catch (error) {
    os().openApp('airpear')
    os().notify({ app: 'airpear', title: 'AirPear', body: error instanceof Error ? error.message : 'Could not prepare this file.' })
  }
}

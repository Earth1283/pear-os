import type { V86 } from 'v86'
import { loadIso, loadState, saveMachine, supportUrls } from '../lib/v86store'

export const MEM_MB = 128
export const VGA_MB = 8

/**
 * A hard disk that is "N bytes of zeros" without allocating N bytes.
 *
 * v86 wants either an ArrayBuffer (which it would serialise whole into every saved state) or a File (which it
 * reads lazily and keeps writes for in a small overlay, so saved states only hold the blocks the guest wrote).
 * Browsers cannot make a sparse File, so this is a File in name only: it passes `instanceof File`, reports its
 * size, and hands out zero-filled Blobs for whatever range v86 slices. v86 only ever uses `size` and `slice()`.
 */
export function sparseDisk(bytes: number): File {
  const f = Object.create(File.prototype) as File
  Object.defineProperties(f, {
    size: { value: bytes },
    name: { value: 'pear-hd.img' },
    type: { value: '' },
    slice: {
      value: (start = 0, end = bytes) => new Blob([new Uint8Array(Math.max(0, Math.min(end, bytes) - Math.max(0, start)))]),
    },
  })
  return f
}

export interface Machine {
  emulator: V86
  /** True if this boot resumed a saved state instead of starting from the CD. */
  resumed: boolean
  save(): Promise<number>
  destroy(): void
}

/** Boots the stored Windows ISO (or resumes the saved machine). `screen` must contain a text div and a canvas. */
export async function startMachine(screen: HTMLElement, diskBytes: number, onProgress?: (m: string) => void, signal?: AbortSignal): Promise<Machine> {
  const cancelled = () => new DOMException('Cancelled', 'AbortError')
  onProgress?.('Loading the emulator…')
  const [{ V86 }, urls] = await Promise.all([import('v86'), supportUrls()])
  if (signal?.aborted) {
    Object.values(urls).forEach((u) => URL.revokeObjectURL(u))
    throw cancelled()
  }
  onProgress?.('Reading the Windows disc from this browser…')
  const iso = await loadIso()
  const state = await loadState()
  if (signal?.aborted) {
    Object.values(urls).forEach((u) => URL.revokeObjectURL(u))
    throw cancelled()
  }

  onProgress?.(state ? 'Resuming your saved machine…' : 'Powering on…')
  const emulator = new V86({
    wasm_path: urls['v86.wasm'],
    bios: { url: urls['seabios.bin'] },
    vga_bios: { url: urls['vgabios.bin'] },
    memory_size: MEM_MB * 1024 * 1024,
    vga_memory_size: VGA_MB * 1024 * 1024,
    screen_container: screen,
    // Typed as ArrayBuffer-only, but File is supported at runtime and is what keeps the disk sparse.
    hda: { buffer: sparseDisk(diskBytes), async: true } as never,
    cdrom: { buffer: iso, async: true } as never,
    ...(state ? { initial_state: { buffer: state } } : {}),
    autostart: true,
    acpi: false,
    disable_speaker: true,
  })

  await new Promise<void>((resolve) => emulator.add_listener('emulator-ready', () => resolve()))

  return {
    emulator,
    resumed: !!state,
    async save() {
      const buf = await emulator.save_state()
      await saveMachine(buf, diskBytes)
      return buf.byteLength
    },
    destroy() {
      try {
        void emulator.destroy()
      } finally {
        Object.values(urls).forEach((u) => URL.revokeObjectURL(u))
      }
    },
  }
}

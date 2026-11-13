import { useOS } from '../store'

export function shutterSound() {
  try {
    const ctx = new AudioContext()
    const len = Math.floor(ctx.sampleRate * 0.12)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * (i < len / 3 ? 0.08 : 0.2)))
    const src = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = 0.5 * useOS.getState().volume ** 2
    src.buffer = buf
    src.connect(gain).connect(ctx.destination)
    src.start()
    src.onended = () => ctx.close()
  } catch {
    return
  }
}

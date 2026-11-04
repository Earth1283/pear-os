import { useEffect, useRef } from 'react'
import { layersFor, shaderHub, useShaders, type SinkHandle, type SinkTarget } from '../lib/shaders'
import { useOS } from '../store'

function useLayers(target: SinkTarget) {
  const key = useShaders((s) => layersFor(s, target).map((l) => l.id).join('|'))
  return key ? layersFor(useShaders.getState(), target) : []
}

function ShaderCanvas({ target, className, blend, focus = 1, paused = false }: { target: SinkTarget; className: string; blend: string; focus?: number; paused?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const handle = useRef<SinkHandle | null>(null)
  useEffect(() => {
    handle.current = shaderHub()?.attach(ref.current!, target) ?? null
    handle.current?.set({ focus, paused })
    return () => {
      handle.current?.detach()
      handle.current = null
    }
  }, [target])
  useEffect(() => handle.current?.set({ focus, paused }), [focus, paused])
  return <canvas ref={ref} className={`shader-canvas ${className}`} style={{ mixBlendMode: blend as React.CSSProperties['mixBlendMode'] }} aria-hidden />
}

export function ShaderLayer({ target }: { target: 'desktop' | 'overlay' | 'sky' | 'shadow' }) {
  const layers = useLayers(target)
  const lake = useOS((s) => s.wallpaper === 'lake')
  const lit = target === 'shadow' && layers.length > 0
  useEffect(() => {
    if (target !== 'shadow') return
    document.documentElement.classList.toggle('lit', lit)
    return () => document.documentElement.classList.remove('lit')
  }, [target, lit])
  if (!layers.length || (target === 'sky' && lake)) return null
  return <ShaderCanvas target={target} className={`shader-${target}`} blend={layers[0].blend} />
}

export function WindowShader({ focused, minimized }: { focused: boolean; minimized: boolean }) {
  const layers = useLayers('windows')
  return layers.length ? <ShaderCanvas target="windows" className="win-shader" blend={layers[0].blend} focus={focused ? 1 : 0.3} paused={minimized} /> : null
}

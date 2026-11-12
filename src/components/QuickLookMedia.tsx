import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Music2, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react'
import { os, useOS } from '../store'
import { formatBytes } from '../lib/fs'

const time = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00'
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

export function QuickLookMedia({ url, name, size, video, onError }: { url: string; name: string; size: number; video: boolean; onError: () => void }) {
  const media = useRef<HTMLMediaElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [ready, setReady] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const volume = useOS((s) => s.volume)

  useEffect(() => {
    if (media.current) media.current.volume = volume
  }, [volume])

  useEffect(() => {
    const element = media.current
    if (element && element.getAttribute('src') !== url) element.src = url
    return () => {
      if (!element) return
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
  }, [url])

  const toggle = () => {
    const element = media.current
    if (!element) return
    if (element.paused) void element.play().catch(onError)
    else element.pause()
  }
  const seek = (value: number) => {
    if (!media.current || !ready) return
    media.current.currentTime = Math.max(0, Math.min(duration, value))
    setPosition(media.current.currentTime)
  }
  const events = {
    src: url,
    preload: 'metadata',
    onLoadedMetadata: () => {
      const length = media.current?.duration ?? 0
      setDuration(Number.isFinite(length) ? length : 0)
      setReady(Number.isFinite(length) && length > 0)
    },
    onDurationChange: () => {
      const length = media.current?.duration ?? 0
      if (Number.isFinite(length) && length > 0) { setDuration(length); setReady(true) }
    },
    onTimeUpdate: () => setPosition(media.current?.currentTime ?? 0),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onError,
  }

  return (
    <div className={`ql-media ${video ? 'ql-media-video' : 'ql-media-audio'}`}>
      {video ? <video ref={(element) => { media.current = element }} className="ql-video" playsInline aria-label={name} onClick={toggle} {...events} /> : <>
        <audio ref={(element) => { media.current = element }} {...events} />
        <div className="ql-audio-art" aria-hidden="true"><Music2 size={86} strokeWidth={1.4} /></div>
        <div className="ql-audio-details"><h2>{name.replace(/\.[^.]+$/, '')}</h2><p>{name.split('.').pop()?.toUpperCase()} audio · {formatBytes(size)}</p></div>
      </>}
      <div className="ql-transport" role="group" aria-label="Playback controls">
        <div className="ql-transport-buttons">
          <button className="ql-media-button ql-skip" aria-label="Back 10 seconds" disabled={!ready} onClick={() => seek(position - 10)}><RotateCcw size={22} /><span>10</span></button>
          <button className="ql-media-button ql-play" aria-label={playing ? 'Pause' : 'Play'} disabled={!ready} onClick={toggle}>{playing ? <Pause size={24} fill="currentColor" strokeWidth={0} /> : <Play size={24} fill="currentColor" strokeWidth={0} />}</button>
          <button className="ql-media-button ql-skip" aria-label="Forward 10 seconds" disabled={!ready} onClick={() => seek(position + 10)}><RotateCw size={22} /><span>10</span></button>
        </div>
        <div className="ql-timeline">
          <span>{time(position)}</span>
          <input className="ql-range" type="range" aria-label="Playback position" aria-valuetext={`${time(position)} of ${time(duration)}`} min={0} max={duration || 1} step={0.01} value={Math.min(position, duration || 1)} disabled={!ready} style={{ '--ql-progress': `${duration ? Math.min(100, position / duration * 100) : 0}%` } as CSSProperties} onChange={(e) => seek(Number(e.target.value))} />
          <span>−{time(duration - position)}</span>
          <div className="ql-volume">
            <button className="ql-media-button" aria-label="Volume" aria-expanded={showVolume} onClick={() => setShowVolume(!showVolume)}>{volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
            {showVolume && <div className="ql-volume-popover"><input className="ql-range" type="range" aria-label="Preview volume" min={0} max={1} step={0.01} value={volume} style={{ '--ql-progress': `${volume * 100}%` } as CSSProperties} onChange={(e) => os().set('volume', Number(e.target.value))} /></div>}
          </div>
        </div>
      </div>
    </div>
  )
}

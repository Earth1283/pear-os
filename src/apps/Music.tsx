import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CirclePlay, Disc3, Download, HardDrive, Heart, Laptop, MicVocal, Music2, Pause, Play, Plus, Radio, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import { os, useOS, type Win } from '../store'
import { bumpDrive, drive, useBackend } from '../lib/backend'
import { menu, type MenuEntry } from '../lib/menu'
import { STATIONS } from '../lib/synth'
import { AUDIO_EXT, STATION_TRACKS, formatTime, usePlayer, useCurrent, type Track } from '../lib/player'
import { Art, Eq, Scrub, Visualizer, trackHue } from '../components/MusicBits'

type View = 'now' | 'radio' | 'songs' | 'albums' | 'artists' | 'favorites'
type SourceFilter = 'all' | 'drive' | 'local'
type SortKey = 'default' | 'title' | 'artist' | 'album' | 'time'

const VIEWS: View[] = ['now', 'radio', 'songs', 'albums', 'artists', 'favorites']
const ROW = 30

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

function Transport({ big }: { big?: boolean }) {
  const playing = usePlayer((s) => s.playing)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const { toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer.getState()
  const sz = big ? 22 : 16
  return (
    <div className={`m-transport ${big ? 'big' : ''}`} data-nodrag>
      <button className={`m-btn ${shuffle ? 'on' : ''}`} title="Shuffle" aria-pressed={shuffle} onClick={toggleShuffle}>
        <Shuffle size={sz - 3} />
      </button>
      <button className="m-btn" title="Previous" onClick={prev}>
        <SkipBack size={sz} fill="currentColor" />
      </button>
      <button className="m-btn play" title={playing ? 'Pause' : 'Play'} onClick={toggle}>
        {playing ? <Pause size={sz + 4} fill="currentColor" /> : <Play size={sz + 4} fill="currentColor" />}
      </button>
      <button className="m-btn" title="Next" onClick={() => next()}>
        <SkipForward size={sz} fill="currentColor" />
      </button>
      <button className={`m-btn ${repeat !== 'off' ? 'on' : ''}`} title={`Repeat: ${repeat}`} aria-pressed={repeat !== 'off'} onClick={cycleRepeat}>
        {repeat === 'one' ? <Repeat1 size={sz - 3} /> : <Repeat size={sz - 3} />}
      </button>
    </div>
  )
}

function Lcd() {
  const cur = useCurrent()
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const buffering = usePlayer((s) => s.buffering)
  const live = cur?.source === 'station'
  return (
    <div className="m-lcd" data-nodrag>
      <Art track={cur} size={38} radius={5} />
      <div className="m-lcd-mid">
        {cur ? (
          <>
            <div className="m-lcd-title">{cur.title}</div>
            <div className="m-lcd-sub">
              {cur.artist}
              {cur.album && cur.source !== 'station' ? ` — ${cur.album}` : ''}
            </div>
            <div className="m-lcd-time">
              <span>{live ? formatTime(position) : formatTime(position)}</span>
              <Scrub
                label="Playback position"
                value={live ? 1 : duration ? position / duration : 0}
                disabled={live || !duration}
                thumb={false}
                onCommit={(v) => usePlayer.getState().seek(v * duration)}
              />
              <span>{live ? 'LIVE' : buffering && !duration ? '…' : `-${formatTime(Math.max(0, duration - position))}`}</span>
            </div>
          </>
        ) : (
          <div className="m-lcd-idle">
            <Music2 size={14} /> Not Playing
          </div>
        )}
      </div>
    </div>
  )
}

function VolumeControl() {
  const volume = useOS((s) => s.volume)
  const Icon = volume === 0 ? VolumeX : volume < 0.45 ? Volume1 : Volume2
  return (
    <div className="m-volume" data-nodrag>
      <button className="m-btn sm" title={volume === 0 ? 'Unmute' : 'Mute'} onClick={() => os().set('volume', volume === 0 ? 0.6 : 0)}>
        <Icon size={15} />
      </button>
      <Scrub label="Volume" value={volume} onChange={(v) => os().set('volume', v)} onCommit={(v) => os().set('volume', v)} />
    </div>
  )
}

function useVirtual(count: number) {
  const box = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 40 })
  const update = useCallback(() => {
    const e = box.current
    if (!e) return
    const start = Math.max(0, Math.floor(e.scrollTop / ROW) - 8)
    const end = Math.min(count, Math.ceil((e.scrollTop + e.clientHeight) / ROW) + 8)
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }))
  }, [count])
  useEffect(() => {
    update()
    const e = box.current
    if (!e) return
    const ro = new ResizeObserver(update)
    ro.observe(e)
    return () => ro.disconnect()
  }, [update])
  return { box, range, update }
}

function SongTable({ tracks, sort, setSort, onPlay, rowMenu, empty }: { tracks: Track[]; sort: { key: SortKey; dir: 1 | -1 }; setSort: (s: { key: SortKey; dir: 1 | -1 }) => void; onPlay: (t: Track) => void; rowMenu: (t: Track) => MenuEntry[]; empty: React.ReactNode }) {
  const cur = useCurrent()
  const playing = usePlayer((s) => s.playing)
  const favorites = usePlayer((s) => s.favorites)
  const durations = usePlayer((s) => s.durations)
  const [sel, setSel] = useState<string | null>(null)
  const { box, range, update } = useVirtual(tracks.length)
  const head = (key: SortKey, label: string) => (
    <button className={`m-th ${sort.key === key ? 'on' : ''}`} onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1 })}>
      {label}
      {sort.key === key && <span>{sort.dir === 1 ? '▲' : '▼'}</span>}
    </button>
  )
  if (!tracks.length) return <>{empty}</>
  return (
    <div className="m-table">
      <div className="m-tr m-thead">
        <span />
        {head('title', 'Title')}
        {head('artist', 'Artist')}
        {head('album', 'Album')}
        {head('time', 'Time')}
        <span />
      </div>
      <div className="m-rows" ref={box} onScroll={update} onPointerDown={() => setSel(null)}>
        <div style={{ height: tracks.length * ROW, position: 'relative' }}>
          {tracks.slice(range.start, range.end).map((t, i) => {
            const isCur = cur?.id === t.id
            const fav = favorites.includes(t.id)
            const d = durations[t.id] ?? t.duration
            return (
              <div
                key={t.id}
                className={`m-tr m-row ${sel === t.id ? 'sel' : ''} ${isCur ? 'cur' : ''} ${(range.start + i) % 2 ? 'odd' : ''}`}
                style={{ position: 'absolute', top: (range.start + i) * ROW, left: 0, right: 0, height: ROW }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setSel(t.id)
                }}
                onDoubleClick={() => onPlay(t)}
                onContextMenu={(e) => {
                  setSel(t.id)
                  menu(rowMenu(t))(e)
                }}
              >
                <span className="m-num">{isCur ? <Eq playing={playing} /> : t.track ?? ''}</span>
                <span className="m-cell title">{t.title}</span>
                <span className="m-cell">{t.artist}</span>
                <span className="m-cell">{t.album}</span>
                <span className="m-cell time">{d ? formatTime(d) : ''}</span>
                <button className={`m-heart ${fav ? 'on' : ''}`} title={fav ? 'Remove from Favorites' : 'Add to Favorites'} onClick={() => usePlayer.getState().toggleFavorite(t.id)} onDoubleClick={(e) => e.stopPropagation()}>
                  <Heart size={13} fill={fav ? 'currentColor' : 'none'} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function NowPlaying() {
  const cur = useCurrent()
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const playing = usePlayer((s) => s.playing)
  const favorites = usePlayer((s) => s.favorites)
  const upNext = queue.slice(index + 1, index + 9)
  if (!cur) {
    return (
      <div className="m-empty">
        <div className="m-empty-art">
          <Music2 size={54} strokeWidth={1.3} />
        </div>
        <h2>Nothing Playing</h2>
        <p>Pick a song from your library, or tune in to an endless station that is generated, live, in your browser.</p>
        <div className="m-empty-actions">
          <button className="btn primary" onClick={() => usePlayer.getState().playStation('lofi')}>
            <Play size={13} fill="currentColor" /> Play “lofi beats to debug to”
          </button>
        </div>
      </div>
    )
  }
  const fav = favorites.includes(cur.id)
  return (
    <div className="m-now">
      <div className={`m-now-art ${playing ? 'playing' : ''}`}>
        <Art track={cur} size={300} radius={14} />
      </div>
      <div className="m-now-info">
        <div className="m-now-head">
          <div>
            <h1>{cur.title}</h1>
            <h3>
              {cur.artist}
              {cur.album && cur.source !== 'station' && <span> — {cur.album}</span>}
            </h3>
          </div>
          <button className={`m-heart big ${fav ? 'on' : ''}`} title="Favorite" onClick={() => usePlayer.getState().toggleFavorite(cur.id)}>
            <Heart size={20} fill={fav ? 'currentColor' : 'none'} />
          </button>
        </div>
        <Visualizer className="m-now-viz" hue={trackHue(cur)} bars={52} />
        {upNext.length > 0 && (
          <div className="m-upnext">
            <div className="m-upnext-head">Up Next</div>
            {upNext.map((t, i) => (
              <button key={`${t.id}-${i}`} className="m-up" onClick={() => usePlayer.getState().play(queue, index + 1 + i)}>
                <Art track={t} size={30} radius={4} />
                <span className="m-up-text">
                  <b>{t.title}</b>
                  <small>{t.artist}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RadioView() {
  const cur = useCurrent()
  const playing = usePlayer((s) => s.playing)
  return (
    <div className="m-page scroll">
      <header className="m-page-head">
        <h1>Pear Radio</h1>
        <p>Four endless stations, composed live by your browser. No two minutes are the same.</p>
      </header>
      <div className="m-stations">
        {STATIONS.map((s, i) => {
          const t = STATION_TRACKS[i]
          const on = cur?.id === t.id
          return (
            <button key={s.id} className={`m-station ${on ? 'on' : ''}`} onClick={() => (on ? usePlayer.getState().toggle() : usePlayer.getState().playStation(s.id))}>
              <div className="m-station-art">
                <Art track={t} size={180} radius={12} />
                <span className="m-station-play">{on && playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</span>
                {on && playing && (
                  <span className="m-station-live">
                    <Eq playing /> LIVE
                  </span>
                )}
              </div>
              <b>{s.title}</b>
              <small>{s.blurb}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface Group {
  key: string
  name: string
  sub: string
  tracks: Track[]
}

/** Loose songs with no album tag share one "Unknown Album" instead of one per artist. */
const albumKeyOf = (t: Track) => (t.album === 'Unknown Album' ? 'Unknown Album' : `${t.artist}|${t.album}`)

function groupBy(tracks: Track[], by: 'album' | 'artist'): Group[] {
  const map = new Map<string, Group>()
  for (const t of tracks) {
    const key = by === 'album' ? albumKeyOf(t) : t.artist
    const g = map.get(key) ?? { key, name: by === 'album' ? t.album : t.artist, sub: by === 'album' ? t.artist : '', tracks: [] }
    if (by === 'album' && g.tracks.length && g.sub !== t.artist) g.sub = 'Various Artists'
    g.tracks.push(t)
    map.set(key, g)
  }
  return [...map.values()].sort((a, b) => byText(a.name, b.name))
}

export function Music({ win }: { win: Win }) {
  const authed = useBackend((s) => s.authed)
  const driveVersion = useBackend((s) => s.driveVersion)
  const driveTracks = usePlayer((s) => s.drive)
  const local = usePlayer((s) => s.local)
  const driveState = usePlayer((s) => s.driveState)
  const driveError = usePlayer((s) => s.driveError)
  const favorites = usePlayer((s) => s.favorites)
  const durations = usePlayer((s) => s.durations)
  const cur = useCurrent()

  const [view, setView] = useState<View>(() => (VIEWS.includes(win.props.view as View) ? (win.props.view as View) : cur ? 'now' : 'songs'))
  const [source, setSource] = useState<SourceFilter>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'default', dir: 1 })
  const [filter, setFilter] = useState<{ by: 'album' | 'artist'; key: string; label: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    const v = win.props.view as View | undefined
    if (v && VIEWS.includes(v)) {
      setView(v)
      setFilter(null)
    }
  }, [win.props])

  useEffect(() => {
    if (authed) void usePlayer.getState().loadDrive()
  }, [authed, driveVersion])

  const library = useMemo(() => (source === 'drive' ? driveTracks : source === 'local' ? local : [...driveTracks, ...local]), [source, driveTracks, local])

  const songs = useMemo(() => {
    let list = view === 'favorites' ? [...STATION_TRACKS, ...driveTracks, ...local].filter((t) => favorites.includes(t.id)) : library
    if (filter) list = list.filter((t) => (filter.by === 'album' ? albumKeyOf(t) : t.artist) === filter.key)
    const needle = q.trim().toLowerCase()
    if (needle) list = list.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(needle))
    const out = [...list]
    const { key, dir } = sort
    out.sort((a, b) => {
      let c = 0
      if (key === 'title') c = byText(a.title, b.title)
      else if (key === 'artist') c = byText(a.artist, b.artist) || byText(a.album, b.album) || (a.track ?? 0) - (b.track ?? 0)
      else if (key === 'album') c = byText(a.album, b.album) || (a.track ?? 0) - (b.track ?? 0)
      else if (key === 'time') c = (durations[a.id] ?? 0) - (durations[b.id] ?? 0)
      else c = byText(a.artist, b.artist) || byText(a.album, b.album) || (a.track ?? 0) - (b.track ?? 0) || byText(a.title, b.title)
      return c * dir
    })
    return out
  }, [view, library, driveTracks, local, favorites, filter, q, sort, durations])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? library.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(needle)) : library
  }, [library, q])
  const albums = useMemo(() => (view === 'albums' ? groupBy(filtered, 'album') : []), [view, filtered])
  const artists = useMemo(() => (view === 'artists' ? groupBy(filtered, 'artist') : []), [view, filtered])

  // Covers are fetched lazily, a screenful at a time.
  useEffect(() => {
    if (view === 'albums') usePlayer.getState().ensureArt(albums.slice(0, 48).map((g) => g.tracks[0].id))
  }, [view, albums])

  const go = (v: View) => {
    setView(v)
    setFilter(null)
    if (v !== 'songs' && v !== 'albums' && v !== 'artists' && v !== 'favorites') setQ('')
  }

  const importFiles = async (list: File[]) => {
    const audio = list.filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'))
    if (!audio.length) return os().notify({ app: 'music', title: 'Music', body: 'None of those look like audio files. Music accepts MP3, M4A, AAC, FLAC, WAV and OGG.' })
    if (authed) {
      try {
        for (const [i, f] of audio.entries()) {
          setBusy(`Uploading “${f.name}” (${i + 1} of ${audio.length})…`)
          await drive.write(`/Music/${f.name.replace(/[\\/]/g, '_')}`, f)
        }
        bumpDrive()
        os().notify({ app: 'music', title: 'Music', body: `Added ${audio.length} ${audio.length === 1 ? 'song' : 'songs'} to /Music in PearDrive.` })
      } catch (e) {
        os().notify({ app: 'music', title: 'Music', body: `Upload failed: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        setBusy(null)
      }
    } else {
      const n = usePlayer.getState().addLocal(audio)
      os().notify({ app: 'music', title: 'Music', body: n ? `Added ${n} ${n === 1 ? 'song' : 'songs'} from this computer. They'll be gone when you close the tab; connect pearosd for a permanent library.` : 'Those songs are already in your library.' })
    }
    go('songs')
  }

  const play = (t: Track, within: Track[]) => usePlayer.getState().playTrack(t, within)

  const rowMenu = (list: Track[]) => (t: Track): MenuEntry[] => {
    const fav = favorites.includes(t.id)
    return [
      { label: 'Play', run: () => play(t, list) },
      { label: 'Play Next', run: () => usePlayer.getState().playNext(t) },
      'sep',
      { label: fav ? 'Remove from Favorites' : 'Add to Favorites', run: () => usePlayer.getState().toggleFavorite(t.id) },
      ...(t.source === 'drive' && t.path
        ? ([
            'sep',
            { label: 'Download', run: () => window.open(drive.url(t.path!, true), '_blank', 'noopener') },
            { label: 'Show in Finder', run: () => os().openApp('finder', { props: { path: `drive:${t.path!.replace(/\/[^/]*$/, '') || '/'}` }, forceNew: true }) },
          ] as MenuEntry[])
        : []),
      'sep',
      { label: 'Copy Title', run: () => navigator.clipboard?.writeText(`${t.artist} — ${t.title}`) },
    ]
  }

  const addButton = (
    <button className="btn small" onClick={() => picker.current?.click()}>
      <Plus size={12} /> Add Files…
    </button>
  )

  const emptyLibrary = (
    <div className="m-empty">
      <div className="m-empty-art">
        <Music2 size={54} strokeWidth={1.3} />
      </div>
      <h2>{q ? 'No Results' : view === 'favorites' ? 'No Favorites Yet' : 'Your Library is Empty'}</h2>
      <p>
        {q
          ? `Nothing matches “${q}”.`
          : view === 'favorites'
            ? 'Click the heart next to any song or station and it will show up here.'
            : authed
              ? driveState === 'loading'
                ? 'Looking through PearDrive…'
                : driveError
                  ? `Couldn't read PearDrive: ${driveError}`
                  : 'Music in PearDrive shows up here automatically. Add some, or drag audio files onto this window to upload them to /Music.'
              : "Drag audio files onto this window or add them from your computer. Without a pearosd backend they only last until you close the tab."}
      </p>
      {!q && view !== 'favorites' && (
        <div className="m-empty-actions">
          <button className="btn primary" onClick={() => picker.current?.click()}>
            <Plus size={13} /> Add Files…
          </button>
          <button className="btn" onClick={() => go('radio')}>
            <Radio size={13} /> Tune in to Pear Radio
          </button>
        </div>
      )}
    </div>
  )

  const nav = (id: View, label: string, Icon: typeof Music2, count?: number) => (
    <button key={id + label} className={`sb-item ${view === id && (id !== 'songs' || source === 'all') ? 'active' : ''}`} onClick={() => (setSource('all'), go(id))}>
      <Icon size={15} />
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </button>
  )
  const sourceItem = (s: SourceFilter, label: string, Icon: typeof Music2, count: number) => (
    <button className={`sb-item ${view === 'songs' && source === s ? 'active' : ''}`} onClick={() => (setSource(s), go('songs'))}>
      <Icon size={15} />
      <span>{label}</span>
      <span className="count">{count}</span>
    </button>
  )

  const total = driveTracks.length + local.length

  return (
    <div
      className={`music ${dropping ? 'drop' : ''}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === ' ' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault()
          usePlayer.getState().toggle()
        }
      }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current++
        setDropping(true)
      }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0
          setDropping(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDropping(false)
        if (e.dataTransfer.files.length) void importFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <input ref={picker} type="file" multiple hidden accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus" onChange={(e) => (e.target.files && void importFiles(Array.from(e.target.files)), (e.target.value = ''))} />
      <aside className="sidebar music-side" data-drag>
        <div className="sidebar-spacer" />
        <label className="search-field wide" data-nodrag>
          <Search size={13} />
          <input
            value={q}
            placeholder="Search"
            onChange={(e) => {
              setQ(e.target.value)
              if (e.target.value && !['songs', 'albums', 'artists', 'favorites'].includes(view)) setView('songs')
            }}
          />
          {q && (
            <button className="m-clear" onClick={() => setQ('')} aria-label="Clear search">
              <X size={11} />
            </button>
          )}
        </label>
        <div className="sb-group">
          <div className="sb-head">Music</div>
          {nav('now', 'Listening Now', CirclePlay)}
          {nav('radio', 'Pear Radio', Radio)}
        </div>
        <div className="sb-group">
          <div className="sb-head">Library</div>
          {nav('songs', 'Songs', Music2, total)}
          {nav('albums', 'Albums', Disc3)}
          {nav('artists', 'Artists', MicVocal)}
          {nav('favorites', 'Favorites', Heart)}
        </div>
        <div className="sb-group">
          <div className="sb-head">Sources</div>
          {authed && sourceItem('drive', 'PearDrive', HardDrive, driveTracks.length)}
          {sourceItem('local', 'This Computer', Laptop, local.length)}
        </div>
      </aside>

      <section className="music-main">
        <header className="music-bar" data-drag>
          <Transport />
          <Lcd />
          <VolumeControl />
        </header>
        <div className="music-body">
          {view === 'now' && <NowPlaying />}
          {view === 'radio' && <RadioView />}
          {(view === 'songs' || view === 'favorites') && (
            <div className="m-page tableful">
              <header className="m-page-head row">
                <div>
                  <h1>{view === 'favorites' ? 'Favorites' : filter ? filter.label : source === 'drive' ? 'PearDrive' : source === 'local' ? 'This Computer' : 'Songs'}</h1>
                  <p>
                    {songs.length} {songs.length === 1 ? 'song' : 'songs'}
                    {busy ? ` · ${busy}` : driveState === 'loading' && authed ? ' · Scanning PearDrive…' : ''}
                  </p>
                </div>
                <div className="m-head-actions">
                  {filter && (
                    <button className="m-chip" onClick={() => setFilter(null)}>
                      {filter.by === 'album' ? 'Album' : 'Artist'}: {filter.label} <X size={11} />
                    </button>
                  )}
                  {songs.length > 0 && (
                    <button className="btn small" onClick={() => play(songs[0], songs)}>
                      <Play size={11} fill="currentColor" /> Play
                    </button>
                  )}
                  {songs.length > 1 && (
                    <button
                      className="btn small"
                      onClick={() => {
                        usePlayer.setState({ shuffle: true })
                        const t = songs[Math.floor(Math.random() * songs.length)]
                        play(t, songs)
                      }}
                    >
                      <Shuffle size={11} /> Shuffle
                    </button>
                  )}
                  {view === 'songs' && addButton}
                </div>
              </header>
              <SongTable tracks={songs} sort={sort} setSort={setSort} onPlay={(t) => play(t, songs)} rowMenu={rowMenu(songs)} empty={emptyLibrary} />
            </div>
          )}
          {view === 'albums' && (
            <div className="m-page scroll">
              <header className="m-page-head row">
                <div>
                  <h1>Albums</h1>
                  <p>{albums.length} albums</p>
                </div>
                <div className="m-head-actions">{addButton}</div>
              </header>
              {albums.length === 0 ? (
                emptyLibrary
              ) : (
                <div className="m-albums">
                  {albums.map((g) => (
                    <button
                      key={g.key}
                      className="m-album"
                      onClick={() => {
                        setFilter({ by: 'album', key: g.key, label: g.name })
                        setView('songs')
                      }}
                      onContextMenu={menu([{ label: 'Play Album', run: () => play(g.tracks[0], g.tracks) }])}
                    >
                      <Art track={g.tracks.find((t) => t.art) ?? g.tracks[0]} size={150} radius={9} />
                      <b>{g.name}</b>
                      <small>{g.sub}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {view === 'artists' && (
            <div className="m-page scroll">
              <header className="m-page-head row">
                <div>
                  <h1>Artists</h1>
                  <p>{artists.length} artists</p>
                </div>
                <div className="m-head-actions">{addButton}</div>
              </header>
              {artists.length === 0 ? (
                emptyLibrary
              ) : (
                <div className="m-artists">
                  {artists.map((g) => (
                    <button
                      key={g.key}
                      className="m-artist"
                      onClick={() => {
                        setFilter({ by: 'artist', key: g.key, label: g.name })
                        setView('songs')
                      }}
                      onContextMenu={menu([{ label: 'Play All', run: () => play(g.tracks[0], g.tracks) }])}
                    >
                      <span className="m-avatar" style={{ background: `linear-gradient(145deg, hsl(${trackHue(g.tracks[0])} 70% 62%), hsl(${(trackHue(g.tracks[0]) + 50) % 360} 62% 42%))` }}>
                        {g.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="m-artist-text">
                        <b>{g.name}</b>
                        <small>
                          {g.tracks.length} {g.tracks.length === 1 ? 'song' : 'songs'}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {dropping && (
          <div className="m-dropzone">
            <Download size={30} />
            <b>{authed ? 'Drop to add to PearDrive /Music' : 'Drop to add to your library'}</b>
          </div>
        )}
      </section>
    </div>
  )
}


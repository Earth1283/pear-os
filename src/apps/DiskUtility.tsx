import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, HardDrive, Info, Layers, RotateCcw, ShieldCheck, Trash2, Unplug, RefreshCw, Globe, X } from 'lucide-react'
import { os, type Win } from '../store'
import { root, sizeOf, formatBytes, type FsNode } from '../lib/fs'
import { refreshSys, useBackend } from '../lib/backend'
import './DiskUtility.css'

type LocalEntry = { key: string; bytes: number }
type Snapshot = {
  usage?: number
  quota?: number
  details?: Record<string, number>
  persisted?: boolean
  local: LocalEntry[] | null
  databases: IDBDatabaseInfo[] | null
  errors: string[]
  at: number
}
type Volume = 'browser' | 'local' | 'virtual' | 'drive' | `db:${string}`
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const bytes = (n: number | undefined | null) => (n == null ? 'Unavailable' : formatBytes(n))

function localEntries(): LocalEntry[] {
  return Object.keys(localStorage)
    .map((key) => ({ key, bytes: (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2 }))
    .sort((a, b) => b.bytes - a.bytes)
}

async function snapshot(): Promise<Snapshot> {
  const out: Snapshot = { local: null, databases: null, errors: [], at: Date.now() }
  await Promise.all([
    (async () => {
      try {
        if (!navigator.storage?.estimate) throw new Error('Storage estimates are unavailable in this browser.')
        const e = (await navigator.storage.estimate()) as StorageEstimate & { usageDetails?: Record<string, number> }
        out.usage = e.usage
        out.quota = e.quota
        out.details = e.usageDetails
      } catch (e) {
        out.errors.push(errorText(e))
      }
    })(),
    (async () => {
      try {
        if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted()
      } catch (e) {
        out.errors.push(`Persistence: ${errorText(e)}`)
      }
    })(),
    (async () => {
      try {
        if (!globalThis.indexedDB?.databases) throw new Error('This browser cannot list IndexedDB databases.')
        out.databases = (await indexedDB.databases()).filter((d) => d.name !== undefined)
      } catch (e) {
        out.errors.push(errorText(e))
      }
    })(),
    (async () => {
      try {
        out.local = localEntries()
      } catch (e) {
        out.errors.push(`localStorage: ${errorText(e)}`)
      }
    })(),
  ])
  return out
}

type Inspection = { stores: number; records: number; iso?: number; disk?: number }
async function inspectDatabase(name: string): Promise<Inspection> {
  return new Promise((resolve, reject) => {
    let db: IDBDatabase | undefined
    let finished = false
    const done = (error?: unknown, result?: Inspection) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      db?.close()
      if (error) reject(error)
      else resolve(result!)
    }
    const timer = setTimeout(() => done(new Error('Timed out; the database may be busy.')), 8000)
    const request = indexedDB.open(name)
    request.onupgradeneeded = () => {
      request.transaction?.abort()
      done(new Error('Database disappeared during inspection; no replacement was created.'))
    }
    request.onerror = () => done(request.error ?? new Error('Cannot open database.'))
    request.onblocked = () => done(new Error('Opening the database was blocked by another tab.'))
    request.onsuccess = () => {
      db = request.result
      if (finished) {
        db.close()
        return
      }
      db.onversionchange = () => done(new Error('Database changed during inspection.'))
      const stores = Array.from(db.objectStoreNames)
      const result: Inspection = { stores: stores.length, records: 0 }
      if (!stores.length) return done(undefined, result)
      try {
        const tx = db.transaction(stores, 'readonly')
        tx.onabort = () => done(tx.error ?? new Error('Read transaction aborted.'))
        tx.onerror = () => done(tx.error ?? new Error('Read transaction failed.'))
        tx.oncomplete = () => done(undefined, result)
        for (const store of stores) {
          const count = tx.objectStore(store).count()
          count.onsuccess = () => {
            result.records += count.result
          }
        }
        if (name === 'pearos-v86' && stores.includes('blobs')) {
          // Fetching "state" would clone the entire saved machine; read only metadata.
          const iso = tx.objectStore('blobs').get('iso:meta')
          const state = tx.objectStore('blobs').get('state:meta')
          iso.onsuccess = () => {
            if (Number.isFinite(iso.result?.size) && iso.result.size >= 0) result.iso = iso.result.size
          }
          state.onsuccess = () => {
            if (Number.isFinite(state.result?.diskBytes) && state.result.diskBytes >= 0) result.disk = state.result.diskBytes
          }
        }
      } catch (e) {
        done(e)
      }
    }
  })
}

function checkVirtual() {
  let nodes = 0
  const issues: string[] = []
  const seen = new Set<FsNode>()
  const walk = (node: FsNode, path: string) => {
    if (seen.has(node)) {
      issues.push(`${path}: cycle or shared node`)
      return
    }
    seen.add(node)
    nodes++
    if (!Number.isFinite(node.modified)) issues.push(`${path}: invalid modification time`)
    if (node.type === 'file') {
      if (!Number.isFinite(node.size) || node.size < 0) issues.push(`${path}: invalid file size`)
    } else if (node.type === 'dir' && node.children && typeof node.children === 'object') {
      for (const [name, child] of Object.entries(node.children)) {
        if (!name || name.includes('/') || name === '.' || name === '..') issues.push(`${path}: invalid name “${name}”`)
        if (!child || typeof child !== 'object') issues.push(`${path}/${name}: invalid node`)
        else walk(child, `${path === '/' ? '' : path}/${name}`)
      }
    } else issues.push(`${path}: invalid node type or children`)
  }
  walk(root, '/')
  return { nodes, issues }
}

export function DiskUtility(_: { win: Win }) {
  const [selected, setSelected] = useState<Volume>('browser')
  const [data, setData] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [info, setInfo] = useState(false)
  const [eraseKeys, setEraseKeys] = useState<string[] | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [persisting, setPersisting] = useState(false)
  const refreshing = useRef(false)
  const aiding = useRef(false)
  const present = useBackend((s) => s.present)
  const authed = useBackend((s) => s.authed)
  const sys = useBackend((s) => s.sys)
  const refresh = useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true
    setLoading(true)
    try {
      const [next] = await Promise.all([snapshot(), present && authed ? refreshSys() : Promise.resolve()])
      setData(next)
    } finally {
      refreshing.current = false
      setLoading(false)
    }
  }, [present, authed])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (selected === 'drive' && !present) setSelected('browser')
  }, [present, selected])

  const notify = (body: string) => os().notify({ app: 'diskutility', title: 'Disk Utility', body })
  const firstAid = async () => {
    if (aiding.current) return
    aiding.current = true
    setRunning(true)
    setLog(['First Aid · read-only checks across Pear storage.', 'No repairs promised. No repairs secretly performed.'])
    const append = (line: string) => setLog((old) => [...old, line])
    let findings = 0
    try {
      try {
        const entries = localEntries().filter((e) => e.key.startsWith('pearos.'))
        let valid = 0
        for (const { key } of entries) {
          try {
            const value = localStorage.getItem(key)
            if (value === null) throw new Error('Key disappeared during inspection')
            JSON.parse(value)
            valid++
          } catch (e) {
            findings++
            append(`CHECK ${key}: ${errorText(e)}`)
          }
        }
        append(`localStorage: ${valid}/${entries.length} pearos.* values parse as JSON. Non-JSON is a finding, not proof of corruption.`)
      } catch (e) {
        findings++
        append(`SKIPPED localStorage: ${errorText(e)}`)
      }
      const virtual = checkVirtual()
      findings += virtual.issues.length
      append(`Pretend disk: walked ${virtual.nodes} nodes; ${virtual.issues.length} consistency findings.`)
      virtual.issues.forEach((issue) => append(`CHECK ${issue}`))
      append('The enormous pretend files remain enormous. This is not a medical condition.')
      try {
        if (!globalThis.indexedDB?.databases) throw new Error('Database enumeration is unavailable.')
        const databases = await indexedDB.databases()
        for (const database of databases) {
          if (database.name === undefined) continue
          try {
            const result = await inspectDatabase(database.name)
            append(`OK IndexedDB “${database.name}”: opened read-only; ${result.stores} stores, ${result.records} records.`)
            if (result.iso !== undefined) append(`Windows 98 ISO metadata: ${bytes(result.iso)}. Chunk contents were not read or verified.`)
            if (result.disk !== undefined) append(`Windows 98 guest disk metadata: ${bytes(result.disk)}. This is not the database's physical size.`)
          } catch (e) {
            findings++
            append(`CHECK IndexedDB “${database.name}”: ${errorText(e)}`)
          }
        }
        append(`IndexedDB: ${databases.length} databases listed. Opening and counting records does not verify their contents.`)
      } catch (e) {
        findings++
        append(`SKIPPED IndexedDB: ${errorText(e)}`)
      }
      append(`Finished: ${findings} findings or unavailable checks. Host filesystem integrity was not tested. The stethoscope is a browser.`)
    } catch (e) {
      append(`First Aid stopped: ${errorText(e)}`)
    } finally {
      aiding.current = false
      setRunning(false)
      void refresh()
    }
  }

  const persist = async () => {
    setPersisting(true)
    try {
      if (!navigator.storage?.persist) throw new Error('Persistent storage is unavailable in this browser.')
      const granted = await navigator.storage.persist()
      notify(
        granted
          ? 'Persistent storage granted. The browser agreed to be less forgetful; this is still not a backup.'
          : 'Persistence was not granted. The browser reserves the right to forget you.',
      )
      await refresh()
    } catch (e) {
      notify(errorText(e))
    } finally {
      setPersisting(false)
    }
  }
  const erase = () => {
    if (selected === 'virtual') return notify("You can't erase the startup disk. You can try, though. You just did.")
    if (selected !== 'local')
      return notify(
        selected.startsWith('db:')
          ? 'Use Boot Camp Assistant to remove Windows 98 and its stored files. No database was erased.'
          : 'This volume cannot be erased here. Disk Utility has declined to become a browser-shaped lawnmower.',
      )
    try {
      const keys = localEntries()
        .filter((e) => e.key.startsWith('pearos.'))
        .map((e) => e.key)
      if (!keys.length) return notify('No pearos.* localStorage keys to erase. An unusually efficient cleanup.')
      setConfirmation('')
      setEraseKeys(keys)
    } catch (e) {
      notify(errorText(e))
    }
  }
  const confirmErase = async () => {
    if (confirmation !== 'ERASE' || !eraseKeys) return
    let removed = 0
    try {
      for (const key of eraseKeys) {
        if (localStorage.getItem(key) !== null) {
          localStorage.removeItem(key)
          removed++
        }
      }
      notify(`Erased ${removed} pearos.* localStorage keys. Running apps may save settings again. Reload to use the reset settings.`)
    } catch (e) {
      notify(`Removed ${removed} keys before stopping: ${errorText(e)}`)
    }
    setEraseKeys(null)
    await refresh()
  }

  const localTotal = data?.local?.reduce((sum, entry) => sum + entry.bytes, 0)
  const pearKeys = data?.local?.filter((entry) => entry.key.startsWith('pearos.'))
  const isDb = selected.startsWith('db:')
  const name =
    selected === 'browser'
      ? 'Browser Storage'
      : selected === 'local'
        ? 'localStorage'
        : selected === 'virtual'
          ? 'Pear HD'
          : selected === 'drive'
            ? 'PearDrive'
            : selected.slice(3)
  const Icon = isDb || selected === 'local' ? Database : selected === 'browser' ? Globe : HardDrive
  const virtualSize = selected === 'virtual' ? sizeOf(root) : 0
  const used =
    selected === 'browser'
      ? data?.usage
      : selected === 'local'
        ? localTotal
        : selected === 'virtual'
          ? virtualSize
          : selected === 'drive' && sys?.diskTotal != null && sys.diskFree != null
            ? sys.diskTotal - sys.diskFree
            : undefined
  const total = selected === 'browser' ? data?.quota : selected === 'drive' ? sys?.diskTotal : undefined
  const ratio = used !== undefined && total != null && total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : undefined
  const subtitle =
    selected === 'browser'
      ? 'This origin · browser estimate'
      : selected === 'local'
        ? 'This origin · UTF-16 key + value bytes'
        : selected === 'virtual'
          ? 'Pretend startup disk · fictional file sizes'
          : selected === 'drive'
            ? 'Real host filesystem · shared capacity'
            : 'Real browser database · size not exposed per database'
  const volumeButton = (id: Volume, label: string, I: typeof HardDrive) => (
    <button key={id} className={`sb-item ${selected === id ? 'active' : ''}`} aria-pressed={selected === id} onClick={() => setSelected(id)} title={label}>
      <I size={16} />
      <span>{label}</span>
    </button>
  )

  return (
    <div className="disk-utility">
      <aside className="sidebar" data-drag inert={!!eraseKeys}>
        <div className="sidebar-spacer" />
        <div className="sb-head">Internal (allegedly)</div>
        {volumeButton('virtual', 'Pear HD', HardDrive)}
        <div className="sb-head">Browser · this origin</div>
        {volumeButton('browser', 'Browser Storage', Globe)}
        {volumeButton('local', 'localStorage', Database)}
        <div className="sb-head">IndexedDB</div>
        {data?.databases?.map((db) => volumeButton(`db:${db.name}`, db.name!, Database))}
        <small className="du-sidebar-note">
          {!data
            ? 'Reading storage…'
            : data.databases === null
              ? 'Listing unavailable'
              : !data.databases.length
                ? 'No databases found'
                : 'Sizes belong to the origin, not individual databases.'}
        </small>
        {present && (
          <>
            <div className="sb-head">pearosd</div>
            {volumeButton('drive', 'PearDrive', HardDrive)}
          </>
        )}
        <div className="du-sidebar-foot">
          Disk Utility
          <br />
          <span>Now with actual curiosity.</span>
        </div>
      </aside>
      <section className="du-main" inert={!!eraseKeys}>
        <div className="toolbar du-toolbar" data-drag>
          {[
            { label: 'First Aid', icon: ShieldCheck, action: () => void firstAid(), disabled: running },
            {
              label: 'Partition',
              icon: Layers,
              action: () =>
                notify(
                  'Browsers cannot partition physical disks. Boot Camp’s partition slider configures its emulated disk; it does not resize your real drive.',
                ),
            },
            { label: 'Erase', icon: Trash2, action: erase },
            {
              label: 'Restore',
              icon: RotateCcw,
              action: () => notify('No disk image or backup is selected. Nothing was restored. The past remains inconveniently intact.'),
            },
            {
              label: 'Mount',
              icon: Unplug,
              action: () => notify('This is a storage view, not a block device. There is nothing to mount here, emotionally or otherwise.'),
            },
            { label: 'Info', icon: Info, action: () => setInfo(!info), pressed: info },
          ].map(({ label, icon: I, action, disabled, pressed }) => (
            <button key={label} disabled={disabled} aria-pressed={pressed} onClick={action}>
              <I size={18} strokeWidth={1.6} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="du-scroll">
          <header className="du-volume">
            <div className="du-disk-icon">
              <Icon size={42} strokeWidth={1.2} />
            </div>
            <div>
              <h1>{name}</h1>
              <p>{subtitle}</p>
            </div>
            <button className="tb-btn" aria-label="Refresh storage" title="Refresh storage" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw size={16} />
            </button>
          </header>
          <div className="du-capacity">
            <strong>{isDb ? 'Size unavailable' : bytes(used)}</strong>
            <span>
              {total != null
                ? ` used of ${bytes(total)}`
                : selected === 'virtual'
                  ? ' in pretend files'
                  : selected === 'local'
                    ? ' in strings'
                    : selected === 'drive'
                      ? ' · sign in or refresh for host stats'
                      : ' used'}
            </span>
          </div>
          {ratio !== undefined && (
            <>
              <div
                className="du-usage"
                role="meter"
                aria-label={`${name} storage used`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={ratio}
                aria-valuetext={`${bytes(used)} of ${bytes(total)}`}
              >
                <span style={{ width: `${ratio}%` }} />
              </div>
              <div className="du-usage-labels">
                <span>Used · {ratio.toFixed(1)}%</span>
                <span>{bytes(Math.max(0, total! - used!))} available</span>
              </div>
            </>
          )}
          {selected === 'virtual' && (
            <>
              <div className="du-breakdown" aria-label="Pretend file sizes">
                {Object.entries(root.children).map(([key, node], i) => (
                  <span
                    key={key}
                    title={`${key}: ${formatBytes(sizeOf(node))}`}
                    style={{ flexGrow: sizeOf(node), background: ['#5185de', '#a877ca', '#e4a958', '#66a899', '#d47383'][i % 5] }}
                  />
                ))}
              </div>
              <p className="du-note">
                These are the file sizes in Pear’s virtual filesystem, including its heroic cache. No physical capacity or free space is invented.
              </p>
              <dl className="du-facts">
                {Object.entries(root.children).map(([key, node]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{formatBytes(sizeOf(node))}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {selected === 'browser' && (
            <>
              <p className="du-note">The browser estimates this site’s storage allowance. It is not your disk’s free space, and may include privacy padding.</p>
              <dl className="du-facts">
                <div>
                  <dt>Persistence</dt>
                  <dd>{data?.persisted === undefined ? 'Unavailable' : data.persisted ? 'Granted' : 'Best effort (evictable)'}</dd>
                </div>
                {Object.entries(data?.details ?? {}).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{bytes(value)}</dd>
                  </div>
                ))}
              </dl>
              {!data?.details && <p className="du-note">This browser does not expose a usage breakdown.</p>}
              <button className="btn" disabled={persisting || data?.persisted === true || !navigator.storage?.persist} onClick={() => void persist()}>
                {persisting ? 'Requesting persistence…' : data?.persisted ? 'Persistent storage granted' : 'Request Persistent Storage'}
              </button>
            </>
          )}
          {selected === 'local' && (
            <>
              <p className="du-note">
                {data?.local ? `${data.local.length} keys; ${pearKeys?.length} start with pearos.*.` : 'localStorage could not be read.'} String size counts two
                bytes per UTF-16 code unit, including key names. Browser overhead and quota accounting differ.
              </p>
              <dl className="du-facts du-keys">
                {data?.local?.map((entry) => (
                  <div key={entry.key}>
                    <dt title={entry.key}>{entry.key}</dt>
                    <dd>{bytes(entry.bytes)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {isDb && (
            <>
              <p className="du-note">
                IndexedDB does not expose physical usage per database. First Aid opens each listed database and counts records without reading their contents.
              </p>
              <dl className="du-facts">
                <div>
                  <dt>Database version</dt>
                  <dd>{data?.databases?.find((db) => db.name === selected.slice(3))?.version ?? 'No longer listed'}</dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>Read-only inspection</dd>
                </div>
              </dl>
              {selected === 'db:pearos-v86' && (
                <p className="du-note">
                  Windows 98 lives here. First Aid reads its ISO and guest disk metadata, never the ISO chunks or saved RAM. Metadata sizes are not physical
                  database usage.
                </p>
              )}
            </>
          )}
          {selected === 'drive' && (
            <>
              <p className="du-note">
                Capacity describes the host filesystem containing PearDrive, including space used outside PearDrive. No host files are scanned or modified.
              </p>
              <dl className="du-facts">
                <div>
                  <dt>Host</dt>
                  <dd>{sys?.hostname ?? 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>PearDrive root</dt>
                  <dd>{sys?.root ?? 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Connection</dt>
                  <dd>{authed ? 'Signed in' : 'Sign in to pearosd for stats'}</dd>
                </div>
              </dl>
            </>
          )}
          {info && (
            <dl className="du-facts du-info">
              <div>
                <dt>Origin</dt>
                <dd>{location.origin}</dd>
              </div>
              <div>
                <dt>Last storage check</dt>
                <dd>{data ? new Date(data.at).toLocaleTimeString() : 'Reading…'}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{subtitle}</dd>
              </div>
            </dl>
          )}
          {!!data?.errors.length && (
            <div className="du-errors">
              {data.errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}
          {!!log.length && (
            <section className="du-log">
              <header>
                <b>{running ? 'First Aid is checking…' : 'First Aid report'}</b>
                <button aria-label="Close First Aid report" disabled={running} onClick={() => setLog([])}>
                  <X size={14} />
                </button>
              </header>
              <pre role="log" aria-live="polite" aria-relevant="additions text">
                {log.join('\n')}
              </pre>
            </section>
          )}
        </div>
        <footer className="du-footer">
          {loading ? 'Reading storage…' : data ? `Measured ${new Date(data.at).toLocaleTimeString()}` : 'Storage not yet measured'}
          <span>Reality sold separately. Measurements included.</span>
        </footer>
      </section>
      {eraseKeys && (
        <div className="du-sheet-backdrop">
          <form
            className="du-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="du-erase-title"
            onSubmit={(e) => {
              e.preventDefault()
              void confirmErase()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEraseKeys(null)
              if (e.key === 'Tab') {
                const fields = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'))
                const first = fields[0],
                  last = fields[fields.length - 1]
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault()
                  last?.focus()
                }
                if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault()
                  first?.focus()
                }
              }
            }}
          >
            <Trash2 size={32} />
            <h2 id="du-erase-title">Erase Pear’s saved settings?</h2>
            <p>
              This permanently deletes the {eraseKeys.length} pearos.* localStorage keys listed below, including any saved app data in those keys. There is no
              undo. IndexedDB and PearDrive are untouched.
            </p>
            <div className="du-erase-list">{eraseKeys.join('\n')}</div>
            <p>Running apps may write these keys again. Reload after erasing to use the reset settings.</p>
            <label>
              Type ERASE to confirm
              <input autoFocus className="field" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
            </label>
            <div className="du-sheet-actions">
              <button className="btn" type="button" onClick={() => setEraseKeys(null)}>
                Cancel
              </button>
              <button className="btn du-danger" type="submit" disabled={confirmation !== 'ERASE'}>
                Erase {eraseKeys.length} keys
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

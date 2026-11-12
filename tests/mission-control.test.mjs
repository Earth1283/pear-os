import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

const storage = new Map()
globalThis.window = { innerWidth: 1440, innerHeight: 900, matchMedia: () => ({ matches: false }) }
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } })

const { os, useOS, registerSpecs, CLOSED, MAX_SPACES } = await import('../src/store.ts')
const { missionLayout } = await import('../src/lib/missionControl.ts')
registerSpecs({ finder: { name: 'Finder', w: 860, h: 520 }, notes: { name: 'Notes', w: 820, h: 540, singleton: true }, terminal: { name: 'Terminal', w: 700, h: 440 } })

beforeEach(() => {
  useOS.setState({ windows: [], focused: null, zTop: 10, spaces: [1], activeSpace: 1, overlay: CLOSED, launching: [] })
  storage.clear()
})

test('new windows belong to the active desktop and switching restores its front window', () => {
  const first = os().openApp('finder')
  const secondSpace = os().addSpace()
  const second = os().openApp('terminal')
  assert.equal(os().windows.find((w) => w.id === second).space, secondSpace)
  os().switchSpace(1)
  assert.equal(os().focused, first)
  os().switchSpace(secondSpace)
  assert.equal(os().focused, second)
  os().switchSpace(999)
  assert.equal(os().activeSpace, secondSpace)
})

test('Dock activation prefers this desktop and navigates to a remote singleton', () => {
  const first = os().openApp('finder')
  const note = os().openApp('notes')
  const secondSpace = os().addSpace()
  const second = os().openApp('finder', { forceNew: true })
  os().minimize(first)
  assert.equal(os().openApp('finder'), second)
  assert.equal(os().activeSpace, secondSpace)
  assert.equal(os().windows.find((w) => w.id === first).minimized, true)
  assert.equal(os().openApp('notes', { props: { note: 'math' } }), note)
  assert.equal(os().activeSpace, 1)
  assert.equal(os().windows.filter((w) => w.app === 'notes').length, 1)
})

test('closing, quitting, and minimizing never focus a window on another desktop', () => {
  const first = os().openApp('finder')
  os().addSpace()
  const second = os().openApp('terminal')
  os().switchSpace(1)
  os().minimize(second)
  assert.equal(os().focused, first)
  os().closeWindow(first)
  assert.equal(os().focused, null)
  const another = os().openApp('finder')
  os().closeApp('finder')
  assert.equal(os().focused, null)
  assert.ok(!os().windows.some((w) => w.id === another))
})

test('moving a window preserves its identity, contents, geometry, and minimized state', () => {
  const first = os().openApp('finder')
  const moving = os().openApp('terminal', { props: { command: 'pearfetch' } })
  const before = os().windows.find((w) => w.id === moving)
  const secondSpace = os().addSpace()
  os().switchSpace(1)
  os().moveWindowToSpace(moving, secondSpace)
  assert.equal(os().focused, first)
  assert.deepEqual(os().windows.find((w) => w.id === moving), { ...before, space: secondSpace })
  os().switchSpace(secondSpace)
  assert.equal(os().focused, moving)
  os().moveWindowToSpace(moving, 999)
  assert.equal(os().windows.find((w) => w.id === moving).space, secondSpace)
})

test('removing a desktop migrates all windows, including minimized windows', () => {
  os().openApp('finder')
  const secondSpace = os().addSpace()
  const note = os().openApp('notes')
  const terminal = os().openApp('terminal')
  os().minimize(terminal)
  const before = os().windows.map((w) => ({ ...w, space: 1 }))
  os().removeSpace(secondSpace)
  assert.deepEqual(os().spaces, [1])
  assert.equal(os().activeSpace, 1)
  assert.equal(os().focused, note)
  assert.deepEqual(os().windows, before)
  os().removeSpace(1)
  assert.deepEqual(os().spaces, [1])
})

test('desktop count is bounded and only desktop metadata is persisted', () => {
  os().openApp('finder')
  for (let i = 1; i < MAX_SPACES; i++) assert.notEqual(os().addSpace(), null)
  assert.equal(os().addSpace(), null)
  assert.equal(os().spaces.length, MAX_SPACES)
  const saved = JSON.parse(storage.get('pearos.spaces.v1'))
  assert.deepEqual(saved, { spaces: os().spaces, activeSpace: os().activeSpace })
  assert.equal(saved.windows, undefined)
})

test('Mission Control and other overlays are mutually exclusive', () => {
  os().setOverlay({ spotlight: true, launchpad: true })
  os().setOverlay({ missionControl: true })
  assert.deepEqual(os().overlay, { ...CLOSED, missionControl: true })
  os().setOverlay({ spotlight: true })
  assert.equal(os().overlay.missionControl, false)
  assert.equal(os().overlay.spotlight, true)
  os().closeOverlays()
  assert.deepEqual(os().overlay, CLOSED)
})

test('overview fits mixed window sizes without overlaps or changing their geometry', () => {
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [844, 390]]) {
    for (const count of [1, 2, 4, 7, 12, 24]) {
      const windows = Array.from({ length: count }, (_, i) => ({ id: String(i), x: i * 5, y: 30, w: i % 3 === 0 ? 236 : 860, h: i % 3 === 0 ? 392 : 520 }))
      const before = structuredClone(windows)
      const rects = [...missionLayout(windows, width, height).values()]
      assert.equal(rects.length, count)
      assert.deepEqual(windows, before)
      for (const [i, rect] of rects.entries()) {
        assert.ok(rect.x >= 0 && rect.y >= 136)
        assert.ok(rect.x + rect.w <= width + .01 && rect.y + rect.h + 26 <= height - 40)
        assert.ok(rect.scale > 0 && rect.scale <= 1)
        for (const other of rects.slice(i + 1)) {
          assert.ok(rect.x + rect.w <= other.x || other.x + other.w <= rect.x || rect.y + rect.h + 26 <= other.y || other.y + other.h + 26 <= rect.y)
        }
      }
    }
  }
  assert.equal(missionLayout([], 1440, 900).size, 0)
})

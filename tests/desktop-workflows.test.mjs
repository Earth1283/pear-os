import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const storage = new Map()
globalThis.window = { innerWidth: 1440, innerHeight: 900, matchMedia: () => ({ matches: false }) }
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } })

const { os, useOS, registerSpecs, onQuit, onSpace, spaceOrder, fullscreenRect, fullscreenSide } = await import('../src/store.ts')
const { indexVirtualFiles, searchVirtualFiles } = await import('../src/lib/fileSearch.ts')
const { HOME, emptyTrash, moveNode, moveToTrash, rename, resolve, trashCount, writeFile } = await import('../src/lib/fs.ts')
registerSpecs({
  calculator: { name: 'Calculator', w: 236, h: 392, resizable: false },
  about: { name: 'About This Pear', w: 300, h: 580, singleton: true, resizable: false, systemPanel: true },
})

beforeEach(() => {
  os().resetSession()
  useOS.setState({ spaces: [1], activeSpace: 1, assign: {}, spaceFollowApp: true })
  storage.clear()
})

test('an app with zero windows stays active and stays running until quit', () => {
  let quits = 0
  onQuit('notes', () => { quits++ })
  const id = os().openApp('notes')
  os().closeWindow(id)
  assert.equal(os().focused, null)
  assert.equal(os().activeApp, 'notes')
  assert.deepEqual(os().runningApps, ['notes', 'finder'])
  assert.equal(quits, 0)

  os().activateApp('finder')
  os().activateApp('notes')
  assert.equal(os().activeApp, 'notes')
  assert.equal(os().windows.length, 0)
  os().closeApp('notes')
  assert.equal(quits, 1)
  assert.equal(os().activeApp, 'finder')
  assert.deepEqual(os().runningApps, ['finder'])
  onQuit('notes', () => {})
})

test('About opens a single system panel without activating or launching an app', () => {
  const terminal = os().openApp('terminal')
  const about = os().openApp('about')
  assert.equal(os().focused, about)
  assert.equal(os().activeApp, 'terminal')
  assert.deepEqual(os().runningApps, ['terminal', 'finder'])
  assert.ok(!os().launching.includes('about'))
  os().minimize(about)
  assert.equal(os().windows.find((w) => w.id === about).minimized, false)
  assert.equal(os().openApp('about'), about)
  os().addSpace()
  os().openApp('notes')
  os().switchSpace(1)
  assert.equal(os().focused, about)
  assert.equal(os().activeApp, 'terminal')
  os().closeWindow(about)
  assert.equal(os().focused, terminal)
  assert.equal(os().activeApp, 'terminal')
})

test('status popovers switch directly to other menu bar panels', () => {
  os().setOverlay({ menu: 'pear' })
  os().setOverlay({ statusMenu: 'wifi' })
  assert.equal(os().overlay.menu, null)
  os().setOverlay({ controlCenter: true })
  assert.equal(os().overlay.statusMenu, null)
  os().setOverlay({ notificationCenter: true })
  assert.equal(os().overlay.controlCenter, false)
  os().setOverlay({ spotlight: true })
  assert.equal(os().overlay.notificationCenter, false)
  os().closeOverlays()
  assert.equal(os().overlay.spotlight, false)
})

test('hiding and returning to an app preserves minimized and visible windows', () => {
  const visible = os().openApp('terminal')
  const minimized = os().openApp('terminal', { forceNew: true })
  os().minimize(minimized)
  const notes = os().openApp('notes')
  os().activateApp('terminal')
  os().hideApp('terminal')
  assert.equal(os().focused, notes)
  assert.ok(os().hiddenApps.includes('terminal'))
  assert.equal(os().windows.find((w) => w.id === visible).minimized, false)
  os().activateApp('terminal')
  assert.equal(os().focused, visible)
  assert.equal(os().windows.find((w) => w.id === minimized).minimized, true)
  assert.deepEqual(os().hiddenApps, [])
  os().openApp('terminal')
  assert.equal(os().windows.find((w) => w.id === minimized).minimized, true)
})

test('window cycling follows stable order and ignores windows from other apps and desktops', () => {
  const first = os().openApp('terminal')
  const second = os().openApp('terminal', { forceNew: true })
  const third = os().openApp('terminal', { forceNew: true })
  os().openApp('notes')
  os().addSpace()
  os().openApp('terminal', { forceNew: true })
  os().focus(first)
  for (const id of [second, third, first]) {
    os().cycleWindows(false)
    assert.equal(os().focused, id)
  }
  os().cycleWindows(true)
  assert.equal(os().focused, third)
})

test('full-screen Spaces isolate assigned apps and save the original desktop and tile geometry', () => {
  const finder = os().openApp('finder')
  os().assignApp('finder', 'all')
  const desktop = os().addSpace()
  const id = os().openApp('terminal')
  os().tileWindow(id, 'left')
  const before = os().windows.find((w) => w.id === id)
  os().toggleFullscreen(id)
  const full = os().activeSpace
  assert.deepEqual(spaceOrder(os()), [1, desktop, full])
  assert.equal(onSpace(os().windows.find((w) => w.id === finder), full, os().assign), false)
  assert.equal(JSON.parse(storage.get('pearos.spaces.v1')).activeSpace, desktop)
  os().switchSpace(desktop)
  os().activateApp('terminal')
  assert.equal(os().activeSpace, full)
  os().toggleFullscreen(id)
  const after = os().windows.find((w) => w.id === id)
  assert.equal(os().activeSpace, desktop)
  assert.deepEqual({ ...after, z: before.z }, before)
  assert.deepEqual(spaceOrder(os()), [1, desktop])
})

test('closing either member of a split keeps the other in its Space until it exits', () => {
  const terminal = os().openApp('terminal')
  const notes = os().openApp('notes')
  os().splitFullscreen(terminal, notes, 'right')
  const space = os().activeSpace
  assert.equal(os().windows.find((w) => w.id === notes).fullscreen.side, 'left')
  assert.deepEqual(fullscreenRect('right', { width: 901, height: 600 }), { x: 450, y: 0, w: 451, h: 600 })
  os().closeApp('terminal')
  assert.equal(os().activeSpace, space)
  assert.equal(os().focused, notes)
  assert.deepEqual(os().windows.find((w) => w.id === notes).fullscreen, { space })
  os().closeWindow(notes)
  assert.deepEqual(spaceOrder(os()), [1])
  assert.equal(os().activeSpace, 1)
})

test('a hidden split partner can return and a window can be dragged out of full screen', () => {
  const terminal = os().openApp('terminal')
  const notes = os().openApp('notes')
  os().splitFullscreen(terminal, notes, 'left')
  const split = os().activeSpace
  os().hideApp('terminal')
  assert.equal(os().focused, notes)
  assert.equal(fullscreenSide(os().windows.find((w) => w.id === notes), os()), undefined)
  os().activateApp('terminal')
  assert.equal(fullscreenSide(os().windows.find((w) => w.id === notes), os()), 'right')
  os().setOverlay({ missionControl: true })
  os().moveWindowToSpace(terminal, 1)
  assert.equal(os().focused, notes)
  assert.equal(os().activeSpace, split)
  assert.ok(os().overlay.missionControl)
  assert.equal(os().windows.find((w) => w.id === terminal).fullscreen, undefined)
})

test('Spotlight ranks matching names, indexes text, and tracks rename and trash', () => {
  const path = HOME + '/Documents/midnight-spoon.txt'
  writeFile(path, 'A cobalt teaspoon')
  assert.equal(searchVirtualFiles(indexVirtualFiles(), 'MIDNIGHT-SPOON')[0], path)
  assert.equal(searchVirtualFiles(indexVirtualFiles(), 'cobalt teaspoon')[0], path)
  const renamed = rename(path, 'midnight-fork.txt').path
  assert.deepEqual(searchVirtualFiles(indexVirtualFiles(), 'midnight-spoon'), [])
  assert.equal(searchVirtualFiles(indexVirtualFiles(), 'cobalt teaspoon')[0], renamed)
  moveToTrash(renamed)
  assert.deepEqual(searchVirtualFiles(indexVirtualFiles(), 'cobalt teaspoon'), [])
})

test('bringAllToFront, closeAllWindows, hideOtherApps, and system dialogs manage app state cleanly', () => {
  const t1 = os().openApp('terminal')
  const t2 = os().openApp('terminal', { forceNew: true })
  const n1 = os().openApp('notes')
  os().focus(t1)
  os().bringAllToFront('terminal')
  const wins = os().windows
  const zNotes = wins.find((w) => w.id === n1).z
  assert.ok(wins.find((w) => w.id === t1).z > zNotes)
  assert.ok(wins.find((w) => w.id === t2).z > zNotes)

  os().hideOtherApps('terminal')
  assert.ok(os().hiddenApps.includes('notes'))
  assert.ok(!os().hiddenApps.includes('terminal'))

  os().openDialog({ kind: 'force-quit' })
  assert.deepEqual(os().systemDialog, { kind: 'force-quit' })
  os().closeDialog()
  assert.equal(os().systemDialog, null)

  os().closeAllWindows('terminal')
  assert.equal(os().windows.filter((w) => w.app === 'terminal').length, 0)
})

test('moveNode relocates files between directories and emptyTrash clears the Trash', () => {
  const src = `${HOME}/Desktop/drag-test.txt`
  assert.equal(writeFile(src, 'hello'), true)
  const moved = moveNode(src, `${HOME}/Documents`)
  assert.equal(moved, `${HOME}/Documents/drag-test.txt`)
  assert.equal(resolve(src), null)
  assert.ok(resolve(moved))

  assert.equal(moveToTrash(moved), true)
  assert.ok(trashCount() >= 1)
  const erased = emptyTrash()
  assert.ok(erased >= 1)
  assert.equal(trashCount(), 0)
})

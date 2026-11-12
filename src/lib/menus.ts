import { os, useOS, type Win } from '../store'
import { openGallery } from '../components/Widgets'
import { APPS, DOCK_APPS } from '../apps/registry'
import type { AppId } from '../apps/ids'
import { TOOLS } from './writingTools'
import { openPath } from '../apps/open'
import { HOME, addNode, canRename, cloneNode, formatBytes, mkdir, moveToTrash, normalise, parentOf, remove, resolve, sizeOf, toggleTag } from './fs'
import { replaceInField, type Field, type MenuEntry } from './menu'
import { lastContextPoint, useStickies } from './stickies'
import { shareWithAirPear } from './airpearShare'

const say = (text: string) => {
  if (!('speechSynthesis' in window) || !text.trim()) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.volume = os().volume
  speechSynthesis.speak(u)
}

const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {})
const truncate = (s: string, n = 24) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const gargle = (q: string) => os().openApp('safari', { props: { url: `gargle.com/search?q=${encodeURIComponent(q)}` } })
const toast = (title: string, body: string, app: AppId = 'finder') => os().notify({ app, title, body })

const lookUp = (q: string): MenuEntry => ({
  label: `Look Up “${truncate(q)}”`,
  run: () => toast('Dictionary', `${truncate(q, 40)} (noun): a thing you right-clicked. See also: curiosity.`, 'notes'),
})
const translate = (q: string): MenuEntry => ({
  label: `Translate “${truncate(q)}”`,
  run: () => toast('Translate', `English → English: “${truncate(q, 60)}”. Other languages coming later.`, 'notes'),
})

const speechMenu = (text: string): MenuEntry => ({
  label: 'Speech',
  submenu: [
    { label: 'Start Speaking', disabled: !text.trim(), run: () => say(text) },
    { label: 'Stop Speaking', run: () => speechSynthesis?.cancel() },
  ],
})

const servicesMenu: MenuEntry = {
  label: 'Services',
  submenu: [{ label: 'No Services Apply', disabled: true }, 'sep', { label: 'Services Settings…', run: () => os().openApp('settings', { props: { pane: 'general' } }) }],
}

const shareMenu = (what: string): MenuEntry => ({
  label: 'Share',
  submenu: [
    { label: 'AirPear', run: () => { void shareWithAirPear(what) } },
    { label: 'Mail', run: () => toast('Mail', 'Mail needs an account. Mail has needed an account since 2003.') },
    { label: 'Messages', run: () => toast('Messages', 'Sent as a green bubble. Everyone is judging you.') },
    { label: 'Notes', run: () => os().saveNote({ id: 'n' + Date.now(), text: what, updated: Date.now() }) },
    'sep',
    { label: 'Edit Extensions…', disabled: true },
  ],
})

export function textMenu(el: Field): MenuEntry[] {
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0
  const sel = el.value.slice(start, end)
  const has = sel.length > 0
  const secret = el instanceof HTMLInputElement && el.type === 'password'
  const apply = (fn: (s: string) => string) => () => replaceInField(el, start, end, fn)
  return [
    ...(has && !secret ? [lookUp(sel), translate(sel), { label: 'Search With Gargle', run: () => gargle(sel) }, 'sep' as const] : []),
    {
      label: 'Cut',
      disabled: !has || secret,
      run: () => {
        copy(sel)
        apply(() => '')()
      },
    },
    { label: 'Copy', disabled: !has || secret, run: () => copy(sel) },
    {
      label: 'Paste',
      run: () =>
        navigator.clipboard
          ?.readText()
          .then((t) => replaceInField(el, start, end === start ? start : end, () => t))
          .catch(() => toast('Paste', 'PearOS asked your browser for the clipboard. Your browser said no.', 'notes')),
    },
    'sep',
    {
      label: 'Writing Tools',
      disabled: secret || !el.value.trim(),
      submenu: [
        { label: 'Show Writing Tools', run: () => os().openApp('intelligence', { props: { ask: has ? sel : el.value } }) },
        'sep',
        ...TOOLS.map((t) => ({ label: t.label, run: apply(t.run) })),
      ],
    },
    'sep',
    {
      label: 'Spelling and Grammar',
      submenu: [
        { label: 'Show Spelling and Grammar', shortcut: '⌘:', disabled: true },
        { label: 'Check Document Now', shortcut: '⌘;', run: () => toast('Spelling', 'No problems found. We did not look.', 'notes') },
        'sep',
        { label: 'Check Spelling While Typing', checked: true },
        { label: 'Check Grammar With Spelling', checked: false },
        { label: 'Correct Spelling Automatically', checked: true },
      ],
    },
    {
      label: 'Substitutions',
      submenu: [{ label: 'Smart Quotes', checked: true }, { label: 'Smart Dashes', checked: true }, { label: 'Text Replacement', checked: true }],
    },
    {
      label: 'Transformations',
      disabled: secret,
      submenu: [
        { label: 'Make Upper Case', run: apply((s) => s.toUpperCase()) },
        { label: 'Make Lower Case', run: apply((s) => s.toLowerCase()) },
        { label: 'Capitalize', run: apply((s) => s.replace(/\b\w/g, (c) => c.toUpperCase())) },
      ],
    },
    speechMenu(secret ? '' : has ? sel : el.value),
    'sep',
    {
      label: 'AutoFill',
      submenu: [
        { label: 'Contacts…', run: apply(() => 'Pear User, 1 Infinite Pear, Cupertino') },
        { label: 'Passwords…', run: apply(() => 'password123') },
      ],
    },
    servicesMenu,
  ]
}

export function selectionMenu(text: string): MenuEntry[] {
  return [lookUp(text), translate(text), { label: 'Search With Gargle', run: () => gargle(text) }, 'sep', { label: 'Copy', run: () => copy(text) }, shareMenu(text), 'sep', speechMenu(text), servicesMenu]
}

function kindOf(path: string) {
  const n = resolve(path)
  if (!n) return 'Unknown'
  if (n.type === 'dir') return 'Folder'
  return n.kind === 'app' ? 'Application' : `${n.kind[0].toUpperCase()}${n.kind.slice(1)} document`
}

export function fileMenu(path: string, opts: { rename?: () => void } = {}): MenuEntry[] {
  const node = resolve(path)
  if (!node) return []
  const { dir, name } = parentOf(path)
  const inTrash = path.startsWith(HOME + '/.Trash/')
  const locked = path.startsWith('/Applications') || path.startsWith('/System') || path === '/'
  const done = () => os().bumpFs()
  const textish = node.type === 'file' && node.kind === 'text'
  const imageish = node.type === 'file' && node.kind === 'image'
  return [
    { label: 'Open', run: () => openPath(path) },
    ...(node.type === 'file' && node.kind !== 'app'
      ? [
          {
            label: 'Open With',
            submenu: [
              ...(textish ? [{ label: 'TextEdit (default)', run: () => openPath(path) }, 'sep' as const] : []),
              ...(imageish ? [{ label: 'Preview (default)', run: () => openPath(path) }, 'sep' as const] : []),
              { label: 'Sapphari', run: () => os().openApp('safari', { props: { url: `file://${path}` } }) },
              { label: 'Terminal', run: () => os().openApp('terminal', { forceNew: true }) },
              'sep' as const,
              { label: 'App Store…', run: () => toast('App Store', 'No apps can open this. One app could, but it is $29.99/month.') },
              { label: 'Other…', disabled: true },
            ],
          } as MenuEntry,
        ]
      : []),
    'sep',
    ...(inTrash
      ? [
          {
            label: 'Put Back',
            run: () => {
              addNode(HOME + '/Desktop', name, node)
              remove(path)
              done()
            },
          },
          {
            label: 'Delete Immediately…',
            run: () => {
              remove(path)
              done()
              toast('Finder', `“${name}” is gone forever. It did not get to say goodbye.`, 'trash')
            },
          },
        ]
      : [
          {
            label: 'Move to Trash',
            shortcut: '⌘⌫',
            disabled: locked,
            run: () => {
              moveToTrash(path)
              done()
            },
          },
        ]),
    'sep',
    {
      label: 'Get Info',
      shortcut: '⌘I',
      run: () =>
        toast(
          `${name} Info`,
          `${kindOf(path)} · ${formatBytes(sizeOf(node))} · Modified ${new Date(node.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · Where: ${dir}`,
        ),
    },
    { label: 'Rename', shortcut: '↩', disabled: !opts.rename || !canRename(path), run: opts.rename },
    {
      label: `Compress “${truncate(name, 20)}”`,
      disabled: locked,
      run: () => {
        addNode(dir, `${name}.zip`, { type: 'file', kind: 'archive', size: Math.max(22, Math.round(sizeOf(node) * 0.93)), modified: Date.now() })
        done()
      },
    },
    {
      label: 'Duplicate',
      shortcut: '⌘D',
      disabled: locked,
      run: () => {
        const dot = node.type === 'file' && name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length
        addNode(dir, `${name.slice(0, dot)} copy${name.slice(dot)}`, { ...cloneNode(node), modified: Date.now() })
        done()
      },
    },
    {
      label: 'Make Alias',
      disabled: locked && path !== '/',
      run: () => {
        addNode(path === '/' ? HOME + '/Desktop' : dir, `${name || 'Pear HD'} alias`, node)
        done()
      },
    },
    {
      label: 'Quick Look',
      run: () => (textish || imageish ? openPath(path) : toast('Quick Look', `Quickly looked at “${name}”. It looked back.`)),
    },
    'sep',
    { label: 'Copy', run: () => copy(path) },
    shareMenu(path),
    'sep',
    {
      tags: node.tags ?? [],
      onPick: (tag) => {
        toggleTag(path, tag)
        done()
      },
    },
    { label: 'Tags…', disabled: true },
    'sep',
    {
      label: 'Quick Actions',
      submenu: [
        { label: 'Rotate Left', run: () => (imageish ? openPath(path) : toast('Quick Actions', `“${name}” rotated 90°. You can't tell, but it did.`)) },
        { label: 'Create PDF', run: () => addNode(dir, `${name}.pdf`, { type: 'file', kind: 'binary', size: 48_000, modified: Date.now() }) !== null && done() },
        'sep',
        { label: 'Customize…', disabled: true },
      ],
    },
    servicesMenu,
  ]
}

export function folderMenu(dirPath: string, opts: { view?: 'grid' | 'list'; setView?: (v: 'grid' | 'list') => void; sort?: string; setSort?: (s: string) => void } = {}): MenuEntry[] {
  const writable = dirPath.startsWith(HOME)
  const sorts = ['Name', 'Kind', 'Date Modified', 'Size']
  return [
    {
      label: 'New Folder',
      shortcut: '⇧⌘N',
      disabled: !writable,
      run: () => {
        let name = 'untitled folder'
        for (let i = 2; resolve(`${dirPath}/${name}`); i++) name = `untitled folder ${i}`
        mkdir(`${dirPath}/${name}`)
        os().bumpFs()
      },
    },
    'sep',
    { label: 'Get Info', run: () => toast(`${dirPath.split('/').pop() || 'Pear HD'} Info`, `Folder · ${formatBytes(sizeOf(resolve(dirPath)!))} · Where: ${normalise(dirPath + '/..')}`) },
    'sep',
    {
      label: 'Import from pPhone',
      submenu: [
        { label: 'Take Photo', run: () => toast('Continuity Camera', 'Point your pPhone at something. No, not the ceiling.', 'mirroring') },
        { label: 'Scan Documents', run: () => toast('Continuity Camera', 'Scanned 1 document: your thumb.', 'mirroring') },
        { label: 'Add Sketch', run: () => toast('Continuity Sketch', 'Your sketch has been imported. It is a pear. It is always a pear.', 'mirroring') },
      ],
    },
    'sep',
    ...(opts.setView
      ? [
          {
            label: 'View',
            submenu: [
              { label: 'as Icons', checked: opts.view === 'grid', run: () => opts.setView!('grid') },
              { label: 'as List', checked: opts.view === 'list', run: () => opts.setView!('list') },
              { label: 'as Columns', disabled: true },
              { label: 'as Gallery', disabled: true },
            ],
          } as MenuEntry,
        ]
      : []),
    { label: 'Use Groups', checked: false, disabled: true },
    {
      label: 'Sort By',
      submenu: [{ label: 'None', checked: !opts.sort, run: () => opts.setSort?.('') }, 'sep', ...sorts.map((s) => ({ label: s, checked: opts.sort === s, disabled: !opts.setSort, run: () => opts.setSort?.(s) }))],
    },
    { label: 'Clean Up', disabled: !!opts.setView },
    { label: 'Show View Options', shortcut: '⌘J', disabled: true },
  ]
}

export function desktopMenu(): MenuEntry[] {
  return [
    ...folderMenu(HOME + '/Desktop').slice(0, 1),
    'sep',
    { label: 'Get Info', run: () => os().openApp('about') },
    { label: 'Mission Control', shortcut: '⌃↑', run: () => os().setOverlay({ missionControl: true }) },
    'sep',
    { label: 'Change Wallpaper…', run: () => os().openApp('settings', { props: { pane: 'wallpaper' } }) },
    { label: 'Edit Widgets…', run: () => openGallery('desktop') },
    { label: 'New Sticky', run: () => useStickies.getState().add(lastContextPoint()) },
    'sep',
    { label: 'Use Stacks', run: () => toast('Stacks', 'Your desktop is now organised into one stack called “Everything”.') },
    {
      label: 'Sort By',
      submenu: [
        { label: 'None', checked: true },
        { label: 'Snap to Grid' },
        'sep',
        { label: 'Name' },
        { label: 'Kind' },
        { label: 'Date Last Opened' },
        { label: 'Date Added' },
        { label: 'Size' },
        { label: 'Tags' },
      ],
    },
    { label: 'Clean Up' },
    { label: 'Clean Up By', submenu: [{ label: 'Name' }, { label: 'Kind' }, { label: 'Date Modified' }, { label: 'Tags' }] },
    { label: 'Show View Options', disabled: true },
  ]
}

export function dockMenu(app: AppId): MenuEntry[] {
  const s = useOS.getState()
  const wins = s.windows.filter((w) => w.app === app)
  const running = wins.length > 0
  const name = APPS[app].name
  if (app === 'trash') {
    const trash = resolve(HOME + '/.Trash')
    const n = trash?.type === 'dir' ? Object.keys(trash.children).length : 0
    return [
      { label: 'Open', run: () => os().openApp('finder', { props: { path: HOME + '/.Trash' }, forceNew: true }) },
      'sep',
      {
        label: 'Empty Trash',
        disabled: n === 0,
        run: () => {
          if (trash?.type === 'dir') trash.children = {}
          os().bumpFs()
          toast('Trash', `${n} item${n === 1 ? '' : 's'} permanently deleted, including your feelings.`, 'trash')
        },
      },
    ]
  }
  const options: MenuEntry = {
    label: 'Options',
    submenu: [
      { label: 'Keep in Dock', checked: DOCK_APPS.includes(app), disabled: app === 'finder' },
      { label: 'Open at Login', checked: app === 'finder' || app === 'intelligence' },
      { label: 'Show in Finder', run: () => os().openApp('finder', { props: { path: '/Applications' }, forceNew: true }) },
      'sep',
      { header: 'Assign To' },
      { label: 'All Desktops' },
      { label: 'This Desktop' },
      { label: 'None', checked: true },
    ],
  }
  const winItems: MenuEntry[] = wins.map((w) => ({ label: w.title || name, checked: w.id === s.focused, run: () => os().focus(w.id) }))
  const extras: MenuEntry[] =
    app === 'finder'
      ? [{ label: 'New Finder Window', run: () => os().openApp('finder', { forceNew: true }) }, { label: 'New Smart Folder', disabled: true }, { label: 'Find…', run: () => os().setOverlay({ spotlight: true }) }, 'sep']
      : app === 'terminal'
        ? [{ label: 'New Window', run: () => os().openApp('terminal', { forceNew: true }) }, 'sep']
        : app === 'safari'
          ? [{ label: 'New Window', run: () => os().openApp('safari', { forceNew: true }) }, { label: 'New Private Window', run: () => os().openApp('safari', { forceNew: true, props: { url: '' } }) }, 'sep']
          : app === 'notes'
            ? [{ label: 'New Note', run: () => (os().saveNote({ id: 'n' + Date.now(), text: '', updated: Date.now() }), os().openApp('notes')) }, 'sep']
            : []
  if (app === 'launchpad') return [options, 'sep', { label: 'Open', run: () => os().setOverlay({ launchpad: true }) }]
  return [
    ...(winItems.length ? [...winItems, 'sep' as const] : []),
    ...extras,
    options,
    'sep',
    ...(running
      ? [
          { label: 'Show All Windows', run: () => wins.forEach((w) => os().focus(w.id)) },
          { label: 'Hide', run: () => wins.forEach((w) => os().minimize(w.id)) },
          ...(app === 'finder' ? [] : [{ label: 'Quit', run: () => os().closeApp(app) }]),
        ]
      : [{ label: 'Open', run: () => os().openApp(app) }]),
  ]
}

export function dockSeparatorMenu(): MenuEntry[] {
  const s = useOS.getState()
  const refuse = (side: string) => () => toast('Dock', `The Dock refuses to move to the ${side}. It is comfortable where it is.`, 'settings')
  return [
    { label: s.dockAutohide ? 'Turn Hiding Off' : 'Turn Hiding On', shortcut: '⌥⌘D', run: () => os().set('dockAutohide', !s.dockAutohide) },
    { label: s.dockMagnify ? 'Turn Magnification Off' : 'Turn Magnification On', run: () => os().set('dockMagnify', !s.dockMagnify) },
    'sep',
    { label: 'Position on Screen', submenu: [{ label: 'Left', run: refuse('left') }, { label: 'Bottom', checked: true }, { label: 'Right', run: refuse('right') }] },
    { label: 'Minimize Using', submenu: [{ label: 'Genie Effect', checked: true }, { label: 'Scale Effect' }, { label: 'Suck Effect', disabled: true }] },
    'sep',
    { label: 'Dock Settings…', run: () => os().openApp('settings', { props: { pane: 'desktop' } }) },
  ]
}

export function windowChromeMenu(win: Win): MenuEntry[] {
  const t = os().tileWindow
  const resizable = APPS[win.app].resizable !== false
  return [
    { label: 'Minimize', shortcut: '⌘M', run: () => os().minimize(win.id) },
    { label: 'Zoom', disabled: !resizable, run: () => t(win.id, win.tile === 'fill' ? null : 'fill') },
    'sep',
    {
      label: 'Move & Resize',
      disabled: !resizable,
      submenu: [
        { header: 'Halves' },
        { label: 'Left', shortcut: '⌃⌥←', run: () => t(win.id, 'left') },
        { label: 'Right', shortcut: '⌃⌥→', run: () => t(win.id, 'right') },
        { header: 'Quarters' },
        { label: 'Top Left', run: () => t(win.id, 'top-left') },
        { label: 'Top Right', run: () => t(win.id, 'top-right') },
        { label: 'Bottom Left', run: () => t(win.id, 'bottom-left') },
        { label: 'Bottom Right', run: () => t(win.id, 'bottom-right') },
        'sep',
        { label: 'Return to Previous Size', disabled: !win.tile, run: () => t(win.id, null) },
      ],
    },
    { label: 'Fill', shortcut: '⌃⌥F', disabled: !resizable, run: () => t(win.id, 'fill') },
    'sep',
    { label: 'Move to Desktop', submenu: [
      ...os().spaces.map((space, i) => ({ label: `Desktop ${i + 1}`, checked: win.space === space, run: () => os().moveWindowToSpace(win.id, space) })),
      'sep',
      { label: 'New Desktop', disabled: os().spaces.length >= 8, run: () => { const space = os().addSpace(); if (space !== null) { os().moveWindowToSpace(win.id, space); os().focus(win.id) } } },
    ] },
    { label: 'Show in Stage Manager', run: () => toast('Stage Manager', 'Stage Manager has left the stage.', 'settings') },
    'sep',
    { label: 'Close Window', shortcut: '⌘W', run: () => os().closeWindow(win.id) },
  ]
}

export function windowFallbackMenu(win: Win): MenuEntry[] {
  return [
    { label: 'Copy', disabled: true },
    { label: 'Writing Tools', disabled: true, submenu: [] },
    servicesMenu,
    'sep',
    { label: 'Inspect Element', run: () => toast('Developer', 'Developer Tools require the Pear Developer Program ($99/year, renews automatically).', 'safari') },
    'sep',
    { label: `Hide ${APPS[win.app].name}`, run: () => os().windows.filter((w) => w.app === win.app).forEach((w) => os().minimize(w.id)) },
    { label: `Quit ${APPS[win.app].name}`, run: () => os().closeApp(win.app) },
  ]
}

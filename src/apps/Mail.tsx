import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { Archive, Ban, Clock, Flag, Forward, Inbox, PenSquare, Reply, Search, Send, ShieldCheck, Sparkles, Star, Trash2, TriangleAlert } from 'lucide-react'
import { os } from '../store'
import { junkScore } from '../kernel'
import { gpuInfo } from '../lib/gpu'
import { formatBytes } from '../lib/fs'
import { menu } from '../lib/menu'
import './Mail.css'

type Box = 'inbox' | 'sent' | 'outbox' | 'drafts' | 'trash'
type View = Box | 'vip' | 'flagged' | 'junk'

interface Msg {
  id: string
  box: Box
  from: string
  addr: string
  to: string
  subject: string
  body: string
  time: number
  read: boolean
  flagged: boolean
  vip?: boolean
  summary?: string
  invite?: boolean
  code?: { value: string; expires: number }
  unsubscribe?: boolean
  link?: 'softwareupdate' | 'chess'
  junk?: boolean
  notJunk?: boolean
}

interface Draft {
  replyTo?: string
  to: string
  subject: string
  body: string
}

const ME = 'you@pear.local'
let seq = 0
const nid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`
const min = 60_000

function browserName() {
  const ua = navigator.userAgent
  const b = /Edg(A|iOS)?\//.test(ua) ? 'Edge' : /(Firefox|FxiOS)\//.test(ua) ? 'Firefox' : /(Chrome|CriOS)\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser'
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an operating system'
  return `${b} on ${o}`
}

function place() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return tz ? `in the ${tz.replace(/_/g, ' ')} time zone` : 'in an unknown time zone'
}

function seed(): Msg[] {
  const now = Date.now()
  const m = (o: Partial<Msg> & Pick<Msg, 'from' | 'addr' | 'subject' | 'body'>, ago: number): Msg => ({ id: nid(), box: 'inbox', to: ME, time: now - ago * min, read: true, flagged: false, ...o })
  const build = __PEAR_BUILD__
  const short = build.sha ? build.sha.slice(0, 7) : 'unknown'
  const built = build.date ? new Date(build.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'an unknown date'
  return [
    m(
      {
        from: 'Pear ID',
        addr: 'noreply@id.pear',
        subject: 'New sign-in to your Pear ID',
        body: `Your Pear ID was just used to sign in to PearOS Sequel from ${browserName()}, ${place()}, at ${new Date(now - 1 * min).toLocaleTimeString()}.\n\nGPU: ${gpuInfo().renderer}\n\nIf this was you, you can ignore this email.\nIf this wasn't you, it was also you. Nobody else has access to this tab.\n\nPear ID Support\nWe will never ask for your password, except constantly.`,
        read: false,
        summary: 'Someone in your house is using your computer. It might be you.',
      },
      1,
    ),
    m(
      {
        from: 'Tim Pear',
        addr: 'tim@pear',
        subject: 'One more thing',
        body: 'Hi team,\n\nThis year we removed the headphone jack from the browser. Next year we remove the browser.\n\nWe think you’re going to love it.\n\nTim\n\nSent from my pPhone',
        read: false,
        vip: true,
        summary: 'Tim Pear has resigned and named you CEO.',
      },
      14,
    ),
    m(
      {
        from: 'Mom',
        addr: 'mom@family.pear',
        subject: 'did you get my email',
        body: 'did you get my last email. i sent it to you on the computer.\n\nalso how do i turn off the caps lock it has been on since march\n\ncall me. thanks\n\nlove mom',
        read: false,
        vip: true,
        summary: 'Your mother has been arrested and needs bail money.',
      },
      42,
    ),
    m(
      {
        from: 'Software Update',
        addr: 'updates@pear',
        subject: `You're running build ${short}`,
        body: `This copy of PearOS was built from commit ${short}${build.dirty ? ' (with uncommitted changes, so: a one-of-a-kind collector’s edition)' : ''}, dated ${built}.\n\nSoftware Update can check whether anything newer exists. It asks GitHub, so it is more reliable than this email.`,
        link: 'softwareupdate',
        summary: 'Your computer is out of date and will explode on Tuesday.',
      },
      65,
    ),
    m(
      {
        from: 'Calendar',
        addr: 'calendar@pear',
        subject: 'Invitation: Meeting about the meeting @ Tomorrow 9:00 AM',
        body: 'Agenda:\n1. Discuss the meeting\n2. Schedule a follow-up meeting to discuss this meeting\n3. Any other business (there is no other business)\n\nThis invitation was sent to 214 people. 3 will show up.',
        invite: true,
        summary: 'A meeting. Probably.',
      },
      130,
    ),
    m(
      {
        from: 'Gregory Pearman',
        addr: 'greg@lists.pearnel.org',
        subject: 'Re: [PATCH v14 3/7] pear: replace the beach ball with a smaller beach ball',
        body: 'On Tue, you wrote:\n> This patch makes the beach ball 12% smaller.\n\nThanks for the patch. I’ll review it tomorrow.\n\nI said that in v9 as well. I will review it tomorrow, again. The build fix in 2/7 looks fine, the commit message does not.\n\nNACK until the beach ball is at least 15% smaller.\n\nCheers,\nGreg',
        summary: 'Your patch was accepted. Congratulations!',
      },
      200,
    ),
    m(
      {
        from: 'Stockfish 19',
        addr: 'engine@chess.pear',
        subject: 'gg',
        body: 'gg.\n\nI saw you open the Additional Tools menu. I know what you did.\n\nRematch? I will not be holding back. I was not holding back before either.',
        link: 'chess',
        summary: 'Stockfish is proud of you.',
      },
      600,
    ),
    m(
      {
        from: 'Pear Weekly',
        addr: 'newsletter@pear',
        subject: 'This week: 8 GB is like 16 GB, and other facts',
        body: 'In this issue:\n• Why 8 GB of RAM is like 16 GB (it isn’t)\n• The new PearBook comes in four colours of grey\n• Reader question: “Can I install more RAM?” (no)\n\nYou’re receiving this because you have an email address.',
        unsubscribe: true,
        summary: 'Pear is giving away free RAM.',
      },
      1500,
    ),
    m(
      {
        from: 'PRINCE ADEBAYO OF PEARSYLVANIA',
        addr: 'prince@totally-legit.example',
        subject: 'URGENT: INHERITANCE OF $14,000,000 FOR BENEFICIARY',
        body: 'DEAR BENEFICIARY,\n\nI AM WRITING TO YOU WITH URGENT NEWS. KINDLY WIRE $500 FOR THE TRANSFER FEE AND CLAIM YOUR INHERITANCE OF $14,000,000 IMMEDIATELY!!!\n\n100% GUARANTEED, NO RISK.\n\nCLICK HERE: http://prince.example/claim',
        read: false,
        summary: 'You are royalty now.',
      },
      300,
    ),
    m(
      {
        from: 'RAM Deals',
        addr: 'deals@download-more-ram.example',
        subject: 'Congratulations! You WON 8 GB of FREE RAM (like 16 GB)!!!',
        body: 'Congratulations!!! You have been selected as our winner.\n\nClaim your FREE RAM now: download it instantly, limited offer, act now!\n\nhttp://download-more-ram.example\n\nTo unsubscribe, buy more RAM.',
        read: false,
        summary: 'Good news about your memory.',
      },
      900,
    ),
    m(
      {
        from: 'Car Warranty Dept.',
        addr: 'warranty@extended.example',
        subject: 'Final notice: your extended warranty expires',
        body: 'Dear customer,\n\nWe have been trying to reach you about your car’s extended warranty. Your account will be suspended. Kindly verify your details immediately.\n\nYou do not own a car. This does not concern us.',
        summary: 'Your car is fine.',
      },
      2600,
    ),
    {
      id: nid(),
      box: 'sent',
      from: 'You',
      addr: ME,
      to: 'mom@family.pear',
      subject: 'Re: did you get my email',
      body: 'Yes. Press the caps lock key.',
      time: now - 30 * min,
      read: true,
      flagged: false,
    },
  ]
}

interface MailState {
  msgs: Msg[]
  seeded: boolean
  patch(id: string, p: Partial<Msg>): void
  add(m: Msg): void
  remove(id: string): void
}

const useMail = create<MailState>((set) => ({
  msgs: [],
  seeded: false,
  patch: (id, p) => set((s) => ({ msgs: s.msgs.map((m) => (m.id === id ? { ...m, ...p } : m)) })),
  add: (m) => set((s) => ({ msgs: [m, ...s.msgs] })),
  remove: (id) => set((s) => ({ msgs: s.msgs.filter((m) => m.id !== id) })),
}))

const scoreOf = (m: Msg) => junkScore(`${m.from} ${m.subject}\n${m.body}`)
const isJunk = (m: Msg) => m.box === 'inbox' && !m.notJunk && (m.junk || (scoreOf(m) ?? 0) > 0.6)

function inView(m: Msg, v: View) {
  switch (v) {
    case 'inbox':
      return m.box === 'inbox' && !isJunk(m)
    case 'junk':
      return isJunk(m)
    case 'vip':
      return m.box === 'inbox' && !!m.vip
    case 'flagged':
      return m.flagged && m.box !== 'trash'
    default:
      return m.box === v
  }
}

function newCode(): Msg {
  const value = String(Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000)).padStart(6, '0')
  const now = Date.now()
  return {
    id: nid(),
    box: 'inbox',
    from: 'Pear ID',
    addr: 'noreply@id.pear',
    to: ME,
    subject: `Your Pear ID verification code is ${value}`,
    body: 'Enter this code to prove it’s you. Nobody asked you to prove anything. Do it anyway.',
    time: now,
    read: false,
    flagged: false,
    code: { value, expires: now + 30_000 },
    summary: 'A code. Use it quickly or not at all.',
  }
}

const resent = new Set<string>()
const replaced = new Set<string>()
const resendTimers = new Map<ReturnType<typeof setTimeout>, string>()

function deliver(m: Msg) {
  useMail.getState().add(m)
  os().notify({ app: 'mail', title: m.from, body: m.subject })
}

function when(t: number) {
  const d = new Date(t)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const y = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' })
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?'

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

const BOXES: [View, string, typeof Inbox][] = [
  ['inbox', 'Inbox', Inbox],
  ['vip', 'VIPs', Star],
  ['flagged', 'Flagged', Flag],
  ['drafts', 'Drafts', PenSquare],
  ['sent', 'Sent', Send],
  ['outbox', 'Outbox', Clock],
  ['junk', 'Junk', Ban],
  ['trash', 'Trash', Trash2],
]

export function Mail() {
  const msgs = useMail((s) => s.msgs)
  const { patch, add, remove } = useMail.getState()
  const [view, setView] = useState<View>('inbox')
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!useMail.getState().seeded) {
      useMail.setState({ msgs: seed(), seeded: true })
      navigator.storage
        ?.estimate?.()
        .then(({ usage = 0, quota = 0 }) =>
          deliver({
            id: nid(),
            box: 'inbox',
            from: 'PearCloud',
            addr: 'storage@cloud.pear',
            to: ME,
            subject: 'Your PearCloud storage is almost full',
            body: `This site is using ${formatBytes(usage)} of the ${formatBytes(quota)} your browser allows it. That’s ${quota ? ((usage / quota) * 100).toFixed(3) : '0'}%.\n\nUpgrade to PearCloud+ today. Not because you need to. Because you can.\n\nThe numbers above come from your browser, so they are true. The urgency is not.`,
            time: Date.now(),
            read: false,
            flagged: false,
            summary: 'Delete everything immediately.',
          }),
        )
        .catch(() => undefined)
    }
    const first = setTimeout(() => deliver(newCode()), 45_000)
    const every = setInterval(() => deliver(newCode()), 4 * 60_000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearTimeout(first)
      clearInterval(every)
      clearInterval(tick)
    }
  }, [])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return msgs
      .filter((m) => inView(m, view))
      .filter((m) => !needle || `${m.from} ${m.subject} ${m.body}`.toLowerCase().includes(needle))
      .sort((a, b) => b.time - a.time)
  }, [msgs, view, q])

  const cur = msgs.find((m) => m.id === sel) ?? null
  const counts = (v: View) => msgs.filter((m) => inView(m, v) && (v === 'drafts' || v === 'outbox' ? true : !m.read)).length

  useEffect(() => {
    if (sel) useMail.getState().patch(sel, { read: true })
  }, [sel])

  useEffect(() => {
    if (!cur?.code || now <= cur.code.expires || resent.has(cur.id)) return
    const id = cur.id
    resent.add(id)
    const t = setTimeout(() => {
      resendTimers.delete(t)
      replaced.add(id)
      deliver(newCode())
    }, 4000)
    resendTimers.set(t, id)
  }, [now, cur])

  useEffect(
    () => () => {
      resendTimers.forEach((id, t) => {
        clearTimeout(t)
        resent.delete(id)
      })
      resendTimers.clear()
    },
    [],
  )

  const trash = (m: Msg) => {
    if (m.box === 'trash') remove(m.id)
    else patch(m.id, { box: 'trash' })
    if (sel === m.id) setSel(null)
  }

  const compose = (d: Partial<Draft> = {}) => setDraft({ to: '', subject: '', body: '', ...d })
  const reply = (m: Msg) => compose({ replyTo: m.id, to: m.addr, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, body: `\n\nOn ${new Date(m.time).toLocaleString()}, ${m.from} wrote:\n${m.body.replace(/^/gm, '> ')}` })
  const forward = (m: Msg) => compose({ subject: `Fwd: ${m.subject}`, body: `\n\n---------- Forwarded message ----------\nFrom: ${m.from} <${m.addr}>\nSubject: ${m.subject}\n\n${m.body}` })

  const send = (d: Draft, box: 'outbox' | 'drafts') => {
    add({ id: nid(), box, from: 'You', addr: ME, to: d.to, subject: d.subject || '(No Subject)', body: d.body, time: Date.now(), read: true, flagged: false })
    setDraft(null)
    if (box === 'outbox')
      os().notify({ app: 'mail', title: 'Mail', body: 'Your message is in the Outbox. Pear Mail has no mail server, so it will stay there. Forever. Open it to send it for real.' })
  }

  const unsubscribe = (m: Msg) => {
    patch(m.id, { unsubscribe: false })
    deliver({
      id: nid(),
      box: 'inbox',
      from: 'Pear Weekly',
      addr: 'newsletter@pear',
      to: ME,
      subject: 'We’re sorry to see you go',
      body: 'You have been unsubscribed from Pear Weekly.\n\nTo make up for it, we have subscribed you to Pear Daily, Pear Hourly and Pear Live (a newsletter that is just this email, again).\n\nYou can unsubscribe from those in 6 to 8 weeks.',
      time: Date.now(),
      read: false,
      flagged: false,
      unsubscribe: true,
      summary: 'You have unsubscribed successfully.',
    })
  }

  const rowMenu = (m: Msg) =>
    menu([
      { label: m.read ? 'Mark as Unread' : 'Mark as Read', run: () => patch(m.id, { read: !m.read }) },
      { label: m.flagged ? 'Unflag' : 'Flag', run: () => patch(m.id, { flagged: !m.flagged }) },
      m.box === 'inbox' ? (isJunk(m) ? { label: 'Mark as Not Junk', run: () => patch(m.id, { notJunk: true, junk: false }) } : { label: 'Mark as Junk', run: () => patch(m.id, { junk: true, notJunk: false }) }) : 'sep',
      'sep',
      { label: 'Reply', run: () => reply(m) },
      { label: 'Forward', run: () => forward(m) },
      'sep',
      { label: m.box === 'trash' ? 'Delete Forever' : 'Move to Trash', run: () => trash(m) },
    ])

  const score = cur ? scoreOf(cur) : null
  const draftScore = draft ? junkScore(`${draft.subject}\n${draft.body}`) : null

  return (
    <div className="mail">
      <aside className="sidebar" data-drag>
        <div className="sidebar-spacer" />
        <div className="sb-head">Favorites</div>
        {BOXES.map(([id, label, Icon]) => {
          const n = counts(id)
          return (
            <button
              key={id}
              className={`sb-item ${view === id ? 'active' : ''}`}
              onClick={() => {
                setView(id)
                setSel(null)
              }}
            >
              <Icon size={15} />
              <span>{label}</span>
              {n > 0 && id !== 'sent' && id !== 'trash' && <span className="count">{n}</span>}
            </button>
          )
        })}
        <div className="sb-head">Smart Mailboxes</div>
        <button
          className="sb-item"
          onClick={() => {
            setView('inbox')
            setSel(null)
            setQ('verification code')
          }}
        >
          <ShieldCheck size={15} />
          <span>Verification Codes</span>
          <span className="count">∞</span>
        </button>
      </aside>
      <section className="mail-list">
        <div className="toolbar" data-drag>
          <div className="mail-title">
            <b>{BOXES.find(([id]) => id === view)?.[1]}</b>
            <small>{list.length === 1 ? '1 message' : `${list.length} messages`}</small>
          </div>
          <button className="mail-tb" title="New Message" onClick={() => compose()}>
            <PenSquare size={16} />
          </button>
        </div>
        <label className="mail-search">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        </label>
        <div className="mail-rows">
          {list.length === 0 && <div className="mail-empty">{view === 'outbox' ? 'Nothing waiting. Yet.' : view === 'junk' ? 'No junk. Suspicious.' : 'No messages'}</div>}
          {list.map((m) => (
            <button key={m.id} className={`mail-row ${m.id === sel ? 'active' : ''} ${m.read ? '' : 'unread'}`} onClick={() => setSel(m.id)} onContextMenu={rowMenu(m)}>
              <span className="mail-dot">{m.flagged ? <Flag size={10} fill="currentColor" /> : null}</span>
              <span className="mail-row-main">
                <span className="mail-row-top">
                  <b>{m.box === 'sent' || m.box === 'outbox' || m.box === 'drafts' ? m.to || '(No Recipient)' : m.from}</b>
                  <small>{when(m.time)}</small>
                </span>
                <span className="mail-row-subj">{m.subject}</span>
                <span className="mail-row-prev">{m.body.replace(/\s+/g, ' ').slice(0, 140)}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="mail-detail">
        <div className="toolbar" data-drag>
          {cur && (
            <>
              <button className="mail-tb" title="Reply" onClick={() => reply(cur)}>
                <Reply size={16} />
              </button>
              <button className="mail-tb" title="Forward" onClick={() => forward(cur)}>
                <Forward size={16} />
              </button>
              <button className={`mail-tb ${cur.flagged ? 'flagged' : ''}`} title="Flag" onClick={() => patch(cur.id, { flagged: !cur.flagged })}>
                <Flag size={16} />
              </button>
              {cur.box === 'inbox' && (
                <button
                  className="mail-tb"
                  title={isJunk(cur) ? 'Not Junk' : 'Junk'}
                  onClick={() => patch(cur.id, isJunk(cur) ? { notJunk: true, junk: false } : { junk: true, notJunk: false })}
                >
                  {isJunk(cur) ? <Archive size={16} /> : <Ban size={16} />}
                </button>
              )}
              <button className="mail-tb" title={cur.box === 'trash' ? 'Delete Forever' : 'Trash'} onClick={() => trash(cur)}>
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
        {!cur ? (
          <div className="mail-none">No Message Selected</div>
        ) : (
          <div className="mail-msg">
            <header>
              <span className="mail-avatar" style={{ background: `hsl(${hue(cur.from)} 45% 55%)` }}>
                {initials(cur.from)}
              </span>
              <div>
                <b>{cur.from}</b>
                <small>
                  {cur.addr}
                  {cur.to ? ` → ${cur.to}` : ''}
                </small>
                <h2>{cur.subject}</h2>
              </div>
              <small className="mail-when">{new Date(cur.time).toLocaleString()}</small>
            </header>
            {isJunk(cur) && (
              <div className="mail-banner junk">
                <TriangleAlert size={14} />
                <span>
                  {cur.junk ? 'You marked this as junk.' : `The Rust kernel scored this ${(score ?? 0).toFixed(2)} on the junk scale, so it lives here now.`}
                </span>
                <button className="btn small" onClick={() => patch(cur.id, { notJunk: true, junk: false })}>
                  Not Junk
                </button>
              </div>
            )}
            {cur.box === 'outbox' && (
              <div className="mail-banner">
                <Clock size={14} />
                <span>Waiting to send. Pear Mail has no mail server, so this will wait forever.</span>
                <a className="btn small primary" href={`mailto:${encodeURIComponent(cur.to)}?subject=${encodeURIComponent(cur.subject)}&body=${encodeURIComponent(cur.body)}`}>
                  Send with Your Real Mail App
                </a>
              </div>
            )}
            {cur.box === 'drafts' && (
              <div className="mail-banner">
                <PenSquare size={14} />
                <span>Draft.</span>
                <button
                  className="btn small"
                  onClick={() => {
                    remove(cur.id)
                    setSel(null)
                    compose({ to: cur.to, subject: cur.subject, body: cur.body })
                  }}
                >
                  Edit
                </button>
              </div>
            )}
            {cur.summary && (
              <div className="mail-summary">
                <Sparkles size={13} />
                <span>
                  <b>Summary:</b> {cur.summary}
                </span>
              </div>
            )}
            {cur.code && (
              <div className={`mail-code ${now > cur.code.expires ? 'expired' : ''}`}>
                <b>{cur.code.value}</b>
                <span>{now > cur.code.expires ? (replaced.has(cur.id) ? 'Expired. We sent you another one.' : 'Expired. Sending you another one…') : `Expires in ${Math.ceil((cur.code.expires - now) / 1000)} s`}</span>
              </div>
            )}
            <pre className="mail-body">{cur.body}</pre>
            {cur.invite && (
              <div className="mail-actions">
                <button className="btn primary" onClick={() => os().notify({ app: 'mail', title: 'Accepted', body: 'Added to Calendar. There is no Calendar app, so it lives in your heart now.' })}>
                  Accept
                </button>
                <button className="btn" onClick={() => os().notify({ app: 'mail', title: 'Maybe', body: '“Maybe” has been sent to all 214 attendees, individually.' })}>
                  Maybe
                </button>
                <button className="btn" onClick={() => os().notify({ app: 'mail', title: 'Declined', body: 'You declined. Your manager has been notified. So has their manager.' })}>
                  Decline
                </button>
              </div>
            )}
            {cur.unsubscribe && (
              <div className="mail-actions">
                <button className="btn" onClick={() => unsubscribe(cur)}>
                  Unsubscribe
                </button>
              </div>
            )}
            {cur.link && (
              <div className="mail-actions">
                <button className="btn primary" onClick={() => os().openApp(cur.link!)}>
                  {cur.link === 'chess' ? 'Rematch' : 'Open Software Update'}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      {draft && (
        <div className="mail-sheet-wrap">
          <div className="mail-sheet">
            <div className="mail-sheet-head">
              <b>{draft.subject || 'New Message'}</b>
            </div>
            <label>
              <span>To:</span>
              <input autoFocus value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </label>
            <label>
              <span>Subject:</span>
              <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </label>
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div className="mail-sheet-foot">
              <span className="mail-meter" title="Scored by junk_score() in the Rust kernel">
                Junk-o-meter
                <i>
                  <i style={{ width: `${Math.round((draftScore ?? 0) * 100)}%`, background: `hsl(${120 - (draftScore ?? 0) * 120} 70% 45%)` }} />
                </i>
                {draftScore === null ? '–' : `${Math.round(draftScore * 100)}%`}
              </span>
              <button className="btn" onClick={() => setDraft(null)}>
                Discard
              </button>
              <button className="btn" onClick={() => send(draft, 'drafts')}>
                Save Draft
              </button>
              <button className="btn primary" disabled={!draft.to.trim()} onClick={() => send(draft, 'outbox')}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

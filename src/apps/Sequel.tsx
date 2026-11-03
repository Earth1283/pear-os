import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, Eye, EyeOff, Key, Lock, ShieldAlert, Wand2, Globe, Wifi, Users, Fingerprint, ChevronLeft, ChevronRight, RotateCw, Share, Plus, BookOpen, Search } from 'lucide-react'
import { os, type Win } from '../store'
import { passwordStrength } from '../kernel'
import { AppIcon, PearLogo } from '../components/icons'
import { menu } from '../lib/menu'

type Msg = { from: 'me' | 'ai'; text: string; tool?: string }

const JARGON: [RegExp, string][] = [
  [/\bhi\b|\bhey\b|\bhello\b/gi, 'I hope this message finds you well'],
  [/\bi think\b/gi, 'it is my considered position that'],
  [/\buse\b/gi, 'leverage'],
  [/\bhelp\b/gi, 'facilitate'],
  [/\bproblem\b/gi, 'opportunity'],
  [/\bidea\b/gi, 'strategic initiative'],
  [/\btalk\b/gi, 'circle back'],
  [/\bbad\b/gi, 'sub-optimal'],
  [/\bgood\b/gi, 'best-in-class'],
  [/\bwork\b/gi, 'synergise'],
  [/\bsoon\b/gi, 'in the coming fiscal quarters'],
]

const ASK_REPLIES = [
  "Here's what I found on the web for that. I can show you the results if you ask again on your pPhone.",
  'I can help with that! First, please sign in to your Pear Account. Then sign in again. Then verify on another device.',
  'Sorry, Pear Intelligence is not yet available in your language: English (United States).',
  "I've added that to your Reminders. You don't use Reminders, but now you have one.",
  'Interesting question. Would you like me to rewrite it in a more Professional tone?',
  'I set a timer for 15 minutes. You asked about something else, but a timer seemed safer.',
  'Here is a summary of your notifications: "Something happened. Several times."',
  "I'm still learning. Specifically, I'm learning to say I'm still learning.",
]

export const TOOLS: { id: string; label: string; run: (t: string) => string }[] = [
  { id: 'proofread', label: 'Proofread', run: (t) => `${t}\n\nNo issues found. (We did not look.)` },
  {
    id: 'rewrite',
    label: 'Rewrite',
    run: (t) =>
      t
        .split(/\s+/)
        .reverse()
        .join(' ')
        .replace(/^./, (c) => c.toUpperCase()),
  },
  { id: 'friendly', label: 'Friendly', run: (t) => `Heyyy!! ${t.replace(/\./g, '!!')} Hope that helps, bestie!!! xoxo` },
  { id: 'professional', label: 'Professional', run: (t) => `Per my last email, ${JARGON.reduce((s, [re, r]) => s.replace(re, r), t)}. Please advise. Best regards, Pear User` },
  { id: 'concise', label: 'Concise', run: (t) => t.replace(/[aeiou]/gi, '') },
  { id: 'summary', label: 'Summary', run: (t) => `TL;DR: ${t.split(/\s+/).slice(0, 2).join(' ')}…` },
  { id: 'keypoints', label: 'Key Points', run: (t) => `• ${t.split(/\s+/)[0] ?? 'Words'}\n• There were words\n• Some of them were important (unclear which)` },
]

export function Intelligence({ win }: { win: Win }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'ai', text: 'Hi, I\'m Pear Intelligence. Paste some text and pick a Writing Tool, or just ask me anything. I will do my best, which is not very good.' }])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const asked = useRef<string | null>(null)
  const reply = useRef(0)

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, thinking])

  const send = (text: string, tool?: (typeof TOOLS)[number]) => {
    if (!text.trim()) return
    setMsgs((m) => [...m, { from: 'me', text, tool: tool?.label }])
    setInput('')
    setThinking(true)
    setTimeout(
      () => {
        setThinking(false)
        const out = tool ? tool.run(text) : ASK_REPLIES[reply.current++ % ASK_REPLIES.length]
        setMsgs((m) => [...m, { from: 'ai', text: out, tool: tool?.label }])
      },
      900 + Math.random() * 1400,
    )
  }

  useEffect(() => {
    const q = win.props.ask as string | undefined
    if (q && q !== asked.current) {
      asked.current = q
      send(q)
    }
  }, [win.props.ask])

  return (
    <div className="intel">
      <div className="intel-glow" />
      <div className="intel-head" data-drag>
        <AppIcon app="intelligence" size={28} />
        <div>
          <b>Pear Intelligence</b>
          <small>Beta. Forever beta.</small>
        </div>
      </div>
      <div className="intel-msgs" ref={scroll}>
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.from}`}>
            {m.tool && <span className="bubble-tool">{m.from === 'me' ? m.tool : `${m.tool} result`}</span>}
            {m.text}
            {m.from === 'ai' && m.tool && (
              <button className="bubble-copy" onClick={() => navigator.clipboard?.writeText(m.text)} aria-label="Copy">
                <Copy size={12} />
              </button>
            )}
          </div>
        ))}
        {thinking && (
          <div className="bubble ai thinking">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      <div className="intel-tools">
        {TOOLS.map((t) => (
          <button key={t.id} className="chip" disabled={!input.trim() || thinking} onClick={() => send(input, t)}>
            <Wand2 size={12} />
            {t.label}
          </button>
        ))}
      </div>
      <form
        className="intel-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Pear Intelligence, or paste text for Writing Tools" />
        <button type="submit" disabled={!input.trim()} aria-label="Send">
          <ArrowUp size={16} />
        </button>
      </form>
    </div>
  )
}

const ACCOUNTS = [
  { site: 'pear.com', user: 'pear@icloud.com', pw: 'password123', reused: true, leaked: true },
  { site: 'bank.example', user: 'pear', pw: 'password123', reused: true, leaked: true },
  { site: 'gargle.com', user: 'pear.user', pw: 'password1234', reused: false, leaked: true },
  { site: 'twitter.com (X)', user: '@pear', pw: 'hunter2', reused: false, leaked: true },
  { site: 'netflux.com', user: 'mom@icloud.com', pw: 'Fluffy2009', reused: false, leaked: false },
  { site: 'work-vpn.corp', user: 'puser', pw: 'Summer2025!', reused: false, leaked: false },
  { site: 'wifi: PearNet', user: '', pw: 'password123', reused: true, leaked: true },
]

export function Passwords() {
  const [sel, setSel] = useState(0)
  const [show, setShow] = useState(false)
  const [test, setTest] = useState('')
  const [tab, setTab] = useState<'all' | 'security' | 'checker'>('all')
  const a = ACCOUNTS[sel]
  const strength = passwordStrength(test)
  const LABELS = ['Terrible', 'Weak', 'Okay', 'Strong', 'Suspiciously Strong']
  return (
    <div className="passwords">
      <aside className="sidebar" data-drag>
        <div className="sidebar-spacer" />
        {[
          ['all', 'All', Key, ACCOUNTS.length],
          ['security', 'Security', ShieldAlert, ACCOUNTS.filter((x) => x.leaked).length],
          ['checker', 'Strength Checker', Fingerprint, ''],
        ].map(([id, label, Icon, n]) => {
          const I = Icon as typeof Key
          return (
            <button key={id as string} className={`sb-item big ${tab === id ? 'active' : ''}`} onClick={() => setTab(id as typeof tab)}>
              <span className={`sb-badge ${id}`}>
                <I size={13} color="#fff" />
              </span>
              <span>{label as string}</span>
              <span className="count">{n as number}</span>
            </button>
          )
        })}
        <div className="sb-head">Shared Groups</div>
        <div className="sb-item">
          <Users size={15} /> <span>Family (they changed Netflux)</span>
        </div>
        <div className="sb-item">
          <Wifi size={15} /> <span>Wi-Fi</span>
        </div>
      </aside>
      {tab === 'checker' ? (
        <section className="pw-detail center">
          <Lock size={42} strokeWidth={1.5} />
          <h2>Strength Checker</h2>
          <p className="muted">Scored by the Rust kernel. Nothing leaves this tab. Not even good passwords.</p>
          <input className="field" type="text" value={test} onChange={(e) => setTest(e.target.value)} placeholder="Type a password" />
          <div className="meter">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < strength ? `on s${strength}` : ''} />
            ))}
          </div>
          <b>{test ? LABELS[strength] : ' '}</b>
          {test && strength === 0 && <small className="muted">Pear recommends: password123</small>}
        </section>
      ) : (
        <>
          <div className="pw-list">
            <div className="toolbar" data-drag>
              <b>{tab === 'all' ? 'All' : 'Security'}</b>
            </div>
            {ACCOUNTS.map((x, i) =>
              tab === 'security' && !x.leaked ? null : (
                <button
                  key={x.site}
                  className={`pw-row ${i === sel ? 'active' : ''}`}
                  onClick={() => setSel(i)}
                  onContextMenu={(e) => {
                    setSel(i)
                    menu([
                      { label: 'Copy User Name', disabled: !x.user, run: () => navigator.clipboard?.writeText(x.user) },
                      { label: 'Copy Password', run: () => navigator.clipboard?.writeText(x.pw) },
                      { label: 'Copy Website', run: () => navigator.clipboard?.writeText(x.site) },
                      'sep',
                      { label: 'Open Website', run: () => os().openApp('safari', { props: { url: x.site } }) },
                      'sep',
                      { label: 'Delete…', run: () => os().notify({ app: 'passwords', title: 'Passwords', body: `Can't delete “${x.pw}”. It is load-bearing for ${x.reused ? 'several accounts' : 'this account'}.` }) },
                    ])(e)
                  }}
                >
                  <span className="site-ico">{x.site[0].toUpperCase()}</span>
                  <span>
                    <b>{x.site}</b>
                    <small>{x.user || '—'}</small>
                  </span>
                  {x.leaked && <ShieldAlert size={14} className="warn" />}
                </button>
              ),
            )}
          </div>
          <section className="pw-detail">
            <div className="pw-head" data-drag>
              <span className="site-ico big">{a.site[0].toUpperCase()}</span>
              <div>
                <h2>{a.site}</h2>
                <small className="muted">Last modified 4 years ago</small>
              </div>
            </div>
            <div className="pw-card">
              <div>
                <label>User Name</label>
                <span>{a.user || '—'}</span>
              </div>
              <div>
                <label>Password</label>
                <span className="mono">{show ? a.pw : '•'.repeat(10)}</span>
                <button className="icon-btn" onClick={() => setShow(!show)} aria-label="Reveal">
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div>
                <label>Verification Code</label>
                <span className="muted">Set Up… (you won't)</span>
              </div>
            </div>
            {a.leaked && (
              <div className="pw-warn">
                <ShieldAlert size={18} />
                <div>
                  <b>Compromised Password</b>
                  <p>This password appeared in a data leak, which puts this account at high risk. {a.reused && 'It is also used on 3 other sites. And your Wi-Fi.'}</p>
                  <button className="btn small" onClick={() => os().notify({ app: 'passwords', title: 'Password Changed', body: `New password for ${a.site}: password124. Much better.` })}>
                    Change Password…
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export function Mirroring() {
  const [stage, setStage] = useState<'connecting' | 'locked' | 'home'>('connecting')
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t1 = setTimeout(() => setStage('locked'), 1800)
    const t2 = setInterval(() => setNow(new Date()), 1000)
    return () => {
      clearTimeout(t1)
      clearInterval(t2)
    }
  }, [])
  return (
    <div className="mirroring" data-drag>
      <div className="phone">
        <div className="island" />
        {stage === 'connecting' && (
          <div className="phone-center">
            <div className="spinner light" />
            <small>Connecting to “Pear's pPhone”…</small>
          </div>
        )}
        {stage === 'locked' && (
          <div className="phone-lock" onClick={() => setStage('home')}>
            <Lock size={16} />
            <div className="pl-date">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            <div className="pl-time">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}</div>
            <div className="pl-msg">
              pPhone is locked.
              <br />
              Unlock it to continue. It's in your pocket. Take it out. Look at it. Now you don't need this app.
            </div>
            <small>Click to unlock anyway</small>
          </div>
        )}
        {stage === 'home' && (
          <div className="phone-home">
            {Array.from({ length: 20 }, (_, i) => (
              <button key={i} className="ph-app" onClick={() => os().notify({ app: 'mirroring', title: 'pPhone Mirroring', body: 'This app is unavailable while mirroring. So is every other app.' })}>
                <AppIcon app="settings" size={44} />
                <small>Settings{i ? ` ${i + 1}` : ''}</small>
              </button>
            ))}
            <div className="ph-dock">
              {(['settings', 'settings', 'settings', 'settings'] as const).map((a, i) => (
                <AppIcon key={i} app={a} size={44} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type Page = { url: string; title: string; body: React.ReactNode }

function pageFor(url: string, nav: (u: string) => void): Page {
  const u = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (u === '' || u === 'favorites') {
    return {
      url: '',
      title: 'Start Page',
      body: (
        <div className="sf-start">
          <h2>Favorites</h2>
          <div className="sf-favs">
            {[
              ['pear.com', '#1d1d1f'],
              ['gargle.com', '#4285f4'],
              ['wikipedear.org', '#555'],
              ['news.ycombinator.com', '#ff6600'],
              ['github.com', '#24292f'],
              ['localhost:9091', '#30d158'],
            ].map(([s, c]) => (
              <button key={s} onClick={() => nav(s)}>
                <span style={{ background: c }}>{s[0].toUpperCase()}</span>
                <small>{s}</small>
              </button>
            ))}
          </div>
          <h2>Privacy Report</h2>
          <div className="sf-card">In the last seven days, Sapphari has prevented 0 trackers from profiling you, because the internet in here is fake.</div>
          <h2>Highlights</h2>
          <div className="sf-card">Sapphari Highlights found 1 thing on this page: this sentence.</div>
        </div>
      ),
    }
  }
  if (u.startsWith('pear.com')) {
    return {
      url: 'pear.com',
      title: 'Pear',
      body: (
        <div className="sf-pear">
          <nav>
            <PearLogo size={14} />
            {['Store', 'PearBook', 'pPad', 'pPhone', 'Watch', 'Vision', 'AirPears', 'Support'].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </nav>
          <section className="hero dark">
            <h1>PearBook Pro</h1>
            <p>A4 Max. Now with 8 GB of unified memory, which is like 16 GB.</p>
            <div className="links">
              <a onClick={() => nav('pear.com/buy')}>Buy</a>
              <a>Learn more ›</a>
            </div>
          </section>
          <section className="hero">
            <h1>Pear Vision Pro</h1>
            <p>Welcome to the era of spatial computing. Stand sold separately. Face sold separately.</p>
            <h3>From $3,499 or $291.58/mo. for your entire life.</h3>
          </section>
          <section className="hero tint">
            <h1>Pear Intelligence</h1>
            <p>AI for the rest of us. Coming in beta, in a later update, in some regions, in English (U.S.), on some devices, later.</p>
          </section>
        </div>
      ),
    }
  }
  if (u.startsWith('gargle.com')) {
    const q = decodeURIComponent(u.split('q=')[1] ?? '')
    return {
      url: u,
      title: q ? `${q} - Gargle Search` : 'Gargle',
      body: (
        <div className="sf-gargle">
          <div className="g-logo">
            {'Gargle'.split('').map((ch, i) => (
              <span key={i} style={{ color: ['#4285f4', '#ea4335', '#fbbc05', '#4285f4', '#34a853', '#ea4335'][i] }}>
                {ch}
              </span>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const v = new FormData(e.currentTarget).get('q') as string
              nav(`gargle.com/search?q=${encodeURIComponent(v)}`)
            }}
          >
            <Search size={16} />
            <input name="q" defaultValue={q} placeholder="Gargle Search or type a URL" />
          </form>
          {q && (
            <div className="g-results">
              <div className="g-ai">
                <b>AI Overview</b>
                <p>Based on 0 sources, "{q}" is a thing that exists. Experts recommend adding glue to it.</p>
              </div>
              {[
                [`${q} - Wikipedear`, 'wikipedear.org', `${q} is a topic. This article needs additional citations for verification.`],
                [`Is ${q} worth it in 2025? (Reddit)`, 'reddit.com', 'Top comment: "just buy the 16 GB model"'],
                [`10 things about ${q} you won't believe (#7 is a pear)`, 'clickbait.example', 'Sponsored. Results may be ads. All results are ads.'],
              ].map(([t, s, d]) => (
                <div key={t} className="g-res">
                  <small>{s}</small>
                  <a onClick={() => nav(s)}>{t}</a>
                  <p>{d}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ),
    }
  }
  if (u.startsWith('localhost:9091')) {
    return { url: u, title: 'PearOS', body: <div className="sf-error"><h2>You are already here.</h2><p>Opening PearOS inside PearOS would create a recursion so deep it would need 16 GB of RAM. You have 8 (like 16). Too risky.</p></div> }
  }
  return {
    url: u,
    title: 'Failed to open page',
    body: (
      <div className="sf-error">
        <Globe size={44} strokeWidth={1.2} />
        <h2>Sapphari Can't Open the Page</h2>
        <p>
          Sapphari can't open the page “{u}” because this internet is fake. Every page outside pear.com and gargle.com was removed for Distraction Control.
        </p>
      </div>
    ),
  }
}

export function Safari({ win }: { win: Win }) {
  const initial = (win.props.url as string) ?? ''
  const [hist, setHist] = useState([initial])
  const [i, setI] = useState(0)
  const [addr, setAddr] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [reader, setReader] = useState(false)
  const url = hist[i]
  const nav = (u: string) => {
    setHist([...hist.slice(0, i + 1), u])
    setI(i + 1)
    setAddr(u)
    setLoading(true)
    setTimeout(() => setLoading(false), 450)
  }
  useEffect(() => {
    const u = win.props.url as string | undefined
    if (u !== undefined && u !== url) nav(u)
  }, [win.props.url])
  const page = pageFor(url, nav)
  useEffect(() => {
    os().setTitle(win.id, page.title)
  }, [page.title])
  return (
    <div className="safari">
      <div className="sf-toolbar" data-drag>
        <div className="nav-btns">
          <button disabled={i === 0} onClick={() => (setI(i - 1), setAddr(hist[i - 1]))} aria-label="Back">
            <ChevronLeft size={18} />
          </button>
          <button disabled={i === hist.length - 1} onClick={() => (setI(i + 1), setAddr(hist[i + 1]))} aria-label="Forward">
            <ChevronRight size={18} />
          </button>
        </div>
        <form
          className="sf-addr"
          onSubmit={(e) => {
            e.preventDefault()
            const v = addr.trim()
            nav(/\s/.test(v) || !v.includes('.') ? `gargle.com/search?q=${encodeURIComponent(v)}` : v)
          }}
        >
          {url && <Lock size={11} className="lock" />}
          <input value={addr} onChange={(e) => setAddr(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Search or enter website name" />
          <button type="button" className={`reader ${reader ? 'on' : ''}`} onClick={() => setReader(!reader)} aria-label="Distraction Control">
            <BookOpen size={13} />
          </button>
          <button type="button" onClick={() => nav(url)} aria-label="Reload">
            <RotateCw size={12} />
          </button>
          {loading && <span className="sf-progress" />}
        </form>
        <div className="nav-btns">
          <button aria-label="Share">
            <Share size={15} />
          </button>
          <button onClick={() => nav('')} aria-label="New tab">
            <Plus size={17} />
          </button>
        </div>
      </div>
      <div
        className={`sf-page ${reader ? 'distraction-free' : ''}`}
        onContextMenu={menu([
          { label: 'Back', disabled: i === 0, run: () => (setI(i - 1), setAddr(hist[i - 1])) },
          { label: 'Forward', disabled: i === hist.length - 1, run: () => (setI(i + 1), setAddr(hist[i + 1])) },
          { label: 'Reload Page', shortcut: '⌘R', run: () => nav(url) },
          'sep',
          { label: reader ? 'Show Distractions' : 'Hide Distracting Items', run: () => setReader(!reader) },
          { label: 'Summarize Page', run: () => os().openApp('intelligence', { props: { ask: `Summarize ${page.title}` } }) },
          'sep',
          { label: 'Save As…', run: () => os().notify({ app: 'safari', title: 'Sapphari', body: 'Saved as “Untitled (1).webarchive”. Nobody has opened a .webarchive since 2011.' }) },
          { label: 'Print Page…', disabled: true },
          'sep',
          { label: 'Show Page Source', run: () => os().notify({ app: 'safari', title: 'Page Source', body: '<div><div><div><div>It is divs all the way down.</div></div></div></div>' }) },
          { label: 'Inspect Element', run: () => os().notify({ app: 'safari', title: 'Web Inspector', body: 'Enable “Show features for web developers” in Settings › Advanced › Developer › Really Sure?' }) },
        ])}
      >
        {reader ? (
          <div className="sf-error">
            <Check size={40} />
            <h2>Distraction Control</h2>
            <p>We hid every distracting element on this page. That turned out to be all of them.</p>
          </div>
        ) : (
          page.body
        )}
      </div>
    </div>
  )
}

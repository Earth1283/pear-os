import { useId } from 'react'
import type { AppId } from '../apps/ids'
import type { FileKind } from '../lib/fs'

const PEAR_BODY = 'M50 22c-9 0-12.8 8.6-13.8 16.5-1 7.4-12.7 13.8-12.7 31C23.5 85 36 95 50 95s26.5-10 26.5-25.5c0-17.2-11.7-23.6-12.7-31C62.8 30.6 59 22 50 22z'
const PEAR_LEAF = 'M53 20c2-8 9-13 18-13-1 9-8 15-18 13z'
const PEAR_STEM = 'M49.5 23c.2-5-1-9-3.5-12'

export function PearLogo({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path d={PEAR_BODY} fill={color} />
      <path d={PEAR_LEAF} fill={color} />
      <path d={PEAR_STEM} stroke={color} strokeWidth="4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function gearPath(cx: number, cy: number, rOuter: number, rInner: number, teeth: number) {
  const pts: string[] = []
  const step = (Math.PI * 2) / teeth
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    const corners = [a - step * 0.25, a - step * 0.12, a + step * 0.12, a + step * 0.25]
    const radii = [rInner, rOuter, rOuter, rInner]
    corners.forEach((c, k) => pts.push(`${(cx + Math.cos(c) * radii[k]).toFixed(2)},${(cy + Math.sin(c) * radii[k]).toFixed(2)}`))
  }
  return 'M' + pts.join('L') + 'Z'
}

const GEAR_BIG = gearPath(50, 50, 36, 30, 28)
const GEAR_MID = gearPath(50, 50, 22, 18, 14)

function Squircle({ fill, stroke }: { fill: string; stroke?: string }) {
  return <rect x="7" y="7" width="86" height="86" rx="20" fill={fill} stroke={stroke ?? 'rgba(0,0,0,.08)'} strokeWidth=".6" />
}

export function AppIcon({ app, size = 52 }: { app: AppId; size?: number }) {
  const uid = useId().replace(/:/g, '')
  const g = (n: string) => `${uid}${n}`
  const u = (n: string) => `url(#${g(n)})`
  let body: React.ReactNode

  switch (app) {
    case 'finder':
      body = (
        <>
          <defs>
            <linearGradient id={g('l')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5fc8ff" />
              <stop offset="1" stopColor="#1572f0" />
            </linearGradient>
            <linearGradient id={g('r')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f4f8fc" />
              <stop offset="1" stopColor="#c9d8ea" />
            </linearGradient>
            <clipPath id={g('c')}>
              <rect x="7" y="7" width="86" height="86" rx="20" />
            </clipPath>
          </defs>
          <g clipPath={u('c')}>
            <rect x="0" y="0" width="100" height="100" fill={u('r')} />
            <path d="M0 0H56C50 20 46 38 47 56H54C52 70 54 84 58 100H0Z" fill={u('l')} />
          </g>
          <rect x="33" y="31" width="5" height="15" rx="2.5" fill="#0d2a4f" />
          <rect x="63" y="31" width="5" height="15" rx="2.5" fill="#0d2a4f" />
          <path d="M27 64c14 9 32 9 46 0" stroke="#0d2a4f" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M57 4c2-5 7-8 12-8-.6 6-6 9-12 8z" fill="#7cc243" transform="translate(-6 8)" />
        </>
      )
      break
    case 'chess':
      body = (
        <>
          <defs>
            <clipPath id={g('c')}>
              <rect x="7" y="7" width="86" height="86" rx="20" />
            </clipPath>
            <linearGradient id={g('p')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#d9d3c7" />
            </linearGradient>
          </defs>
          <g clipPath={u('c')}>
            {Array.from({ length: 36 }, (_, i) => {
              const x = i % 6
              const y = Math.floor(i / 6)
              return <rect key={i} x={7 + x * 14.34} y={7 + y * 14.34} width="14.4" height="14.4" fill={(x + y) % 2 ? '#a66b3d' : '#f0dcb3'} />
            })}
          </g>
          <rect x="7" y="7" width="86" height="86" rx="20" fill="none" stroke="rgba(0,0,0,.14)" strokeWidth=".8" />
          <ellipse cx="50" cy="80" rx="22" ry="3.6" fill="rgba(0,0,0,.28)" />
          <path
            d="M50 22a10 10 0 0 1 5.6 18.3c4.6 2.6 8.2 8 8.4 16.2.1 4.4 1.6 8 6 11.5H30c4.4-3.5 5.9-7.1 6-11.5.2-8.2 3.8-13.6 8.4-16.2A10 10 0 0 1 50 22Z"
            fill={u('p')}
            stroke="#2c2118"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <rect x="27" y="68" width="46" height="8" rx="4" fill={u('p')} stroke="#2c2118" strokeWidth="2.4" />
        </>
      )
      break
    case 'bootcamp':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#d7dae1" />
              <stop offset="1" stopColor="#8b919e" />
            </linearGradient>
          </defs>
          <Squircle fill={u('b')} />
          <rect x="22" y="38" width="56" height="30" rx="5" fill="#2c2f36" />
          <rect x="22" y="58" width="56" height="10" rx="0" fill="#000" opacity=".25" />
          <circle cx="69" cy="63" r="2.2" fill="#30d158" />
          <path d="M50 38v20" stroke="#8b919e" strokeWidth="2" strokeDasharray="3 2" />
          <g transform="translate(26 42)">
            <path d="M0 1l8-1.6v7L0 8z" fill="#f25022" />
            <path d="M9 -.2l8-1.6v7L9 6.8z" fill="#7fba00" transform="translate(0 0)" />
            <path d="M0 9.4l8-1.6v7l-8 1.6z" fill="#00a4ef" />
            <path d="M9 7.6l8-1.6v7l-8 1.6z" fill="#ffb900" />
          </g>
          <g transform="translate(55 42) scale(.26)">
            <path d={PEAR_BODY} fill="#e8e8ec" transform="translate(-24 -20)" />
            <path d={PEAR_LEAF} fill="#e8e8ec" transform="translate(-24 -20)" />
          </g>
          <path d="M30 76h40" stroke="#fff" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
        </>
      )
      break
    case 'music':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ff5f7e" />
              <stop offset="1" stopColor="#e5143c" />
            </linearGradient>
          </defs>
          <Squircle fill={u('b')} />
          <path d="M40 30.5l28-6.5v38.5" stroke="#fff" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" fill="none" />
          <path d="M40 30.5V66" stroke="#fff" strokeWidth="5" strokeLinecap="round" fill="none" />
          <ellipse cx="33" cy="67" rx="8.5" ry="7" fill="#fff" />
          <ellipse cx="61" cy="63" rx="8.5" ry="7" fill="#fff" />
          <path d="M40 30.5l28-6.5v10l-28 6.5z" fill="#fff" />
        </>
      )
      break
    case 'launchpad':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#c9ced8" />
              <stop offset="1" stopColor="#8d94a3" />
            </linearGradient>
          </defs>
          <Squircle fill={u('b')} />
          {['#ff5f57', '#ffbd2e', '#28c840', '#0a84ff', '#bf5af2', '#ff9f0a', '#64d2ff', '#ff375f', '#30d158'].map((c, i) => (
            <rect key={i} x={23 + (i % 3) * 19} y={23 + Math.floor(i / 3) * 19} width="14" height="14" rx="4" fill={c} />
          ))}
        </>
      )
      break
    case 'safari':
      body = (
        <>
          <defs>
            <radialGradient id={g('b')} cx=".5" cy=".4" r=".6">
              <stop offset="0" stopColor="#5ee0ff" />
              <stop offset="1" stopColor="#1463e6" />
            </radialGradient>
          </defs>
          <Squircle fill="#fbfbfd" />
          <circle cx="50" cy="50" r="35" fill={u('b')} />
          {Array.from({ length: 48 }, (_, i) => {
            const a = (i / 48) * Math.PI * 2
            const r1 = i % 4 === 0 ? 27 : 30
            return <line key={i} x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1} x2={50 + Math.cos(a) * 33} y2={50 + Math.sin(a) * 33} stroke="#fff" strokeWidth={i % 4 === 0 ? 1.4 : 0.7} opacity=".85" />
          })}
          <path d="M50 50L72 28L54 54Z" fill="#ff3b30" />
          <path d="M50 50L28 72L46 46Z" fill="#fff" />
          <circle cx="50" cy="50" r="2.5" fill="#d0d0d0" />
        </>
      )
      break
    case 'notes':
      body = (
        <>
          <defs>
            <linearGradient id={g('y')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffe066" />
              <stop offset="1" stopColor="#f6c90e" />
            </linearGradient>
            <clipPath id={g('c')}>
              <rect x="7" y="7" width="86" height="86" rx="20" />
            </clipPath>
          </defs>
          <Squircle fill="#fdfdfb" />
          <g clipPath={u('c')}>
            <rect x="0" y="0" width="100" height="30" fill={u('y')} />
            <line x1="7" y1="30" x2="93" y2="30" stroke="#e2b400" strokeWidth="1" />
          </g>
          {[44, 56, 68, 80].map((y) => (
            <line key={y} x1="18" y1={y} x2="82" y2={y} stroke="#d4d4d8" strokeWidth="1.6" />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <circle key={i} cx={18 + i * 8} cy="30" r="1.1" fill="#b98f00" />
          ))}
        </>
      )
      break
    case 'textedit':
      body = (
        <>
          <Squircle fill="#e9e6df" />
          <rect x="24" y="16" width="52" height="68" rx="3" fill="#fff" stroke="#cfcac0" />
          {[28, 36, 44, 52, 60, 68].map((y, i) => (
            <line key={y} x1="31" y1={y} x2={i % 2 ? 62 : 69} y2={y} stroke="#b9b4aa" strokeWidth="1.8" strokeLinecap="round" />
          ))}
          <g transform="rotate(38 66 58)">
            <rect x="62" y="22" width="9" height="52" rx="2" fill="#2f6fe0" />
            <rect x="62" y="22" width="9" height="8" rx="2" fill="#f0a3b4" />
            <path d="M62 74l4.5 10 4.5-10z" fill="#e8d3a8" />
            <path d="M65 80.5l1.5 3.5 1.5-3.5z" fill="#333" />
          </g>
        </>
      )
      break
    case 'calculator':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4a4a4f" />
              <stop offset="1" stopColor="#1c1c1e" />
            </linearGradient>
          </defs>
          <Squircle fill={u('b')} />
          {Array.from({ length: 16 }, (_, i) => {
            const col = i % 4
            const row = Math.floor(i / 4)
            const fill = col === 3 ? '#ff9f0a' : row === 0 ? '#a5a5aa' : '#6b6b70'
            return <circle key={i} cx={24 + col * 17.3} cy={26 + row * 16.5} r="6.6" fill={fill} />
          })}
        </>
      )
      break
    case 'terminal':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a3a3c" />
              <stop offset="1" stopColor="#111113" />
            </linearGradient>
          </defs>
          <Squircle fill="#d7d7db" />
          <rect x="13" y="16" width="74" height="68" rx="8" fill={u('b')} />
          <path d="M23 34l12 8-12 8" stroke="#f5f5f7" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <line x1="40" y1="52" x2="54" y2="52" stroke="#f5f5f7" strokeWidth="4.2" strokeLinecap="round" />
        </>
      )
      break
    case 'intelligence': {
      const colors = ['#ff9f0a', '#ff375f', '#bf5af2', '#5e5ce6', '#0a84ff', '#64d2ff', '#ff9f0a']
      body = (
        <>
          <defs>
            <filter id={g('blur')} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
            <radialGradient id={g('bg')} cx=".5" cy=".5" r=".7">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#ece9f6" />
            </radialGradient>
          </defs>
          <Squircle fill={u('bg')} />
          <g filter={u('blur')}>
            {colors.slice(0, 6).map((c, i) => {
              const a0 = (i / 6) * Math.PI * 2
              const a1 = ((i + 1) / 6) * Math.PI * 2
              const r = 25
              return (
                <path
                  key={i}
                  d={`M${50 + Math.cos(a0) * r} ${50 + Math.sin(a0) * r}A${r} ${r} 0 0 1 ${50 + Math.cos(a1) * r} ${50 + Math.sin(a1) * r}`}
                  stroke={c}
                  strokeWidth="11"
                  fill="none"
                  strokeLinecap="round"
                />
              )
            })}
          </g>
          <circle cx="50" cy="50" r="14" fill="#fff" opacity=".9" />
        </>
      )
      break
    }
    case 'passwords':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4fb4ff" />
              <stop offset="1" stopColor="#1458d6" />
            </linearGradient>
          </defs>
          <Squircle fill={u('b')} />
          <circle cx="50" cy="35" r="15" fill="none" stroke="#fff" strokeWidth="7" />
          <path d="M46.5 48h7v28l-3.5 5-3.5-5v-4h-4v-5h4v-3h-4v-5h4z" fill="#fff" />
        </>
      )
      break
    case 'mirroring':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#3f8cff" />
              <stop offset="1" stopColor="#1b3fbf" />
            </linearGradient>
            <linearGradient id={g('s')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffb86b" />
              <stop offset=".5" stopColor="#ff5e9a" />
              <stop offset="1" stopColor="#7a5cff" />
            </linearGradient>
          </defs>
          <Squircle fill={u('b')} />
          <rect x="34" y="18" width="32" height="64" rx="7" fill="#0b0b10" />
          <rect x="36.5" y="20.5" width="27" height="59" rx="5" fill={u('s')} />
          <rect x="45" y="23" width="10" height="3.2" rx="1.6" fill="#0b0b10" />
        </>
      )
      break
    case 'activity':
      body = (
        <>
          <Squircle fill="#e8e8ec" />
          <rect x="14" y="20" width="72" height="56" rx="5" fill="#141416" />
          {[32, 44, 56, 68].map((y) => (
            <line key={y} x1="16" y1={y} x2="84" y2={y} stroke="#2b3a2b" strokeWidth=".7" />
          ))}
          <path d="M16 56L28 56L33 40L40 66L47 30L54 60L60 48L66 52L72 36L78 56L84 56" stroke="#3cf06e" strokeWidth="2.6" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <rect x="14" y="78" width="72" height="5" rx="2.5" fill="#b8b8bf" />
        </>
      )
      break
    case 'fractals':
      body = (
        <>
          <defs>
            <radialGradient id={g('glow')} cx=".55" cy=".5" r=".5">
              <stop offset="0" stopColor="#7c6cff" />
              <stop offset=".6" stopColor="#2a1f6e" />
              <stop offset="1" stopColor="#0a0a1a" />
            </radialGradient>
          </defs>
          <Squircle fill={u('glow')} />
          <path
            d="M70 50c0-11-9-20-20-20-6 0-10 2-13 5 3 2 4 6 4 9 0 2-1 4-2 6 1 2 2 4 2 6 0 3-1 7-4 9 3 3 7 5 13 5 11 0 20-9 20-20z"
            fill="#05050c"
            stroke="#9ad7ff"
            strokeWidth="1.2"
          />
          <circle cx="31.5" cy="50" r="7" fill="#05050c" stroke="#9ad7ff" strokeWidth="1.2" />
          <circle cx="22" cy="50" r="2.5" fill="#05050c" stroke="#9ad7ff" strokeWidth="1" />
          <circle cx="50" cy="27.5" r="3" fill="#05050c" stroke="#ff9ad5" strokeWidth="1" />
          <circle cx="50" cy="72.5" r="3" fill="#05050c" stroke="#ff9ad5" strokeWidth="1" />
        </>
      )
      break
    case 'settings':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e2e2e6" />
              <stop offset="1" stopColor="#9a9aa2" />
            </linearGradient>
            <linearGradient id={g('gear')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8e8e96" />
              <stop offset="1" stopColor="#4a4a52" />
            </linearGradient>
          </defs>
          <Squircle fill={u('b')} />
          <path d={GEAR_BIG} fill={u('gear')} />
          <circle cx="50" cy="50" r="26" fill="#d9d9de" />
          <path d={GEAR_MID} fill="#6c6c74" />
          <circle cx="50" cy="50" r="7" fill="#d9d9de" />
          {[0, 1, 2].map((i) => (
            <rect key={i} x="48.5" y="28" width="3" height="16" rx="1.5" fill="#6c6c74" transform={`rotate(${i * 120} 50 50)`} />
          ))}
        </>
      )
      break
    case 'trash':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#c7ccd4" stopOpacity=".9" />
              <stop offset=".5" stopColor="#f2f4f7" stopOpacity=".95" />
              <stop offset="1" stopColor="#b9bec7" stopOpacity=".9" />
            </linearGradient>
          </defs>
          <path d="M24 26h52l-5 64c0 2-2 4-4 4H33c-2 0-4-2-4-4z" fill={u('b')} stroke="#9aa1ab" strokeWidth="1" />
          <ellipse cx="50" cy="26" rx="27" ry="5" fill="#dfe3e8" stroke="#9aa1ab" />
          {[35, 42.5, 50, 57.5, 65].map((x) => (
            <line key={x} x1={x} y1="34" x2={x + (x - 50) * -0.05} y2="88" stroke="#a5acb6" strokeWidth="1.4" />
          ))}
        </>
      )
      break
    case 'preview':
      body = (
        <>
          <defs>
            <linearGradient id={g('bg')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fdfdfd" />
              <stop offset="1" stopColor="#dcdde2" />
            </linearGradient>
            <linearGradient id={g('sky')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5ab8ff" />
              <stop offset="1" stopColor="#bfe6ff" />
            </linearGradient>
            <linearGradient id={g('glass')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".75" />
              <stop offset="1" stopColor="#bde3ff" stopOpacity=".25" />
            </linearGradient>
            <clipPath id={g('photo')}>
              <rect x="22" y="24" width="50" height="40" rx="2" />
            </clipPath>
          </defs>
          <Squircle fill={u('bg')} />
          <g transform="rotate(-8 50 50)">
            <rect x="24" y="30" width="54" height="44" rx="3" fill="#fff" stroke="rgba(0,0,0,.12)" strokeWidth=".6" />
          </g>
          <rect x="19" y="21" width="56" height="46" rx="3" fill="#fff" stroke="rgba(0,0,0,.14)" strokeWidth=".6" />
          <g clipPath={u('photo')}>
            <rect x="22" y="24" width="50" height="40" fill={u('sky')} />
            <circle cx="60" cy="34" r="5" fill="#ffe066" />
            <path d="M22 64 L38 42 L48 54 L56 46 L72 64Z" fill="#3fa14a" />
            <path d="M22 64 L38 42 L43 48 L30 64Z" fill="#2f7f3a" />
          </g>
          <path d="M66 70 L80 84" stroke="#3a3a3c" strokeWidth="7" strokeLinecap="round" />
          <path d="M66 70 L80 84" stroke="#6e6e73" strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="58" cy="62" r="14" fill={u('glass')} stroke="#48484a" strokeWidth="3.6" />
          <path d="M50 56a10 10 0 0 1 9-4" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" opacity=".9" />
        </>
      )
      break
    case 'photobooth':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e0353f" />
              <stop offset="1" stopColor="#8e0b1d" />
            </linearGradient>
            <linearGradient id={g('fold')} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#000" stopOpacity=".28" />
              <stop offset=".5" stopColor="#fff" stopOpacity=".14" />
              <stop offset="1" stopColor="#000" stopOpacity=".28" />
            </linearGradient>
            <clipPath id={g('c')}>
              <rect x="7" y="7" width="86" height="86" rx="20" />
            </clipPath>
          </defs>
          <Squircle fill={u('b')} />
          <g clipPath={u('c')}>
            {[7, 21, 35, 49, 63, 77].map((x) => (
              <rect key={x} x={x} y="7" width="14" height="86" fill={u('fold')} />
            ))}
            <path d="M7 7h86v10c-14 6-29 6-43 0S21 11 7 17z" fill="#6d0614" />
          </g>
          <g transform="rotate(-7 50 56)">
            <rect x="35" y="22" width="30" height="66" rx="2" fill="#fff" />
            {[25, 46, 67].map((y, i) => (
              <g key={y}>
                <rect x="38" y={y} width="24" height="18" fill={['#79c7ff', '#ffd27a', '#a3e48f'][i]} />
                <circle cx="46" cy={y + 7} r="1.4" fill="#222" />
                <circle cx="54" cy={y + 7} r="1.4" fill="#222" />
                <path d={`M45 ${y + 11.5}q5 ${i === 1 ? -3 : 4} 10 0`} stroke="#222" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              </g>
            ))}
          </g>
        </>
      )
      break
    case 'mail':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4fc3ff" />
              <stop offset="1" stopColor="#0a6cf0" />
            </linearGradient>
            <linearGradient id={g('e')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#dfe8f3" />
            </linearGradient>
          </defs>
          <Squircle fill={u('b')} />
          <rect x="20" y="30" width="60" height="42" rx="5" fill={u('e')} />
          <path d="M21 32l29 22 29-22" stroke="#9fb3c9" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
          <path d="M21 70l20-17M79 70L59 53" stroke="#c4d2e1" strokeWidth="2" />
        </>
      )
      break
    case 'diskutility':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f4f4f6" />
              <stop offset="1" stopColor="#c3c5cc" />
            </linearGradient>
            <radialGradient id={g('p')} cx=".4" cy=".35" r=".8">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset=".55" stopColor="#bcc2cc" />
              <stop offset="1" stopColor="#7d8591" />
            </radialGradient>
          </defs>
          <Squircle fill={u('b')} />
          <rect x="18" y="20" width="64" height="60" rx="6" fill="#3a3d44" />
          <circle cx="46" cy="50" r="23" fill={u('p')} />
          <circle cx="46" cy="50" r="4" fill="#3a3d44" />
          <path d="M71 26L52 52" stroke="#e8e8ea" strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="71" cy="26" r="4" fill="#e8e8ea" />
          <path d="M28 82c0-10 8-12 14-6s14 6 16-6" stroke="#ff453a" strokeWidth="4" fill="none" strokeLinecap="round" />
          <circle cx="58" cy="68" r="5" fill="#d0d3d9" stroke="#8a8f99" strokeWidth="1.5" />
        </>
      )
      break
    case 'softwareupdate':
      body = (
        <>
          <defs>
            <linearGradient id={g('b')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5b5d66" />
              <stop offset="1" stopColor="#2a2b31" />
            </linearGradient>
          </defs>
          <Squircle fill={u('b')} />
          <path d={GEAR_BIG} fill="#8e9099" />
          <circle cx="50" cy="50" r="22" fill="#3a3c43" />
          <path d="M37 52a13 13 0 0 1 22-11" stroke="#30d158" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M63 48a13 13 0 0 1-22 11" stroke="#30d158" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M60 32l1 10-10-1z" fill="#30d158" />
          <path d="M40 68l-1-10 10 1z" fill="#30d158" />
        </>
      )
      break
    case 'about':
    default:
      body = (
        <>
          <Squircle fill="#1c1c1e" />
          <g transform="translate(18 16) scale(.64)">
            <path d={PEAR_BODY} fill="#9bd14b" />
            <path d={PEAR_LEAF} fill="#5aa72f" />
            <path d={PEAR_STEM} stroke="#8b5a2b" strokeWidth="4" strokeLinecap="round" fill="none" />
          </g>
        </>
      )
  }

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="app-icon" aria-hidden>
      {body}
      {app !== 'trash' && (
        <>
          <defs>
            <linearGradient id={g('gloss')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".28" />
              <stop offset=".5" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity=".08" />
            </linearGradient>
          </defs>
          <rect x="7" y="7" width="86" height="86" rx="20" fill={u('gloss')} pointerEvents="none" />
          <rect x="7.4" y="7.4" width="85.2" height="85.2" rx="19.6" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth=".8" />
        </>
      )}
    </svg>
  )
}

export function IntelOrb({ size = 16 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  const colors = ['#ff9f0a', '#ff375f', '#bf5af2', '#5e5ce6', '#0a84ff', '#64d2ff']
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <defs>
        <filter id={`${uid}b`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation=".6" />
        </filter>
      </defs>
      <g filter={`url(#${uid}b)`}>
        {colors.map((c, i) => {
          const a0 = (i / 6) * Math.PI * 2
          const a1 = ((i + 1) / 6) * Math.PI * 2
          return <path key={i} d={`M${10 + Math.cos(a0) * 6.5} ${10 + Math.sin(a0) * 6.5}A6.5 6.5 0 0 1 ${10 + Math.cos(a1) * 6.5} ${10 + Math.sin(a1) * 6.5}`} stroke={c} strokeWidth="3.2" fill="none" />
        })}
      </g>
    </svg>
  )
}

function mix(hex: string, to: string, t: number) {
  const n = (h: string) => {
    const x = h.length === 4 ? h.replace(/\w/g, '$&$&').slice(1) : h.slice(1)
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16))
  }
  const [a, b] = [n(hex), n(to)]
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

export function FolderIcon({ size = 64, tint = '#3fa0f5' }: { size?: number; tint?: string }) {
  const uid = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id={`${uid}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(tint, '#000', 0.12)} />
          <stop offset="1" stopColor={mix(tint, '#000', 0.4)} />
        </linearGradient>
        <linearGradient id={`${uid}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(tint, '#fff', 0.5)} />
          <stop offset=".55" stopColor={mix(tint, '#fff', 0.12)} />
          <stop offset="1" stopColor={mix(tint, '#000', 0.08)} />
        </linearGradient>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".28" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M8 22a6 6 0 0 1 6-6h21c2.4 0 3.7.8 5.3 2.6l2.9 3.4H86a6 6 0 0 1 6 6v50a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z" fill={`url(#${uid}b)`} />
      <rect x="13" y="29" width="74" height="30" rx="2.5" fill="#e8e8ee" />
      <rect x="15" y="32" width="70" height="30" rx="2.5" fill="#fff" />
      <path d="M8 40a6 6 0 0 1 6-6h72a6 6 0 0 1 6 6v40a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z" fill={`url(#${uid}f)`} />
      <rect x="8" y="34" width="84" height="8" rx="6" fill={`url(#${uid}s)`} opacity=".5" />
      <path d="M14.5 34.6h71" stroke="#fff" strokeOpacity=".7" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8.6 78.5v1.5a6 6 0 0 0 6 6h70.8a6 6 0 0 0 6-6v-1.5" fill="none" stroke={mix(tint, '#000', 0.35)} strokeOpacity=".35" strokeWidth="1" />
    </svg>
  )
}

const KIND_COLOR: Record<FileKind, string> = {
  text: '#8e8e93',
  image: '#34c759',
  archive: '#a2845e',
  audio: '#ff2d55',
  video: '#5856d6',
  app: '#0a84ff',
  disk: '#636366',
  binary: '#ff9f0a',
}

function FileGlyph({ kind, color }: { kind: FileKind; color: string }) {
  switch (kind) {
    case 'image':
      return (
        <>
          <rect x="27" y="33" width="46" height="34" rx="3.5" fill="#d6ecff" />
          <circle cx="60" cy="42.5" r="4.5" fill="#ffd60a" />
          <path d="M27 67l13-17c1-1.4 3-1.4 4 0l7 9 5-6c1-1.2 2.8-1.2 3.8 0L73 67z" fill="#34c759" />
          <path d="M27 67l13-17c1-1.4 3-1.4 4 0l5 6.5L40 67z" fill="#248a3d" opacity=".55" />
        </>
      )
    case 'text':
      return (
        <>
          {[34, 42, 50, 58, 66].map((y, i) => (
            <rect key={y} x="28" y={y} width={i === 4 ? 26 : 44} height="3.2" rx="1.6" fill="#c7c7cc" />
          ))}
        </>
      )
    case 'audio':
      return (
        <>
          <path d="M43 36l22-5v32l-22 5z" fill={color} opacity=".18" />
          <path d="M44 37l21-5v6.5l-21 5z" fill={color} />
          <rect x="42" y="37" width="3.2" height="26" fill={color} />
          <rect x="63" y="32" width="3.2" height="26" fill={color} />
          <ellipse cx="38.5" cy="63" rx="6.5" ry="4.8" fill={color} transform="rotate(-18 38.5 63)" />
          <ellipse cx="59.5" cy="58" rx="6.5" ry="4.8" fill={color} transform="rotate(-18 59.5 58)" />
        </>
      )
    case 'video':
      return (
        <>
          <rect x="26" y="34" width="48" height="33" rx="5" fill={color} />
          {[0, 1, 2, 3].map((i) => (
            <g key={i} fill="#fff" opacity=".55">
              <rect x={30 + i * 11.5} y="37" width="5" height="3.5" rx="1" />
              <rect x={30 + i * 11.5} y="60.5" width="5" height="3.5" rx="1" />
            </g>
          ))}
          <path d="M45 45l12 5.5-12 5.5z" fill="#fff" />
        </>
      )
    case 'archive':
      return (
        <>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <rect key={i} x={i % 2 ? 49 : 45} y={10 + i * 5.5} width="6" height="3.2" rx="1" fill={color} opacity={i < 6 ? 0.9 : 0.55} />
          ))}
          <rect x="43" y="52" width="14" height="14" rx="3.5" fill={color} />
          <rect x="47.5" y="56" width="5" height="6" rx="1.5" fill="#fff" opacity=".85" />
        </>
      )
    case 'app':
      return (
        <>
          <rect x="29" y="30" width="42" height="38" rx="9" fill={color} />
          <g transform="translate(35.6 32.2) scale(.28)" fill="#fff">
            <path d={PEAR_BODY} />
            <path d={PEAR_LEAF} />
          </g>
        </>
      )
    default:
      return (
        <>
          <rect x="27" y="33" width="46" height="34" rx="4" fill={color} opacity=".16" />
          <text x="50" y="47" textAnchor="middle" fontSize="11" fontWeight="700" fill={color} fontFamily="ui-monospace, Menlo, monospace">
            0110
          </text>
          <text x="50" y="62" textAnchor="middle" fontSize="11" fontWeight="700" fill={color} fontFamily="ui-monospace, Menlo, monospace">
            1001
          </text>
        </>
      )
  }
}

export function FileIcon({ size = 64, kind, ext }: { size?: number; kind: FileKind; ext: string }) {
  const uid = useId().replace(/:/g, '')
  if (kind === 'disk') return <DiskIcon size={size} />
  const color = KIND_COLOR[kind]
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id={`${uid}p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e9e9ee" />
        </linearGradient>
        <linearGradient id={`${uid}c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6f6f9" />
          <stop offset="1" stopColor="#c9c9d1" />
        </linearGradient>
        <linearGradient id={`${uid}k`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(color, '#fff', 0.18)} />
          <stop offset="1" stopColor={mix(color, '#000', 0.18)} />
        </linearGradient>
      </defs>
      <path d="M22 6h39l21 21v61c0 3.3-2.7 6-6 6H22c-3.3 0-6-2.7-6-6V12c0-3.3 2.7-6 6-6z" fill={`url(#${uid}p)`} stroke="#c4c4cc" strokeWidth="1" />
      <path d="M61 6v15c0 3.3 2.7 6 6 6h15z" fill={`url(#${uid}c)`} stroke="#c4c4cc" strokeWidth="1" strokeLinejoin="round" />
      <FileGlyph kind={kind} color={color} />
      <rect x="21" y="73" width="56" height="14" rx="4" fill={`url(#${uid}k)`} />
      <text x="49" y="83.2" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="Inter, system-ui, sans-serif" letterSpacing=".4">
        {ext.slice(0, 5).toUpperCase()}
      </text>
    </svg>
  )
}

export function DiskIcon({ size = 64 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id={`${uid}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbfbfd" />
          <stop offset="1" stopColor="#c4c4cb" />
        </linearGradient>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a4a4ac" />
          <stop offset="1" stopColor="#6c6c74" />
        </linearGradient>
        <radialGradient id={`${uid}l`}>
          <stop offset="0" stopColor="#b6ffc8" />
          <stop offset=".45" stopColor="#30d158" />
          <stop offset="1" stopColor="#30d158" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M9 44l7-14c1-2 3-3 5-3h58c2 0 4 1 5 3l7 14z" fill={`url(#${uid}t)`} stroke="#9d9da5" strokeWidth="1" strokeLinejoin="round" />
      <path d="M9 44h82v22c0 3.3-2.7 6-6 6H15c-3.3 0-6-2.7-6-6z" fill={`url(#${uid}s)`} stroke="#5c5c64" strokeWidth="1" />
      <path d="M10 44.7h80" stroke="#fff" strokeOpacity=".55" strokeWidth="1.2" />
      <g transform="translate(14.5 46.8) scale(.21)" fill="#d8d8de" fillOpacity=".95">
        <path d={PEAR_BODY} />
        <path d={PEAR_LEAF} />
      </g>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={54 + i * 5} y="54" width="2.4" height="11" rx="1.2" fill="#3f3f46" opacity=".7" />
      ))}
      <circle cx="82" cy="59.5" r="6" fill={`url(#${uid}l)`} />
      <circle cx="82" cy="59.5" r="2" fill="#30d158" />
    </svg>
  )
}

export function LaptopArt({ size = 160 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 160 112" aria-hidden>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e3a8a" />
          <stop offset=".5" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <rect x="22" y="6" width="116" height="80" rx="6" fill="#2c2c2e" />
      <rect x="27" y="11" width="106" height="70" rx="2" fill={`url(#${uid}s)`} />
      <rect x="70" y="11" width="20" height="4" rx="2" fill="#2c2c2e" />
      <path d="M6 90h148l-6 10c-1 2-3 3-5 3H17c-2 0-4-1-5-3z" fill="#c7c7cc" />
      <rect x="66" y="90" width="28" height="3" rx="1.5" fill="#9e9ea3" />
    </svg>
  )
}

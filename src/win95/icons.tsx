import type { ReactNode } from 'react'
import type { IconName } from './store'

const K = '#000'
const G = '#808080'
const L = '#c0c0c0'
const W = '#fff'

const ART: Record<IconName, ReactNode> = {
  computer: (
    <>
      <rect x="3" y="3" width="26" height="19" fill={L} stroke={K} />
      <rect x="5" y="5" width="22" height="14" fill="#008080" stroke={G} />
      <path d="M7 8h6M7 11h4" stroke="#9ff" />
      <rect x="11" y="22" width="10" height="2" fill={G} />
      <rect x="4" y="24" width="24" height="5" fill={L} stroke={K} />
      <rect x="7" y="26" width="8" height="1" fill={G} />
      <rect x="23" y="26" width="2" height="1" fill="#0f0" />
    </>
  ),
  folder: (
    <>
      <path d="M2 8h10l2 3h16v17H2z" fill="#ffff80" stroke={K} />
      <path d="M3 12h26" stroke={W} />
      <path d="M2 28h28V11" stroke={G} fill="none" />
    </>
  ),
  folderOpen: (
    <>
      <path d="M2 7h9l2 3h13v6H2z" fill="#ffff80" stroke={K} />
      <path d="M2 28l5-12h24l-5 12z" fill="#ffff80" stroke={K} />
    </>
  ),
  drive: (
    <>
      <rect x="2" y="12" width="28" height="12" fill={L} stroke={K} />
      <path d="M3 13h26" stroke={W} />
      <rect x="5" y="19" width="14" height="2" fill={G} />
      <rect x="23" y="19" width="3" height="2" fill="#0f0" stroke={K} />
      <path d="M2 24v3h28v-3" fill={G} stroke={K} />
    </>
  ),
  floppy: (
    <>
      <path d="M4 3h21l4 4v22H4z" fill="#303a8c" stroke={K} />
      <rect x="9" y="3" width="13" height="9" fill={L} stroke={K} />
      <rect x="17" y="5" width="3" height="5" fill={K} />
      <rect x="8" y="17" width="16" height="12" fill={W} stroke={G} />
      <path d="M10 21h12M10 24h12" stroke="#f33" />
    </>
  ),
  cdrom: (
    <>
      <circle cx="16" cy="16" r="13" fill="#d8e4f0" stroke={K} />
      <circle cx="16" cy="16" r="5" fill={L} stroke={G} />
      <circle cx="16" cy="16" r="2" fill={K} />
      <path d="M8 9a10 10 0 0 1 8-3" stroke={W} strokeWidth="2" fill="none" />
    </>
  ),
  recycle: (
    <>
      <path d="M7 9h18l-2 19H9z" fill="#b8c8c8" stroke={K} />
      <path d="M5 7h22v3H5z" fill={L} stroke={K} />
      <path d="M12 12l1 14M16 12v14M20 12l-1 14" stroke={G} />
      <path d="M13 3h6l1 4h-8z" fill="#2a2" stroke={K} />
    </>
  ),
  recycleFull: (
    <>
      <path d="M7 9h18l-2 19H9z" fill="#b8c8c8" stroke={K} />
      <path d="M5 7h22v3H5z" fill={L} stroke={K} />
      <path d="M10 8l3-5 4 4 3-4 3 5z" fill={W} stroke={K} />
      <path d="M12 13l1 13M16 13v13M20 13l-1 13" stroke={G} />
    </>
  ),
  notepad: (
    <>
      <rect x="5" y="4" width="22" height="25" fill={W} stroke={K} />
      <rect x="5" y="4" width="22" height="5" fill="#00a" stroke={K} />
      <path d="M9 13h14M9 17h14M9 21h10" stroke="#55a" />
      <path d="M8 2v5M13 2v5M18 2v5M23 2v5" stroke={K} strokeWidth="2" />
    </>
  ),
  mines: (
    <>
      <rect x="2" y="2" width="28" height="28" fill={L} stroke={G} />
      <circle cx="16" cy="17" r="7" fill={K} />
      <path d="M16 6v22M5 17h22M8 9l16 16M24 9L8 25" stroke={K} strokeWidth="2" />
      <rect x="12" y="13" width="3" height="3" fill={W} />
    </>
  ),
  paint: (
    <>
      <path d="M6 8c-5 5-4 16 6 19 6 2 11-2 9-6-2-3-6 0-6-4 0-3 6-2 9-4 5-3-2-11-18-5z" fill="#f0d8a0" stroke={K} />
      <circle cx="11" cy="13" r="2" fill="#e22" />
      <circle cx="16" cy="10" r="2" fill="#2a2" />
      <circle cx="21" cy="12" r="2" fill="#22e" />
      <circle cx="10" cy="19" r="2" fill="#ee2" />
    </>
  ),
  dos: (
    <>
      <rect x="2" y="4" width="28" height="24" fill={K} stroke={G} />
      <rect x="2" y="4" width="28" height="4" fill={L} />
      <path d="M5 12l4 3-4 3M12 19h6" stroke={W} fill="none" />
    </>
  ),
  globe: (
    <>
      <circle cx="16" cy="16" r="13" fill="#3a7bd5" stroke={K} />
      <path d="M8 9c4-3 8 0 7 4-1 3 3 4 2 8-3 1-6-1-7-4-1-3-4-5-2-8zM21 12c3 0 5 3 4 6-3 0-4-3-4-6z" fill="#3c3" />
      <path d="M5 16h22M16 3c-6 7-6 19 0 26M16 3c6 7 6 19 0 26" stroke={W} fill="none" />
    </>
  ),
  doc: (
    <>
      <path d="M6 2h14l7 7v21H6z" fill={W} stroke={K} />
      <path d="M20 2v7h7" fill={L} stroke={K} />
      <path d="M10 14h13M10 18h13M10 22h13M10 26h8" stroke={G} />
    </>
  ),
  exe: (
    <>
      <rect x="3" y="5" width="26" height="22" fill={W} stroke={K} />
      <rect x="3" y="5" width="26" height="5" fill="#00a" stroke={K} />
      <rect x="6" y="13" width="9" height="10" fill="#f33" />
      <rect x="17" y="13" width="9" height="10" fill="#3a3" />
    </>
  ),
  dll: (
    <>
      <path d="M6 2h14l7 7v21H6z" fill={L} stroke={K} />
      <circle cx="16" cy="19" r="5" fill={G} stroke={K} />
      <circle cx="16" cy="19" r="2" fill={L} />
      <path d="M16 11v3M16 24v3M8 19h3M21 19h3" stroke={K} strokeWidth="2" />
    </>
  ),
  control: (
    <>
      <rect x="2" y="6" width="28" height="22" fill={L} stroke={K} />
      <rect x="2" y="6" width="28" height="4" fill="#00a" />
      <circle cx="10" cy="19" r="4" fill="#f33" stroke={K} />
      <rect x="18" y="14" width="9" height="3" fill="#3a3" stroke={K} />
      <rect x="18" y="20" width="9" height="3" fill="#33f" stroke={K} />
    </>
  ),
  display: (
    <>
      <rect x="2" y="3" width="28" height="20" fill={L} stroke={K} />
      <rect x="5" y="6" width="22" height="14" fill="#08f" stroke={G} />
      <path d="M5 20l8-8 6 5 4-4 4 7z" fill="#2a2" />
      <rect x="11" y="23" width="10" height="2" fill={G} />
      <rect x="6" y="25" width="20" height="4" fill={L} stroke={K} />
    </>
  ),
  system: (
    <>
      <rect x="3" y="4" width="26" height="18" fill={L} stroke={K} />
      <rect x="6" y="7" width="20" height="12" fill={W} stroke={G} />
      <path d="M8 10h16M8 13h10M8 16h14" stroke="#00a" />
      <rect x="6" y="24" width="20" height="5" fill={L} stroke={K} />
    </>
  ),
  hardware: (
    <>
      <rect x="3" y="9" width="26" height="14" fill="#2a7" stroke={K} />
      <path d="M6 23v5M10 23v5M14 23v5M18 23v5M22 23v5M26 23v5" stroke="#dc3" strokeWidth="2" />
      <rect x="7" y="12" width="8" height="8" fill={K} />
      <rect x="19" y="12" width="6" height="3" fill={G} />
    </>
  ),
  flag: (
    <>
      <path d="M3 6c4-2 8-1 12 1v9c-4-2-8-3-12-1z" fill="#f33" stroke={K} />
      <path d="M17 7c4 1 8 1 12-1v9c-4 2-8 2-12 1z" fill="#3b3" stroke={K} />
      <path d="M3 18c4-2 8-1 12 1v9c-4-2-8-3-12-1z" fill="#38f" stroke={K} />
      <path d="M17 19c4 1 8 1 12-1v9c-4 2-8 2-12 1z" fill="#fc0" stroke={K} />
    </>
  ),
  help: (
    <>
      <path d="M4 5h22v18H14l-6 6v-6H4z" fill="#ffff80" stroke={K} />
      <text x="15" y="19" textAnchor="middle" fontSize="15" fontWeight="700" fill="#00a" fontFamily="Arial, sans-serif" stroke="none">
        ?
      </text>
    </>
  ),
  run: (
    <>
      <rect x="2" y="6" width="28" height="20" fill={L} stroke={K} />
      <rect x="2" y="6" width="28" height="4" fill="#00a" />
      <path d="M8 18h10" stroke={K} strokeWidth="2" />
      <path d="M17 13l7 5-7 5z" fill="#2a2" stroke={K} />
    </>
  ),
  find: (
    <>
      <path d="M3 5h12l2 3h12v16H3z" fill="#ffff80" stroke={K} />
      <circle cx="19" cy="19" r="6" fill="#bff" stroke={K} strokeWidth="2" />
      <path d="M23 23l6 6" stroke={K} strokeWidth="3" />
    </>
  ),
  docs: (
    <>
      <path d="M6 3h12l5 5v17H6z" fill={W} stroke={K} />
      <path d="M11 8h12l5 5v17H11z" fill={W} stroke={K} />
      <path d="M15 17h9M15 21h9M15 25h6" stroke={G} />
    </>
  ),
  settings: (
    <>
      <rect x="3" y="4" width="26" height="24" fill={L} stroke={K} />
      <circle cx="16" cy="16" r="6" fill={G} stroke={K} />
      <circle cx="16" cy="16" r="2" fill={W} />
      <path d="M16 6v4M16 22v4M6 16h4M22 16h4" stroke={K} strokeWidth="2" />
    </>
  ),
  programs: (
    <>
      <rect x="2" y="3" width="17" height="14" fill={W} stroke={K} />
      <rect x="2" y="3" width="17" height="3" fill="#00a" />
      <rect x="12" y="13" width="17" height="14" fill={L} stroke={K} />
      <rect x="12" y="13" width="17" height="3" fill="#00a" />
      <rect x="5" y="9" width="6" height="4" fill="#f33" />
      <rect x="15" y="19" width="6" height="4" fill="#3a3" />
    </>
  ),
  shutdown: (
    <>
      <rect x="3" y="4" width="26" height="18" fill={L} stroke={K} />
      <rect x="5" y="6" width="22" height="14" fill={K} />
      <path d="M16 8v6" stroke="#f55" strokeWidth="2" />
      <path d="M11 10a6 6 0 1 0 10 0" stroke="#f55" strokeWidth="2" fill="none" />
      <rect x="6" y="24" width="20" height="5" fill={L} stroke={K} />
    </>
  ),
  warn: (
    <>
      <path d="M16 3l14 25H2z" fill="#ff0" stroke={K} />
      <rect x="15" y="11" width="3" height="9" fill={K} />
      <rect x="15" y="22" width="3" height="3" fill={K} />
    </>
  ),
  error: (
    <>
      <circle cx="16" cy="16" r="13" fill="#e00" stroke={K} />
      <path d="M10 10l12 12M22 10L10 22" stroke={W} strokeWidth="4" />
    </>
  ),
  info: (
    <>
      <circle cx="16" cy="16" r="13" fill="#fff" stroke="#00a" strokeWidth="2" />
      <rect x="14.5" y="14" width="3" height="10" fill="#00a" />
      <rect x="14.5" y="8" width="3" height="3" fill="#00a" />
    </>
  ),
  question: (
    <>
      <circle cx="16" cy="16" r="13" fill="#fff" stroke="#00a" strokeWidth="2" />
      <text x="16" y="23" textAnchor="middle" fontSize="20" fontWeight="700" fill="#00a" fontFamily="Arial, sans-serif" stroke="none">
        ?
      </text>
    </>
  ),
  printer: (
    <>
      <rect x="8" y="3" width="16" height="9" fill={W} stroke={K} />
      <rect x="3" y="11" width="26" height="12" fill={L} stroke={K} />
      <rect x="8" y="19" width="16" height="10" fill={W} stroke={K} />
      <path d="M11 22h10M11 25h10" stroke={G} />
    </>
  ),
  sound: (
    <>
      <path d="M4 12h6l7-6v20l-7-6H4z" fill={L} stroke={K} />
      <path d="M21 11c3 3 3 7 0 10M24 8c5 5 5 11 0 16" stroke={K} fill="none" />
    </>
  ),
  mouse: (
    <>
      <rect x="9" y="3" width="14" height="26" rx="7" fill={L} stroke={K} />
      <path d="M9 14h14M16 3v11" stroke={K} />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="9" width="28" height="15" fill={L} stroke={K} />
      <path d="M5 12h3M10 12h3M15 12h3M20 12h3M25 12h2M5 16h3M10 16h3M15 16h3M20 16h3M25 16h2M8 20h16" stroke={K} strokeWidth="2" />
    </>
  ),
  fonts: (
    <>
      <rect x="4" y="3" width="24" height="26" fill={W} stroke={K} />
      <text x="16" y="23" textAnchor="middle" fontSize="19" fontWeight="700" fill="#00a" fontFamily="Georgia, serif" stroke="none">
        A
      </text>
    </>
  ),
  bulb: (
    <>
      <path d="M16 3a8 8 0 0 0-5 14c1 1 1 3 1 4h8c0-1 0-3 1-4a8 8 0 0 0-5-14z" fill="#ff0" stroke={K} />
      <rect x="12" y="22" width="8" height="3" fill={G} stroke={K} />
      <rect x="13" y="26" width="6" height="2" fill={K} />
    </>
  ),
}

export function Icon({ name, size = 32 }: { name: IconName; size?: number }) {
  return (
    <svg className="w95-ico" width={size} height={size} viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden>
      {ART[name]}
    </svg>
  )
}

// Pixels for the image files on the virtual disk. They ship with no content, so each one gets
// procedurally drawn artwork (an SVG) based on its name. Once Preview saves over one, the real
// encoded image lives in the node's `content` as a data URL and wins.

import type { FileNode } from './fs'

const PEAR_BODY = 'M50 22c-9 0-12.8 8.6-13.8 16.5-1 7.4-12.7 13.8-12.7 31C23.5 85 36 95 50 95s26.5-10 26.5-25.5c0-17.2-11.7-23.6-12.7-31C62.8 30.6 59 22 50 22z'
const PEAR_LEAF = 'M53 20c2-8 9-13 18-13-1 9-8 15-18 13z'

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed: number) {
  let x = seed || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4294967296
  }
}

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

function beachBall(cx: number, cy: number, r: number, turn: number) {
  const colors = ['#36a2ff', '#4cd964', '#ffd60a', '#ff9500', '#ff2d55', '#af52de']
  return colors
    .map((c, i) => {
      const a0 = ((i * 60 + turn) * Math.PI) / 180
      const a1 = (((i + 1) * 60 + turn) * Math.PI) / 180
      return `<path d="M${cx} ${cy}L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}A${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}Z" fill="${c}"/>`
    })
    .join('')
}

function screenshot(name: string) {
  const W = 1920
  const H = 1200
  const late = /\.08\b/.test(name)
  const bands = ['#2b2a8f', '#4b3fc4', '#6b5cf0', '#8f7bff', '#b49cff', '#d9c2ff', '#f3e6ff']
  const waves = bands
    .map((c, i) => {
      const y = 300 + i * 130
      return `<path d="M0 ${y} C ${W * 0.25} ${y - 90}, ${W * 0.55} ${y + 110}, ${W} ${y - 30} V ${H} H 0 Z" fill="${c}" opacity="0.95"/>`
    })
    .join('')
  const win = (x: number, y: number, w: number, h: number, title: string, inner: string) => `
    <g filter="url(#sh)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fbfbfd"/>
      <rect x="${x}" y="${y}" width="${w}" height="56" rx="14" fill="#f1f1f4"/>
      <rect x="${x}" y="${y + 42}" width="${w}" height="14" fill="#f1f1f4"/>
      <circle cx="${x + 26}" cy="${y + 28}" r="8" fill="#ff5f57"/><circle cx="${x + 52}" cy="${y + 28}" r="8" fill="#febc2e"/><circle cx="${x + 78}" cy="${y + 28}" r="8" fill="#28c840"/>
      <text x="${x + w / 2}" y="${y + 35}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" font-weight="700" fill="#3a3a3c">${title}</text>
      ${inner}
    </g>`
  const lines = Array.from({ length: 9 }, (_, i) => `<rect x="300" y="${330 + i * 34}" width="${i % 3 === 2 ? 360 : 560}" height="12" rx="6" fill="#d8d8de"/>`).join('')
  return svg(
    W,
    H,
    `<defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#11103a"/><stop offset="1" stop-color="#3b2d9a"/></linearGradient>
      <filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="18" stdDeviation="24" flood-opacity=".35"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>${waves}
    <rect width="${W}" height="34" fill="rgba(255,255,255,.35)"/>
    <text x="70" y="24" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="700" fill="#111">Finder</text>
    <text x="150" y="24" font-family="Helvetica, Arial, sans-serif" font-size="17" fill="#111">File   Edit   View   Go   Window   Help</text>
    <text x="${W - 30}" y="24" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="17" fill="#111">Tue Sep 16  9:41 AM</text>
    ${win(240, 240, 900, 560, 'Untitled.txt — Not Responding', lines)}
    ${win(1000, 430, 640, 400, 'Activity Monitor', `<text x="1320" y="660" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#8e8e93">kernel_task: 340% CPU</text>`)}
    <g transform="translate(${late ? 1012 : 986} ${late ? 622 : 610})">${beachBall(0, 0, 34, late ? 30 : 0)}<circle r="34" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/></g>
    <rect x="${W / 2 - 420}" y="${H - 100}" width="840" height="84" rx="24" fill="rgba(255,255,255,.28)" stroke="rgba(255,255,255,.4)"/>
    ${Array.from({ length: 11 }, (_, i) => `<rect x="${W / 2 - 400 + i * 74}" y="${H - 90}" width="62" height="62" rx="15" fill="${['#1e90ff', '#ff3b30', '#ffcc00', '#34c759', '#5856d6', '#ff9500', '#8e8e93', '#30b0c7', '#af52de', '#ff2d55', '#636366'][i]}"/>`).join('')}`,
  )
}

function pear() {
  const S = 1600
  return svg(
    S,
    S,
    `<defs>
      <radialGradient id="bg" cx=".3" cy=".25" r="1"><stop offset="0" stop-color="#fff6d8"/><stop offset=".6" stop-color="#ffd98a"/><stop offset="1" stop-color="#f2a65a"/></radialGradient>
      <radialGradient id="skin" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#e4f59a"/><stop offset=".55" stop-color="#a9d14b"/><stop offset="1" stop-color="#5f9a26"/></radialGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="22"/></filter>
    </defs>
    <rect width="${S}" height="${S}" fill="url(#bg)"/>
    <ellipse cx="820" cy="1450" rx="430" ry="70" fill="#7a4a1c" opacity=".28" filter="url(#soft)"/>
    <g transform="translate(160 40) scale(13)">
      <path d="${PEAR_BODY}" fill="url(#skin)"/>
      <path d="${PEAR_LEAF}" fill="#4f8f22"/>
      <path d="M49.5 23c.2-5-1-9-3.5-12" stroke="#7b4a1f" stroke-width="3" stroke-linecap="round" fill="none"/>
      <ellipse cx="40" cy="58" rx="5" ry="11" fill="#fff" opacity=".35" transform="rotate(18 40 58)"/>
      ${Array.from({ length: 26 }, (_, i) => {
        const r = rng(hash('pear' + i))
        return `<circle cx="${32 + r() * 36}" cy="${42 + r() * 46}" r=".45" fill="#6b8f1f" opacity=".5"/>`
      }).join('')}
    </g>`,
  )
}

function sonoma() {
  const W = 2560
  const H = 1440
  const hills = ['#f2b24c', '#e48a3c', '#b76a3a', '#6f8f3c', '#3f6f3a', '#24502f']
  return svg(
    W,
    H,
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6aa9e9"/><stop offset=".55" stop-color="#f7c99b"/><stop offset="1" stop-color="#f59f6b"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    <circle cx="${W * 0.7}" cy="${H * 0.42}" r="120" fill="#fff4d1" opacity=".9"/>
    ${hills
      .map((c, i) => {
        const y = H * 0.45 + i * 150
        return `<path d="M0 ${y} Q ${W * 0.2} ${y - 160 + i * 20} ${W * 0.45} ${y - 30} T ${W} ${y - 80} V ${H} H 0 Z" fill="${c}"/>`
      })
      .join('')}`,
  )
}

function abstract(name: string) {
  const r = rng(hash(name))
  const W = 1600
  const H = 1000
  const hue = Math.floor(r() * 360)
  const blobs = Array.from({ length: 7 }, () => `<circle cx="${r() * W}" cy="${r() * H}" r="${180 + r() * 320}" fill="hsl(${(hue + r() * 120) % 360} 85% ${50 + r() * 20}%)" opacity=".75"/>`).join('')
  return svg(W, H, `<defs><filter id="b"><feGaussianBlur stdDeviation="90"/></filter></defs><rect width="${W}" height="${H}" fill="hsl(${hue} 60% 22%)"/><g filter="url(#b)">${blobs}</g>`)
}

export function sampleSVG(name: string) {
  if (/^screenshot/i.test(name)) return screenshot(name)
  if (/^pear\./i.test(name)) return pear()
  if (/sonoma|wallpaper/i.test(name)) return sonoma()
  return abstract(name)
}

/** A URL an <img> can load for a virtual-disk image node. */
export function nodeImageURL(name: string, node: FileNode) {
  if (node.content?.startsWith('data:')) return node.content
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSVG(name))}`
}

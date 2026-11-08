import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

declare const process: { env: Record<string, string | undefined> }

const backend = process.env.PEAROSD_URL ?? 'http://127.0.0.1:9092'

const git = (args: string) => {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}
const build = {
  sha: process.env.GITHUB_SHA ?? git('rev-parse HEAD'),
  date: git('log -1 --format=%cI'),
  dirty: !process.env.GITHUB_SHA && git('status --porcelain') !== '',
  builtAt: new Date().toISOString(),
}

export default defineConfig({
  plugins: [react()],
  define: { __PEAR_BUILD__: JSON.stringify(build) },
  base: process.env.PEAROS_BASE ?? '/',
  server: {
    host: '0.0.0.0',
    port: 9091,
    strictPort: true,
    allowedHosts: true,
    cors: true,
    proxy: {
      '/api': { target: backend, ws: true, secure: false },
      '/p/': { target: backend, secure: false },
    },
  },
  preview: { host: '0.0.0.0', port: 9091, strictPort: true, allowedHosts: true, cors: true },
})

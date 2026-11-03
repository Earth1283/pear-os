import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }

const backend = process.env.PEAROSD_URL ?? 'http://127.0.0.1:9092'

export default defineConfig({
  plugins: [react()],
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

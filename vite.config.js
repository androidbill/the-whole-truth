import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const appVersion = () =>
  readFileSync(resolve(root, 'src/main.jsx'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1]

// Emits version.json (single source of truth: APP_VERSION in main.jsx) so
// running clients can detect that a newer build was deployed.
const versionJson = () => ({
  name: 'twt-version-json',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ version: appVersion() }),
    })
  },
  // Stamp APP_VERSION into the built sw.js: the browser only installs an
  // updated service worker when the file's bytes change, so the version
  // constant must move with every release.
  closeBundle() {
    const p = resolve(root, 'dist/sw.js')
    try {
      const src = readFileSync(p, 'utf8').replace(
        /const VERSION = '[^']*'/,
        `const VERSION = '${appVersion()}'`
      )
      writeFileSync(p, src)
    } catch {}
  },
  configureServer(server) {
    server.middlewares.use('/version.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({ version: appVersion() }))
    })
  },
})

export default defineConfig({
  // Relative base so the build works at any mount path
  // (githubuser.github.io/the-whole-truth/, Firebase Hosting root, etc.)
  base: './',
  plugins: [react(), versionJson()],
  server: {
    port: 5200,
    host: true,
  },
})

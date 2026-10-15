import { fileURLToPath, URL } from 'node:url'
import * as path from 'node:path'
import * as fs from 'node:fs'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { tsmPlugin } from '@eclipse-daanse/tsm/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface TsmModule {
  folder: string
  entry: string
}

/**
 * Finds the TSM modules: every folder under packages/ with a manifest.json.
 */
function scanTsmModules(): Map<string, TsmModule> {
  const modules = new Map<string, TsmModule>()
  const packagesDir = path.resolve(__dirname, 'packages')
  if (!fs.existsSync(packagesDir)) return modules

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const folder = path.join(packagesDir, entry.name)
    const manifestPath = path.join(folder, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      if (manifest.id) modules.set(manifest.id, { folder, entry: manifest.entry || 'src/index.ts' })
    } catch (e) {
      console.warn(`Failed to parse ${manifestPath}:`, e)
    }
  }
  return modules
}

const tsmModules = scanTsmModules()

/*
 * The libraries the host shares with the modules, with the versions actually
 * installed. The host registers them under these versions (src/main.ts) and
 * TSM checks each module's `sharedDependencies` against them.
 */
const SHARED_LIBRARIES = ['vue', 'primevue', '@emfts/core', '@eclipse-daanse/tsm']
const sharedLibraryVersions: Record<string, string> = Object.fromEntries(
  SHARED_LIBRARIES.map((name) => [
    name,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, 'node_modules', name, 'package.json'), 'utf-8')).version,
  ]),
)

/**
 * Serves the modules as a TSM plugin repository under /plugins.
 *
 * Unlike gene's middleware this keeps the query string when handing a source
 * file to Vite: worker imports arrive as `?worker_file&type=module`, and
 * without the query Vite serves the worker as a plain module.
 */
function serveTsmPlugins(): Plugin {
  return {
    name: 'serve-tsm-plugins',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/plugins')) return next()

        const [urlPath, query] = req.url.split('?', 2)

        if (urlPath === '/plugins' || urlPath === '/plugins/' || urlPath === '/plugins/index.json') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ name: 'ribo modules', version: '1.0.0', modules: [...tsmModules.keys()] }, null, 2))
          return
        }

        const match = urlPath.match(/^\/plugins\/([^/]+)\/?(.*)$/)
        const moduleInfo = match ? tsmModules.get(match[1]) : undefined
        if (!match || !moduleInfo) {
          res.statusCode = 404
          res.end('Not Found')
          return
        }

        const subPath = match[2] || 'manifest.json'
        const requestedPath = path.join(moduleInfo.folder, subPath)
        if (!requestedPath.startsWith(moduleInfo.folder)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        if (!fs.existsSync(requestedPath) || fs.statSync(requestedPath).isDirectory()) {
          res.statusCode = 404
          res.end(`Not Found: ${subPath}`)
          return
        }

        const ext = path.extname(requestedPath).toLowerCase()
        if (ext === '.ts' || ext === '.vue') {
          const relativePath = path.relative(__dirname, requestedPath).replace(/\\/g, '/')
          req.url = '/' + relativePath + (query ? `?${query}` : '')
          return next()
        }

        res.setHeader('Content-Type', ext === '.json' ? 'application/json' : 'application/javascript')
        res.end(fs.readFileSync(requestedPath, 'utf-8'))
      })
    },
  }
}

/**
 * Production build of the modules.
 *
 * Every module becomes an entry of the one build, emitted as
 * plugins/<id>/index.js next to a manifest.json pointing at it, plus the
 * repository index - the same /plugins layout the dev server serves. One
 * build means one copy of vue, @emfts/core and the other shared libraries.
 */
function emitTsmPlugins(): Plugin {
  return {
    name: 'emit-tsm-plugins',
    apply: 'build',
    generateBundle() {
      for (const [moduleId, { folder }] of tsmModules) {
        const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf-8'))
        this.emitFile({
          type: 'asset',
          fileName: `plugins/${moduleId}/manifest.json`,
          source: JSON.stringify({ ...manifest, entry: 'index.js' }, null, 2),
        })
      }
      this.emitFile({
        type: 'asset',
        fileName: 'plugins/index.json',
        source: JSON.stringify({ name: 'ribo modules', version: '1.0.0', modules: [...tsmModules.keys()] }, null, 2),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __SHARED_LIBRARY_VERSIONS__: JSON.stringify(sharedLibraryVersions),
  },
  plugins: [vue(), tsmPlugin({ useRenderChunk: false }), serveTsmPlugins(), emitTsmPlugins()],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      ...[...tsmModules.entries()].map(([moduleId, { folder, entry }]) => ({
        find: new RegExp(`^${moduleId}$`),
        replacement: path.join(folder, entry),
      })),
      // Libraries without a manifest: contracts, geometry, standard parts and the generated model
      { find: /^ribo-contracts\/geometry$/, replacement: fileURLToPath(new URL('./packages/ribo-contracts/src/geometry.ts', import.meta.url)) },
      { find: /^ribo-contracts$/, replacement: fileURLToPath(new URL('./packages/ribo-contracts/src/index.ts', import.meta.url)) },
      { find: /^ribo-geometry$/, replacement: fileURLToPath(new URL('./packages/ribo-geometry/src/index.ts', import.meta.url)) },
      { find: /^ribo-model$/, replacement: fileURLToPath(new URL('./packages/ribo-model/src/index.ts', import.meta.url)) },
      { find: /^ribo-parts$/, replacement: fileURLToPath(new URL('./packages/ribo-parts/src/index.ts', import.meta.url)) },
      // Working against a local @emfts/core checkout: EMFTS_LOCAL=/path/to/emfts
      ...(process.env.EMFTS_LOCAL
        ? [{ find: /^@emfts\/core$/, replacement: path.resolve(process.env.EMFTS_LOCAL, 'dist/index.js') }]
        : []),
    ],
    // One instance each - EPackageRegistry.INSTANCE and eClass identity depend on it
    dedupe: ['vue', '@emfts/core'],
  },
  optimizeDeps: {
    // Pre-bundling @emfts/core creates a second copy and with it a second
    // EPackageRegistry.INSTANCE. OpenCascade and PlaneGCS are Emscripten
    // modules that locate their .wasm themselves and must not be rewritten.
    exclude: ['@emfts/core', 'replicad-opencascadejs', '@salusoft89/planegcs'],
    // sax is a CJS dep of @emfts/core that must be pre-bundled for ESM compat
    include: ['sax'],
  },
  worker: {
    format: 'es',
  },
  build: {
    modulePreload: false,
    target: 'esnext',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ...Object.fromEntries([...tsmModules.entries()].map(([moduleId, { folder, entry }]) => [`plugins/${moduleId}/index`, path.join(folder, entry)])),
      },
      // Module entries are loaded by TSM, which calls their activate/deactivate exports
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: (chunk) => (chunk.name.startsWith('plugins/') ? '[name].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
})

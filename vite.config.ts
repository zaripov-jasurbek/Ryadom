import { svelte } from '@sveltejs/vite-plugin-svelte'
import { createReadStream, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const [owner, repo] = process.env.GITHUB_REPOSITORY?.split('/') ?? []
const isUserSite = Boolean(owner && repo === owner + '.github.io')
const base = process.env.NODE_ENV === 'production' && repo && !isUserSite ? '/' + repo + '/' : '/'

/**
 * Receipt OCR runs entirely in the browser, so Tesseract's worker, WASM core and language models
 * are served from the app itself instead of a CDN: in dev from node_modules, in the build as files under tesseract/.
 */
function tesseractAssets(): Plugin {
  const require = createRequire(import.meta.url)
  const pkg = (name: string) => dirname(require.resolve(`${name}/package.json`))
  const files: Record<string, string> = {
    'tesseract/worker.min.js': join(pkg('tesseract.js'), 'dist/worker.min.js'),
    // OEM.LSTM_ONLY loads one of the *-lstm cores depending on the browser's SIMD support.
    ...Object.fromEntries(['', '-simd', '-relaxedsimd'].map(variant => {
      const file = `tesseract-core${variant}-lstm.wasm.js`
      return [`tesseract/core/${file}`, join(pkg('tesseract.js-core'), file)]
    })),
    ...Object.fromEntries(['rus', 'uzb'].map(lang => [`tesseract/lang/${lang}.traineddata.gz`, join(pkg(`@tesseract.js-data/${lang}`), `4.0.0_best_int/${lang}.traineddata.gz`)])),
  }
  let root = '/'
  return {
    name: 'tesseract-assets',
    configResolved(config) { root = config.base },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        const source = path.startsWith(root) ? files[path.slice(root.length)] : undefined
        if (!source) return next()
        // The .gz models are decompressed by Tesseract itself, so no Content-Encoding header.
        res.setHeader('Content-Type', source.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        createReadStream(source).pipe(res)
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source: readFileSync(source) })
    },
  }
}

export default defineConfig({
  plugins: [svelte(), tesseractAssets()],
  base,
})

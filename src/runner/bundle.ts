import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import type { Plugin } from 'vite'

export function browserRunnerBundle(): Plugin {
  const id = 'virtual:pairprep-runner'
  return {
    name: 'pairprep-browser-runner',
    resolveId(source) {
      if (source === id) return '\0' + id
    },
    async load(source) {
      if (source !== '\0' + id) return
      const entry = fileURLToPath(new URL('./worker.ts', import.meta.url))
      this.addWatchFile(entry)
      const { outputFiles } = await build({
        entryPoints: [entry], bundle: true, write: false, platform: 'browser',
        target: 'es2022', format: 'esm', minify: true,
        loader: { '.wasm': 'binary' },
        define: { process: 'undefined', 'import.meta.url': 'self.location.href' },
        external: ['node:*', 'fs', 'path', 'url', 'module'],
        plugins: [{
          name: 'micropython-without-global-bridge',
          setup(build) {
            build.onLoad({ filter: /micropython\.mjs$/ }, async ({ path }) => {
              const source = await readFile(path, 'utf8')
              const bridge = 'globalThis.proxy_js_ref=[globalThis,void 0]'
              if (source.split(bridge).length !== 2) {
                throw new Error('MicroPython JS bridge changed. Review isolation before upgrading.')
              }
              // MicroPython's native js module resolves properties from this
              // first reference. Replacing it also covers unload/re-import.
              return {
                contents: source.replace(bridge, 'globalThis.proxy_js_ref=[Object.freeze(Object.create(null)),void 0]'),
                loader: 'js',
              }
            })
          },
        }],
      })
      // Chromium rejects an opaque-origin blob module worker. Keep module
      // initialization in an async scope but load the bundle as a classic worker.
      return `export default ${JSON.stringify(`(async () => {\n${outputFiles[0].text}\n})();`)}`
    },
  }
}

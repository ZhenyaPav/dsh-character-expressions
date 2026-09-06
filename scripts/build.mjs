import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

await mkdir('dist', { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['@deepseek-ai/*', '@huggingface/transformers', 'adm-zip'],
})

const client = await build({
  entryPoints: ['src/client.tsx'],
  write: false,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['@deepseek-ai/*', 'react', 'react-dom'],
})
const body = client.outputFiles[0].text
const wrapped = `window.__ModuleLoader__.load({id:"dsh-deep-tavern",factory(require,exports,module){\n${body}\n}});\n`
await writeFile('dist/client.js', wrapped)

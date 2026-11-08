import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const harness = resolve(process.env.DSH_SOURCE ?? resolve(root, '../deepseek-harness'))
const output = resolve(root, `.session-record-check-${randomUUID()}.mjs`)
try {
  await build({
    stdin: { resolveDir: root, contents: `
      import assert from 'node:assert/strict'
      import { Readable } from 'node:stream'
      import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
      import { apply } from './src/index.ts'
      const header = { version: SESSION_FORMAT_VERSION, id: 'expression-check', createdAt: 1, isSeeded: false, delegationDepth: 0 }
      const session = Session.create(header.id, undefined, header)
      let route, status, response
      let admission = { peer: { principal: { kind: 'owner' } } }
      apply({ connection: { admit: () => admission }, sessions: { get: () => session }, on() {}, logger: { warn() {} },
        webServer: { register(value) { route = value.handler } } },
        { enabled: false, modelId: 'unused-offline-check', rerollSameExpression: true })
      const request = Readable.from([Buffer.from(JSON.stringify({ sessionId: session.id, label: 'joy' }))])
      request.headers = {}
      request.method = 'POST'
      request.url = '/deep-tavern/api/manual-expression'
      await route(request, { writeHead(value) { status = value }, end(value) { response = value } })
      assert.equal(status, 200, response)
      const event = session.snapshotEvents()[0]
      assert.equal(event.type, 'plugin:deep-tavern/expression')
      assert.equal(event.ignorable, true)
      assert.deepEqual(event.data, { label: 'joy', origin: 'manual' })
      const saved = JSON.parse(JSON.stringify(session.snapshotEvents()))
      const restored = Session.create('expression-restored', saved, { ...header, id: 'expression-restored', isSeeded: true }, saved.length)
      assert.deepEqual(restored.snapshotEvents().slice(0, saved.length), saved)
      const post = async (path, body) => {
        const req = Readable.from([Buffer.from(JSON.stringify(body))])
        Object.assign(req, { headers: {}, method: 'POST', url: '/deep-tavern/api/' + path })
        await route(req, { writeHead(value) { status = value }, end(value) { response = value } })
        return JSON.parse(response)
      }
      for (const action of ['upload', 'zip']) {
        for (const size of [20 * 1024 * 1024 + 1, 50 * 1024 * 1024]) {
          const started = await post('upload/start', { workspace: '/unused', action, size,
            name: 'joy.png', mediaType: 'image/png', label: 'joy' })
          assert.equal(status, 201, JSON.stringify(started))
          assert.equal(started.chunkBytes, 512 * 1024)
          await post('upload/cancel', { id: started.uploadId })
          assert.equal(status, 200)
        }
        const rejected = await post('upload/start', { workspace: '/unused', action, size: 50 * 1024 * 1024 + 1 })
        assert.equal(status, 400)
        assert.equal(rejected.error, 'Upload exceeds the 50 MB limit')
      }
      for (const denied of [{ rejection: 401 }, { rejection: 403 }, { peer: { principal: { kind: 'guest' } } }]) {
        admission = denied
        await route(request, { writeHead(value) { status = value }, end(value) { response = value } })
        assert.equal(status, 403)
        assert.equal(session.snapshotEvents().length, 1, 'Denied action must not write to the Session')
      }
      console.log('Passed: 50 MiB upload boundary, owner-only expression HTTP action, native ignorable plugin record, and saved Session replay.')
    ` },
    outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    tsconfig: resolve(harness, 'tsconfig.base.json'), external: ['adm-zip', '@huggingface/transformers'],
    plugins: [{ name: 'source-resource-urls', setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
        contents: (await readFile(path, 'utf8')).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path).href)), loader: 'ts',
      }))
    } }],
  })
  const result = spawnSync(process.execPath, [output], { cwd: root, stdio: 'inherit', timeout: 30000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Expression record check failed (${result.status})`)
} finally { await rm(output, { force: true }) }

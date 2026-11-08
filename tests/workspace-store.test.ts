import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { WorkspaceExpressionStore } from '../src/workspace-store.ts'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('sprites accept exactly 50 MiB and reject one byte more', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'deep-tavern-upload-limit-'))
  try {
    const bytes = Buffer.alloc(50 * 1024 * 1024 + 1)
    PNG.copy(bytes)
    const store = new WorkspaceExpressionStore()
    const pack = await store.add(workspace, 'joy', 'joy.png', 'image/png', bytes.subarray(0, -1))
    assert.equal((await store.asset(workspace, pack.sprites.joy![0]!.id))!.bytes.length, bytes.length - 1)
    await assert.rejects(store.add(workspace, 'joy', 'joy.png', 'image/png', bytes), /50 MB limit/)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('workspace pack persists opaque assets below the hidden DSH directory', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'deep-tavern-workspace-'))
  const store = new WorkspaceExpressionStore()
  const pack = await store.add(workspace, 'joy', 'smile.png', 'image/png', PNG)
  const sprite = pack.sprites.joy?.[0]
  assert.ok(sprite)
  assert.match(sprite.file, /^sprites\/[0-9a-f-]+\.png$/)
  assert.deepEqual(await store.asset(workspace, sprite.id), { bytes: PNG, mediaType: 'image/png' })
  const manifest = JSON.parse(await readFile(join(workspace, '.dsh', 'character-expressions', 'manifest.json'), 'utf8'))
  assert.equal(manifest.version, 1)
})

test('stored manifest cannot escape the expression directory', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'deep-tavern-workspace-'))
  const store = new WorkspaceExpressionStore()
  await assert.rejects(store.add(workspace, 'joy', 'x.svg', 'image/svg+xml', Buffer.from('svg')), /Unsupported image type/)
})

test('declared image MIME type must match its bytes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'deep-tavern-workspace-'))
  await assert.rejects(new WorkspaceExpressionStore().add(workspace, 'joy', 'x.png', 'image/png', Buffer.from('not-an-image')), /do not match/)
})

test('flat ZIP imports preserve SillyTavern-style label naming', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'deep-tavern-workspace-'))
  const archive = new AdmZip()
  archive.addFile('joy-2.png', PNG)
  const store = new WorkspaceExpressionStore()
  const pack = await store.importZip(workspace, archive.toBuffer())
  assert.equal(pack.sprites.joy?.length, 1)
})

test('nested ZIP entries are rejected before writing a pack', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'deep-tavern-workspace-'))
  const archive = new AdmZip()
  archive.addFile('nested/joy.png', Buffer.from('fixture'))
  await assert.rejects(new WorkspaceExpressionStore().importZip(workspace, archive.toBuffer()), /flat structure/)
})

test('clear removes every workspace expression override', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'deep-tavern-workspace-'))
  const store = new WorkspaceExpressionStore()
  await store.add(workspace, 'joy', 'joy.png', 'image/png', PNG)
  assert.deepEqual(await store.clear(workspace), { version: 1, fallback: null, sprites: {} })
  assert.deepEqual(await store.read(workspace), { version: 1, fallback: null, sprites: {} })
})

test('removing the last fallback sprite clears the fallback selection', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'deep-tavern-workspace-'))
  const store = new WorkspaceExpressionStore()
  const pack = await store.add(workspace, 'joy', 'joy.png', 'image/png', PNG)
  await store.fallback(workspace, 'joy')
  const next = await store.remove(workspace, pack.sprites.joy![0]!.id)
  assert.equal(next.fallback, null)
})

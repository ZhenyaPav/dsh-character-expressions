/** Node host entry for the Deep Tavern bundle. No model dependency reaches the browser entry. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { appendPluginRecord, type Session } from '@deepseek-ai/dsh-session'
import { DEFAULT_MODEL, EmotionClassifier } from './classifier.ts'
import { GO_EMOTIONS, chooseSprite, isExpressionLabel, type ExpressionLabel } from './expressions.ts'
import { WorkspaceExpressionStore } from './workspace-store.ts'

export const name = 'deep-tavern'
export const inject = ['sessions', 'webServer', 'connection']

export interface Config {
  enabled: boolean
  modelId: string
  rerollSameExpression: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  modelId: z.string().default(DEFAULT_MODEL),
  rerollSameExpression: z.boolean().default(true),
})

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** The expression selected after a settled assistant response or by the portrait picker. */
    'plugin:deep-tavern/expression': {
      messageSeq?: number
      label: ExpressionLabel
      score?: number
      spriteId?: string
      origin: 'automatic' | 'manual'
    }
  }
}

function visibleAssistantText(event: any): string {
  if (event.type !== 'assistant/message') return ''
  const content = event.data?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text)
    .join('')
    .trim()
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function requestBytes(req: IncomingMessage, limit: number, tooLarge = 'Request body is too large'): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? Number.NaN)
  if (Number.isFinite(declared) && declared > limit) throw new Error(tooLarge)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) {
      req.resume()
      throw new Error(tooLarge)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, size)
}

async function requestJson(req: IncomingMessage): Promise<any> {
  return JSON.parse((await requestBytes(req, 64 * 1024)).toString('utf8'))
}

function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://localhost').searchParams
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing ${field}`)
  return value
}

/**
 * Mount backend classification and the localhost-only asset management API.
 * All model initialization and inference stay in Node; the client only receives
 * labels, manifests, and image bytes served from its selected workspace.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new WorkspaceExpressionStore()
  const classifier = new EmotionClassifier(config.modelId, join(homedir(), '.dsh', 'models', 'deep-tavern'))
  const previousSprites = new Map<string, { label: ExpressionLabel; id: string }>()
  const uploads = new Map<string, {
    workspace: string
    action: 'upload' | 'zip'
    label?: ExpressionLabel
    name: string
    mediaType: string
    size: number
    received: number
    updatedAt: number
    chunks: Buffer[]
  }>()
  const uploadChunkBytes = 512 * 1024
  const maxUploadBytes = 50 * 1024 * 1024
  const maxStagedBytes = 64 * 1024 * 1024
  const expireUploads = (): void => {
    const cutoff = Date.now() - 10 * 60 * 1000
    for (const [id, upload] of uploads) if (upload.updatedAt < cutoff) uploads.delete(id)
  }
  const uploadFor = (id: string): NonNullable<ReturnType<typeof uploads.get>> => {
    expireUploads()
    const upload = uploads.get(id)
    if (upload === undefined) throw new Error('Upload is unavailable or expired')
    return upload
  }
  if (config.enabled) void classifier.warm().catch(error => ctx.logger.warn(`[deep-tavern] classifier unavailable: ${String(error)}`))

  ctx.on('session/event', (session: Session, event: any) => {
    if (!config.enabled || event.type !== 'assistant/message') return
    const text = visibleAssistantText(event)
    if (text === '') return
    void classifier.classify(text).then(async result => {
      if (result === undefined) return
      const previous = previousSprites.get(String(session.id))
      const workspace = session.header.cwd
      const sprite = workspace === undefined ? undefined : chooseSprite(
        await store.read(workspace), result.label,
        previous?.label === result.label ? { id: previous.id, file: '', mediaType: '' } : undefined,
        config.rerollSameExpression,
      )
      if (sprite !== undefined) previousSprites.set(String(session.id), { label: result.label, id: sprite.id })
      appendPluginRecord(session, 'plugin:deep-tavern/expression', {
        messageSeq: event.seq,
        label: result.label,
        score: result.score,
        ...(sprite === undefined ? {} : { spriteId: sprite.id }),
        origin: 'automatic',
      })
    }).catch(error => ctx.logger.warn(`[deep-tavern] classification failed: ${String(error)}`))
  })

  ctx.webServer.register({
    kind: 'prefix',
    path: '/deep-tavern',
    handler: async (req, res) => {
      const admission = ctx.connection.admit(req)
      if ('rejection' in admission || admission.peer.principal.kind !== 'owner') {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      try {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        if (pathname === '/deep-tavern/api/status' && req.method === 'GET') {
          sendJson(res, 200, { model: config.modelId, rerollSameExpression: config.rerollSameExpression, status: classifier.status, labels: GO_EMOTIONS })
          return
        }
        if (pathname === '/deep-tavern/api/retry' && req.method === 'POST') {
          void classifier.retry().catch(error => ctx.logger.warn(`[deep-tavern] retry failed: ${String(error)}`))
          sendJson(res, 202, { status: classifier.status })
          return
        }
        if (pathname === '/deep-tavern/api/pack' && req.method === 'GET') {
          const workspace = requiredText(query(req).get('workspace'), 'workspace')
          sendJson(res, 200, await store.read(workspace))
          return
        }
        if (pathname === '/deep-tavern/assets' && req.method === 'GET') {
          const workspace = requiredText(query(req).get('workspace'), 'workspace')
          const id = requiredText(query(req).get('id'), 'id')
          const asset = await store.asset(workspace, id)
          if (asset === undefined) { res.writeHead(404); res.end(); return }
          res.writeHead(200, { 'content-type': asset.mediaType, 'cache-control': 'private, max-age=300' })
          res.end(asset.bytes)
          return
        }
        if (pathname === '/deep-tavern/api/upload/start' && req.method === 'POST') {
          expireUploads()
          const body = await requestJson(req)
          const workspace = requiredText(body.workspace, 'workspace')
          const action = requiredText(body.action, 'action')
          if (action !== 'upload' && action !== 'zip') throw new Error('Unknown upload action')
          const size = Number(body.size)
          if (!Number.isSafeInteger(size) || size <= 0 || size > maxUploadBytes) throw new Error('Upload exceeds the 50 MB limit')
          if (uploads.size >= 16) throw new Error('Too many uploads are in progress')
          const staged = [...uploads.values()].reduce((total, upload) => total + upload.size, 0)
          if (staged + size > maxStagedBytes) throw new Error('Too many uploads are in progress')
          const label = action === 'upload' ? requiredText(body.label, 'label').toLowerCase() : undefined
          if (label !== undefined && !isExpressionLabel(label)) throw new Error('Unknown expression label')
          const id = randomUUID()
          uploads.set(id, {
            workspace,
            action,
            ...(label === undefined ? {} : { label }),
            name: requiredText(body.name, 'name'),
            mediaType: action === 'upload' ? requiredText(body.mediaType, 'mediaType') : 'application/zip',
            size,
            received: 0,
            updatedAt: Date.now(),
            chunks: [],
          })
          sendJson(res, 201, { uploadId: id, chunkBytes: uploadChunkBytes })
          return
        }
        if (pathname === '/deep-tavern/api/upload/chunk' && req.method === 'POST') {
          const id = requiredText(query(req).get('id'), 'id')
          const upload = uploadFor(id)
          const chunk = await requestBytes(req, uploadChunkBytes, 'Upload chunk is too large')
          if (chunk.length === 0 || upload.received + chunk.length > upload.size) {
            uploads.delete(id)
            throw new Error('Upload size does not match its declaration')
          }
          upload.chunks.push(chunk)
          upload.received += chunk.length
          upload.updatedAt = Date.now()
          sendJson(res, 200, { received: upload.received })
          return
        }
        if (pathname === '/deep-tavern/api/upload/finish' && req.method === 'POST') {
          const id = requiredText((await requestJson(req)).id, 'id')
          const upload = uploadFor(id)
          uploads.delete(id)
          if (upload.received !== upload.size) throw new Error('Upload is incomplete')
          const bytes = Buffer.concat(upload.chunks, upload.received)
          const pack = upload.action === 'zip'
            ? await store.importZip(upload.workspace, bytes)
            : await store.add(upload.workspace, upload.label!, upload.name, upload.mediaType, bytes)
          sendJson(res, 200, pack)
          return
        }
        if (pathname === '/deep-tavern/api/upload/cancel' && req.method === 'POST') {
          uploads.delete(requiredText((await requestJson(req)).id, 'id'))
          sendJson(res, 200, { ok: true })
          return
        }
        if (pathname === '/deep-tavern/api/pack' && req.method === 'POST') {
          const body = await requestJson(req)
          const workspace = requiredText(body.workspace, 'workspace')
          const action = requiredText(body.action, 'action')
          if (action === 'fallback') {
            const label = body.label === null ? null : requiredText(body.label, 'label').toLowerCase()
            if (label !== null && !isExpressionLabel(label)) throw new Error('Unknown expression label')
            sendJson(res, 200, await store.fallback(workspace, label))
            return
          }
          if (action === 'remove') {
            sendJson(res, 200, await store.remove(workspace, requiredText(body.id, 'id')))
            return
          }
          if (action === 'clear') {
            sendJson(res, 200, await store.clear(workspace))
            return
          }
          throw new Error('Unknown pack action')
        }
        if (pathname === '/deep-tavern/api/manual-expression' && req.method === 'POST') {
          const body = await requestJson(req)
          const label = requiredText(body.label, 'label').toLowerCase()
          if (!isExpressionLabel(label)) throw new Error('Unknown expression label')
          const session = ctx.sessions.get(requiredText(body.sessionId, 'sessionId') as never)
          if (session === undefined) throw new Error('Session is unavailable')
          const workspace = session.header.cwd
          const sprite = workspace === undefined ? undefined : chooseSprite(await store.read(workspace), label, undefined, true)
          if (sprite !== undefined) previousSprites.set(String(session.id), { label, id: sprite.id })
          appendPluginRecord(session, 'plugin:deep-tavern/expression', { label, origin: 'manual', ...(sprite === undefined ? {} : { spriteId: sprite.id }) })
          sendJson(res, 200, { ok: true })
          return
        }
        res.writeHead(404); res.end()
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}

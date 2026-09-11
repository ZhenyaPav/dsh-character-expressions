/** Node host entry for the Deep Tavern bundle. No model dependency reaches the browser entry. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { DEFAULT_MODEL, EmotionClassifier } from './classifier.ts'
import { GO_EMOTIONS, chooseSprite, isExpressionLabel, type ExpressionLabel } from './expressions.ts'
import { WorkspaceExpressionStore } from './workspace-store.ts'

export const name = 'deep-tavern'
export const inject = ['sessions', 'webServer']

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
  interface SessionEventMap {
    /** The expression selected after a settled assistant response or by the portrait picker. */
    'deep-tavern/expression': {
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

async function requestJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length > 20 * 1024 * 1024) throw new Error('Request exceeds the 20 MB limit')
  return JSON.parse(raw)
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
      session.append('deep-tavern/expression', {
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
          if (action === 'upload') {
            const label = requiredText(body.label, 'label').toLowerCase()
            if (!isExpressionLabel(label)) throw new Error('Unknown expression label')
            const data = Buffer.from(requiredText(body.data, 'data'), 'base64')
            sendJson(res, 200, await store.add(workspace, label, requiredText(body.name, 'name'), requiredText(body.mediaType, 'mediaType'), data))
            return
          }
          if (action === 'zip') {
            sendJson(res, 200, await store.importZip(workspace, Buffer.from(requiredText(body.data, 'data'), 'base64')))
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
          session.append('deep-tavern/expression', { label, origin: 'manual', ...(sprite === undefined ? {} : { spriteId: sprite.id }) })
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

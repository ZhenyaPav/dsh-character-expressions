import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { GO_EMOTIONS, type ExpressionLabel, type ExpressionPack, type Sprite } from './expressions.ts'
import { installStyles } from './styles.ts'

const CHARACTER_ID = 'dsh-deep-tavern/character'
const CHARACTER_KIND = 'deep-tavern-character'
const EXPRESSIONS_ID = 'dsh-deep-tavern/expressions'
const EXPRESSIONS_KIND = 'deep-tavern-expressions'
const EXPRESSION_TARGET = 'deep-tavern-expression'

interface ExpressionRecord {
  seq: number
  time: number
  label: ExpressionLabel
  spriteId?: string
  origin: 'automatic' | 'manual'
}

interface ExpressionSnapshot {
  expression: ExpressionRecord | undefined
}

const EMPTY: ExpressionSnapshot = { expression: undefined }

function expressionOf(event: any): ExpressionRecord | undefined {
  if (event.type !== 'deep-tavern/expression' && event.type !== 'plugin:deep-tavern/expression') return undefined
  return {
    seq: event.seq,
    time: event.time,
    label: event.data.label,
    origin: event.data.origin,
    ...(event.data.spriteId === undefined ? {} : { spriteId: event.data.spriteId }),
  }
}

/** Expression-only projection shared by the two sidebar tabs. */
const expressionDefinition: any = {
  kind: 'deep-tavern-expression',
  target: EXPRESSION_TARGET,
  match: (event: any) => expressionOf(event) === undefined ? null : { id: String(event.seq), role: 'start' },
  start: (_context: unknown, match: any) => expressionOf(match.event),
  update: (context: any, match: any) => expressionOf(match.event) ?? context.state,
  buildViewNode: (context: any) => context.state === undefined ? null : {
    key: context.key,
    kind: 'deep-tavern-expression',
    id: context.id,
    target: EXPRESSION_TARGET,
    anchorSeq: context.state.seq,
    location: context.start?.location ?? { kind: 'session' },
    visibility: 'visible',
    data: context.state,
  },
}

class ExpressionBuilder {
  readonly empty = EMPTY
  private expression: ExpressionRecord | undefined

  replace(input: any): ExpressionSnapshot {
    this.expression = latestExpression(input.nodes)
    return { expression: this.expression }
  }

  apply(input: any): ExpressionSnapshot {
    const latest = latestExpression(input.upserts)
    if (latest !== undefined && (this.expression === undefined || latest.seq > this.expression.seq)) this.expression = latest
    return { expression: this.expression }
  }
}

function latestExpression(nodes: readonly any[]): ExpressionRecord | undefined {
  let latest: ExpressionRecord | undefined
  for (const node of nodes) {
    const expression = node.data as ExpressionRecord
    if (latest === undefined || expression.seq > latest.seq) latest = expression
  }
  return latest
}

const expressionViewDefinition: any = {
  target: EXPRESSION_TARGET,
  create: () => new ExpressionBuilder(),
  isActive: (snapshot: ExpressionSnapshot) => snapshot.expression !== undefined,
}

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/deep-tavern${path}`, init)
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await api(path, init)
  const value: any = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : `Request failed (${response.status})`)
  return value as T
}

function packPath(workspace: string): string {
  return `${workspace.replace(/[\\/]$/, '')}/.dsh/character-expressions`
}

interface PackState {
  pack: ExpressionPack | undefined
  loading: boolean
  error: string | undefined
  mutate: (body: Record<string, unknown>) => Promise<void>
  upload: (action: 'upload' | 'zip', file: File, label?: ExpressionLabel) => Promise<void>
}

interface PackChange {
  workspace: string
  pack: ExpressionPack
}

function publishPack(workspace: string, pack: ExpressionPack): void {
  window.dispatchEvent(new CustomEvent<PackChange>('deep-tavern-pack-change', {
    detail: { workspace, pack },
  }))
}

async function uploadPackFile(
  workspace: string,
  action: 'upload' | 'zip',
  file: File,
  label?: ExpressionLabel,
): Promise<ExpressionPack> {
  const started = await apiJson<{ uploadId: string; chunkBytes: number }>('/api/upload/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspace, action, label, name: file.name, mediaType: file.type, size: file.size }),
  })
  try {
    if (!Number.isSafeInteger(started.chunkBytes) || started.chunkBytes <= 0) {
      throw new Error('Server returned an invalid upload chunk size')
    }
    for (let offset = 0; offset < file.size; offset += started.chunkBytes) {
      await apiJson(`/api/upload/chunk?id=${encodeURIComponent(started.uploadId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file.slice(offset, offset + started.chunkBytes),
      })
    }
    return await apiJson('/api/upload/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: started.uploadId }),
    })
  } catch (error) {
    void api('/api/upload/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: started.uploadId }),
    })
    throw error
  }
}

function usePack(workspace: string | undefined): PackState {
  const [pack, setPack] = useState<ExpressionPack>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => {
    if (workspace === undefined) {
      setPack(undefined)
      setError(undefined)
      return
    }
    setLoading(true)
    try {
      setPack(await apiJson(`/api/pack?workspace=${encodeURIComponent(workspace)}`))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [workspace])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const onChange = (event: Event) => {
      const change = (event as CustomEvent<PackChange>).detail
      if (change.workspace === workspace) setPack(change.pack)
    }
    window.addEventListener('deep-tavern-pack-change', onChange)
    return () => window.removeEventListener('deep-tavern-pack-change', onChange)
  }, [refresh, workspace])
  const mutate = useCallback(async (body: Record<string, unknown>) => {
    if (workspace === undefined) return
    setLoading(true)
    try {
      const next = await apiJson<ExpressionPack>('/api/pack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, workspace }),
      })
      setPack(next)
      setError(undefined)
      publishPack(workspace, next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [workspace])
  const upload = useCallback(async (action: 'upload' | 'zip', file: File, label?: ExpressionLabel) => {
    if (workspace === undefined) return
    setLoading(true)
    try {
      const next = await uploadPackFile(workspace, action, file, label)
      setPack(next)
      setError(undefined)
      publishPack(workspace, next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [workspace])
  return { pack, loading, error, mutate, upload }
}

function assetUrl(workspace: string | undefined, sprite: Sprite | undefined): string | undefined {
  if (workspace === undefined || sprite === undefined) return undefined
  return `/deep-tavern/assets?workspace=${encodeURIComponent(workspace)}&id=${encodeURIComponent(sprite.id)}`
}

interface WorkspaceInjected {
  workspace?: string
}

interface CharacterInjected extends WorkspaceInjected {
  useExpression: (selector: (snapshot: ExpressionSnapshot) => unknown) => any
}

function CharacterTab({ workspace, useExpression }: CharacterInjected) {
  const expression = useExpression((snapshot: ExpressionSnapshot) => snapshot.expression) as ExpressionRecord | undefined
  const { pack } = usePack(workspace)
  const label = expression?.label
  const candidates = label === undefined || pack === undefined
    ? []
    : (pack.sprites[label]?.length ?? 0) > 0
      ? pack.sprites[label]!
      : pack.fallback === null ? [] : pack.sprites[pack.fallback] ?? []
  const image = candidates.find(sprite => sprite.id === expression?.spriteId) ?? candidates[0]

  return <section className="deepTavernCharacterTab">
    {image !== undefined && <img className="deepTavernPortraitImage" src={assetUrl(workspace, image)} alt={label ?? 'Character portrait'} />}
  </section>
}

function UploadButton({ label, accept, onFile, children, disabled = false }: {
  label: string
  accept: string
  onFile: (file: File) => void
  children: ReactNode
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <button type="button" className="deepTavernButton" disabled={disabled} onClick={() => input.current?.click()} aria-label={label}>
      {children}
    </button>
    <input
      ref={input}
      className="deepTavernFileInput"
      type="file"
      accept={accept}
      disabled={disabled}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file !== undefined) onFile(file)
      }}
    />
  </>
}

function SpriteCard({ label, sprites, workspace, disabled, upload, remove }: {
  label: ExpressionLabel
  sprites: readonly Sprite[]
  workspace?: string
  disabled: boolean
  upload: (label: ExpressionLabel, file: File) => void
  remove: (id: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return <article className="deepTavernSpriteCard">
    <header>
      <strong>{label}</strong>
      <button type="button" className="deepTavernButton" disabled={disabled} onClick={() => input.current?.click()} aria-label={`Upload ${label} sprite`}>+</button>
      <input
        ref={input}
        className="deepTavernFileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file !== undefined) upload(label, file)
        }}
      />
    </header>
    {sprites.length === 0
      ? <button type="button" className="deepTavernEmptySprite" disabled={disabled} onClick={() => input.current?.click()}>No sprite</button>
      : <div className="deepTavernSpriteImages">
        {sprites.map(sprite => <figure key={sprite.id}>
          <img src={assetUrl(workspace, sprite)} alt={`${label} expression`} />
          <button type="button" disabled={disabled} onClick={() => remove(sprite.id)} aria-label={`Remove ${label} sprite`}>×</button>
        </figure>)}
      </div>}
  </article>
}

function ExpressionSettingsTab({ workspace }: WorkspaceInjected) {
  const { pack, loading, error, mutate, upload } = usePack(workspace)
  const [status, setStatus] = useState<any>()
  useEffect(() => {
    void apiJson('/api/status').then(setStatus).catch(cause => setStatus({ status: { state: 'error', message: String(cause) } }))
  }, [])

  const labelsWithSprites = useMemo(
    () => GO_EMOTIONS.filter(label => (pack?.sprites[label]?.length ?? 0) > 0),
    [pack],
  )
  if (workspace === undefined) {
    return <section className="deepTavernExpressionSettings deepTavernEmptyState">
      <h2>Expression Settings</h2>
      <p>Open a workspace session to manage its character expression pack.</p>
    </section>
  }

  const imageCount = Object.values(pack?.sprites ?? {}).flat().length
  return <section className="deepTavernExpressionSettings" aria-busy={loading}>
    <header className="deepTavernSettingsHeader">
      <div>
        <h2>Expression Settings</h2>
        <p>Stored for this character workspace.</p>
      </div>
      {loading && <span className="deepTavernBusy">Saving…</span>}
    </header>

    {error !== undefined && <div className="deepTavernError" role="alert">{error}</div>}

    <section className="deepTavernSettingGroup">
      <label htmlFor="deep-tavern-fallback">Default / Fallback Expression</label>
      <p>Used when the detected expression has no matching sprite.</p>
      <select
        id="deep-tavern-fallback"
        value={pack?.fallback ?? ''}
        disabled={loading || pack === undefined}
        onChange={event => void mutate({ action: 'fallback', label: event.target.value || null })}
      >
        <option value="">No fallback</option>
        {labelsWithSprites.map(label => <option key={label} value={label}>{label}</option>)}
      </select>
    </section>

    <section className="deepTavernSettingGroup">
      <div className="deepTavernSectionTitle">
        <div>
          <h3>Expression Sprites</h3>
          <p>Upload one or more image variants for any classifier expression.</p>
        </div>
        <span>{imageCount} images</span>
      </div>
      <div className="deepTavernPackActions">
        <UploadButton label="Upload expression sprite pack" accept="application/zip,.zip" disabled={loading} onFile={file => void upload('zip', file)}>
          Upload sprite pack (ZIP)
        </UploadButton>
        <button
          type="button"
          className="deepTavernButton deepTavernDanger"
          disabled={loading || imageCount === 0}
          onClick={() => {
            if (window.confirm('Remove every expression image override from this workspace?')) void mutate({ action: 'clear' })
          }}
        >Remove all image overrides</button>
      </div>
      <p className="deepTavernHint">
        ZIP files use a flat structure. Name images <code>expression.png</code>, <code>expression-2.png</code>, or <code>expression.variant.png</code>.
      </p>
      <p className="deepTavernPath"><strong>Sprite set:</strong> {packPath(workspace)}</p>
      <div className="deepTavernSpriteGrid">
        {GO_EMOTIONS.map(label => <SpriteCard
          key={label}
          label={label}
          sprites={pack?.sprites[label] ?? []}
          workspace={workspace}
          disabled={loading}
          upload={(nextLabel, file) => { void upload('upload', file, nextLabel) }}
          remove={id => { void mutate({ action: 'remove', id }) }}
        />)}
      </div>
    </section>

    <section className="deepTavernClassifierStatus">
      <strong>Expression classifier</strong>
      <span>{status?.model ?? 'Loading…'} · {status?.status?.state ?? 'loading'}</span>
      {status?.status?.state === 'error' && <button type="button" className="deepTavernButton" onClick={() => void api('/api/retry', { method: 'POST' })}>Retry model</button>}
    </section>
  </section>
}

function workspaceFor(ctx: any, sessionId: string): string | undefined {
  return ctx.sessions.list.getSnapshot().byId?.[sessionId]?.cwd
}

function tabDefinition(id: string, kind: string, title: string, description: string, order: number): SidebarRightTabDefinition {
  return {
    id,
    kind,
    title: () => title,
    guide: [{ order, title: () => title, description: () => description }],
  }
}

export const inject = ['slots', 'sessions', 'uiConversation', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  installStyles()
  ctx.uiConversation.events.register(expressionDefinition)
  ctx.uiConversation.views.register(expressionViewDefinition)

  ctx.effect(() => ctx.sidebarRightTabs.register(tabDefinition(
    CHARACTER_ID, CHARACTER_KIND, 'Character', 'Live character sprite', 20,
  )), 'deep-tavern: character sidebar type')
  ctx.effect(() => ctx.sidebarRightTabs.register(tabDefinition(
    EXPRESSIONS_ID, EXPRESSIONS_KIND, 'Expressions', 'Workspace expression sprite settings', 21,
  )), 'deep-tavern: expression settings sidebar type')

  const workspaceInjected = (sessionId: string): WorkspaceInjected => ({
    workspace: workspaceFor(ctx, sessionId),
  })
  const characterInjected = (sessionId: string): any => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`deep-tavern: unknown session "${sessionId}"`)
    const target = ctx.uiConversation.binding(binding).target(EXPRESSION_TARGET as never) as any
    return {
      ...workspaceInjected(sessionId),
      hooks: {
        expression: {
          getSnapshot: () => target.getSnapshot() ?? EMPTY,
          subscribe: (listener: () => void) => target.subscribe(listener),
        },
      },
    }
  }

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: CHARACTER_ID, inject: characterInjected }, CharacterTab,
  )), 'deep-tavern: character sidebar body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: EXPRESSIONS_ID, inject: workspaceInjected }, ExpressionSettingsTab,
  )), 'deep-tavern: expression settings sidebar body')
}

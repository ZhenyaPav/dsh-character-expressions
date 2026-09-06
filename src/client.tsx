import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { GO_EMOTIONS, isExpressionLabel, type ExpressionLabel, type ExpressionPack, type Sprite } from './expressions.ts'
import { installStyles } from './styles.ts'

type TavernRecord = {
  key: string
  seq: number
  time: number
  kind: 'user' | 'assistant' | 'tool' | 'reasoning' | 'status' | 'expression'
  text: string
  label?: ExpressionLabel
  spriteId?: string
  origin?: 'automatic' | 'manual'
}

type TavernSnapshot = { records: readonly TavernRecord[]; expression: TavernRecord | undefined }
const EMPTY: TavernSnapshot = { records: [], expression: undefined }

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((block: any) => {
    if (block?.type === 'text' || block?.type === 'reasoning') return String(block.text ?? '')
    if (block?.type === 'tool-call') return `Tool call: ${String(block.name ?? 'unknown')}`
    return ''
  }).filter(Boolean).join('\n')
}

function recordOf(event: any): Omit<TavernRecord, 'key'> | undefined {
  switch (event.type) {
    case 'user/message': return { seq: event.seq, time: event.time, kind: 'user', text: textOf(event.data?.content) }
    case 'assistant/message': return { seq: event.seq, time: event.time, kind: 'assistant', text: textOf(event.data?.message?.content) }
    case 'assistant/attempt': return { seq: event.seq, time: event.time, kind: 'reasoning', text: 'Assistant attempt interrupted.' }
    case 'assistant/live-chunk': {
      const chunk = event.data?.chunk
      return chunk?.type === 'text-delta'
        ? { seq: event.seq, time: event.time, kind: 'assistant', text: String(chunk.text ?? '') }
        : undefined
    }
    case 'tool/call': return { seq: event.seq, time: event.time, kind: 'tool', text: `Tool call: ${String(event.data?.name ?? 'unknown')}` }
    case 'tool/result': return { seq: event.seq, time: event.time, kind: 'tool', text: textOf(event.data?.message?.content) || 'Tool completed.' }
    case 'turn/end': return { seq: event.seq, time: event.time, kind: 'status', text: 'Turn completed.' }
    case 'deep-tavern/expression': return {
      seq: event.seq, time: event.time, kind: 'expression', text: event.data.origin === 'manual' ? 'Manual expression' : 'Detected expression',
      label: event.data.label, origin: event.data.origin, spriteId: event.data.spriteId,
    }
    default: return undefined
  }
}

const definition: any = {
  kind: 'deep-tavern-record',
  target: 'deep-tavern',
  match: (event: any) => recordOf(event) === undefined ? null : { id: String(event.seq), role: 'start' },
  start: (_context: unknown, match: any) => {
    const record = recordOf(match.event)
    if (record === undefined) throw new Error('deep-tavern record vanished')
    return { ...record, key: `deep-tavern:${record.seq}` }
  },
  update: (context: any) => context.state,
  buildViewNode: (context: any) => context.state === undefined ? null : {
    key: context.key, kind: 'deep-tavern-record', id: context.id, target: 'deep-tavern',
    anchorSeq: context.state.seq, location: context.start?.location ?? { kind: 'session' }, visibility: 'visible', data: context.state,
  },
}

class TavernBuilder {
  readonly empty = EMPTY
  private records = new Map<string, TavernRecord>()
  replace(input: any): TavernSnapshot {
    this.records.clear()
    for (const node of input.nodes) this.records.set(node.key, node.data as TavernRecord)
    return this.snapshot()
  }
  apply(input: any): TavernSnapshot {
    for (const node of input.upserts) this.records.set(node.key, node.data as TavernRecord)
    return this.snapshot()
  }
  private snapshot(): TavernSnapshot {
    const records = [...this.records.values()].sort((a, b) => a.seq - b.seq)
    return { records, expression: [...records].reverse().find(record => record.kind === 'expression') }
  }
}

const viewDefinition: any = { target: 'deep-tavern', create: () => new TavernBuilder(), isActive: (snapshot: TavernSnapshot) => snapshot.records.length > 0 }

function api(path: string, init?: RequestInit): Promise<Response> { return fetch(`/deep-tavern${path}`, init) }

function usePack(workspace: string | undefined): [ExpressionPack | undefined, () => Promise<void>] {
  const [pack, setPack] = useState<ExpressionPack>()
  const refresh = useCallback(async () => {
    if (workspace === undefined) { setPack(undefined); return }
    const response = await api(`/api/pack?workspace=${encodeURIComponent(workspace)}`)
    if (response.ok) setPack(await response.json())
  }, [workspace])
  useEffect(() => { void refresh() }, [refresh])
  return [pack, refresh]
}

function assetUrl(workspace: string | undefined, sprite: Sprite | undefined): string | undefined {
  if (workspace === undefined || sprite === undefined) return undefined
  return `/deep-tavern/assets?workspace=${encodeURIComponent(workspace)}&id=${encodeURIComponent(sprite.id)}`
}

function Portrait({ expression, pack, workspace, sessionId, refresh }: {
  expression: TavernRecord | undefined; pack: ExpressionPack | undefined; workspace: string | undefined; sessionId: string; refresh: () => Promise<void>
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [visible, setVisible] = useState(true)
  const label = expression?.label
  const candidates = label === undefined || pack === undefined
    ? []
    : (pack.sprites[label]?.length ?? 0) > 0
      ? pack.sprites[label]!
      : pack.fallback === null ? [] : pack.sprites[pack.fallback] ?? []
  const image = candidates.find(sprite => sprite.id === expression?.spriteId) ?? candidates[0]
  const choose = async (next: ExpressionLabel) => {
    await api('/api/manual-expression', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, label: next }) })
    setPickerOpen(false)
    await refresh()
  }
  return <aside className="deepTavernPortrait" data-visible={visible || undefined}>
    <button type="button" className="deepTavernPortraitToggle" onClick={() => setVisible(value => !value)} aria-expanded={visible}>Portrait</button>
    {visible && <>
      <button type="button" className="deepTavernPortraitImage" onClick={() => setPickerOpen(value => !value)} aria-label="Choose expression">
        {image === undefined ? <span>No portrait configured</span> : <img src={assetUrl(workspace, image)} alt={label ?? 'Character portrait'} />}
      </button>
      <div className="deepTavernEmotion">{label ?? 'waiting for a reply'}</div>
      {pickerOpen && <div className="deepTavernPicker" role="dialog" aria-label="Expression picker">
        {GO_EMOTIONS.filter(item => (pack?.sprites[item]?.length ?? 0) > 0).map(item => <button key={item} type="button" onClick={() => void choose(item)}>{item}</button>)}
      </div>}
    </>}
  </aside>
}

function RecordView({ record }: { record: TavernRecord }) {
  if (record.kind === 'expression') return null
  const stamp = new Date(record.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <article className={`deepTavernRecord deepTavern-${record.kind}`}>
    <header>{record.kind === 'assistant' ? 'Character' : record.kind === 'user' ? 'You' : record.kind}<time>{stamp}</time></header>
    <div>{record.text || '…'}</div>
  </article>
}

function CharacterChatView(props: any) {
  const snapshot = props.useConversation((conversation: any) => conversation.views.get('deep-tavern') as TavernSnapshot | undefined) ?? EMPTY
  const [workspace, setWorkspace] = useState<string | undefined>(props.workspace)
  const [pack, refresh] = usePack(workspace)
  return <main className="deepTavernView">
    <Portrait expression={snapshot.expression} pack={pack} workspace={workspace} sessionId={props.sessionId} refresh={refresh} />
    <section className="deepTavernTranscript" aria-label="Character Chat transcript">
      {snapshot.records.map(record => <RecordView key={record.key} record={record} />)}
    </section>
  </main>
}

async function fileData(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function SettingsPage(props: any) {
  const workspace = props.workspace as string | undefined
  const [pack, refresh] = usePack(workspace)
  const [status, setStatus] = useState<any>()
  useEffect(() => { void api('/api/status').then(response => response.json()).then(setStatus) }, [])
  const upload = async (label: ExpressionLabel, files: FileList | null) => {
    const file = files?.[0]
    if (file === undefined || workspace === undefined) return
    await api('/api/pack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upload', workspace, label, name: file.name, mediaType: file.type, data: await fileData(file) }) })
    await refresh()
  }
  const setFallback = async (label: string) => {
    if (workspace === undefined) return
    await api('/api/pack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'fallback', workspace, label: label || null }) })
    await refresh()
  }
  const remove = async (id: string) => {
    if (workspace === undefined) return
    await api('/api/pack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove', workspace, id }) })
    await refresh()
  }
  const importZip = async (files: FileList | null) => {
    const file = files?.[0]
    if (file === undefined || workspace === undefined) return
    await api('/api/pack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'zip', workspace, data: await fileData(file) }) })
    await refresh()
  }
  return <section className="deepTavernSettings">
    <h2>Character Chat</h2>
    <p>Backend classifier: <code>{status?.model ?? 'loading…'}</code> — {status?.status?.state ?? 'loading'}</p>
    {status?.status?.state === 'error' && <button type="button" onClick={() => void api('/api/retry', { method: 'POST' })}>Retry model download</button>}
    <p>{workspace === undefined ? 'Open a workspace session to manage its expression pack.' : <code>{workspace}/.dsh/character-expressions</code>}</p>
    <label>Import a flat label-named ZIP <input type="file" accept="application/zip,.zip" onChange={event => void importZip(event.currentTarget.files)} /></label>
    <label>Fallback expression <select value={pack?.fallback ?? ''} onChange={event => void setFallback(event.target.value)}><option value="">No fallback</option>{GO_EMOTIONS.filter(label => (pack?.sprites[label]?.length ?? 0) > 0).map(label => <option key={label} value={label}>{label}</option>)}</select></label>
    <div className="deepTavernSpriteGrid">{GO_EMOTIONS.map(label => <div key={label} className="deepTavernSpriteCard"><strong>{label}</strong><span>{pack?.sprites[label]?.length ?? 0} sprite(s)</span>{pack?.sprites[label]?.map(sprite => <span key={sprite.id} className="deepTavernSpritePreview"><img src={assetUrl(workspace, sprite)} alt={`${label} sprite`} /><button type="button" onClick={() => void remove(sprite.id)}>Remove</button></span>)}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => void upload(label, event.currentTarget.files)} /></div>)}</div>
  </section>
}

function workspaceFor(ctx: any, sessionId: string): string | undefined {
  return ctx.sessions.list.getSnapshot().byId?.[sessionId]?.cwd
}

export const inject = ['slots', 'sessions', 'uiConversation']

export function apply(ctx: Context): void {
  installStyles()
  ctx.uiConversation.events.register(definition)
  ctx.uiConversation.views.register(viewDefinition)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'deep-tavern', order: 5, label: 'Character Chat',
    inject: (sessionId: string) => ({ sessionId, workspace: workspaceFor(ctx, sessionId) }),
  }, CharacterChatView))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'character-chat', order: 12, label: 'Character Chat',
    inject: () => ({ workspace: ctx.sessions.list.getSnapshot().byId?.[ctx.sessions.list.getSnapshot().current]?.cwd }),
  }, SettingsPage))
}

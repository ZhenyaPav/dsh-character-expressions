import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import AdmZip from 'adm-zip'
import { EMPTY_PACK, createPack, isExpressionLabel, type ExpressionLabel, type ExpressionPack, type Sprite } from './expressions.ts'

const ROOT = '.dsh/character-expressions'
const MANIFEST = 'manifest.json'
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
}

function mediaTypeOf(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}

function directory(workspace: string): string { return join(resolve(workspace), ROOT) }
function manifestPath(workspace: string): string { return join(directory(workspace), MANIFEST) }

function contained(root: string, target: string): boolean {
  const difference = relative(root, target)
  return difference !== '' && !difference.startsWith('..') && !difference.includes('..\\')
}

function parsePack(value: unknown): ExpressionPack {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_PACK }
  const candidate = value as Partial<ExpressionPack>
  const sprites: ExpressionPack['sprites'] = {}
  if (candidate.sprites !== undefined && typeof candidate.sprites === 'object') {
    for (const [label, list] of Object.entries(candidate.sprites)) {
      if (!isExpressionLabel(label) || !Array.isArray(list)) continue
      sprites[label] = list.filter((sprite): sprite is Sprite => (
        typeof sprite === 'object' && sprite !== null
        && typeof (sprite as Sprite).id === 'string'
        && typeof (sprite as Sprite).file === 'string'
        && typeof (sprite as Sprite).mediaType === 'string'
      ))
    }
  }
  return createPack({ fallback: candidate.fallback !== null && candidate.fallback !== undefined && isExpressionLabel(candidate.fallback) ? candidate.fallback : null, sprites })
}

function extensionFor(mediaType: string, name: string): string {
  const configured = IMAGE_TYPES[mediaType]
  if (configured === undefined) throw new Error(`Unsupported image type: ${mediaType}`)
  const ext = extname(name).toLowerCase()
  return ext === configured || (configured === '.jpg' && ext === '.jpeg') ? ext : configured
}

/** Workspace-local expression assets and their atomically persisted manifest. */
export class WorkspaceExpressionStore {
  async read(workspace: string): Promise<ExpressionPack> {
    try { return parsePack(JSON.parse(await readFile(manifestPath(workspace), 'utf8'))) }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_PACK }
      throw error
    }
  }

  async add(
    workspace: string,
    label: ExpressionLabel,
    name: string,
    mediaType: string,
    bytes: Buffer,
  ): Promise<ExpressionPack> {
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 50 MB limit')
    const ext = extensionFor(mediaType, name)
    if (mediaTypeOf(bytes) !== mediaType) throw new Error('Image bytes do not match the declared media type')
    const root = directory(workspace)
    const spriteRoot = join(root, 'sprites')
    await mkdir(spriteRoot, { recursive: true })
    const id = randomUUID()
    const sprite: Sprite = { id, file: `sprites/${id}${ext}`, mediaType }
    const output = resolve(root, sprite.file)
    if (!contained(root, output)) throw new Error('Invalid sprite output path')
    await writeFile(output, bytes, { flag: 'wx' })
    const pack = await this.read(workspace)
    const next = createPack({ ...pack, sprites: { ...pack.sprites, [label]: [...(pack.sprites[label] ?? []), sprite] } })
    await this.write(workspace, next)
    return next
  }

  async remove(workspace: string, id: string): Promise<ExpressionPack> {
    const root = directory(workspace)
    const pack = await this.read(workspace)
    let removed: Sprite | undefined
    const sprites: ExpressionPack['sprites'] = {}
    for (const label of Object.keys(pack.sprites) as ExpressionLabel[]) {
      const next = (pack.sprites[label] ?? []).filter(sprite => {
        if (sprite.id === id) { removed = sprite; return false }
        return true
      })
      if (next.length > 0) sprites[label] = next
    }
    if (removed !== undefined) {
      const target = resolve(root, removed.file)
      if (!contained(root, target)) throw new Error('Invalid stored sprite path')
      await rm(target, { force: true })
    }
    const fallback = pack.fallback !== null && (sprites[pack.fallback]?.length ?? 0) > 0
      ? pack.fallback
      : null
    const next = createPack({ fallback, sprites })
    await this.write(workspace, next)
    return next
  }

  async fallback(workspace: string, label: ExpressionLabel | null): Promise<ExpressionPack> {
    const pack = await this.read(workspace)
    if (label !== null && (pack.sprites[label]?.length ?? 0) === 0) throw new Error('Fallback needs at least one sprite')
    const next = createPack({ ...pack, fallback: label })
    await this.write(workspace, next)
    return next
  }

  /** Remove the complete workspace-local sprite override pack. */
  async clear(workspace: string): Promise<ExpressionPack> {
    await rm(directory(workspace), { recursive: true, force: true })
    return { ...EMPTY_PACK }
  }

  /** Import a flat label-named ZIP, rejecting traversal and unknown labels. */
  async importZip(workspace: string, bytes: Buffer): Promise<ExpressionPack> {
    const archive = new AdmZip(bytes)
    const imports: Array<{ label: ExpressionLabel; name: string; mediaType: string; bytes: Buffer }> = []
    if (archive.getEntries().length === 0) throw new Error('ZIP contains no files')
    for (const entry of archive.getEntries()) {
      if (entry.isDirectory || entry.entryName.includes('/') || entry.entryName.includes('\\')) {
        if (!entry.isDirectory) throw new Error('ZIP files must have a flat structure')
        continue
      }
      const label = basename(entry.entryName, extname(entry.entryName)).split(/[.-]/, 1)[0]?.toLowerCase()
      if (label === undefined || !isExpressionLabel(label)) throw new Error(`Unknown expression label in ZIP: ${entry.entryName}`)
      const mediaType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extname(entry.entryName).toLowerCase()]
      if (mediaType === undefined) throw new Error(`Unsupported image in ZIP: ${entry.entryName}`)
      const entryBytes = entry.getData()
      if (entryBytes.length === 0 || entryBytes.length > MAX_IMAGE_BYTES || mediaTypeOf(entryBytes) !== mediaType) throw new Error(`Invalid image in ZIP: ${entry.entryName}`)
      imports.push({ label, name: entry.entryName, mediaType, bytes: entryBytes })
    }
    let pack = await this.read(workspace)
    for (const item of imports) pack = await this.add(workspace, item.label, item.name, item.mediaType, item.bytes)
    return pack
  }

  async asset(workspace: string, id: string): Promise<{ bytes: Buffer; mediaType: string } | undefined> {
    const root = directory(workspace)
    const sprite = Object.values((await this.read(workspace)).sprites).flat().find(candidate => candidate.id === id)
    if (sprite === undefined) return undefined
    const target = resolve(root, sprite.file)
    if (!contained(root, target)) throw new Error('Invalid stored sprite path')
    return { bytes: await readFile(target), mediaType: sprite.mediaType }
  }

  private async write(workspace: string, pack: ExpressionPack): Promise<void> {
    const root = directory(workspace)
    await mkdir(root, { recursive: true })
    const temporary = join(root, `${MANIFEST}.${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(pack, null, 2)}\n`)
    await rename(temporary, manifestPath(workspace))
  }
}

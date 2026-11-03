/**
 * Per-workspace memory files: one Markdown file per fact plus a `MEMORY.md` index, following ZCode's
 * project-memory layout. The store, not the model, keeps the index in step with the fact files.
 */
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = typeof MEMORY_TYPES[number]

/** One fact as the model saves it. */
export interface MemoryInput {
  readonly name: string
  readonly description: string
  readonly type: MemoryType
  readonly body: string
}

/** One fact file's recall summary. */
export interface MemoryEntry {
  readonly name: string
  readonly description: string
  readonly type: string
  readonly mtimeMs: number
}

export const INDEX_FILE = 'MEMORY.md'
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const MANIFEST_LIMIT = 200
const INDEX_MAX_LINES = 200
const INDEX_MAX_CHARS = 25_000

/**
 * Resolve the memory directory of one workspace, keyed like ZCode: basename slug plus the first 16
 * hex digits of the SHA-256 of the normalized absolute path.
 * @param home - DSH home directory.
 * @param cwd - the session's workspace directory.
 * @param platform - path case policy; Windows paths compare case-insensitively.
 * @returns the absolute memory directory.
 */
export function memoryRoot(home: string, cwd: string, platform: NodeJS.Platform = process.platform): string {
  const absolute = resolve(cwd)
  const keySource = platform === 'win32' ? absolute.toLowerCase() : absolute
  const hash = createHash('sha256').update(keySource).digest('hex').slice(0, 16)
  const slug = basename(absolute).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  return join(home, 'memories', 'projects', `${slug}-${hash}`, 'memory')
}

/** Reject anything but a short kebab-case slug, so a name can never leave the memory directory. */
export function assertMemoryName(name: string): string {
  if (!NAME.test(name)) throw new Error(`memory name must be a short kebab-case slug (a-z, 0-9, -): ${JSON.stringify(name)}`)
  return name
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Render a fact file; JSON strings are valid YAML scalars, so descriptions need no further escaping. */
export function renderMemory(input: MemoryInput, originSessionId: string | undefined): string {
  return [
    '---',
    `name: ${input.name}`,
    `description: ${JSON.stringify(oneLine(input.description))}`,
    'metadata:',
    `  type: ${input.type}`,
    ...originSessionId === undefined ? [] : [`  originSessionId: ${originSessionId}`],
    '---',
    input.body.trim(),
    '',
  ].join('\n')
}

/** Read the few frontmatter fields recall needs; malformed frontmatter yields empty fields. */
export function parseFrontmatter(text: string): { description: string; type: string; originSessionId?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const block = match?.[1] ?? ''
  const field = (key: string): string | undefined => {
    const line = new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm').exec(block)?.[1]?.trim()
    if (line === undefined || line === '') return undefined
    if (line.startsWith('"')) {
      try { return String(JSON.parse(line)) } catch { return line }
    }
    return line
  }
  const origin = field('originSessionId')
  return { description: field('description') ?? '', type: field('type') ?? '', ...origin === undefined ? {} : { originSessionId: origin } }
}

/** Bound the index the way ZCode bounds `MEMORY.md`: 200 lines or 25,000 characters. */
export function boundIndex(text: string): string {
  const trimmed = text.trim()
  const lines = trimmed.split('\n')
  let bounded = lines.slice(0, INDEX_MAX_LINES).join('\n')
  if (bounded.length > INDEX_MAX_CHARS) bounded = bounded.slice(0, INDEX_MAX_CHARS)
  if (bounded.length === trimmed.length) return trimmed
  return `${bounded}\n\n[MEMORY.md truncated: only the first part is shown. Keep the index short; read individual memories with memory_read.]`
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, path)
}

/** Replace, append, or remove the index line pointing at `name.md`. */
export function updateIndex(index: string, name: string, description: string | undefined): string {
  const target = `](${name}.md)`
  const lines = index.split('\n').filter(line => line.trim() !== '' && !line.includes(target))
  if (description !== undefined) lines.push(`- [${name}](${name}.md) — ${oneLine(description)}`)
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/** Serialized file operations on one workspace memory directory. */
export class MemoryStore {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(readonly root: string) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work)
    this.tail = run.catch(() => undefined)
    return run
  }

  private file(name: string): string {
    return join(this.root, `${assertMemoryName(name)}.md`)
  }

  /** The bounded index text, or undefined when it is missing or empty. */
  async index(): Promise<string | undefined> {
    const text = await readOptional(join(this.root, INDEX_FILE))
    if (text === undefined || text.trim() === '') return undefined
    return boundIndex(text)
  }

  /** Create or replace one fact, keeping its first session id, and point the index at it. */
  async save(input: MemoryInput, sessionId: string | undefined): Promise<'created' | 'updated'> {
    assertMemoryName(input.name)
    if (!MEMORY_TYPES.includes(input.type)) throw new Error(`memory type must be one of ${MEMORY_TYPES.join(', ')}`)
    if (oneLine(input.description) === '') throw new Error('memory description must not be empty')
    if (input.body.trim() === '') throw new Error('memory body must not be empty')
    return this.serial(async () => {
      await mkdir(this.root, { recursive: true })
      const path = this.file(input.name)
      const existing = await readOptional(path)
      const origin = existing === undefined ? sessionId : parseFrontmatter(existing).originSessionId ?? sessionId
      await writeAtomic(path, renderMemory(input, origin))
      const indexPath = join(this.root, INDEX_FILE)
      await writeAtomic(indexPath, updateIndex(await readOptional(indexPath) ?? '', input.name, input.description))
      return existing === undefined ? 'created' : 'updated'
    })
  }

  /** Remove one fact and its index line; a missing fact reports false. */
  async delete(name: string): Promise<boolean> {
    const path = this.file(name)
    return this.serial(async () => {
      const existed = await readOptional(path) !== undefined
      await rm(path, { force: true })
      const indexPath = join(this.root, INDEX_FILE)
      const index = await readOptional(indexPath)
      if (index !== undefined) await writeAtomic(indexPath, updateIndex(index, name, undefined))
      return existed
    })
  }

  /** One fact's full text, or undefined when it does not exist. */
  async read(name: string): Promise<string | undefined> {
    return readOptional(this.file(name))
  }

  /** Fact summaries, newest first, at most 200 like ZCode's recall manifest. */
  async list(): Promise<MemoryEntry[]> {
    let names: string[]
    try { names = await readdir(this.root) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const entries: MemoryEntry[] = []
    for (const file of names) {
      if (!file.endsWith('.md') || file === INDEX_FILE || !NAME.test(file.slice(0, -3))) continue
      const path = join(this.root, file)
      const [text, info] = await Promise.all([readOptional(path), stat(path).catch(() => undefined)])
      if (text === undefined || info === undefined || !info.isFile()) continue
      const { description, type } = parseFrontmatter(text)
      entries.push({ name: file.slice(0, -3), description, type, mtimeMs: info.mtimeMs })
    }
    return entries.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, MANIFEST_LIMIT)
  }
}

/** One memory file in the Settings viewer's catalog. */
export interface CatalogFile {
  readonly name: string
  readonly path: string
  readonly kind: 'index' | 'item'
  readonly size: number
  readonly updatedAt: number
}

/** One workspace directory holding memory files. */
export interface CatalogWorkspace {
  readonly id: string
  readonly label: string
  readonly updatedAt: number
  readonly files: CatalogFile[]
}

const PROJECT_ID = /^(.*)-[0-9a-f]{16}$/

/**
 * List every workspace memory directory under `home`, the way ZCode's viewer reads its catalog: plain directories
 * and Markdown files only, `MEMORY.md` first, the most recently updated workspace first. A directory that belongs
 * to a registered workspace takes that workspace's title and follows the registry order.
 * @param home - DSH home directory.
 * @param workspaces - registered workspaces in display order.
 * @returns workspaces with at least one memory file.
 */
export async function listCatalog(home: string, workspaces: readonly { path: string; title: string }[] = []): Promise<CatalogWorkspace[]> {
  const projects = join(home, 'memories', 'projects')
  const known = new Map(workspaces.map(({ path, title }, order) => [basename(resolve(memoryRoot(home, path), '..')), { title, order }]))
  let entries
  try { entries = await readdir(projects, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const found: { workspace: CatalogWorkspace; order: number }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const root = join(projects, entry.name, 'memory')
    let names
    try { names = await readdir(root, { withFileTypes: true }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') continue
      throw error
    }
    const files: CatalogFile[] = []
    for (const file of names) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue
      const path = join(root, file.name)
      const info = await lstat(path).catch(() => undefined)
      if (info === undefined || !info.isFile()) continue
      files.push({ name: file.name, path, kind: file.name === INDEX_FILE ? 'index' : 'item', size: info.size, updatedAt: info.mtimeMs })
    }
    if (files.length === 0) continue
    files.sort((left, right) => left.kind !== right.kind ? (left.kind === 'index' ? -1 : 1) : left.name.localeCompare(right.name, 'en'))
    const registered = known.get(entry.name)
    const label = registered?.title ?? (PROJECT_ID.exec(entry.name)?.[1]?.trim() || entry.name)
    found.push({ order: registered?.order ?? Number.POSITIVE_INFINITY,
      workspace: { id: entry.name, label, updatedAt: Math.max(...files.map(file => file.updatedAt)), files } })
  }
  return found
    .sort((left, right) => left.order - right.order || right.workspace.updatedAt - left.workspace.updatedAt || left.workspace.id.localeCompare(right.workspace.id, 'en'))
    .map(({ workspace }) => workspace)
}

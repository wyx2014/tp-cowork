import { SkillError } from './errors.ts'
/** One installer publishes complete directories into the profile's real DSH filesystem provider. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { InstallRequest, InstallResult, InstallSource, InstallerApi } from '../../contracts/index.ts'
import { contained, fingerprint, markerName, parseSkill, readTree, sha256, validateFiles, type SkillFile } from './files.ts'
import { readPackage, readZip } from './archive.ts'

const markerSchema = z.object({ owner: z.literal('tpcowork-toolbox'), source: z.string(), fingerprint: z.string(), requestId: z.string(), version: z.string() })
export interface InstallerOptions { root: string; userRoot?: string; bundledRoot: string; maxBytes: number; maxFiles: number }
/** Trusted Host source adapter. TpcoworkHub verifies server hashes before supplying these files. */
export type SourceResolver = (source: InstallSource, signal: AbortSignal) => Promise<readonly SkillFile[]>
export class SkillInstaller extends TypertRemoteService implements InstallerApi {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private readonly sources = new Map<string, SourceResolver>()
  private readonly imports = new Map<string, { files: readonly SkillFile[]; expires: number }>()
  private readonly operations = new Map<string, { key: string; controller: AbortController; result: Promise<InstallResult> }>()
  constructor(ctx: Context, readonly options: InstallerOptions, private readonly changed: () => void) {
    super(ctx, 'toolboxInstaller')
    ctx.effect(() => async () => { this.lifetime.abort(); await this.tail })
  }
  /** Local import grants a temporary opaque ticket over a validated immutable directory snapshot. */
  async prepareLocalImport(request: { path: string }): Promise<{ importId: string; name: string }> {
    const files = await readPackage(resolve(request.path), this.options.maxBytes, this.options.maxFiles)
    return this.prepare(files)
  }
  /** Browser-selected ZIPs use the same validation and immutable snapshot as local packages. */
  async prepareArchive(request: { contentBase64: string }): Promise<{ importId: string; name: string }> {
    if (request.contentBase64.length > Math.ceil(this.options.maxBytes / 3) * 4) throw new SkillError('skills/resource-size')
    if (request.contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.contentBase64)) throw new SkillError('skills/invalid-archive')
    return this.prepare(readZip(Buffer.from(request.contentBase64, 'base64'), this.options.maxBytes, this.options.maxFiles))
  }
  /** Stage a manually authored entry through the same resource validation and installer. */
  async prepareSkill(request: { content: string }): Promise<{ importId: string; name: string }> {
    const bytes = Buffer.from(request.content, 'utf8')
    return this.prepare([{ path: 'SKILL.md', bytes, sha256: sha256(bytes) }])
  }
  private prepare(files: readonly SkillFile[]): { importId: string; name: string } {
    validateFiles(files, this.options.maxBytes, this.options.maxFiles)
    for (const [id, draft] of this.imports) if (draft.expires <= Date.now()) this.imports.delete(id)
    if (this.imports.size >= 32) this.imports.delete(this.imports.keys().next().value!)
    const name = parseSkill(files.find(file => file.path === 'SKILL.md')!.bytes).name
    const importId = randomUUID()
    this.imports.set(importId, { files, expires: Date.now() + 15 * 60 * 1000 })
    return { importId, name }
  }
  /** Register one trusted resolver, e.g. TpcoworkHub or a ClawHub download adapter; disposal withdraws it. */
  registerSource(kind: InstallSource['kind'], resolver: SourceResolver): () => void {
    if (kind !== 'tpcoworkhub' || this.sources.has(kind)) throw new SkillError('skills/source-conflict')
    this.sources.set(kind, resolver)
    return () => { if (this.sources.get(kind) === resolver) this.sources.delete(kind) }
  }
  serialize<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work)
    this.tail = pending.catch(() => undefined)
    return pending
  }
  async install(request: InstallRequest): Promise<InstallResult> {
    const key = JSON.stringify(request)
    const old = this.operations.get(request.requestId)
    if (old) {
      if (old.key !== key) throw new SkillError('skills/request-conflict')
      return old.result
    }
    if (this.operations.size >= 256) this.operations.delete(this.operations.keys().next().value!)
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    const operationId = request.requestId
    const result = this.serialize(async (): Promise<InstallResult> => {
      try {
        signal.throwIfAborted()
        if (request.scope.kind !== 'user') throw new SkillError('skills/profile-scope-required')
        let files: readonly SkillFile[]
        if (request.source.kind === 'local') {
          const snapshot = this.imports.get(request.source.importId)
          if (!snapshot || snapshot.expires <= Date.now()) throw new SkillError('skills/import-expired')
          files = snapshot.files
        } else if (request.source.kind === 'bundled') {
          const path = join(this.options.bundledRoot, request.source.resourceId)
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.source.resourceId) || !contained(this.options.bundledRoot, path)) throw new SkillError('skills/invalid-resource-id')
          files = await readTree(path, this.options.maxBytes, this.options.maxFiles)
        } else {
          const resolver = this.sources.get('tpcoworkhub')
          if (!resolver) throw new SkillError('skills/source-unavailable')
          files = await resolver(request.source, signal)
        }
        validateFiles(files, this.options.maxBytes, this.options.maxFiles)
        const meta = parseSkill(files.find(file => file.path === 'SKILL.md')!.bytes)
        if (request.source.kind === 'bundled' && meta.name !== request.source.resourceId) throw new SkillError('skills/name-conflict')
        const hash = fingerprint(files)
        if (request.source.kind === 'tpcoworkhub' && hash !== request.source.fingerprint) throw new SkillError('skills/package-hash')
        const installRoot = request.source.kind === 'bundled' ? this.options.root : this.options.userRoot ?? this.options.root
        let target = join(installRoot, meta.name)
        const source = sourceIdentity(request.source, meta.name)
        let catalog = await this.ctx.skills.inventory({ cwd: this.ctx.profileContext.cwd, signal })
        // Earlier atomic installs may still produce watcher invalidations while this scan reads.
        for (let attempt = 1; !catalog.complete && attempt < 4; attempt++) {
          catalog = await this.ctx.skills.inventory({ cwd: this.ctx.profileContext.cwd, signal })
        }
        if (!catalog.complete) throw new SkillError('skills/incomplete-inventory')
        // Keep existing personal installs from older DSH builds editable in their original location.
        const previousTarget = join(this.options.root, meta.name)
        if (request.source.kind !== 'bundled' && target !== previousTarget && !(await present(target)) && await present(previousTarget)) {
          const previous = await this.owned(previousTarget)
          if (previous.source === source) target = previousTarget
        }
        if (catalog.entries.some(entry => entry.skill.name === meta.name
          && (entry.skill.resourceBase?.kind !== 'directory' || resolve(entry.skill.resourceBase.path) !== target))) throw new SkillError('skills/name-conflict')
        const exists = await present(target)
        if (exists) {
          const previous = await this.owned(target)
          if (previous.source !== source) throw new SkillError('skills/name-conflict')
          if (previous.fingerprint === hash) return { operationId, state: 'unchanged', skillId: skillId(target), fingerprint: hash }
          if (request.conflict !== 'replace-owned') throw new SkillError('skills/name-conflict')
        }
        const destinationRoot = dirname(target)
        await mkdir(destinationRoot, { recursive: true, mode: 0o700 })
        if ((await lstat(destinationRoot)).isSymbolicLink()) throw new SkillError('skills/symlink')
        // Staging and backups live beside the discovery root: providers never discover partial trees.
        const transaction = await mkdtemp(join(dirname(destinationRoot), '.skill-transaction-'))
        const staging = join(transaction, 'new')
        const backup = join(transaction, 'previous')
        let moved = false
        try {
          await mkdir(staging, { mode: 0o700 })
          for (const file of files) {
            signal.throwIfAborted()
            const path = join(staging, file.path)
            await mkdir(dirname(path), { recursive: true, mode: 0o700 })
            await writeFile(path, file.bytes, { flag: 'wx', mode: 0o600 })
          }
          await writeFile(join(staging, markerName), JSON.stringify({ owner: 'tpcowork-toolbox', source, fingerprint: hash, requestId: request.requestId, version: request.source.kind === 'tpcoworkhub' ? request.source.versionId : hash.slice(0, 12) }), { flag: 'wx', mode: 0o600 })
          signal.throwIfAborted()
          if (exists) { await this.owned(target); await rename(target, backup); moved = true }
          else if (await present(target)) throw new SkillError('skills/name-conflict')
          try { await rename(staging, target) }
          catch (error) { if (moved) { await rename(backup, target); moved = false } throw error }
          moved = false
          this.changed()
        } finally {
          // A failed rollback retains the previous tree for explicit recovery.
          if (!moved) await rm(transaction, { recursive: true, force: true })
        }
        return { operationId, state: 'installed', skillId: skillId(target), fingerprint: hash }
      } catch (error) {
        return { operationId, state: signal.aborted ? 'cancelled' : 'failed', error: { code: safeCode(error), message: '技能未安装；请检查来源、资源完整性或同名用户修改。' } }
      }
    }).then(result => {
      if (request.source.kind === 'local' && ['installed', 'unchanged', 'cancelled'].includes(result.state)) this.imports.delete(request.source.importId)
      return result
    })
    this.operations.set(request.requestId, { key, controller, result })
    return result
  }
  async cancel(request: { operationId: string }): Promise<void> {
    const operation = this.operations.get(request.operationId)
    if (!operation) return
    operation.controller.abort()
    await operation.result
  }
  /** Refuse unowned or modified files before update/removal. */
  async owned(target: string) {
    if (![this.options.root, this.options.userRoot].some(root => root !== undefined && contained(root, target))
      || (await lstat(target)).isSymbolicLink()) throw new SkillError('skills/not-owned')
    let marker
    try { marker = markerSchema.parse(JSON.parse(await readFile(join(target, markerName), 'utf8'))) }
    catch { throw new SkillError('skills/not-owned') }
    if (fingerprint(await readTree(target, this.options.maxBytes, this.options.maxFiles, true)) !== marker.fingerprint) throw new SkillError('skills/user-modified')
    return marker
  }
}
export function skillId(path: string): string { return 'skill-' + sha256(resolve(path)).slice(0, 24) }
export async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error }
}
function sourceIdentity(source: InstallSource, name: string): string {
  return source.kind === 'tpcoworkhub' ? `tpcoworkhub:${source.skillId}` : `${source.kind}:${name}`
}
function safeCode(error: unknown): string {
  if (error instanceof SkillError) return error.code
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && ['EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'ENOSPC', 'ENOTDIR', 'EIO', 'EROFS'].includes(error.code)) return `skills/filesystem-${error.code}`
  return 'skills/installation-failed'
}

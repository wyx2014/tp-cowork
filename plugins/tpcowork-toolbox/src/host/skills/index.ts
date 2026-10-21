/** Profile skill management; DSH remains the catalog, execution policy and settings authority. */
import { SkillError } from '../installer/errors.ts'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '../../host.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SkillCandidate, SkillViewOptions } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { basename, join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, rename, rm, mkdtemp } from 'node:fs/promises'
import type { Catalog, InstallRequest, SkillItem, SkillScope, SkillsApi } from '../../contracts/index.ts'
import { SkillInstaller, skillId } from '../installer/index.ts'
import { fingerprint, markerName, parseSkill, readTree, sha256 } from '../installer/files.ts'
import { PythonModuleChecks, readiness } from './readiness.ts'
import { hostContribution } from './remote.ts'
import { applyNativeTools, type NativeOptions } from './native.ts'
import { userSkillsDirectory } from './user-directory.ts'

export const name = 'toolbox-skills'
export const inject = ['skills', 'typert', 'settings', 'profileContext']
export interface Config extends NativeOptions {
  settingsEntry: string
  settingsPath: string[]
  bundledRoot: string
  userRoot: string
  python: string
  maxBytes: number
  maxFiles: number
  disabledNames: Volatile<string[]>
  removedBundled: Volatile<string[]>
}
export const Config = z.object({
  settingsEntry: z.string().default('toolbox-skills'),
  settingsPath: z.array(z.string()).default([]),
  bundledRoot: z.string().default(fileURLToPath(new URL('../resources/skills/', import.meta.url))),
  userRoot: z.string().default(''),
  python: z.string().default('python3'), maxBytes: z.number().min(1).default(64 * 1024 * 1024), maxFiles: z.number().min(1).default(2048),
  disabledNames: z.array(z.string()).default([]).volatile(), removedBundled: z.array(z.string()).default([]).volatile(),
  requestTimeoutMs: z.number().min(1).default(120000), imageMaxBytes: z.number().min(1).default(25 * 1024 * 1024), visionMaxTokens: z.number().min(1).default(4096),
  callUsernameRef: z.string().default('DSH_YEALINK_USERNAME').role('credential-ref'), callPasswordRef: z.string().default('DSH_YEALINK_PASSWORD').role('credential-ref'), visionKeyRef: z.string().default('DSH_IMAGE_EXTRACT_API_KEY').role('credential-ref'),
})
/** Stable Host access for T5; the public Remote service exposes only InstallerApi methods. */
export function requireInstaller(ctx: Context): SkillInstaller {
  const service = ctx.get('toolboxInstaller')
  if (!(service instanceof SkillInstaller)) throw new SkillError('skills/installer-unavailable')
  return service
}
export class ToolboxSkills extends TypertRemoteService implements SkillsApi {
  private revision = 1
  private readonly digests = new Map<string, { digest: string; revision: number }>()
  private readonly entries = new Map<string, SkillCandidate>()
  private readonly pythonChecks = new PythonModuleChecks()
  constructor(ctx: Context, readonly config: Config, readonly installer: SkillInstaller, private readonly invalidateProvider: () => void) {
    super(ctx, 'toolboxSkills')
    ctx.on('agent/disposed', ({ agent }) => { this.digests.delete(agent.id) })
  }
  changed(): void {
    this.revision++
    this.ctx.emit('toolbox/changed', { domain: 'skills', revision: this.revision })
  }
  private async withView<T>(request: SkillScope, work: (options: SkillViewOptions) => Promise<T>): Promise<T> {
    if (!request.sessionId) return work({ cwd: this.ctx.profileContext.cwd })
    const query = this.ctx.get('sessionQuery')
    if (!query) throw new SkillError('skills/session-unavailable')
    const sessionId = SessionId(request.sessionId)
    using observation = await query.observeSession(sessionId)
    const agent = this.ctx.get('agents')?.get(sessionId)
    const cwd = observation.projections?.values.workingDirectory ?? observation.header.cwd ?? this.ctx.profileContext.cwd
    const preset = observation.projections?.values.agentPreset ?? undefined
    const presets = this.ctx.get('agentPresets')
    await using lease = !agent && presets ? await presets.acquireScope(preset) : undefined
    const scope = agent ?? lease?.key
    return await work({ cwd, ...(scope ? { scope } : {}) })
  }
  async inventory(request: SkillScope): Promise<Catalog<SkillItem>> {
    return this.withView(request, async options => {
      const observation = await this.ctx.skills.inventory(options)
      const items: SkillItem[] = []
      this.entries.clear()
      for (const entry of observation.entries) {
        const candidate = entry.skill
        const directoryEntry = candidate.path !== undefined && basename(candidate.path) === 'SKILL.md'
        const id = skillId(candidate.resourceBase?.kind === 'directory' && directoryEntry
          ? candidate.resourceBase.path : candidate.path ?? `${candidate.provider}:${candidate.name}`)
        this.entries.set(id, candidate)
        try {
          const flat = candidate.path && !directoryEntry
          let files = candidate.resourceBase?.kind === 'directory' && !flat
            ? await readTree(candidate.resourceBase.path, this.config.maxBytes, this.config.maxFiles, true) : []
          // Flat-file providers may share their root with unrelated skills.
          if (candidate.path && candidate.resourceBase?.kind === 'directory' && dirname(candidate.path) === candidate.resourceBase.path && !directoryEntry) {
            const bytes = await readFile(candidate.path)
            files = [{ path: 'SKILL.md', bytes, sha256: sha256(bytes) }]
          }
          const hash = files.length ? fingerprint(files) : fingerprint([])
          let origin: SkillItem['origin'] = candidate.source.startsWith('project') ? 'project' : candidate.source === 'bundled' ? 'bundled' : 'user'
          let version = hash.slice(0, 12)
          let managed = false
          if (candidate.resourceBase?.kind === 'directory') {
            try {
              const marker = JSON.parse(await readFile(join(candidate.resourceBase.path, markerName), 'utf8')) as { owner?: string; source?: string; version?: string; fingerprint?: string }
              if (marker.source?.startsWith('bundled:')) origin = 'bundled'
              if (marker.source?.startsWith('tpcoworkhub:')) origin = 'tpcoworkhub'
              if (typeof marker.version === 'string') version = marker.version
              managed = marker.owner === 'tpcowork-toolbox' && marker.fingerprint === hash
            } catch { /* Unmanaged skills have no ownership marker. */ }
          }
          const ready = await readiness(this.ctx, files, options, this.config.python, this.config, this.pythonChecks)
          if (!files.length) { ready.state = 'unknown'; ready.reasons.push({ code: 'opaque-resources', message: '该提供方未公开可验证的技能资源，请使用原生管理入口。' }) }
          if (!entry.selected) { ready.state = 'blocked'; ready.reasons.push({ code: 'shadowed', message: '同名技能由更高优先级来源提供。' }) }
          items.push({ id, name: candidate.name, description: candidate.description, origin, provider: candidate.provider, version, fingerprint: hash, installed: true, enabled: entry.enabled, invocation: { ...candidate.invocation }, readiness: ready, resources: files.map(file => file.path).sort(), ...(candidate.path ? { path: candidate.path } : {}), managed })
        } catch {
          items.push({ id, name: candidate.name, description: candidate.description, origin: 'user', provider: candidate.provider, version: 'unknown', fingerprint: '', installed: true, enabled: entry.enabled, invocation: { ...candidate.invocation }, readiness: { state: 'error', reasons: [{ code: 'invalid-resources', message: '技能资源不可读取或不完整。' }] }, resources: [], ...(candidate.path ? { path: candidate.path } : {}), managed: false })
        }
      }
      const digest = JSON.stringify([observation.complete, items.map(({ readiness: ready, ...item }) => ({ ...item, readiness: { state: ready.state, reasons: ready.reasons } }))])
      const view = request.sessionId ?? ''
      if (digest !== this.digests.get(view)?.digest) {
        this.revision++
        this.digests.set(view, { digest, revision: this.revision })
      }
      return { revision: this.digests.get(view)!.revision, complete: observation.complete, items }
    })
  }
  async install(request: InstallRequest) { return this.installer.install(request) }
  async checkReadiness(request: SkillScope & { id: string }): Promise<SkillItem> {
    this.pythonChecks.clear()
    const item = (await this.inventory(request)).items.find(item => item.id === request.id)
    if (!item) throw new SkillError('skills/not-found')
    return item
  }
  async detail(request: SkillScope & { id: string }) {
    const item = (await this.inventory(request)).items.find(item => item.id === request.id)
    if (!item) throw new SkillError('skills/not-found')
    const candidate = this.entries.get(request.id)
    const content = candidate?.path ? parseSkill(await readFile(candidate.path)).content : ''
    return { item, content }
  }
  async setEnabled(request: SkillScope & { id: string; enabled: boolean; expectedRevision: number }): Promise<Catalog<SkillItem>> {
    return this.installer.serialize(async () => {
      const catalog = await this.inventory(request)
      this.assertRevision(request.expectedRevision, catalog)
      const item = catalog.items.find(item => item.id === request.id)
      if (!item) throw new SkillError('skills/not-found')
      const names = new Set(this.config.disabledNames.get())
      if (request.enabled) names.delete(item.name); else names.add(item.name)
      await this.writePolicy('disabledNames', [...names])
      return this.inventory(request)
    })
  }
  async remove(request: SkillScope & { id: string; expectedRevision: number }): Promise<void> {
    return this.installer.serialize(async () => {
      const catalog = await this.inventory(request)
      this.assertRevision(request.expectedRevision, catalog)
      const candidate = this.entries.get(request.id)
      if (candidate?.resourceBase?.kind !== 'directory') throw new SkillError('skills/not-owned')
      const target = candidate.resourceBase.path
      const marker = await this.installer.owned(target)
      if (marker.source.startsWith('bundled:')) {
        const removed = new Set(this.config.removedBundled.get()); removed.add(candidate.name)
        await this.writePolicy('removedBundled', [...removed])
      }
      const transaction = await mkdtemp(join(dirname(dirname(target)), '.skill-remove-'))
      await rename(target, join(transaction, 'removed'))
      this.invalidateProvider()
      this.changed()
      await rm(transaction, { recursive: true, force: true })
    })
  }
  private assertRevision(expected: number, catalog: Catalog<SkillItem>): void {
    if (!catalog.complete) throw new SkillError('skills/incomplete-inventory')
    if (expected !== catalog.revision) throw new SkillError('toolbox/stale-selection')
  }
  private async writePolicy(field: 'disabledNames' | 'removedBundled', value: string[]): Promise<void> {
    const descriptor = this.ctx.settings.describe().find(row => row.ns === this.config.settingsEntry)
    if (!descriptor) throw new SkillError('skills/settings-entry-missing')
    await this.ctx.settings.mutate(this.config.settingsEntry, [{ op: 'set', path: [...this.config.settingsPath, field], value }], descriptor.revision)
  }
}
/** Mount as an internal module under one toolbox package. T7 owns the final composition entry. */
export function applySkillsModule(ctx: Context, config: Config): void {
  ctx.typert.register(hostContribution)
  let invalidate = () => {}
  let service: ToolboxSkills | undefined
  const changed = () => { invalidate(); service?.changed() }
  const userRoot = userSkillsDirectory({ configured: config.userRoot })
  const installer = new SkillInstaller(ctx, { root: resolve(ctx.profileContext.dir, 'skills'), userRoot, bundledRoot: config.bundledRoot, maxBytes: config.maxBytes, maxFiles: config.maxFiles }, changed)
  service = new ToolboxSkills(ctx, config, installer, () => { invalidate() })
  let invalidatePolicy = () => {}
  ctx.skills.registerPolicy(control => {
    invalidatePolicy = control.invalidate
    return { allows: name => !config.disabledNames.get().includes(name) }
  })
  let provider: FileSystemSkillProvider
  ctx.skills.registerProvider(control => {
    invalidate = control.invalidate
    // A dropped personal skill wins a same-name profile copy; both remain visible in inventory.
    provider = new FileSystemSkillProvider(ctx, control, { providerName: 'toolbox-profile', includeDefaultRoots: false,
      customSkillDirs: [...new Set([userRoot, installer.options.root])], watch: true })
    return provider
  })
  ctx.effect(() => async () => { await provider.dispose() })
  const policy = () => JSON.stringify([config.disabledNames.get(), config.removedBundled.get()])
  let previousPolicy = policy()
  ctx.on('settings/document-updated', ns => {
    if (ns !== config.settingsEntry) return
    const current = policy()
    if (current === previousPolicy) return
    previousPolicy = current
    invalidatePolicy()
  })
  ctx.on('skills/change', () => service?.changed())
  ctx.inject(['tools', 'credentials'], inner => applyNativeTools(inner, config))
}
export const apply = applySkillsModule

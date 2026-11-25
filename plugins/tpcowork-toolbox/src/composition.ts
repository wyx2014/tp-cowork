/** The one toolbox Loader entry owns defaults; installed files and DSH settings remain authoritative. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Config as SkillsConfig, applySkillsModule, requireInstaller } from './host/skills/index.ts'
import { Config as McpConfig, applyMcpModule } from './host/mcp/index.ts'
import { fingerprint, readTree } from './host/installer/files.ts'
import { present, skillId } from './host/installer/index.ts'
import { SkillError } from './host/installer/errors.ts'
import type { InitializationIssue } from './contracts/index.ts'
import * as TpcoworkHub from './host/tpcoworkhub/index.ts'
import * as Teams from './host/teams/index.ts'
import { DefaultInitialization, initializationCode } from './initialization.ts'
import { bundledPythonPath } from './runtime-paths.ts'

export interface Config {
  settingsEntry: string
  skills: SkillsConfig
  mcp: McpConfig
  tpcoworkhub: TpcoworkHub.Config
  defaults: { skills: Volatile<Record<string, string>>; mcp: Volatile<Record<string, string>> }
}
export const Config = z.object({
  settingsEntry: z.string().default('tpcowork-toolbox'),
  skills: z.object({ ...SkillsConfig.dict,
    bundledRoot: z.string().default(fileURLToPath(new URL('../resources/skills/', import.meta.url))),
    python: z.string().default(bundledPythonPath()),
  }),
  mcp: McpConfig,
  tpcoworkhub: TpcoworkHub.Config,
  defaults: z.object({ skills: z.dict(z.string()).default({}).volatile(), mcp: z.dict(z.string()).default({}).volatile() }),
})
const excluded = new Set(['anysearch', ...['stock', 'fund', 'edb', 'news', 'bond', 'global-stock', 'index'].map(domain => `hexin-ifind-ds-${domain}-mcp`)])
const preservedSkillErrors = new Set(['skills/not-owned', 'skills/user-modified', 'skills/name-conflict'])
const retiredSkills = ['office-documents', 'xlsx', 'portfolio-analysis', 'corporate-ppt', 'docx', 'pdf', 'writing-plans', 'write-article', 'weekly-report', 'long-goal', 'memory', 'my', 'weather', 'cron', 'create-skill']

/** Failures are contained per resource; only successful or preserved defaults get release hashes. */
export async function initializeDefaults(ctx: Context, config: Config, signal: AbortSignal): Promise<InitializationIssue[]> {
  const issues: InitializationIssue[] = []
  const attempt = async (kind: InitializationIssue['kind'], resourceId: string, work: () => Promise<void>) => {
    signal.throwIfAborted()
    try { await work() }
    catch (error) {
      signal.throwIfAborted()
      issues.push({ kind, resourceId, code: initializationCode(error) })
    }
  }
  const installer = requireInstaller(ctx)
  const skillVersions = { ...config.defaults.skills.get() }
  for (const name of retiredSkills) await attempt('skill', name, async () => {
    const target = join(installer.options.root, name)
    if (!(await present(target))) { delete skillVersions[name]; return }
    let marker
    try { marker = await installer.owned(target) }
    catch (error) {
      if (error instanceof SkillError && preservedSkillErrors.has(error.code)) return
      throw error
    }
    if (marker.source !== `bundled:${name}`) return
    const catalog = await ctx.toolboxSkills.inventory({})
    const item = catalog.items.find(item => item.id === skillId(target) && item.origin === 'bundled')
    if (!item) throw new SkillError('skills/retired-skill-missing')
    signal.throwIfAborted()
    await ctx.toolboxSkills.retireBundled({ id: item.id, expectedRevision: catalog.revision })
    delete skillVersions[name]
  })
  await attempt('resources', 'bundled-skills', async () => {
    for (const entry of await readdir(config.skills.bundledRoot, { withFileTypes: true })) {
      const id = entry.name
      if (retiredSkills.includes(id)) continue
      await attempt('skill', id, async () => {
        if (!entry.isDirectory()) throw new SkillError('skills/default-resource-invalid')
        if (excluded.has(id)) throw new SkillError('skills/default-resource-excluded')
        const target = join(installer.options.root, id)
        if (config.skills.removedBundled.get().includes(id) || (skillVersions[id] && !(await present(target)))) return
        const files = await readTree(join(config.skills.bundledRoot, id), config.skills.maxBytes, config.skills.maxFiles)
        const hash = fingerprint(files)
        if (skillVersions[id] === hash) return
        signal.throwIfAborted()
        const requestId = randomUUID()
        const cancel = () => { void installer.cancel({ operationId: requestId }) }
        signal.addEventListener('abort', cancel, { once: true })
        try {
          const result = await installer.install({ requestId, source: { kind: 'bundled', resourceId: id }, scope: { kind: 'user' }, conflict: 'replace-owned' })
          if (result.state !== 'installed' && result.state !== 'unchanged' && !preservedSkillErrors.has(result.error?.code ?? '')) {
            issues.push({ kind: 'skill', resourceId: id, code: result.error?.code ?? 'skills/installation-failed' })
            return
          }
          skillVersions[id] = hash
        } finally { signal.removeEventListener('abort', cancel) }
      })
    }
  })
  await attempt('settings', 'skills', async () => {
    if (JSON.stringify(skillVersions) === JSON.stringify(config.defaults.skills.get())) return
    const descriptor = ctx.settings.describe().find(row => row.ns === config.settingsEntry)
    if (!descriptor) throw new SkillError('skills/settings-entry-missing')
    await ctx.settings.mutate(config.settingsEntry, [{ op: 'set', path: ['defaults', 'skills'], value: skillVersions }], descriptor.revision)
  })
  await attempt('mcp', 'default-connectors', () => retireMcpDefaults(ctx, config, signal))
  return issues
}

async function retireMcpDefaults(ctx: Context, config: Config, signal: AbortSignal): Promise<void> {
  const previous = config.mcp.servers.get()
  const rows = previous.filter(row => row.definition.origin === 'custom')
  if (rows.length === previous.length && Object.keys(config.defaults.mcp.get()).length === 0) return
  const descriptor = ctx.settings.describe().find(row => row.ns === config.settingsEntry)
  if (!descriptor) throw new Error('toolbox/default-settings-entry-missing')
  signal.throwIfAborted()
  await ctx.settings.mutate(config.settingsEntry, [
    { op: 'set', path: ['defaults', 'mcp'], value: {} },
    { op: 'set', path: ['mcp', 'servers'], value: rows },
    { op: 'set', path: ['mcp', 'configRevision'], value: Math.max(config.mcp.configRevision.get(), ...previous.map(row => row.revision)) },
  ], descriptor.revision)
}

/** Optional T5/T6 modules use this same scope and settings entry after integration; absent modules stay absent. */
export interface OptionalToolboxModule<T> { inject: string[]; apply(ctx: Context, config: T): void | Promise<void> }
export function mountOptionalModule<T>(ctx: Context, module: OptionalToolboxModule<T>, config: T): void {
  ctx.inject(module.inject, inner => module.apply(inner, config))
}

/** Management modules depend on their services, independently of default resource installation. */
export function composeToolbox(ctx: Context, config: Config): void {
  // The parent must be ACTIVE before DSH settings can edit its Loader entry.
  ctx.inject(['toolbox', 'skills', 'settings', 'profileContext'], inner => {
    applySkillsModule(inner, { ...config.skills, settingsEntry: config.settingsEntry, settingsPath: ['skills'] })
    inner.inject(['tools', 'credentials'], mcpCtx => applyMcpModule(mcpCtx, { ...config.mcp, settingsEntry: config.settingsEntry, settingsPath: ['mcp'] }, true))
    mountOptionalModule(inner, TpcoworkHub, config.tpcoworkhub)
    mountOptionalModule(inner, Teams, undefined)
    inner.inject(['toolboxInstaller', 'toolboxSkills'], async defaultsCtx => {
      const initialization = new DefaultInitialization(defaultsCtx, signal => initializeDefaults(defaultsCtx, config, signal))
      defaultsCtx.provide('toolboxInitialization', initialization)
      await initialization.retry()
    })
  })
}

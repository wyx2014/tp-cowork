/** The one toolbox Loader entry owns defaults; installed files and DSH settings remain authoritative. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { readdir, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Config as SkillsConfig, applySkillsModule, requireInstaller } from './host/skills/index.ts'
import { Config as McpConfig, applyMcpModule, defaultMcpDefinitions, type McpRecord } from './host/mcp/index.ts'
import { fingerprint, readTree, sha256 } from './host/installer/files.ts'
import { present, skillId } from './host/installer/index.ts'
import { SkillError } from './host/installer/errors.ts'
import { parseDefinition } from './host/mcp/schema.ts'
import type { McpDefinition } from './contracts/index.ts'
import * as TpcoworkHub from './host/tpcoworkhub/index.ts'
import * as Teams from './host/teams/index.ts'
import { bundledPythonPath } from './runtime-paths.ts'

export interface Config {
  settingsEntry: string
  skills: SkillsConfig
  mcp: McpConfig
  tpcoworkhub: TpcoworkHub.Config
  defaults: { skills: Volatile<Record<string, string>>; mcp: Volatile<Record<string, string>> }
  deployment: { juyuanEndpoint: string; caihuiEndpoint: string; playwrightCommand: string; playwrightArgs: string[] }
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
  deployment: z.object({
    juyuanEndpoint: z.string().default('https://api.gildata.com/mcp-servers/aidata-assistant-srv-api'),
    caihuiEndpoint: z.string().default('https://mcp.finchina.com/finchina-data-mcp-server/mcp'),
    playwrightCommand: z.string().default(''), playwrightArgs: z.array(z.string()).default([]),
  }),
})
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const excluded = new Set(['anysearch', ...['stock', 'fund', 'edb', 'news', 'bond', 'global-stock', 'index'].map(domain => `hexin-ifind-ds-${domain}-mcp`)])
const preservedSkillErrors = new Set(['skills/not-owned', 'skills/user-modified', 'skills/name-conflict'])
const retiredSkills = ['office-documents', 'xlsx', 'portfolio-analysis', 'corporate-ppt', 'docx', 'pdf']

function definitionHash(definition: McpDefinition): string {
  return sha256(JSON.stringify([definition.id, definition.label, definition.origin,
    definition.credentials.map(binding => [binding.ref, binding.target, binding.key]), definition.transport,
    definition.transport === 'stdio' ? [definition.command, definition.args, definition.cwd ?? null] : [definition.endpoint],
  ]))
}

/** A packed launcher is offered only when its pinned dependency and offline browser are present. */
async function localPlaywright(ctx: Context): Promise<{ command: string; args: string[] } | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'runtime/playwright.json'), 'utf8')) as { version?: string; executable?: string; platform?: string; arch?: string; archive?: string; archiveSha256?: string }
    const dependency = JSON.parse(await readFile(join(packageRoot, 'node_modules/@playwright/mcp/package.json'), 'utf8')) as { version?: string }
    if (manifest.version !== '0.0.30' || dependency.version !== manifest.version || manifest.platform !== process.platform || manifest.arch !== process.arch || !manifest.executable
      || manifest.executable.includes('..') || manifest.executable.startsWith('/')) return undefined
    if (manifest.archive !== 'browsers.tar.gz' || !/^[a-f0-9]{64}$/.test(manifest.archiveSha256 ?? '')) return undefined
    await access(join(packageRoot, 'runtime', manifest.archive))
    return { command: process.execPath, args: [join(packageRoot, 'lib/playwright-launcher.mjs'), '--cache-dir', join(ctx.profileContext.dir, 'toolbox-runtime/playwright')] }
  } catch { return undefined }
}

/** First install and upgrades only add unseen defaults or replace unmodified, product-owned resources. */
export async function initializeDefaults(ctx: Context, config: Config): Promise<void> {
  const installer = requireInstaller(ctx)
  const skillVersions = { ...config.defaults.skills.get() }
  for (const name of retiredSkills) {
    const target = join(installer.options.root, name)
    if (!(await present(target))) { delete skillVersions[name]; continue }
    let marker
    try { marker = await installer.owned(target) }
    catch (error) {
      if (error instanceof SkillError && preservedSkillErrors.has(error.code)) continue
      throw error
    }
    if (marker.source !== `bundled:${name}`) continue
    const catalog = await ctx.toolboxSkills.inventory({})
    const item = catalog.items.find(item => item.id === skillId(target) && item.origin === 'bundled')
    if (!item) throw new Error(`toolbox/retired-skill-missing:${name}`)
    await ctx.toolboxSkills.remove({ id: item.id, expectedRevision: catalog.revision })
    delete skillVersions[name]
  }
  for (const entry of await readdir(config.skills.bundledRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) throw new Error('toolbox/default-resource-invalid')
    const id = entry.name
    if (retiredSkills.includes(id)) continue
    if (excluded.has(id)) throw new Error('toolbox/default-resource-excluded')
    const files = await readTree(join(config.skills.bundledRoot, id), config.skills.maxBytes, config.skills.maxFiles)
    const hash = fingerprint(files)
    const target = join(installer.options.root, id)
    if (config.skills.removedBundled.get().includes(id) || (skillVersions[id] && !(await present(target)))) continue
    if (skillVersions[id] === hash) continue
    const result = await installer.install({ requestId: randomUUID(), source: { kind: 'bundled', resourceId: id }, scope: { kind: 'user' }, conflict: 'replace-owned' })
    if (result.state !== 'installed' && result.state !== 'unchanged' && !preservedSkillErrors.has(result.error?.code ?? '')) {
      throw new Error(`toolbox/default-install-failed:${result.error?.code ?? result.state}`)
    }
    skillVersions[id] = hash
  }
  const playwright = config.deployment.playwrightCommand
    ? { command: config.deployment.playwrightCommand, args: config.deployment.playwrightArgs }
    : await localPlaywright(ctx)
  const definitions = defaultMcpDefinitions({
    juyuanEndpoint: config.deployment.juyuanEndpoint, caihuiEndpoint: config.deployment.caihuiEndpoint,
    ...(playwright ? { playwright } : {}),
  })
  const versions = { ...config.defaults.mcp.get() }
  const previous = config.mcp.servers.get()
  // Only explicitly product-owned legacy defaults are retired; custom IDs always survive.
  const rows: McpRecord[] = previous.filter(row => !(row.definition.origin === 'bundled' && excluded.has(row.definition.id)))
    .map(row => ({ definition: parseDefinition(row.definition), revision: row.revision }))
  let revision = Math.max(config.mcp.configRevision.get(), ...previous.map(row => row.revision))
  for (const definition of definitions) {
    const current = rows.find(row => row.definition.id === definition.id)
    const hash = definitionHash(definition)
    if (config.mcp.removedBundled.get().includes(definition.id) || (!current && versions[definition.id])) continue
    if (!current) rows.push({ definition, revision: ++revision })
    else if (current.definition.origin === 'bundled' && versions[definition.id] === definitionHash(current.definition) && versions[definition.id] !== hash) {
      current.definition = { ...definition, enabled: current.definition.enabled }
      current.revision = ++revision
    }
    // An existing definition with no prior release hash is an override, never assumed safe to replace.
    versions[definition.id] = hash
  }
  const descriptor = ctx.settings.describe().find(row => row.ns === config.settingsEntry)
  if (!descriptor) throw new Error('toolbox/default-settings-entry-missing')
  if (JSON.stringify(skillVersions) === JSON.stringify(config.defaults.skills.get())
    && JSON.stringify(versions) === JSON.stringify(config.defaults.mcp.get()) && JSON.stringify(rows) === JSON.stringify(previous)) return
  await ctx.settings.mutate(config.settingsEntry, [
    { op: 'set', path: ['defaults', 'skills'], value: skillVersions },
    { op: 'set', path: ['defaults', 'mcp'], value: versions },
    { op: 'set', path: ['mcp', 'servers'], value: rows },
    { op: 'set', path: ['mcp', 'configRevision'], value: revision },
  ], descriptor.revision)
}

/** Optional T5/T6 modules use this same scope and settings entry after integration; absent modules stay absent. */
export interface OptionalToolboxModule<T> { inject: string[]; apply(ctx: Context, config: T): void | Promise<void> }
export function mountOptionalModule<T>(ctx: Context, module: OptionalToolboxModule<T>, config: T): void {
  ctx.inject(module.inject, inner => module.apply(inner, config))
}

/** Compose only after DSH authorities exist. Defaults finish before exposing MCP management. */
export function composeToolbox(ctx: Context, config: Config): void {
  // The parent must be ACTIVE before DSH settings can edit its Loader entry.
  ctx.inject(['toolbox', 'skills', 'settings', 'profileContext'], inner => {
    applySkillsModule(inner, { ...config.skills, settingsEntry: config.settingsEntry, settingsPath: ['skills'] })
    inner.inject(['toolboxInstaller'], async defaultsCtx => {
      await initializeDefaults(defaultsCtx, config)
      mountOptionalModule(defaultsCtx, TpcoworkHub, config.tpcoworkhub)
      defaultsCtx.inject(['tools', 'credentials'], mcpCtx => applyMcpModule(mcpCtx, { ...config.mcp, settingsEntry: config.settingsEntry, settingsPath: ['mcp'] }))
      mountOptionalModule(defaultsCtx, Teams, undefined)
    })
  })
}

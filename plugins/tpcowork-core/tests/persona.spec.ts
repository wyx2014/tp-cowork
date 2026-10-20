import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '../../../../deepseek-harness/vendor/cordis/src/index.ts'
import { entryListSchema } from '../../../../deepseek-harness/vendor/include/src/index.ts'
import SystemPrompt, { renderPrompt, type Config } from '../../../../deepseek-harness/packages/core/system-prompt/src/index.ts'
import { createScope, type ScopeKey } from '../../../../deepseek-harness/packages/core/scope/src/index.ts'
import * as Persona from '../../../../deepseek-harness/packages/preset/persona/src/index.ts'

const requireHarness = createRequire(process.cwd() + '/package.json')
const core = requireHarness(resolve('../plugins/tpcowork-core/index.js'))
const { load } = requireHarness('js-yaml')
const codingPersona = 'You are a coding agent powered by the {{model}} model.'
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

async function harness(config: Config = { personaPrefix: codingPersona }): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, config).await()
  ctx.systemPrompt.variable('model', () => 'test-model')
  return ctx
}

async function presetPersona(preset: string): Promise<Persona.Config> {
  const source = await readFile(resolve(`packages/bundle/web-app/presets/${preset}.patch.yml`), 'utf8')
  const patches = load(source, { schema: entryListSchema }) as { insert: { config: { plugins: { id: string; config: Persona.Config }[] } }[] }[]
  return patches[0]!.insert[0]!.config.plugins.find(row => row.id === 'persona')!.config
}

it('assembles the office identity with the configured model while retaining tools, guidance and runtime context', async () => {
  const ctx = await harness()
  const tool = { name: 'read_document', description: 'Read a document.', parameters: { type: 'object' } }
  ctx.systemPrompt.tools(() => ({ schemas: [tool] }))
  ctx.systemPrompt.section({ name: 'guidance', order: 100, text: 'Use the available tools to complete the requested work.' })
  ctx.systemPrompt.context({ name: 'workspace', order: 100, required: true, text: 'Workspace: /office' })
  await ctx.plugin(core).await()
  const assembly = await ctx.systemPrompt.assemble()
  const prompt = renderPrompt(assembly)
  expect(prompt).toContain('你是 TP Cowork，一位面向日常办公的 AI 助手。')
  expect(prompt).toContain('当前底层模型是 test-model')
  expect(prompt).not.toContain('You are an AI agent powered by DeepSeek Harness.')
  expect(prompt).not.toContain('You are a coding agent')
  expect(assembly.tools).toEqual([tool])
  expect(assembly.contexts[0]?.text).toBe('Workspace: /office')
  await expect(prompt + '\n').toMatchFileSnapshot(resolve('../plugins/tpcowork-core/tests/fixtures/persona.expected.md'))
})

it.each(['standard', 'cordis', 'ptc'])('applies the office identity after the shipped %s preset shadows the deployment persona', async (preset) => {
  const ctx = await harness()
  await ctx.plugin(core).await()
  const key: ScopeKey = { agent: preset }
  await createScope(ctx, key).ctx.plugin(Persona, await presetPersona(preset)).await()
  const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
  expect(prompt).toContain('你好！我是 TP Cowork，你的 AI 办公助手。')
  expect(prompt).not.toContain('You are a coding agent')
  expect(prompt).not.toContain('You are a helpful software engineer assistant.')
})

it('preserves a scoped custom role and suffix', async () => {
  const ctx = await harness()
  await ctx.plugin(core).await()
  const key: ScopeKey = { agent: 'researcher' }
  await createScope(ctx, key).ctx.plugin(Persona, {
    prefix: 'You research the requested topic.', suffix: 'Cite the supplied documents.',
  }).await()
  expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: key })))
    .toBe('You research the requested topic.\n\nCite the supplied documents.')
})

it('respects an explicitly complete prompt', async () => {
  const ctx = await harness()
  await ctx.plugin(core).await()
  const key: ScopeKey = { agent: 'complete' }
  await createScope(ctx, key).ctx.plugin(Persona, { prefix: codingPersona, complete: true }).await()
  expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: key })))
    .toBe('You are a coding agent powered by the test-model model.')
})

it('restores the original prompt when the Host plugin unloads', async () => {
  const ctx = await harness()
  const original = renderPrompt(await ctx.systemPrompt.assemble())
  const plugin = ctx.plugin(core)
  await plugin.await()
  expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toBe(original)
  await plugin.dispose()
  expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(original)
})

it('respects the shipped Minimal preset complete prompt and runtime-context policy', async () => {
  const ctx = await harness()
  await ctx.plugin(core).await()
  ctx.systemPrompt.context({ name: 'optional', order: 100, text: 'Optional workspace context.' })
  const key: ScopeKey = { agent: 'minimal' }
  await createScope(ctx, key).ctx.plugin(Persona, await presetPersona('minimal')).await()
  const assembly = await ctx.systemPrompt.assemble({ scope: key })
  expect(renderPrompt(assembly)).toBe('You are a helpful software engineer assistant.')
  expect(assembly.contexts).toEqual([])
})

it('provides the product identity when the deployment has no persona', async () => {
  const ctx = await harness({})
  await ctx.plugin(core).await()
  expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('你是 TP Cowork，一位面向日常办公的 AI 助手。')
})

it('preserves deployment roles, suffixes, tool ordering and runtime-context policy', async () => {
  const ctx = await harness({
    personaPrefix: 'You assist with office research.',
    personaSuffix: 'Cite the supplied documents.',
    includeRuntimeContext: false,
    toolOrder: ['write_document', '<unlisted-tools>'],
  })
  ctx.systemPrompt.tools(() => ({ schemas: ['read_document', 'write_document'].map(name => ({
    name, description: name, parameters: { type: 'object' },
  })) }))
  ctx.systemPrompt.context({ name: 'workspace', order: 100, text: 'Optional workspace context.' })
  ctx.systemPrompt.context({ name: 'policy', order: 200, required: true, text: 'Required policy.' })
  await ctx.plugin(core).await()
  const assembly = await ctx.systemPrompt.assemble()
  expect(renderPrompt(assembly)).toBe('You assist with office research.\n\nCite the supplied documents.')
  expect(assembly.tools.map(tool => tool.name)).toEqual(['write_document', 'read_document'])
  expect(assembly.contexts.map(context => context.text)).toEqual(['Required policy.'])
})

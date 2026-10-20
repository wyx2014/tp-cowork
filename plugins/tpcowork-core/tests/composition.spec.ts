import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '../../../../deepseek-harness/vendor/cordis/src/index.ts'
import Loader from '../../../../deepseek-harness/vendor/loader/src/index.ts'
import Include from '../../../../deepseek-harness/vendor/include/src/index.ts'
import SystemPrompt, { renderPrompt } from '../../../../deepseek-harness/packages/core/system-prompt/src/index.ts'

const requireHarness = createRequire(process.cwd() + '/package.json')
const { load, dump } = requireHarness('js-yaml')
let ctx: Context | undefined
let directory: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  if (directory) await rm(directory, { recursive: true, force: true })
})

it('loads the shipped core and UI entries through a profile and toggles identity and appearance independently', async () => {
  directory = await mkdtemp(join(tmpdir(), 'tpcowork-core-'))
  const rows = [{ id: 'system-prompt', name: 'prompt', config: {
    personaPrefix: 'You are a coding agent powered by the {{model}} model.',
  } }]
  const modules = new Map<string, unknown>([['prompt', SystemPrompt]])
  for (const plugin of ['core', 'ui']) {
    const root = resolve(`../plugins/tpcowork-${plugin}`)
    const patches = load(await readFile(join(root, 'cordis.patch.yml'), 'utf8')) as { insert: typeof rows }[]
    rows.push(...patches[0]!.insert)
    modules.set(`@tpcowork/dsh-${plugin}`, requireHarness(join(root, 'index.js')))
  }
  const config = join(directory, 'cordis.yml')
  await writeFile(config, dump(rows))
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', import: async (id: string) => {
    if (!modules.has(id)) throw new Error(`Missing test module ${id}`)
    return modules.get(id)
  } } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  ctx.systemPrompt.variable('model', () => 'test-model')
  const prompt = async () => renderPrompt(await ctx!.systemPrompt.assemble())
  const appearance = () => {
    const injections: { kind: string; text: string }[] = []
    ctx!.emit('webserver/index-inject', injections)
    return injections
  }
  const entries = [...ctx.loader.entries()]
  const core = entries.find(entry => entry.options.name === '@tpcowork/dsh-core')!
  const ui = entries.find(entry => entry.options.name === '@tpcowork/dsh-ui')!
  const branded = await prompt()
  const styled = appearance()
  expect(branded).toContain('你是 TP Cowork，一位面向日常办公的 AI 助手。')
  expect(styled.map(row => row.kind)).toEqual(['style', 'script'])

  await ui.update({ disabled: true })
  await ctx.loader.await()
  expect(await prompt()).toBe(branded)
  expect(appearance()).toEqual([])

  await ui.update({ disabled: false })
  await ctx.loader.await()
  await core.update({ disabled: true })
  await ctx.loader.await()
  const upstream = await prompt()
  expect(upstream).toContain('You are an AI agent powered by DeepSeek Harness.')
  expect(upstream).not.toContain('TP Cowork')
  expect(appearance()).toEqual(styled)

  await ui.update({ disabled: true })
  await ctx.loader.await()
  expect(await prompt()).toBe(upstream)
  expect(appearance()).toEqual([])

  await core.update({ disabled: false })
  await ctx.loader.await()
  expect(await prompt()).toBe(branded)
  expect(appearance()).toEqual([])
})

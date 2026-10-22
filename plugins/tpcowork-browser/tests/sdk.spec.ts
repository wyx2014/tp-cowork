import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mountWorkflowRuntime } from '../../../../deepseek-harness/packages/workflow/workflow-ptc/tests/setup.ts'
import { externalTestParent } from '../../../../deepseek-harness/packages/subagent/subagent/tests/external-activation-helpers.ts'
import { createSkillProvider } from '../src/skills.js'

// The SDK, its docs and the skills exist only in a build, as in the distributable.
const output = resolve('../plugins/tpcowork-browser', process.env.BROWSER_TEST_OUTPUT ?? 'lib')
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let context: Context | undefined
let root: string | undefined
const originalSend = Object.getOwnPropertyDescriptor(process, 'send')
const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected')
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const [key, value] of [['send', originalSend], ['connected', originalConnected]] as const) {
    if (value) Object.defineProperty(process, key, value)
    else Reflect.deleteProperty(process, key)
  }
  if (root) await rm(root, { recursive: true, force: true })
})

/** A desktop bridge fake that answers the commands the reference client sends, and records them. */
function fakeDesktop(commands: { method: string; tabId?: string; action?: { name: string } }[]) {
  const tab = { tabId: 'tab-1', url: 'https://example.com/', title: 'Example', viewport: { width: 1280, height: 720 }, active: true }
  const answer = (command: { method: string; action?: { name: string; operation?: string } }) => {
    const meta = { tabId: tab.tabId, currentUrl: tab.url }
    if (command.method === 'list') return { ok: true, tabs: commands.some(row => row.method === 'newTab') ? [tab] : [] }
    if (command.method === 'newTab') return { ok: true, tab, meta }
    if (command.method === 'screenshot') return { ok: true, image: { base64: PNG }, meta }
    if (command.action?.operation === 'click') return { ok: false, error: { code: 'timeout', message: 'Locator matched no element' } }
    return { ok: true, meta }
  }
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  Object.defineProperty(process, 'send', { configurable: true, value: (message: { kind: string; op: string; payload?: { command?: never } }, callback: (error?: Error) => void) => {
    queueMicrotask(() => {
      if (message.kind !== 'request') return
      let value: unknown = {}
      if (message.op === 'enable') value = { version: 1 }
      if (message.op === 'ambient') value = { tabCount: 0 }
      if (message.op === 'command') { commands.push(message.payload!.command!); value = answer(message.payload!.command!) }
      process.emit('message', { ...message, kind: 'result', value }, undefined)
    })
    callback()
  } })
}

it.skipIf(!existsSync(join(output, 'browser-client.mjs')))('a sandboxed run_code program drives the browser tools through the reference agent.browsers SDK', async () => {
  root = await mkdtemp(join(homedir(), '.dsh-browser-sdk-test-'))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  const commands: { method: string; tabId?: string; action?: { name: string } }[] = []
  fakeDesktop(commands)
  context = new Context()
  provideWorkingDirectoryFixture(context)
  await context.plugin(SystemPrompt)
  await context.plugin(Tools, { mode: 'ptc' })
  // The real Node runtime under the restricted file policy, as the PTC agent preset uses.
  await mountWorkflowRuntime(context, { cwd, mode: 'workspace-write', runtimeConfig: { graceMs: 50 } })
  const saved: unknown[] = []
  context.provide('attachments', { saveImage: async (image: unknown) => { saved.push(image); return { kind: 'image', id: `image-${saved.length}` } } } as never)
  const Browser = await import(pathToFileURL(join(output, 'host.js')).href)
  await context.plugin(Browser)
  const agent = await externalTestParent(context, cwd)

  const assembly = await context.systemPrompt.assemble({ agent } as never)
  expect(assembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
  const guidance = assembly.sections.find(section => section.name === 'tpcowork-browser:usage')!.text
  const url = /await import\((".+?")\)/.exec(guidance)![1]!
  // The SDK is a private copy outside the package, so a packaged app.asar never has to be imported.
  expect(JSON.parse(url)).toMatch(/^file:.*tpcowork-browser-sdk-/)
  expect(fileURLToPath(JSON.parse(url)).startsWith(output)).toBe(false)

  const code = `
const { setupBrowserRuntime } = await import(${url});
await setupBrowserRuntime({ globals: globalThis, tools, ToolCallError });
const browser = await agent.browsers.getDefault();
const before = await browser.tabs.list();
const tab = await browser.tabs.new();
await tab.goto("https://example.com/");
await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
const png = await tab.screenshot();
let failure;
try { await tab.playwright.getByRole("button", { name: "Missing" }).click(); }
catch (error) { failure = { name: error.name, message: error.message, cause: { name: error.cause?.name, code: error.cause?.code } }; }
const docs = await browser.documentation();
return JSON.parse(JSON.stringify({ type: browser.type, before, tabId: tab.id, pngBytes: png.length, failure,
  documentation: { runCode: docs.includes("run_code"), nodeRepl: docs.includes("nodeRepl") } }));`
  const result = await context.tools.execute({ agent, signal: new AbortController().signal, callId: ToolCallId('program'), name: RUN_CODE_NAME,
    arguments: { code, description: 'Drive the browser through the SDK' } })
  expect(result.isError, JSON.stringify(result.content)).toBe(false)
  expect((result.value as { sandbox: unknown }).sandbox).toMatchObject({ mode: 'workspace-write', denied: false })
  expect((result.value as { result: unknown }).result).toMatchObject({ type: 'iab', before: [], tabId: 'tab-1', pngBytes: Buffer.from(PNG, 'base64').length,
    // The reference adds the locator to the message and keeps the command error as its cause.
    failure: { name: 'Error', message: expect.stringContaining('Locator matched no element'), cause: { name: 'BrowserCommandError', code: 'browser_command_failed' } },
    documentation: { runCode: true, nodeRepl: false } })
  expect(commands.map(command => command.action ? `${command.method}:${command.action.name}` : command.method))
    .toEqual(['list', 'newTab', 'navigate', 'playwright:waitForLoadState', 'screenshot', 'playwright:locator'])
  // The screenshot reaches the model as an image after the program, without its bytes in any text.
  expect(saved).toHaveLength(1)
  expect(result.additionalContexts?.flatMap(message => message.content.map(block => block.type))).toContain('image')
  expect(JSON.stringify(result.content)).not.toContain(PNG)
  // Unloading the plugin removes its private SDK copy.
  await context.fiber.dispose()
  context = undefined
  expect(existsSync(fileURLToPath(JSON.parse(url)))).toBe(false)
})

it('offers the reference browser skills, with the SDK address in the program bootstrap', async () => {
  const provider = createSkillProvider(async () => 'file:///private/sdk/browser-client.mjs')
  const candidates = await provider.list()
  expect(candidates.map((row: { name: string }) => row.name)).toEqual(['control-browser', 'web-gui-tester'])
  const signal = new AbortController().signal
  const control = await provider.get(candidates[0], { signal })
  expect(control.content).toContain('await import("file:///private/sdk/browser-client.mjs")')
  expect(control.content).not.toContain('BROWSER_SDK_URL')
  const unavailable = await createSkillProvider(async () => undefined).get(candidates[0], { signal })
  expect(unavailable.content).toContain('drive the browser with the browser_* tools')
  expect((await provider.get(candidates[1], { signal })).content).toContain('Pure GUI black-box testing')
})

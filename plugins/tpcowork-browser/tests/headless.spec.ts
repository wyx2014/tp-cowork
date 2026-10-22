import { afterEach, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as Browser from '../src/host.js'
import { resolveConfig } from '../src/config.js'
import { createHeadlessBackend } from '../src/headless.js'

// The reference's own executable search; the test needs one installed Chrome-family browser.
// A cold Chrome launch on a busy machine can exceed the default 5 s test budget.
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(path => existsSync(path))

let context: Context | undefined
let server: Server | undefined
const originalSend = Object.getOwnPropertyDescriptor(process, 'send')
const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected')
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const [key, value] of [['send', originalSend], ['connected', originalConnected]] as const) {
    if (value) Object.defineProperty(process, key, value)
    else Reflect.deleteProperty(process, key)
  }
  await new Promise(resolve => server ? server.close(resolve) : resolve(undefined))
  server = undefined
})

async function site(): Promise<string> {
  server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Headless acceptance</title><h1>Waiting</h1><label>Name<input></label><button onclick="document.querySelector(\'h1\').textContent=\'Hello \'+document.querySelector(\'input\').value">Greet</button>')
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}/`
}

it('validates the backend choice and requires an absolute executable path', () => {
  expect(resolveConfig({}).backend).toBe('desktop')
  expect(resolveConfig({ backend: 'auto', executablePath: '/opt/chrome' })).toMatchObject({ backend: 'auto', executablePath: '/opt/chrome' })
  expect(() => resolveConfig({ backend: 'cdp' })).toThrow(/desktop, headless or auto/)
  expect(() => resolveConfig({ backend: 'headless', executablePath: 'chrome' })).toThrow(/absolute/)
})

/** The DSH Node-mode Host runner: an IPC carrier whose bridge has no native browser. */
function nodeModeRunner() {
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  Object.defineProperty(process, 'send', { configurable: true, value: (message: Record<string, unknown>, callback: () => void) => {
    queueMicrotask(() => process.emit('message', { type: 'tpcowork-browser', version: 1, kind: 'result', id: message.id,
      error: { code: 'native_unavailable', message: 'The desktop browser bridge is unavailable in this Host runner.' } }, undefined))
    callback()
  } })
}

async function mountBrowser(config: object) {
  context = new Context()
  await context.plugin(SystemPrompt)
  await context.plugin(Tools)
  context.provide('workingDirectory', { get: () => process.cwd() } as never)
  context.provide('attachments', { saveImage: async () => ({ kind: 'image', id: 'shot' }) } as never)
  await context.plugin(Browser, config)
}

it('auto falls back to headless only when this Host has no desktop browser', async () => {
  nodeModeRunner()
  await mountBrowser({ backend: 'auto' })
  expect(context!.tools.get('browser_tabs')).toBeDefined()
  await context!.fiber.dispose()
  context = undefined
  nodeModeRunner()
  // An explicit desktop choice never silently switches to another browser.
  await expect(mountBrowser({ backend: 'desktop' })).rejects.toThrow(/bridge is unavailable/)
  expect(context!.tools.get('browser_tabs')).toBeUndefined()
})

it('never launches Chromium only to describe a Session that has not used it', async () => {
  let loads = 0
  const backend = createHeadlessBackend(resolveConfig({ backend: 'headless' }), { loadPlaywright: async () => { loads++; throw new Error('unexpected launch') } })
  try {
    expect(await backend.call('enable')).toMatchObject({ version: 1, headless: true })
    expect(await backend.call('ambient', { sessionId: 'idle' })).toEqual({ tabCount: 0 })
    expect(loads).toBe(0)
  } finally { await backend.dispose() }
})

it.skipIf(!chrome)('drives the managed headless Chromium through the same browser tools', async () => {
  const url = await site()
  context = new Context()
  await context.plugin(SystemPrompt)
  await context.plugin(Tools)
  const saved: unknown[] = []
  context.provide('workingDirectory', { get: () => process.cwd() } as never)
  context.provide('attachments', { saveImage: async (image: unknown) => { saved.push(image); return { kind: 'image', id: 'shot' } } } as never)
  await context.plugin(Browser, { backend: 'headless', executablePath: chrome })
  const agent = { session: Session.create(SessionId('headless-owner')) }
  const call = async (name: string, command: Record<string, unknown>) => {
    const result = await context!.tools.execute({ agent: agent as never, signal: new AbortController().signal, callId: ToolCallId(`call-${name}`), name, arguments: { command } })
    expect(result.isError, JSON.stringify(result.content)).toBe(false)
    return result.value as Record<string, any>
  }
  const created = await call('browser_tabs', { method: 'newTab' })
  const tabId = created.tab.tabId ?? created.tab.id
  await call('browser_navigate', { method: 'navigate', tabId, url })
  await call('browser_act', { method: 'playwright', tabId, action: { name: 'waitForLoadState', state: 'domcontentloaded' } })
  const snapshot = await call('browser_act', { method: 'playwright', tabId, action: { name: 'domSnapshot' } })
  expect(JSON.stringify(snapshot)).toContain('Greet')
  await call('browser_act', { method: 'playwright', tabId, action: { name: 'locator', selector: 'internal:role=textbox[name="Name"i]', operation: 'fill', value: 'DSH' } })
  await call('browser_act', { method: 'playwright', tabId, action: { name: 'locator', selector: 'internal:role=button[name="Greet"i]', operation: 'click' } })
  const heading = await call('browser_act', { method: 'playwright', tabId, action: { name: 'locator', selector: 'h1', operation: 'textContent' } })
  expect(heading.value).toBe('Hello DSH')
  const shot = await call('browser_screenshot', { method: 'screenshot', tabId })
  expect(shot.attachment).toEqual({ kind: 'image', id: 'shot' })
  expect(saved).toHaveLength(1)
  const tabs = await call('browser_tabs', { method: 'list' })
  expect(tabs.tabs).toEqual([expect.objectContaining({ tabId, url, title: 'Headless acceptance' })])
}, 30000)

it.skipIf(!chrome)('reports open headless tabs for ambient context and closes them with the Session', async () => {
  const url = await site()
  const backend = createHeadlessBackend(resolveConfig({ backend: 'headless', executablePath: chrome }))
  try {
    const created = await backend.call('command', { sessionId: 'owner', command: { method: 'newTab' } })
    expect(created.ok, JSON.stringify(created)).toBe(true)
    const tabId = created.tab.tabId ?? created.tab.id
    expect((await backend.call('command', { sessionId: 'owner', command: { method: 'navigate', tabId, url } })).ok).toBe(true)
    expect(await backend.call('ambient', { sessionId: 'owner' })).toEqual({ tabCount: 1, currentUrl: url })
    // Another Session neither sees nor reaches these tabs.
    expect(await backend.call('ambient', { sessionId: 'other' })).toEqual({ tabCount: 0 })
    await backend.closeSession('owner')
    expect(await backend.call('ambient', { sessionId: 'owner' })).toEqual({ tabCount: 0 })
    // A later Session relaunches Chromium under a new generation and still works.
    const again = await backend.call('command', { sessionId: 'next', command: { method: 'newTab' } })
    expect(again.ok, JSON.stringify(again)).toBe(true)
  } finally { await backend.dispose() }
}, 30000)

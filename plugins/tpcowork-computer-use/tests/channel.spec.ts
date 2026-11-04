import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { NativeClient, NativeError } from '@deepseek-ai/dsh-cua/native-client'
import { helperChannel } from '../src/host.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const step of cleanup.splice(0)) await step() })

/** A stand-in Cua Driver module with the SDK's shape; one tool blocks until cancelled, to exercise cancellation. */
const FAKE = `export class CuaDriver {
  static create() { return new CuaDriver() }
  async callTool(name, json, options) {
    const args = JSON.parse(json)
    if (name === 'list_apps') return { rawJson: JSON.stringify({ structuredContent: { apps: [{ pid: 4242, name: 'Probe', running: true, kind: 'desktop' }] } }) }
    if (name === 'list_windows') return { rawJson: JSON.stringify({ structuredContent: { windows: [] } }) }
    if (name === 'type_text') return await new Promise((resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
    if (name === 'check_permissions') return { rawJson: JSON.stringify({ structuredContent: { accessibility: true } }) }
    return { rawJson: JSON.stringify({ isError: true, content: [{ type: 'text', text: 'unexpected ' + name + ' ' + JSON.stringify(args) }] }) }
  }
  async shutdown() {}
  uniffiDestroy() {}
}`

it('runs dsh-cua\'s own NativeClient over the helper process: requests, refusals and cancellation keep the connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpcowork-cu-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const driver = join(directory, 'driver.mjs')
  await writeFile(driver, FAKE)
  const config = { helperPath: new URL('../lib/helper.mjs', import.meta.url).pathname, cwd: directory, timeoutMs: 10_000, connectTimeoutMs: 5000,
    screenshotTimeoutMs: 5000, axTimeoutMs: 3000, maxRequestBytes: 1 << 20, maxResponseBytes: 1 << 24, graceMs: 2000, textEventIntervalMs: 0 }
  const client = new NativeClient({ subprocess: { spawn: () => { throw new Error('unused') } } as never }, config, helperChannel(pathToFileURL(driver).href))
  cleanup.push(() => client.dispose())
  const signal = new AbortController().signal
  expect(await client.request('getCapabilities', {}, signal)).toMatchObject({ permissions: { accessibility: true } })
  const app = await client.request('getApp', { selector: 'Probe' }, signal) as { appHandle: string; authorization: { persistable: boolean } }
  expect(app).toMatchObject({ pid: 4242, name: 'Probe' })
  expect(await client.request('getState', { appHandle: app.appHandle }, signal)).toMatchObject({ windowId: null, tree: 'Probe has no windows.' })
  await expect(client.request('getApp', { selector: 'Nothing' }, signal)).rejects.toMatchObject({ code: 'APP_NOT_FOUND' })
  // A cancelled input answers NATIVE_CANCELLED and the same connection keeps working.
  const cancel = new AbortController()
  const typing = client.request('typeText', { appHandle: app.appHandle, text: 'x' }, cancel.signal)
  setTimeout(() => { cancel.abort() }, 100)
  await expect(typing).rejects.toBeInstanceOf(NativeError)
  await expect(typing).rejects.toMatchObject({ code: 'NATIVE_CANCELLED' })
  expect(client.disposed).toBe(false)
  expect(await client.request('listApps', {}, signal)).toEqual([{ pid: 4242, name: 'Probe' }])
})

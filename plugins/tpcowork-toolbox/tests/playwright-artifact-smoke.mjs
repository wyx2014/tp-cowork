/** Negotiate the pinned launcher and use its packaged browser against a local page. No public sites. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
const root = process.env.TOOLBOX_PACKAGE_ROOT ?? fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(fileURLToPath(new URL('../../../../deepseek-harness/packages/mcp/mcp-client/package.json', import.meta.url)))
const { Client } = require('@modelcontextprotocol/client')
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio')
const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Toolbox offline fixture</title><h1>Packaged browser</h1>') })
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
const client = new Client({ name: 'toolbox-release-smoke', version: '1.0.0' })
const cache = await mkdtemp(join(tmpdir(), 'toolbox-browser-cache-'))
const options = { command: process.execPath, args: [resolve(root, 'lib/playwright-launcher.mjs'), '--cache-dir', cache], stderr: 'pipe' }
const transport = new StdioClientTransport(options)
const concurrent = new Client({ name: 'toolbox-concurrent-smoke', version: '1.0.0' })
const other = new StdioClientTransport(options)
for (const stream of [transport.stderr, other.stderr]) stream?.on('data', bytes => process.stderr.write(bytes))
let phase = 'concurrent cold extraction and handshake'
const started = Date.now()
try {
  // Cold extraction competes for disk/CPU on shared build hosts; keep a finite, explicit budget.
  console.log(`Playwright smoke: ${phase}`)
  await Promise.all([client.connect(transport, { timeout: 120000 }), concurrent.connect(other, { timeout: 120000 })])
  console.log(`Playwright smoke: both handshakes completed in ${Date.now() - started}ms`)
  phase = 'tool discovery'
  const tools = await client.listTools()
  assert.ok(tools.tools.some(tool => tool.name === 'browser_navigate'))
  phase = 'local browser navigation'
  const result = await client.callTool({ name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${server.address().port}/` } })
  assert.ok(!result.isError, JSON.stringify(result))
  assert.match(JSON.stringify(result), /Toolbox offline fixture/)
  assert.equal((await readdir(cache)).filter(name => !name.startsWith('.')).length, 1)
  assert.equal((await readdir(cache)).filter(name => name.startsWith('.prepare-')).length, 0)
  console.log(`Pinned Playwright 0.0.30: ${tools.tools.length} tools, concurrent cold extraction and packaged Chromium navigation passed.`)
} catch (error) {
  console.error(`Playwright smoke failed during ${phase} after ${Date.now() - started}ms`)
  throw error
} finally {
  await Promise.all([client.close(), concurrent.close()]); await Promise.all([transport.close(), other.close()])
  await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()))
  await rm(cache, { recursive: true, force: true })
}

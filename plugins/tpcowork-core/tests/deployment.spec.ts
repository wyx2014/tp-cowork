import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { buildCore } from '../build.mjs'
import { credentialReference, initializeDeploymentCredential, loadDeployment, resolveDeployment } from '../deployment.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'tpcowork-deployment-'))
  directories.push(root)
  return { root, url: pathToFileURL(root + '/') }
}

it('imports the reference once and prepares a portable bundle with a private deployment file and a secret-free patch', async () => {
  const reference = await directory()
  const output = await directory()
  await mkdir(join(reference.root, 'config/provider'), { recursive: true })
  await writeFile(join(reference.root, 'config/provider/desktop-deployment.local.json'), JSON.stringify({
    apiBase: 'http://gateway.test/v1', apiKey: 'deployment-test-key',
  }))
  await buildCore({ directory: output.url, referenceRoot: reference.root, env: {} })
  await rm(reference.root, { recursive: true })
  const deployed = await loadDeployment(output.url, {})
  expect(deployed.apiBase).toBe('http://gateway.test/v1')
  expect(deployed.apiKey).toBe('deployment-test-key')
  const patch = await readFile(join(output.root, 'model.patch.yml'), 'utf8')
  expect(patch).not.toContain('deployment-test-key')
  expect(patch).not.toContain(reference.root)
  if (process.platform !== 'win32') expect((await stat(join(output.root, 'deployment.local.json'))).mode & 0o777).toBe(0o600)
})

it('uses build environment overrides and supports another intranet model and capacity', async () => {
  const output = await directory()
  await writeFile(join(output.root, 'deployment.local.json'), JSON.stringify({
    apiBase: 'http://old.test/v1', apiKey: 'old-key', modelId: 'custom-model', contextWindow: 64000, maxTokens: 4096,
  }))
  await buildCore({ directory: output.url, env: {
    TPCOWORK_DEEPSEEK_BASE_URL: ' http://new.test/v1 ', TPCOWORK_DEEPSEEK_API_KEY: ' new-key ',
  } })
  const deployment = await loadDeployment(output.url, {})
  expect(deployment).toMatchObject({ apiBase: 'http://new.test/v1', apiKey: 'new-key', modelId: 'custom-model' })
  const rows = JSON.parse(await readFile(join(output.root, 'model.patch.yml'), 'utf8'))
  expect(rows.find((row: { id: string }) => row.id === 'agent-default-model').config.model).toBe('custom-model')
})

it('seeds the dedicated credential once, preserving subsequent user or environment credentials', async () => {
  let stored: { value: string; source: string } | undefined
  const credentials = {
    resolve: vi.fn(async () => stored),
    set: vi.fn(async (_ref: string, value: string) => { stored = { value, source: 'file' } }),
  }
  await initializeDeploymentCredential(credentials, resolveDeployment({ apiKey: 'bundled-key' }, {}))
  expect(credentials.set).toHaveBeenCalledWith(credentialReference, 'bundled-key')
  stored = { value: 'user-key', source: 'env' }
  await initializeDeploymentCredential(credentials, resolveDeployment({ apiKey: 'updated-bundle-key' }, {}))
  expect(credentials.set).toHaveBeenCalledTimes(1)
  expect(stored.value).toBe('user-key')
})

it('allows deployment without a bundled key when DSH supplies credentials', async () => {
  const output = await directory()
  const credentials = { resolve: vi.fn(), set: vi.fn() }
  await initializeDeploymentCredential(credentials, await loadDeployment(output.url, {}))
  expect(credentials.set).not.toHaveBeenCalled()
})

it.each([
  null,
  { apiBase: 'file:///secret-key' },
  { apiBase: 'http://user:secret-key@gateway.test/v1' },
  { apiBase: 'http://gateway.test/v1?token=secret-key' },
  { contextWindow: 100, maxTokens: 101 },
  { modelId: '' },
  { providerId: 'invalid/provider' },
  { apiKey: 'secret-key\n' },
])('rejects invalid deployment without printing private input: %j', input => {
  expect(() => resolveDeployment(input, {})).toThrow('TP Cowork: invalid DeepSeek deployment configuration')
})

it('reports malformed local JSON without including its contents', async () => {
  const output = await directory()
  await writeFile(join(output.root, 'deployment.local.json'), '{secret-key:')
  await expect(loadDeployment(output.url, {})).rejects.toThrow('TP Cowork: invalid DeepSeek deployment configuration')
})

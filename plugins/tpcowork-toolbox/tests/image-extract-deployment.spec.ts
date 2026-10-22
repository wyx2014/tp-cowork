import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { skillsFixture } from './skills-fixture.ts'
import * as deployment from '../src/host/skills/image-extract-deployment.ts'

it('loads a portable deployment without its source checkout and honors runtime overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'toolbox-vision-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const url = pathToFileURL(directory + '/')
  const bundled = { apiUrl: 'https://vision.test/v1/chat/completions', model: 'bundled-vision', apiKey: 'bundled-test-key' }
  await writeFile(join(directory, 'image-extract.local.json'), JSON.stringify(bundled))
  expect(await deployment.loadImageExtractDeployment(url, {})).toEqual(bundled)
  expect(await deployment.loadImageExtractDeployment(url, {
    TPCOWORK_IMAGE_EXTRACT_API_URL: 'https://build.test/chat/completions', TPCOWORK_IMAGE_EXTRACT_MODEL: 'build-model',
    TPCOWORK_IMAGE_EXTRACT_API_KEY: 'replacement-test-key',
    DSH_IMAGE_EXTRACT_URL: 'https://runtime.test/chat/completions', DSH_IMAGE_EXTRACT_MODEL: 'runtime-model',
  })).toEqual({ apiUrl: 'https://runtime.test/chat/completions', model: 'runtime-model', apiKey: 'replacement-test-key' })
  await writeFile(join(directory, 'image-extract.local.json'), '{private-test-key:')
  await expect(deployment.loadImageExtractDeployment(url, {})).rejects.toThrow('图片提取部署配置无效，请检查服务地址、模型和凭证。')
})

it('seeds the system credential without overwriting existing credentials or custom references', async () => {
  const values = new Map<string, string>()
  const credentials = {
    resolve: vi.fn(async (ref: string) => values.has(ref) ? { value: values.get(ref) } : undefined),
    set: vi.fn(async (ref: string, value: string) => { values.set(ref, value) }),
  }
  const bundled = deployment.resolveImageExtractDeployment({ apiKey: 'bundled-test-key' }, {})
  await deployment.initializeImageExtractCredential(credentials, deployment.imageExtractCredentialRef, bundled)
  expect(values.get(deployment.imageExtractCredentialRef)).toBe('bundled-test-key')
  values.set(deployment.imageExtractCredentialRef, 'user-test-key')
  await deployment.initializeImageExtractCredential(credentials, deployment.imageExtractCredentialRef, bundled)
  await deployment.initializeImageExtractCredential(credentials, 'CUSTOM_VISION_KEY', bundled)
  expect(values.get(deployment.imageExtractCredentialRef)).toBe('user-test-key')
  expect(credentials.set).toHaveBeenCalledTimes(1)
  credentials.set.mockClear()
  await deployment.initializeImageExtractCredential(credentials, deployment.imageExtractCredentialRef, deployment.resolveImageExtractDeployment({}, {}))
  expect(credentials.set).not.toHaveBeenCalled()
})

it('initializes bundled credentials before registering native tools and reports the skill as ready', async () => {
  const bundled = { apiUrl: 'https://vision.test/chat/completions', model: 'test-vision', apiKey: 'bundled-test-key' }
  const load = vi.spyOn(deployment, 'loadImageExtractDeployment').mockResolvedValue(bundled)
  onTestFinished(() => load.mockRestore())
  const { ctx, installer } = await skillsFixture()
  const values = new Map<string, string>()
  ctx.provide('credentials', {
    resolve: async (ref: string) => values.has(ref) ? { value: values.get(ref), source: 'test' } : undefined,
    set: async (ref: string, value: string) => { values.set(ref, value) },
  } as never)
  const registered = new Set<string>()
  ctx.provide('tools', {
    get: (name: string) => registered.has(name) ? {} : undefined,
    register: (tool: { name: string }) => {
      expect(values.get(deployment.imageExtractCredentialRef)).toBe('bundled-test-key')
      registered.add(tool.name)
    },
  } as never)
  await vi.waitFor(() => expect(registered.has('extract_image')).toBe(true))
  const installed = await installer.install({ requestId: 'vision', source: { kind: 'bundled', resourceId: 'image-extract' }, scope: { kind: 'user' }, conflict: 'reject' })
  const item = await ctx.toolboxSkills.checkReadiness({ id: installed.skillId! })
  expect(item.readiness.state).toBe('ready')
  expect(JSON.stringify(item)).not.toContain('bundled-test-key')
})

it.each([
  null,
  { apiUrl: 'file:///private-test-key' },
  { apiUrl: 'https://user:private-test-key@vision.test/chat/completions' },
  { apiUrl: 'https://vision.test/chat/completions?token=private-test-key' },
  { model: ' ' },
  { apiKey: 'private-test-key\n' },
])('rejects invalid deployment settings without including the supplied data', input => {
  expect(() => deployment.resolveImageExtractDeployment(input, {})).toThrow('图片提取部署配置无效，请检查服务地址、模型和凭证。')
})

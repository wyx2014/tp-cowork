import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { skillsFixture } from './skills-fixture.ts'
import { extractImage, nativeMissing, sendCall, type NativeOptions } from '../src/host/skills/native.ts'
const config: NativeOptions = { requestTimeoutMs: 1000, imageMaxBytes: 1024, visionMaxTokens: 123, callUsernameRef: 'PHONE_USER', callPasswordRef: 'PHONE_PASSWORD', visionKeyRef: 'VISION_KEY' }
describe('native external-service adapters', () => {
  it('reports missing configuration without making requests', async () => {
    const ctx = new Context()
    const fetch = vi.spyOn(globalThis, 'fetch')
    vi.stubEnv('DSH_YEALINK_URL', '')
    vi.stubEnv('DSH_IMAGE_EXTRACT_URL', '')
    try {
      expect((await nativeMissing(ctx, 'call', config)).join('')).toContain('设置电话')
      expect(await nativeMissing(ctx, 'image-extract', config)).toContain('VISION_KEY')
      await expect(sendCall(ctx, { action: 'dial', number: '1234' }, new AbortController().signal, config)).rejects.toThrow('尚未配置')
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore(); vi.unstubAllEnvs(); await ctx.fiber.dispose() }
  })
  it('sends the actual Yealink protocol, never treats HTTP login pages as success, and redacts failures', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: 'private-test-value', source: 'test' }) } as never)
    vi.stubEnv('DSH_YEALINK_URL', 'https://phone.test')
    vi.stubEnv('DSH_YEALINK_CALLER', '1234')
    vi.stubEnv('DSH_YEALINK_PBX', 'pbx.test')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('OK'))
    try {
      const result = await sendCall(ctx, { action: 'dial', number: '5678' }, new AbortController().signal, config)
      const url = fetch.mock.calls[0]![0] as URL
      expect(url.pathname).toBe('/cgi-bin/ConfigManApp.com')
      expect(url.searchParams.get('outgoing_url')).toBe('1234@pbx.test')
      expect(url.searchParams.get('number')).toBe('5678')
      expect(result).toBe('已向话机发送拨号指令；是否接通请以话机状态为准。')
      fetch.mockResolvedValueOnce(new Response('<html>private-test-value</html>'))
      await expect(sendCall(ctx, { action: 'hangup' }, new AbortController().signal, config)).rejects.toThrow('话机指令失败；请检查网络、TLS 证书和凭证。')
    } finally { fetch.mockRestore(); vi.unstubAllEnvs(); await ctx.fiber.dispose() }
  })
  it('reads image bytes through DSH FS, sends the deployed model request, and rejects empty output', async () => {
    const { ctx, home } = await skillsFixture()
    await ctx.plugin(FileSystem, { cwd: home })
    ctx.provide('credentials', { resolve: async () => ({ value: 'private-test-value', source: 'test' }) } as never)
    vi.stubEnv('DSH_IMAGE_EXTRACT_URL', 'https://vision.test/chat/completions')
    vi.stubEnv('DSH_IMAGE_EXTRACT_MODEL', 'test-vision')
    await writeFile(join(home, 'sample.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [{ message: { content: [{ type: 'text', text: '实测文本' }] } }] }))
    try {
      expect(await extractImage(ctx, { image_path: 'sample.png' }, new AbortController().signal, config)).toBe('实测文本')
      const payload = JSON.parse(String(fetch.mock.calls[0]![1]?.body))
      expect(payload.model).toBe('test-vision')
      expect(payload.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
      expect(payload.max_tokens).toBe(123)
      fetch.mockResolvedValueOnce(Response.json({ choices: [] }))
      await expect(extractImage(ctx, { image_path: 'sample.png' }, new AbortController().signal, config)).rejects.toThrow('图片提取失败')
    } finally { fetch.mockRestore(); vi.unstubAllEnvs() }
  })
})

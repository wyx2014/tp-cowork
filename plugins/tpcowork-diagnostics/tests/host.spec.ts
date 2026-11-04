import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Diagnostics from '../src/host.ts'
import { tapStderr } from '../src/host.ts'
import { maskSecrets } from '../src/mask-secrets.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step() })
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'tpcowork-diagnostics-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}
const today = () => { const d = new Date(); return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

it('writes the Host\'s log records to daily files with secrets masked, warnings also to the error file', async () => {
  const directory = await temporary()
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(Diagnostics, { logLevel: 'info', directory }).await()
  const logger = ctx.logger('toolbox')
  logger.info('request Authorization: Bearer abc.def.ghi')
  logger.info('configured api_key=sk-1234567890abcdefXYZ for the model')
  logger.warn('hub refused token 0123456789abcdef0123456789abcdef')
  logger.debug('below the threshold')
  expect((await readdir(directory)).sort()).toEqual([`dsh-${today()}.error.log`, `dsh-${today()}.log`])
  const all = await readFile(join(directory, `dsh-${today()}.log`), 'utf8')
  expect(all).toMatch(/^--- TP Cowork Host pid \d+ /u)
  expect(all).toContain('[I] [toolbox] request Authorization: Bearer ****')
  expect(all).toContain('[I] [toolbox] configured api_key=**** for the model')
  expect(all).toContain('[W] [toolbox] hub refused token 012****')
  expect(all).not.toContain('0123456789abcdef0123')
  expect(all).not.toContain('abc.def.ghi')
  expect(all).not.toContain('sk-1234567890')
  expect(all).not.toContain('below the threshold')
  const errors = await readFile(join(directory, `dsh-${today()}.error.log`), 'utf8')
  expect(errors).toContain('hub refused token')
  expect(errors).not.toContain('configured')
})

it('also writes the start-up records Cordis buffered before the plugin loaded, once each', async () => {
  const directory = await temporary()
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.logger('loader').info('apply plugin llm-pi-ai')
  ctx.logger('loader').error('plugin x failed: password=hunter2')
  // Cordis' own buffer stops at INFO (its WARN is a higher number), so an earlier warning cannot be replayed.
  ctx.logger('loader').warn('not buffered by Cordis')
  await ctx.plugin(Diagnostics, { logLevel: 'info', directory }).await()
  ctx.logger('session').info('live record')
  const all = await readFile(join(directory, `dsh-${today()}.log`), 'utf8')
  const lines = all.trim().split('\n')
  expect(lines.slice(1).map(line => line.replace(/^\S+ \S+ /u, ''))).toEqual([
    '[I] [loader] apply plugin llm-pi-ai',
    '[E] [loader] plugin x failed: password=****',
    '[I] [session] live record',
  ])
})

it('copies whole stderr lines into the log and restores stderr on dispose', () => {
  const written: string[] = []
  const recorded: string[] = []
  const stream = { write(chunk: unknown) { written.push(String(chunk)); return true } } as unknown as NodeJS.WriteStream
  const original = stream.write
  const restore = tapStderr(stream, line => recorded.push(line))
  stream.write('plugin failed: ')
  stream.write(Buffer.from('boom\nsecond '))
  stream.write('line\n\n')
  expect(written).toEqual(['plugin failed: ', 'boom\nsecond ', 'line\n\n'])
  expect(recorded).toEqual(['plugin failed: boom', 'second line'])
  stream.write('unterminated')
  restore()
  expect(recorded).toEqual(['plugin failed: boom', 'second line', 'unterminated'])
  expect(stream.write).toBe(original)
})

it('masks the credential shapes TP Cowork logs can carry', () => {
  expect(maskSecrets('GET http://10.17.12.229:20255/desktop/authorize?state=abc&token=secret-value')).toBe('GET http://10.17.12.229:20255/desktop/authorize?state=abc&token=****')
  expect(maskSecrets('{"token":"hub-session-token","user":"zhangsan"}')).toBe('{"token":"****","user":"zhangsan"}')
  expect(maskSecrets('Cookie: session=abc; other=1')).toBe('Cookie: ****')
  expect(maskSecrets('x-tpcowork-key: 3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c')).toBe('x-tpcowork-key: 3f9****')
})

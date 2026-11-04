import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }))
const { createDesktopDiagnostics, PRIVACY_COPY } = await import('../src/desktop.ts')

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const step of cleanup.splice(0)) await step(); vi.unstubAllEnvs() })

async function setup(answer: number) {
  const root = await mkdtemp(join(tmpdir(), 'tpcowork-diagnostics-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', join(root, 'home'))
  await mkdir(join(root, 'home/logs/host'), { recursive: true })
  await writeFile(join(root, 'home/logs/host/dsh-2026-11-03.log'), 'host line\n')
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const prompts: { message?: string; buttons?: string[] }[] = []
  const revealed: string[] = []
  const errors: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const runtime = {
    logsDir: join(root, 'Logs'), crashDumpsDir: join(root, 'Crashpad'), appName: 'TP Cowork', appVersion: '9.9.9',
    showMessageBox: async (_window: unknown, options: { message?: string; buttons?: string[] }) => { prompts.push(options); await gate; return { response: answer } },
    showError: (title: string, content: string) => { errors.push(`${title}: ${content}`) },
    reveal: (path: string) => { revealed.push(path) },
    on: (event: string, listener: (...args: unknown[]) => void) => { listeners.set(event, listener) },
    off: (event: string) => { listeners.delete(event) },
  }
  const diagnostics = createDesktopDiagnostics({ window: () => undefined, userData: join(root, 'userData') }, runtime as never)
  cleanup.push(async () => { diagnostics.dispose() })
  return { root, diagnostics, listeners, prompts, revealed, errors, release }
}

it('asks first, then exports Host and desktop logs once for concurrent requests and reveals the archive', async () => {
  const { root, diagnostics, listeners, prompts, revealed, release } = await setup(0)
  listeners.get('child-process-gone')!({}, { type: 'Utility', name: 'network', reason: 'crashed', exitCode: -1073741819 })
  const first = diagnostics.request({ action: 'export', locale: 'zh' })
  const second = diagnostics.request({ action: 'export', locale: 'zh' })
  release()
  const [a, b] = await Promise.all([first, second])
  expect(a).toEqual(b)
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toMatchObject({ message: PRIVACY_COPY.zh.message, buttons: ['导出', '取消'] })
  if (a.status !== 'exported') throw new Error('not exported')
  expect(a.path.startsWith(join(root, 'userData', 'diagnostics', 'diagnostics-'))).toBe(true)
  expect(revealed).toEqual([a.path])
  const names = execFileSync('unzip', ['-Z1', a.path], { encoding: 'utf8' })
  expect(names).toContain('host/dsh-2026-11-03.log')
  expect(names).toMatch(/main\/dsh-\d{4}-\d{2}-\d{2}\.log/u)
  const today = names.match(/main\/(dsh-\d{4}-\d{2}-\d{2}\.log)/u)![1]!
  const mainLog = await readFile(join(root, 'Logs', today), 'utf8')
  expect(mainLog).toContain('--- TP Cowork 9.9.9 desktop')
  expect(mainLog).toContain('child process gone (type: Utility, name: network, reason: crashed, exitCode: -1073741819 / 0xc0000005)')
})

it('does nothing when the privacy notice is declined, and reports failures in a native error', async () => {
  const declined = await setup(1)
  declined.release()
  expect(await declined.diagnostics.request({ action: 'export', locale: 'en' })).toEqual({ status: 'cancelled' })
  expect(declined.prompts[0]).toMatchObject({ buttons: ['Export', 'Cancel'] })
  expect(declined.revealed).toEqual([])

  const failing = await setup(0)
  failing.release()
  await writeFile(join(failing.root, 'userData'), 'a file where the folder should be')
  const result = await failing.diagnostics.request({ action: 'export', locale: 'zh' })
  expect(result.status).toBe('failed')
  expect(failing.errors[0]).toMatch(/^无法导出诊断信息: /u)
  await expect(failing.diagnostics.request({ action: 'other' })).rejects.toThrow('unknown action')
})

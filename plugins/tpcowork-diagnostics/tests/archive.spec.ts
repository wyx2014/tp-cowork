import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createDiagnosticsArchive } from '../src/archive.ts'
import { createZip } from '../src/zip.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const step of cleanup.splice(0)) await step() })
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'tpcowork-diagnostics-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}
/** List and read an archive with the system's own unzip, so the writer is checked against an independent reader. */
const list = (zip: string) => execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').sort()
const read = (zip: string, name: string) => execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8' })

it('writes archives that standard unzip reads back intact, compressed and stored', async () => {
  const directory = await temporary()
  const text = Buffer.from('重复的日志行\n'.repeat(500))
  const random = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 97) % 251))
  const zip = join(directory, 'a.zip')
  await writeFile(zip, await createZip([{ name: 'logs/host.log', data: text }, { name: 'bin.dmp', data: random }, { name: 'empty.txt', data: Buffer.alloc(0) }]))
  execFileSync('unzip', ['-tq', zip])
  expect(list(zip)).toEqual(['bin.dmp', 'empty.txt', 'logs/host.log'])
  expect(read(zip, 'logs/host.log')).toBe(text.toString())
})

it('bundles crash reports, crash dumps and newest logs under one budget, and keeps only three archives', async () => {
  const root = await temporary()
  const main = join(root, 'Logs'); const host = join(root, 'home/logs/host'); const dumps = join(root, 'Crashpad'); const out = join(root, 'userData/diagnostics')
  await mkdir(main, { recursive: true }); await mkdir(host, { recursive: true }); await mkdir(join(dumps, 'completed'), { recursive: true })
  await writeFile(join(main, 'dsh-2026-11-02.log'), 'old main\n')
  await writeFile(join(main, 'dsh-2026-11-03.log'), 'main today\n')
  await writeFile(join(main, 'crash-2026-11-03T01-02-03-004Z-host.log'), 'host crashed\n')
  await writeFile(join(main, 'unrelated.txt'), 'not ours')
  await writeFile(join(host, 'dsh-2026-11-03.log'), 'host today\n')
  await writeFile(join(host, 'dsh-2026-11-03.error.log'), 'host warning\n')
  await writeFile(join(dumps, 'completed', 'abc.dmp'), 'dump')
  await writeFile(join(root, 'secret.txt'), 'outside')
  await symlink(join(root, 'secret.txt'), join(host, 'dsh-2026-11-01.log'))
  const oldest = new Date('2026-11-02T00:00:00Z')
  await utimes(join(main, 'dsh-2026-11-02.log'), oldest, oldest)

  const options = { outDir: out, mainLogsDir: main, hostLogsDir: host, crashDumpsDir: dumps, appName: 'TP Cowork', appVersion: '1.2.3' }
  const zip = await createDiagnosticsArchive(options)
  expect(list(zip)).toEqual([
    'crash-dumps/completed/abc.dmp', 'crash-reports/crash-2026-11-03T01-02-03-004Z-host.log',
    'host/dsh-2026-11-03.error.log', 'host/dsh-2026-11-03.log',
    'main/dsh-2026-11-02.log', 'main/dsh-2026-11-03.log', 'system-info.txt',
  ])
  const info = read(zip, 'system-info.txt')
  expect(info).toContain('app: TP Cowork\nversion: 1.2.3\n')
  expect(info).toContain('included-log-files: 4\nomitted-log-files: 0\nincluded-crash-reports: 1')

  // A tight budget keeps crash evidence first and then the newest logs; the oldest is reported as omitted.
  const tight = await createDiagnosticsArchive({ ...options, maxEvidenceBytes: 'host crashed\n'.length + 'dump'.length + 'main today\n'.length + 'host today\n'.length + 'host warning\n'.length })
  expect(list(tight)).not.toContain('main/dsh-2026-11-02.log')
  expect(read(tight, 'system-info.txt')).toContain('omitted-log-files: 1')

  await createDiagnosticsArchive(options)
  await createDiagnosticsArchive(options)
  expect((await readdir(out)).filter(name => name.endsWith('.zip'))).toHaveLength(3)
})

it('works when nothing has been logged yet, and refuses a linked log directory', async () => {
  const root = await temporary()
  const zip = await createDiagnosticsArchive({ outDir: join(root, 'out'), mainLogsDir: join(root, 'missing'), hostLogsDir: join(root, 'missing-too'), appName: 'TP Cowork', appVersion: '1' })
  expect(list(zip)).toEqual(['system-info.txt'])
  await mkdir(join(root, 'real'))
  await symlink(join(root, 'real'), join(root, 'linked'))
  await expect(createDiagnosticsArchive({ outDir: join(root, 'out'), mainLogsDir: join(root, 'linked'), appName: 'TP Cowork', appVersion: '1' }))
    .rejects.toThrow('refusing linked log directory')
})

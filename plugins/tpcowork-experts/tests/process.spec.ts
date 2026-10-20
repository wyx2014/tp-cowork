/** Kill a real Loader process during research, then resume its JSONL in a fresh Loader. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { fixture } from './fixture.ts'

const crashRoot = process.env.EXPERTS_CRASH_ROOT
const workspace = resolve(import.meta.dirname, '../../..')
it.skipIf(!crashRoot)('process-worker', async () => {
  const h = await fixture({ root: crashRoot!, hang: true })
  await h.submit('asset-research-team')
  await vi.waitFor(() => expect(h.adapter.requests.length).toBeGreaterThanOrEqual(4), { timeout: 30000 })
  await h.ctx.sessions.flush(h.agent.session)
  const { run } = await h.ctx.experts.snapshot({ sessionId: h.agent.id })
  await writeFile(join(crashRoot!, 'ready.json'), JSON.stringify({ runId: run!.runId }))
  await new Promise(() => {})
})

it.skipIf(!!crashRoot)('a SIGKILL during native workflow is interrupted after restart and only explicit rerun starts new work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'experts-crash-'))
  const child = spawn(process.execPath, [resolve(workspace, '../deepseek-harness/node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(workspace, 'plugins/tpcowork-experts/vitest.config.ts'), resolve(import.meta.dirname, 'process.spec.ts'), '-t', '^process-worker$'], {
    cwd: workspace, env: { ...process.env, EXPERTS_CRASH_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject)
  })
  let output = ''
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000) })
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-8000) })
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    await rm(root, { recursive: true, force: true })
  })
  let original!: { runId: string }
  await vi.waitFor(async () => {
    expect(child.exitCode, output).toBeNull()
    original = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8'))
  }, { timeout: 90000 })
  child.kill('SIGKILL')
  expect(await exited).toMatchObject({ signal: 'SIGKILL' })
  const h = await fixture({ root })
  const value = await h.ctx.experts.snapshot({ sessionId: h.agent.id })
  expect(value.status).toBe('interrupted')
  expect(value.run!.runId).toBe(original.runId)
  expect(value.run!.code).toBe('process_interrupted')
  expect(h.adapter.requests).toHaveLength(0)
  expect(h.ctx.experts.active.size).toBe(0)
  expect(h.ctx.agents.list().map(agent => agent.id)).toEqual([h.agent.id])
  await h.ctx.experts.rerun({ sessionId: h.agent.id }, new AbortController().signal)
  const rerun = await h.wait()
  expect(rerun.status, JSON.stringify(rerun.run)).toBe('completed')
  expect(rerun.run!.runId).not.toBe(original.runId)
  expect(rerun.run!.context).toEqual(value.run!.context)
  const oldEvents = await Array.fromAsync(h.ctx.experts.watch({ runId: original.runId }, new AbortController().signal))
  expect(oldEvents.at(-1)).toMatchObject({ type: 'settled', status: 'interrupted' })
})

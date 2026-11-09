import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UsageStore } from '../src/store.ts'

const row = { time: 1, model: 'm', input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 }
const session = (seq: number) => ({ records: [row], turns: [{ time: 1, durationMs: 60_000 }], tools: [1], open: [[2, 5]] as Array<[number, number]>, model: 'm', seq })

describe('usage store', () => {
  it('survives a restart', async () => {
    const home = await mkdtemp(join(tmpdir(), 'usage-store-'))
    const first = new UsageStore(home, () => {})
    await first.load()
    first.set('a', session(4))
    first.set('b', session(9))
    await first.flush()

    const second = new UsageStore(home, () => {})
    await second.load()
    expect(second.size).toBe(2)
    expect(second.get('a')).toEqual(session(4))
    expect(second.get('b')).toEqual(session(9))
  })

  it('sets a corrupt file aside instead of overwriting it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'usage-store-'))
    await mkdir(join(home, 'usage'))
    const errors: string[] = []
    const probe = new UsageStore(home, message => errors.push(message))
    await writeFile(join(home, 'usage', 'records.v3.json'), '{not json')
    await probe.load()
    expect(probe.size).toBe(0)
    expect(errors).toHaveLength(1)
    const kept = (await readdir(join(home, 'usage'))).filter(name => name.startsWith('records.v3.unreadable-'))
    expect(kept).toHaveLength(1)
    expect(await readFile(join(home, 'usage', kept[0]!), 'utf8')).toBe('{not json')
    probe.set('a', session(1))
    await probe.flush()
    expect(JSON.parse(await readFile(join(home, 'usage', 'records.v3.json'), 'utf8')).version).toBe(3)
  })

  it('never writes before the existing file has been read', async () => {
    const home = await mkdtemp(join(tmpdir(), 'usage-store-'))
    const first = new UsageStore(home, () => {})
    await first.load()
    first.set('a', session(4))
    await first.flush()
    // A store that never loaded knows nothing; flushing it must keep the existing rows.
    const unloaded = new UsageStore(home, () => {})
    await unloaded.flush()
    const reread = new UsageStore(home, () => {})
    await reread.load()
    expect(reread.get('a')).toEqual(session(4))
  })

  it('reads the rows a previous instance is still writing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'usage-store-'))
    const first = new UsageStore(home, () => {})
    await first.load()
    first.set('a', session(4))
    void first.flush()
    const second = new UsageStore(home, () => {})
    await second.load()
    expect(second.get('a')).toEqual(session(4))
  })
})

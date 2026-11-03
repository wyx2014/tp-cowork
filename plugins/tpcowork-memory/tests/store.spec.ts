import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boundIndex, listCatalog, MemoryStore, memoryRoot, parseFrontmatter, updateIndex } from '../src/store.ts'
import { formatUpdatedAt } from '../src/updated-at.ts'
import { en } from '../src/locales.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function store() {
  const home = await mkdtemp(join(tmpdir(), 'tpcm-'))
  roots.push(home)
  return new MemoryStore(memoryRoot(home, '/work/My Project'))
}

describe('memory root', () => {
  it('keys each workspace by slug and path hash, case-insensitively on Windows', () => {
    const root = memoryRoot('/h', '/work/My Project', 'darwin')
    expect(root).toMatch(/^\/h\/memories\/projects\/my-project-[0-9a-f]{16}\/memory$/)
    expect(memoryRoot('/h', '/work/other', 'darwin')).not.toBe(root)
    expect(memoryRoot('/h', 'C:\\Work\\App', 'win32')).toBe(memoryRoot('/h', 'c:\\work\\app', 'win32'))
    expect(memoryRoot('/h', '/', 'darwin')).toMatch(/\/project-[0-9a-f]{16}\/memory$/)
  })
})

describe('memory store', () => {
  it('saves one fact per file, keeps its first session, and points the index at it', async () => {
    const memory = await store()
    expect(await memory.index()).toBeUndefined()
    expect(await memory.save({ name: 'reply-language', description: 'Prefers: Chinese "replies"', type: 'user', body: 'Reply in Chinese.' }, 's1')).toBe('created')
    expect(await memory.save({ name: 'reply-language', description: 'Prefers Chinese replies', type: 'feedback', body: 'Reply in Chinese.\n**Why:** team language.' }, 's2')).toBe('updated')
    const text = await memory.read('reply-language')
    expect(parseFrontmatter(text!)).toEqual({ description: 'Prefers Chinese replies', type: 'feedback', originSessionId: 's1' })
    expect(text).toContain('**Why:** team language.')
    await memory.save({ name: 'report-dashboard', description: 'Weekly numbers live in the BI dashboard', type: 'reference', body: 'https://bi.example/weekly' }, 's2')
    expect(await memory.index()).toBe([
      '- [reply-language](reply-language.md) — Prefers Chinese replies',
      '- [report-dashboard](report-dashboard.md) — Weekly numbers live in the BI dashboard',
    ].join('\n'))
    expect((await memory.list()).map(entry => entry.name).sort()).toEqual(['reply-language', 'report-dashboard'])
  })

  it('deletes a fact and its index line, and reports a missing one', async () => {
    const memory = await store()
    await memory.save({ name: 'a-fact', description: 'A', type: 'project', body: 'A.' }, undefined)
    expect(await memory.delete('a-fact')).toBe(true)
    expect(await memory.delete('a-fact')).toBe(false)
    expect(await memory.read('a-fact')).toBeUndefined()
    expect(await memory.index()).toBeUndefined()
    expect(await memory.list()).toEqual([])
  })

  it('rejects names that could leave the directory and invalid content', async () => {
    const memory = await store()
    for (const name of ['../x', 'A-B', 'a/b', '', 'MEMORY']) {
      await expect(memory.save({ name, description: 'x', type: 'user', body: 'x' }, undefined)).rejects.toThrow('kebab-case')
    }
    await expect(memory.read('../secret')).rejects.toThrow('kebab-case')
    await expect(memory.save({ name: 'ok', description: ' ', type: 'user', body: 'x' }, undefined)).rejects.toThrow('description')
    await expect(memory.save({ name: 'ok', description: 'x', type: 'other' as never, body: 'x' }, undefined)).rejects.toThrow('type')
  })

  it('serializes concurrent saves so the index keeps every pointer', async () => {
    const memory = await store()
    await Promise.all(Array.from({ length: 8 }, (_, i) => memory.save({ name: `fact-${i}`, description: `F${i}`, type: 'user', body: 'x' }, undefined)))
    expect((await memory.index())!.split('\n')).toHaveLength(8)
  })

  it('lists only fact files and tolerates foreign Markdown', async () => {
    const memory = await store()
    await memory.save({ name: 'kept', description: 'Kept', type: 'user', body: 'x' }, undefined)
    await writeFile(join(memory.root, 'Notes.md'), 'not a fact')
    await writeFile(join(memory.root, 'plain.md'), 'no frontmatter')
    expect((await memory.list()).map(entry => [entry.name, entry.type])).toEqual(expect.arrayContaining([['kept', 'user'], ['plain', '']]))
    expect((await memory.list()).some(entry => entry.name === 'Notes')).toBe(false)
    expect(await readFile(join(memory.root, 'MEMORY.md'), 'utf8')).toBe('- [kept](kept.md) — Kept\n')
  })
})

describe('index text', () => {
  it('replaces, appends and removes pointer lines', () => {
    const index = updateIndex(updateIndex('', 'a', 'A'), 'b', 'B')
    expect(updateIndex(index, 'a', 'A2')).toBe('- [b](b.md) — B\n- [a](a.md) — A2\n')
    expect(updateIndex(index, 'a', undefined)).toBe('- [b](b.md) — B\n')
  })

  it('bounds the index to 200 lines or 25,000 characters with a notice', () => {
    expect(boundIndex('  short  ')).toBe('short')
    const long = boundIndex(Array.from({ length: 250 }, (_, i) => `- line ${i}`).join('\n'))
    expect(long.split('\n').filter(line => line.startsWith('- line'))).toHaveLength(200)
    expect(long).toContain('[MEMORY.md truncated')
    expect(boundIndex('x'.repeat(30_000)).length).toBeLessThan(25_200)
  })
})

describe('memory catalog', () => {
  it('lists workspaces with memory files, index first, registered workspaces by registry order and title', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tpcm-'))
    roots.push(home)
    expect(await listCatalog(home)).toEqual([])
    const app = new MemoryStore(memoryRoot(home, '/work/app'))
    await app.save({ name: 'b-fact', description: 'B', type: 'project', body: 'B.' }, undefined)
    await app.save({ name: 'a-fact', description: 'A', type: 'project', body: 'A.' }, undefined)
    const docs = new MemoryStore(memoryRoot(home, '/work/docs'))
    await docs.save({ name: 'only', description: 'O', type: 'user', body: 'O.' }, undefined)
    await utimes(join(docs.root, 'only.md'), new Date(), new Date(Date.now() + 60_000))
    // An empty or foreign directory never appears.
    await mkdir(join(home, 'memories', 'projects', 'empty-0123456789abcdef', 'memory'), { recursive: true })
    await writeFile(join(home, 'memories', 'projects', 'stray.txt'), 'x')
    const byTime = await listCatalog(home)
    expect(byTime.map(workspace => workspace.label)).toEqual(['docs', 'app'])
    expect(byTime[1]!.files.map(file => [file.name, file.kind])).toEqual([['MEMORY.md', 'index'], ['a-fact.md', 'item'], ['b-fact.md', 'item']])
    expect(byTime[1]!.files[1]!.path).toBe(join(app.root, 'a-fact.md'))
    const registered = await listCatalog(home, [{ path: '/work/app', title: 'My App' }])
    expect(registered.map(workspace => workspace.label)).toEqual(['My App', 'docs'])
  })
})

describe('update stamp', () => {
  const t = (key: keyof typeof en, params?: Record<string, unknown>) =>
    en[key].replace(/\{(\w+)\}/g, (match, name: string) => params && name in params ? String(params[name]) : match)
  const now = new Date(2026, 9, 28, 15, 0).getTime()
  it('reads relative, then day words, weekday, and date like ZCode', () => {
    expect(formatUpdatedAt(t, now, now - 30_000)).toBe('Just now')
    expect(formatUpdatedAt(t, now, now - 5 * 60_000)).toBe('5 min ago')
    expect(formatUpdatedAt(t, now, new Date(2026, 9, 28, 9, 5).getTime())).toBe('Today 09:05')
    expect(formatUpdatedAt(t, now, new Date(2026, 9, 27, 21, 30).getTime())).toBe('Yesterday 21:30')
    expect(formatUpdatedAt(t, now, new Date(2026, 9, 26, 8, 0).getTime())).toBe('Mon 08:00')
    expect(formatUpdatedAt(t, now, new Date(2026, 8, 1, 8, 0).getTime())).toBe('9/1 08:00')
    expect(formatUpdatedAt(t, now, new Date(2025, 0, 2, 8, 0).getTime())).toBe('2025/1/2 08:00')
  })
})

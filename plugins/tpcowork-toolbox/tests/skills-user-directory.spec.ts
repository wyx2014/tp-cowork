import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { userSkillsDirectory } from '../src/host/skills/user-directory.ts'
import { markerName } from '../src/host/installer/files.ts'
import { skillId } from '../src/host/installer/index.ts'
import { skillsFixture } from './skills-fixture.ts'

const entry = (name: string, body: string) => `---\nname: ${name}\ndescription: Personal skill\n---\n${body}\n`

it('keeps the old GUI personal directory on Windows, macOS and Linux and permits an explicit path', () => {
  expect(userSkillsDirectory({ platform: 'win32', home: 'C:\\Users\\wangyb', env: { APPDATA: 'C:\\Users\\wangyb\\AppData\\Roaming' } }))
    .toBe('C:\\Users\\wangyb\\AppData\\Roaming\\tpcowork\\workspace\\skills')
  expect(userSkillsDirectory({ platform: 'win32', home: 'C:\\Users\\wangyb', env: {} }))
    .toBe('C:\\Users\\wangyb\\AppData\\Roaming\\tpcowork\\workspace\\skills')
  expect(userSkillsDirectory({ platform: 'darwin', home: '/Users/test', env: {} }))
    .toBe('/Users/test/Library/Application Support/tpcowork/workspace/skills')
  expect(userSkillsDirectory({ platform: 'linux', home: '/home/test', env: { XDG_CONFIG_HOME: '/custom/config' } }))
    .toBe('/custom/config/tpcowork/workspace/skills')
  expect(userSkillsDirectory({ platform: 'win32', configured: 'D:\\my-skills' })).toBe('D:\\my-skills')
})

it('discovers a dropped skill after a missing personal directory is created, refreshes edits and removes stale entries', async () => {
  const { ctx, userRoot } = await skillsFixture({ separateUserRoot: true })
  expect((await ctx.toolboxSkills.inventory({})).items).toEqual([])
  const changes: unknown[] = []
  ctx.on('toolbox/changed', change => { changes.push(change) })
  const directory = join(userRoot, 'my-report-1.0.0')
  await mkdir(join(directory, 'references'), { recursive: true })
  const path = join(directory, 'SKILL.md')
  await writeFile(path, entry('my-report', 'Read [reference](references/guide.md).'))
  await writeFile(join(directory, 'references/guide.md'), 'My reference')
  await vi.waitFor(() => expect(changes.length).toBeGreaterThan(0), { timeout: 5000 })
  await vi.waitFor(async () => {
    expect((await ctx.toolboxSkills.inventory({})).items).toEqual([expect.objectContaining({
      id: skillId(directory), name: 'my-report', origin: 'user', installed: true, enabled: true,
      path, managed: false, resources: ['SKILL.md', 'references/guide.md'],
    })])
  }, { timeout: 5000 })
  expect((await ctx.skills.get('my-report'))?.resourceBase).toEqual({ kind: 'directory', path: directory })
  const content = entry('my-report', 'Updated personal instructions')
  await writeFile(path, content)
  await vi.waitFor(async () => expect((await ctx.skills.get('my-report'))?.content).toContain('Updated personal instructions'), { timeout: 5000 })
  const catalog = await ctx.toolboxSkills.inventory({})
  await ctx.toolboxSkills.setEnabled({ id: skillId(directory), expectedRevision: catalog.revision, enabled: false })
  expect(await ctx.skills.get('my-report')).toBeUndefined()
  expect(await readFile(path, 'utf8')).toBe(content)
  await expect(readFile(join(directory, markerName))).rejects.toMatchObject({ code: 'ENOENT' })
  await rm(directory, { recursive: true })
  await vi.waitFor(async () => expect((await ctx.toolboxSkills.inventory({})).items).toEqual([]), { timeout: 5000 })
})

it('accepts an empty legacy metadata field when discovering and reading personal skills', async () => {
  const { ctx, userRoot } = await skillsFixture({ separateUserRoot: true })
  const directory = join(userRoot, 'legacy-empty-metadata')
  const path = join(directory, 'SKILL.md')
  const content = '---\nname: legacy-empty-metadata\ndescription: Legacy personal skill\nmetadata:\n---\nOriginal personal instructions\n'
  await mkdir(directory, { recursive: true })
  await writeFile(path, content)
  await vi.waitFor(async () => {
    expect((await ctx.toolboxSkills.inventory({})).items).toEqual([expect.objectContaining({
      origin: 'user', path, managed: false, readiness: expect.objectContaining({ state: 'ready', reasons: [] }),
    })])
  }, { timeout: 5000 })
  expect((await ctx.skills.get('legacy-empty-metadata'))?.content).toContain('Original personal instructions')
  expect((await ctx.toolboxSkills.detail({ id: skillId(directory) })).content).toContain('Original personal instructions')
  expect(await readFile(path, 'utf8')).toBe(content)
})

it('writes imported and created personal skills into the old GUI directory, while product defaults stay built-in', async () => {
  const { ctx, installer, userRoot, dir, start } = await skillsFixture({ separateUserRoot: true })
  const bundled = await installer.install({ requestId: 'default', source: { kind: 'bundled', resourceId: 'brainstorming' }, scope: { kind: 'user' }, conflict: 'reject' })
  const prepared = await installer.prepareSkill({ content: entry('my-report', 'Personal instructions') })
  const installed = await installer.install({ requestId: 'personal', source: { kind: 'local', importId: prepared.importId }, scope: { kind: 'user' }, conflict: 'reject' })
  expect(installed.state).toBe('installed')
  expect(await readFile(join(userRoot, 'my-report/SKILL.md'), 'utf8')).toContain('Personal instructions')
  await expect(readFile(join(dir, 'skills/my-report/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  const catalog = await ctx.toolboxSkills.inventory({})
  expect(catalog.items.find(item => item.id === installed.skillId)).toMatchObject({ origin: 'user', managed: true, path: join(userRoot, 'my-report/SKILL.md') })
  expect(catalog.items.find(item => item.id === bundled.skillId)).toMatchObject({ origin: 'bundled', path: join(dir, 'skills/brainstorming/SKILL.md') })
  await ctx.fiber.dispose()
  const restarted = await start()
  expect((await restarted.skills.get('my-report'))?.content).toContain('Personal instructions')
  await restarted.toolboxSkills.remove({ id: installed.skillId!, expectedRevision: (await restarted.toolboxSkills.inventory({})).revision })
  await expect(readFile(join(userRoot, 'my-report/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await restarted.skills.get('brainstorming'))?.content).toBeTruthy()
})

it('selects a personal override ahead of an existing product copy without overwriting either file', async () => {
  const { ctx, installer, userRoot, dir } = await skillsFixture({ separateUserRoot: true })
  await installer.install({ requestId: 'default', source: { kind: 'bundled', resourceId: 'brainstorming' }, scope: { kind: 'user' }, conflict: 'reject' })
  const original = await readFile(join(dir, 'skills/brainstorming/SKILL.md'), 'utf8')
  await mkdir(join(userRoot, 'brainstorming'), { recursive: true })
  await writeFile(join(userRoot, 'brainstorming/SKILL.md'), entry('brainstorming', 'My own brainstorming instructions'))
  await vi.waitFor(async () => expect((await ctx.skills.get('brainstorming'))?.content).toContain('My own brainstorming instructions'), { timeout: 5000 })
  const items = (await ctx.toolboxSkills.inventory({})).items
  expect(items.filter(item => item.name === 'brainstorming')).toHaveLength(2)
  expect(items.find(item => item.origin === 'bundled')?.readiness.reasons).toContainEqual(expect.objectContaining({ code: 'shadowed' }))
  expect(items.find(item => item.origin === 'user')?.readiness.state).toBe('ready')
  expect(await readFile(join(dir, 'skills/brainstorming/SKILL.md'), 'utf8')).toBe(original)
})

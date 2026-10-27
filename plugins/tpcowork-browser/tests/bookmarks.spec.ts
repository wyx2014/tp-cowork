import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookmarkStore, bookmarkUserDataDirs, findBookmarksFile, parseChromiumBookmarks } from '../src/bookmarks.js'
import { flattenBookmarks, searchBookmarks } from '../src/bookmark-search.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function temp() { const root = await mkdtemp(join(tmpdir(), 'tpcb-bookmarks-')); roots.push(root); return root }

const url = (name: string, href: string) => ({ type: 'url', name, url: href })
const folder = (name: string, children: unknown[]) => ({ type: 'folder', name, children })
const document = {
  roots: {
    bookmark_bar: folder('Bookmarks bar', [url('GitHub', 'https://github.com/'), folder('Work', [url('Jira', 'https://jira.example.com/browse'), url('Bookmarklet', 'javascript:alert(1)')]), folder('Empty', [])]),
    other: folder('Other bookmarks', [url('Docs', 'https://docs.example.com/'), url('Settings', 'chrome://settings')]),
    synced: folder('Mobile bookmarks', []),
  },
}
async function profile(userDataDir: string, name: string, bookmarks?: unknown) {
  await mkdir(join(userDataDir, name), { recursive: true })
  if (bookmarks !== undefined) await writeFile(join(userDataDir, name, 'Bookmarks'), JSON.stringify(bookmarks))
}

describe('Chromium bookmarks', () => {
  it('locates Chrome and Edge per platform', () => {
    expect(bookmarkUserDataDirs({ platform: 'darwin', homeDir: '/Users/a' })).toEqual({
      chrome: '/Users/a/Library/Application Support/Google/Chrome', edge: '/Users/a/Library/Application Support/Microsoft Edge' })
    expect(bookmarkUserDataDirs({ platform: 'linux', homeDir: '/home/a', env: {} })).toEqual({
      chrome: '/home/a/.config/google-chrome', edge: '/home/a/.config/microsoft-edge' })
    expect(bookmarkUserDataDirs({ platform: 'win32', homeDir: 'C:/Users/a', env: { LOCALAPPDATA: 'L' } }).edge).toBe(join('L', 'Microsoft', 'Edge', 'User Data'))
  })

  it('reads the last used profile, else Default, else the first profile with bookmarks', async () => {
    const dir = await temp()
    await profile(dir, 'Default', document)
    await profile(dir, 'Profile 2', document)
    await profile(dir, 'Profile 3')
    await writeFile(join(dir, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 2', info_cache: { Default: {}, 'Profile 2': {} } } }))
    expect((await findBookmarksFile(dir))?.profile).toBe('Profile 2')
    await writeFile(join(dir, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 3' } }))
    expect((await findBookmarksFile(dir))?.profile).toBe('Default')
    await rm(join(dir, 'Default', 'Bookmarks'))
    expect((await findBookmarksFile(dir))?.profile).toBe('Profile 2')
    expect(await findBookmarksFile(join(dir, 'missing'))).toBeUndefined()
  })

  it('keeps web addresses and non-empty folders only', () => {
    const { roots: parsed, count } = parseChromiumBookmarks(document)
    expect(count).toBe(3)
    expect(parsed).toEqual([
      { id: 'bookmark_bar', title: 'Bookmarks bar', children: [{ title: 'GitHub', url: 'https://github.com/' }, { title: 'Work', children: [{ title: 'Jira', url: 'https://jira.example.com/browse' }] }] },
      { id: 'other', title: 'Other bookmarks', children: [{ title: 'Docs', url: 'https://docs.example.com/' }] },
    ])
    expect(() => parseChromiumBookmarks({})).toThrow('expected format')
  })

  it("stores each browser's snapshot, replaces it on re-import, and reports missing browsers as a result", async () => {
    const home = await temp()
    const dirs = { chrome: join(home, 'chrome'), edge: join(home, 'edge') }
    await profile(dirs.chrome, 'Default', document)
    const emit = vi.fn()
    const store = new BookmarkStore(home, emit, dirs)
    await store.start()
    expect(await store.list()).toEqual({ revision: 0, available: { chrome: true, edge: false }, sources: {} })
    expect(await store.import('edge')).toEqual({ success: false, browser: 'edge', error: 'bookmarks_not_found' })
    expect(await store.import('chrome')).toMatchObject({ success: true, browser: 'chrome', profile: 'Default', count: 3 })
    expect(emit).toHaveBeenCalledOnce()
    expect(store.summary()).toMatchObject({ revision: 1, sources: { chrome: { profile: 'Default', count: 3 } } })
    expect(store.summary().sources.chrome).not.toHaveProperty('roots')
    // Owner-only file; a fresh store restores it.
    expect((await stat(join(home, 'bookmarks.json'))).mode & 0o777).toBe(0o600)
    const restored = new BookmarkStore(home, vi.fn(), dirs)
    await restored.start()
    expect((await restored.list()).sources.chrome.count).toBe(3)
    // Re-importing replaces the snapshot with the browser's current bookmarks.
    await profile(dirs.chrome, 'Default', { roots: { bookmark_bar: folder('Bar', [url('Only', 'https://only.example/')]) } })
    expect(await store.import('chrome')).toMatchObject({ count: 1 })
    expect(JSON.parse(await readFile(join(home, 'bookmarks.json'), 'utf8')).chrome.roots[0].children).toEqual([{ title: 'Only', url: 'https://only.example/' }])
    await expect(store.import('safari')).rejects.toThrow('Chrome or Edge')
  })
})

describe('bookmark search', () => {
  const rows = flattenBookmarks({ chrome: parseChromiumBookmarks(document), edge: { roots: [{ id: 'bookmark_bar', title: 'Bar', children: [{ title: 'GitHub Actions', url: 'https://github.com/features/actions' }, { title: 'GitHub', url: 'https://github.com/' }] }] } },
    (id: string, title: string) => id === 'bookmark_bar' ? '书签栏' : title)

  it('flattens folders into paths', () => {
    expect(rows.find(row => row.title === 'Jira')).toMatchObject({ host: 'jira.example.com', path: ['书签栏', 'Work'], browser: 'chrome' })
  })

  it('ranks title and host prefixes first, matches every word, and shows each address once', () => {
    expect(searchBookmarks(rows, 'git').map(row => row.title)).toEqual(['GitHub', 'GitHub Actions'])
    expect(searchBookmarks(rows, 'work jira').map(row => row.title)).toEqual(['Jira'])
    expect(searchBookmarks(rows, 'browse').map(row => row.title)).toEqual(['Jira'])
    expect(searchBookmarks(rows, '  ')).toEqual([])
    expect(searchBookmarks(rows, 'e', 2)).toHaveLength(2)
  })
})

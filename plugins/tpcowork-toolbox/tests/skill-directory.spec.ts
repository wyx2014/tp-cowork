import { afterEach, expect, it, vi } from 'vitest'
import { pickSkillDirectory } from '../src/client/skill-directory.ts'

afterEach(() => vi.unstubAllGlobals())

it('returns the desktop selection and preserves cancellation without opening a second chooser', async () => {
  const host = vi.fn(async () => '/host')
  const pick = vi.fn().mockResolvedValueOnce('/local/my-skill').mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('chooser failed'))
  vi.stubGlobal('__DSH_DIRECTORY_PICKER__', { pick })
  expect(await pickSkillDirectory(host)).toBe('/local/my-skill')
  expect(await pickSkillDirectory(host)).toBeNull()
  await expect(pickSkillDirectory(host)).rejects.toThrow('chooser failed')
  expect(host).not.toHaveBeenCalled()
})

it('uses the Host chooser outside the desktop application', async () => {
  vi.stubGlobal('__DSH_DIRECTORY_PICKER__', undefined)
  const host = vi.fn(async () => '/host/my-skill')
  expect(await pickSkillDirectory(host)).toBe('/host/my-skill')
  expect(host).toHaveBeenCalledOnce()
})

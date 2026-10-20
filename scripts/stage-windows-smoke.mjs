/** Verify a relocatable application outside the deeply nested builder output directory. */
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Copy the entire packaged app to a private path with spaces and remove it after verification. */
export async function withStagedWindowsApplication(source, verify) {
  const root = await mkdtemp(join(tmpdir(), 'tp-'))
  try {
    const application = join(root, 'TP Cowork')
    await cp(source, application, { recursive: true, errorOnExist: true, force: false })
    return await verify(application)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

/** Initialize the same profile as Desktop, without opening a temporary welcome window. */
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { harnessRoot } from './package-command.mjs'

export async function initializeDesktopProfile({ harness = harnessRoot,
  home = process.env.DSH_HOME || join(harness, 'apps/desktop/.desktop-build/development/home'),
} = {}) {
  const { createPluginProfile } = await import(pathToFileURL(join(harness, 'apps/desktop/lib/types/project-manager.js')))
  const profile = join(resolve(home), 'profiles/desktop')
  createPluginProfile(profile)
  return profile
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(`TP Cowork profile: ${await initializeDesktopProfile()}`) }
  catch (error) { console.error(`TP Cowork: ${error.message}`); process.exitCode = 1 }
}

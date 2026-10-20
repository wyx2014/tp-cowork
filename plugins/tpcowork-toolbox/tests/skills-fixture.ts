/** Real Loader/profile/settings/Gateway composition, isolated from the user's profiles. */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { onTestFinished } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as skills from '../src/host/skills/index.ts'
export async function skillsFixture(options: { python?: string; separateUserRoot?: boolean } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'toolbox-skills-')))
  const dir = join(home, 'profiles/test')
  const userRoot = options.separateUserRoot ? join(home, 'app-data/tpcowork/workspace/skills') : join(dir, 'skills')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules/test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  const bundledRoot = resolve(import.meta.dirname, '../resources/skills')
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
    { id: 'typert', name: 'cordis:typert' }, { id: 'gateway', name: 'cordis:gateway' },
    { id: 'skills', name: 'cordis:registry' }, { id: 'toolbox-skills', name: 'cordis:toolbox', config: { bundledRoot, userRoot, ...(options.python ? { python: options.python } : {}) } },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  const contexts: Awaited<ReturnType<typeof boot>>[] = []
  const start = async () => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile)
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, typert: TypertRegistry, gateway: Gateway, registry: SkillRegistry, toolbox: skills })
    })
    contexts.push(ctx)
    return ctx
  }
  onTestFinished(async () => { for (const ctx of contexts) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  const ctx = await start()
  return { ctx, home, dir, userRoot, start, bundledRoot, installer: skills.requireInstaller(ctx) }
}

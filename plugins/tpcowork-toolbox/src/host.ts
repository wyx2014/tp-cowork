import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { Change, InstallerApi, McpApi, PromptHubApi, SkillsApi, TeamsApi, ToolboxApi, ToolboxDescription } from './contracts/index.ts'
import { defaultMcpPresets } from './presets.ts'
import { hostContribution } from './remote.ts'
import { watchChanges } from './changes.ts'
import { Config, composeToolbox } from './composition.ts'
import { userSkillsDirectory } from './host/skills/user-directory.ts'
export { Config } from './composition.ts'
export type * from './contracts/index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    toolbox: ToolboxApi
    toolboxSkills: SkillsApi
    toolboxMcp: McpApi
    toolboxTeams: TeamsApi
    toolboxInstaller: InstallerApi
    toolboxPromptHub: PromptHubApi
  }
  interface Events { 'toolbox/changed'(change: Change): void }
}
export const name = 'tpcowork-toolbox'
export const inject = ['typert']
export class ToolboxService extends TypertRemoteService implements ToolboxApi {
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'toolbox') }
  async describe(): Promise<ToolboxDescription> {
    return {
      contractVersion: 1,
      modules: {
        skills: this.ctx.get('toolboxSkills') !== undefined, mcp: this.ctx.get('toolboxMcp') !== undefined,
        teams: this.ctx.get('toolboxTeams') !== undefined, installer: this.ctx.get('toolboxInstaller') !== undefined,
        prompthub: this.ctx.get('toolboxPromptHub') !== undefined,
      },
      defaultMcpIds: defaultMcpPresets.map(preset => preset.id),
      ...(this.ctx.get('toolboxSkills') ? { userSkillsDirectory: userSkillsDirectory({ configured: this.config.skills.userRoot }) } : {}),
    }
  }
}
class ToolboxChangesService extends TypertRemoteService {
  constructor(private readonly owner: Context) { super(owner, 'toolboxChanges') }
  watch(signal: AbortSignal) { return watchChanges(this.owner, signal) }
}
/** Optional management modules compose into this one plugin. No second executor, installer index or store. */
export function apply(ctx: Context, config: Config): void {
  ctx.typert.register(hostContribution)
  new ToolboxService(ctx, config)
  new ToolboxChangesService(ctx)
  let revision = 0
  for (const key of ['toolboxSkills', 'toolboxMcp', 'toolboxTeams', 'toolboxInstaller', 'toolboxPromptHub'] as const) {
    ctx.inject([key], inner => {
      const changed = () => { ctx.emit('toolbox/changed', { revision: ++revision, domain: 'modules' }) }
      changed()
      inner.effect(() => changed)
    })
  }
  composeToolbox(ctx, config)
}

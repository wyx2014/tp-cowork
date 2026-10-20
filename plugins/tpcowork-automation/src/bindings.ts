/** Read-only editor bindings from the same default preset used by automation execution. */
import { type Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-workspace'
import { bindingsRequest, bindingsContribution } from './bindings-remote.ts'
import { AutomationError, parseInput } from './errors.ts'
import type { AutomationBindingsRequest, AutomationBindingsValue } from './ui-types.ts'

declare module '@deepseek-ai/cordis' { interface Context { automationBindings: AutomationBindings } }

/** Lists metadata without creating an Agent, Session or model request. */
export class AutomationBindings extends TypertRemoteService {
  static inject = ['typert', 'tools', 'workingDirectory']
  constructor(ctx: Context) {
    super(ctx, 'automationBindings')
    ctx.typert.register(bindingsContribution)
  }
  /** @param input - Effective task directory. @returns User-invocable skills and registered MCP connector identities. */
  async list(input: AutomationBindingsRequest): Promise<AutomationBindingsValue> {
    const data = parseInput(bindingsRequest, input)
    const presets = this.ctx.get('agentPresets')
    await using lease = presets === undefined ? undefined : await presets.acquireScope()
    const skills = this.ctx.get('skills')
    try {
      const catalog = skills === undefined ? [] : await skills.list({ cwd: data.workspacePath ?? this.ctx.workingDirectory.defaultDirectory, scope: lease?.key })
      const connectors = [...new Set(this.ctx.tools.schemas(lease?.key).flatMap(tool => {
        // Tool names carry no structured server identity; ambiguous delimiters cannot be guessed.
        if (tool.name.split('__').length !== 3) return []
        const match = /^mcp__([A-Za-z0-9_-]{1,32})__/.exec(tool.name)
        return match?.[1] ? [match[1]] : []
      }))].sort().map(name => ({ name }))
      return { skills: catalog.filter(isUserInvocable).map(({ name, description }) => ({ name, description })), connectors, skillsAvailable: skills !== undefined }
    } catch {
      throw new AutomationError('runtime_unavailable', '无法读取当前自动化技能和 MCP 绑定。')
    }
  }
}

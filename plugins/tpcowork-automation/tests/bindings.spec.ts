/** Public metadata comes from real tool/skill registries and is withdrawn on unload. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import { AutomationBindings } from '../src/bindings.ts'

describe('automation editor bindings', () => {
  it('lists user-invocable skills and unambiguous MCP identities without invoking tools or loading bodies', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(TypertRegistry); await ctx.plugin(Gateway); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools); await ctx.plugin(Skills)
      ctx.provide('workingDirectory', { defaultDirectory: '/workspace' })
      ctx.skills.register({ name: 'report', description: 'Reports', source: 'runtime', content: 'private skill body' })
      ctx.skills.register({ name: 'hidden', description: 'Hidden', source: 'runtime', content: 'hidden body', invocation: { userInvocable: false, modelInvocable: true } })
      for (const name of ['mcp__docs__read', 'mcp__docs__search', 'mcp__mail__read', 'mcp__ambiguous__server__read']) {
        ctx.tools.register({ name, description: 'public tool', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] }, execute: async () => { throw new Error('must not execute') } })
      }
      const plugin = await ctx.plugin(AutomationBindings)
      const result = await ctx.typertGateway.invoke({ namespace: 'automationBindings', method: 'list', args: { request: { workspacePath: '/project' } } })
      expect(result).toEqual({ skills: [{ name: 'report', description: 'Reports' }], connectors: [{ name: 'docs' }, { name: 'mail' }], skillsAvailable: true })
      expect(JSON.stringify(result)).not.toContain('body')
      await plugin.dispose()
      await expect(ctx.typertGateway.invoke({ namespace: 'automationBindings', method: 'list', args: { request: {} } })).rejects.toMatchObject({ code: 'gateway/definition-unavailable' })
    } finally { await ctx.fiber.dispose() }
  })
  it('reports a missing skill registry and validates the wire input', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(TypertRegistry); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
      ctx.provide('workingDirectory', { defaultDirectory: '/workspace' })
      await ctx.plugin(AutomationBindings)
      expect(await ctx.automationBindings.list({})).toEqual({ skills: [], connectors: [], skillsAvailable: false })
      await expect(ctx.automationBindings.list({ workspacePath: '' })).rejects.toMatchObject({ code: 'automation/invalid_input' })
    } finally { await ctx.fiber.dispose() }
  })
})

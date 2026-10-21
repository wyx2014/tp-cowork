import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { apply as applyConnection } from '@deepseek-ai/dsh-client-connection/client'
import { apply as applyGatewayClient, inject as clientInject } from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteMock, ok } from '@deepseek-ai/dsh-remote-mock'
import * as host from '../src/host.ts'
import * as client from '../src/client.ts'
import { descriptionSchema } from '../src/remote.ts'

const description = { contractVersion: 1, modules: { skills: false, mcp: false, teams: false, installer: false, prompthub: false }, defaultMcpIds: ['juyuan', 'caihui_mcp', 'playwright'] }
describe('DSH plugin seam', () => {
  it('announces teams only while both the catalog and task services are available', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(TypertRegistry)
      await ctx.plugin(TypertGatewayService)
      await ctx.plugin(host)
      await ctx.plugin({ name: 'teams-fixture', apply(inner: Context) {
        inner.provide('toolboxTeams', { inventory: async () => ({ revision: 1, complete: true, items: [] }) })
      } })
      expect((await ctx.toolbox.describe()).modules.teams).toBe(false)
      const stream = (await ctx.typertGateway.stream({ namespace: 'toolboxChanges', method: 'watch', args: {}, signal: new AbortController().signal }))[Symbol.asyncIterator]()
      expect((await stream.next()).value).toEqual({ type: 'ready' })
      const unused = async () => { throw new Error('Task methods are not used by describe') }
      const tasks = await ctx.plugin({ name: 'tasks-fixture', apply(inner: Context) {
        inner.provide('toolboxTasks', { selection: unused, context: unused, submit: unused })
      } })
      expect((await ctx.toolbox.describe()).modules.teams).toBe(true)
      expect((await stream.next()).value).toMatchObject({ type: 'changed', change: { domain: 'modules' } })
      await tasks.dispose()
      expect((await ctx.toolbox.describe()).modules.teams).toBe(false)
      expect((await stream.next()).value).toMatchObject({ type: 'changed', change: { domain: 'modules' } })
      await stream.return?.()
    } finally { await ctx.fiber.dispose() }
  })

  it('loads through the real Host Gateway, streams invalidation and removes endpoints and idle listeners on unload', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(TypertRegistry)
      await ctx.plugin(TypertGatewayService)
      const plugin = await ctx.plugin(host)
      expect(descriptionSchema.parse(await ctx.typertGateway.invoke({ namespace: 'toolbox', method: 'describe', args: {} }))).toEqual(description)
      const stream = (await ctx.typertGateway.stream({ namespace: 'toolboxChanges', method: 'watch', args: {}, signal: new AbortController().signal }))[Symbol.asyncIterator]()
      expect((await stream.next()).value).toEqual({ type: 'ready' })
      const module = await ctx.plugin({ name: 'installer-fixture', apply(inner: Context) {
        inner.provide('toolboxInstaller', { install: async () => ({ operationId: 'unused', state: 'unchanged' }), cancel: async () => {} })
      } })
      expect((await ctx.toolbox.describe()).modules.installer).toBe(true)
      expect((await stream.next()).value).toMatchObject({ type: 'changed', change: { domain: 'modules' } })
      await module.dispose()
      expect((await ctx.toolbox.describe()).modules.installer).toBe(false)
      expect((await stream.next()).value).toMatchObject({ type: 'changed', change: { domain: 'modules' } })
      ctx.emit('toolbox/changed', { revision: 1, domain: 'mcp', id: 'juyuan' })
      expect((await stream.next()).value).toMatchObject({ type: 'changed', change: { id: 'juyuan' } })
      const stopped = stream.next()
      await plugin.dispose()
      expect((await stopped).done).toBe(true)
      expect(ctx.get('toolbox')).toBeUndefined()
      expect(ctx.typert.local.list()).toEqual([])
      await expect(ctx.typertGateway.invoke({ namespace: 'toolbox', method: 'describe', args: {} })).rejects.toMatchObject({ code: 'gateway/definition-unavailable' })
    } finally { await ctx.fiber.dispose() }
  })
  it('mounts the real Client Remote facade and withdraws it on unload', async () => {
    const globals = ['location', '__DSH_TRANSPORT__'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
    const ctx = new Context()
    const mock = RemoteMock.create().unary('toolbox/describe', () => ok(description))
    try {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: '127.0.0.1', search: '' } })
      Object.defineProperty(globalThis, '__DSH_TRANSPORT__', { configurable: true, value: { rpc: mock.rpc } })
      await ctx.plugin(TypertRegistry)
      await ctx.plugin({ inject: [], apply: applyConnection })
      await ctx.plugin({ inject: clientInject, apply: applyGatewayClient })
      const plugin = await ctx.plugin(client)
      await vi.waitFor(() => expect(ctx.connection.generation.getSnapshot()).toBeDefined())
      expect(await ctx.toolbox.describe()).toEqual(description)
      await plugin.dispose()
      expect(ctx.get('toolbox')).toBeUndefined()
      expect(ctx.typert.remotes.list()).toEqual([])
      mock.assertNoUnmatched()
    } finally {
      await ctx.fiber.dispose()
      for (const [key, descriptor] of globals) {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, key)
        else Object.defineProperty(globalThis, key, descriptor)
      }
    }
  })
})

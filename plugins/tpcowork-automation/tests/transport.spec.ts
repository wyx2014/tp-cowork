import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { apply as applyConnection } from '@deepseek-ai/dsh-client-connection/client'
import { apply as applyGatewayClient, inject as clientInject } from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteMock, ok } from '@deepseek-ai/dsh-remote-mock'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../deepseek-harness/packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import { AutomationService } from '../src/host.ts'
import * as clientPlugin from '../src/client.ts'
import { payloadSchema } from '../src/schemas.ts'
import { AutomationError } from '../src/errors.ts'
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol'

const empty = { tasks: [], status: { enabled: false, jobs: 0, next_wake_at_ms: null } }
describe('shared Gateway interfaces', () => {
  it('dispatches through real Host Gateway validation and withdraws definitions on plugin unload', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Storage)
      await ctx.plugin(TypertRegistry)
      const backend = new MemoryStorageBackend(new MemoryMediaPool())
      ctx.effect(() => ctx.storage.backend.register('fixture', backend))
      const facility = new DomainFacility(ctx, { backend: 'fixture' })
      ctx.provide('storageDomain', facility)
      ctx.effect(() => async () => { await facility.closeAll(); await backend.close() })
      await ctx.plugin(TypertGatewayService)
      const plugin = await ctx.plugin(AutomationService)
      const lifetime = new AbortController()
      const stream = await ctx.typertGateway.stream({ namespace: 'automationChanges', method: 'watch', args: {}, signal: lifetime.signal })
      const changes = stream[Symbol.asyncIterator]()
      expect((await changes.next()).value).toEqual({ type: 'ready' })
      const raw = await ctx.typertGateway.invoke({ namespace: 'automation', method: 'create', args: {
        request: { name: '传输测试', prompt: '生成报告', schedule: { frequency: 'manual' } },
      } })
      const result = payloadSchema.parse(raw)
      expect((await changes.next()).value).toMatchObject({ type: 'changed', change: { reason: 'created', taskId: result.tasks[0]!.id } })
      lifetime.abort(); await expect(changes.next()).rejects.toMatchObject({ code: 'gateway/cancelled' })
      expect(isRemoteJsonValue(raw)).toBe(true)
      expect(result.tasks[0]!.name).toBe('传输测试')
      expect(payloadSchema.parse(await ctx.typertGateway.invoke({ namespace: 'automation', method: 'list', args: {} }))).toEqual(result)
      const run = await ctx.automation.beginRun({ taskId: result.tasks[0]!.id, trigger: 'manual' })
      await ctx.automation.finishRun({ taskId: result.tasks[0]!.id, runId: run.id, status: 'completed', resultType: 'none', conversationAvailable: false })
      expect(isRemoteJsonValue(await ctx.typertGateway.invoke({ namespace: 'automation', method: 'list', args: {} }))).toBe(true)
      await expect(ctx.typertGateway.invoke({ namespace: 'automation', method: 'create', args: {
        request: { name: 'invalid', prompt: 'run', schedule: { frequency: 'daily', timezone: 'No/SuchZone' } },
      } })).rejects.toMatchObject({ code: 'automation/invalid_timezone' })
      const live = (await ctx.typertGateway.stream({ namespace: 'automationChanges', method: 'watch', args: {}, signal: new AbortController().signal }))[Symbol.asyncIterator]()
      await live.next(); const stopped = live.next()
      await plugin.dispose()
      expect((await stopped).done).toBe(true)
      expect(ctx.get('automationChanges')).toBeUndefined()
      await expect(ctx.typertGateway.invoke({ namespace: 'automation', method: 'list', args: {} }))
        .rejects.toMatchObject({ code: 'gateway/definition-unavailable' })
    } finally { await ctx.fiber.dispose() }
  })

  it('mounts the real Client namespace, delegates mutations and removes all plugin services on unload', async () => {
    const descriptors = ['location', '__DSH_TRANSPORT__'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
    const mock = RemoteMock.create().unary('automation/list', () => ok(empty)).unary('automation/create', () => ok(empty))
      .unary('automation/runNow', () => ({ ok: false, error: new AutomationError('runtime_unavailable', 'not loaded') }))
    const ctx = new Context()
    try {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: '127.0.0.1', search: '' } })
      Object.defineProperty(globalThis, '__DSH_TRANSPORT__', { configurable: true, value: { rpc: mock.rpc } })
      await ctx.plugin(TypertRegistry)
      await ctx.plugin({ inject: [], apply: applyConnection })
      await ctx.plugin({ inject: clientInject, apply: applyGatewayClient })
      const plugin = await ctx.plugin(clientPlugin)
      await vi.waitFor(() => expect(ctx.connection.generation.getSnapshot()).toBeDefined())
      expect(await ctx.automation.list()).toEqual(empty)
      expect(await ctx.automation.create({ name: 'client', prompt: 'run', schedule: { frequency: 'manual' } })).toEqual(empty)
      await expect(ctx.automation.runNow({ id: 'task' })).rejects.toMatchObject({ code: 'automation/runtime_unavailable' })
      await plugin.dispose()
      expect(ctx.get('automation')).toBeUndefined()
      expect(ctx.typert.remotes.list()).toEqual([])
      mock.assertNoUnmatched()
    } finally {
      await ctx.fiber.dispose()
      for (const [key, descriptor] of descriptors) {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, key)
        else Object.defineProperty(globalThis, key, descriptor)
      }
    }
  })
})

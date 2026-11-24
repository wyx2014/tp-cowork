import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { MemoryCredentials } from '../../../../deepseek-harness/packages/credentials/credentials/tests/memory.ts'
import * as HubModel from '../src/hub-model.ts'

it('keeps the gateway adapter owned by the model plugin when a configuration caller unloads', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime).await()
  await ctx.plugin(MemoryCredentials).await()
  const gateway = ctx.plugin(HubModel)
  await gateway.await()

  const config = {
    quotaStatus: 'active',
    apiKey: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    baseURL: 'https://gateway.example/v1',
    models: [{ id: 'chat' }],
  }
  const firstLogin = ctx.plugin({ name: 'first-login', inject: ['tpcoworkGateway'],
    async apply(scope: Context) { await scope.tpcoworkGateway.configure(config) },
  })
  await firstLogin.await()
  await firstLogin.dispose()

  ctx.tpcoworkGateway.clear()
  expect(ctx.tpcoworkGateway.modelConnection()).toBeNull()
  expect(ctx.llm.listProviders().map(provider => provider.id)).not.toContain(HubModel.providerId)
  await ctx.tpcoworkGateway.configure(config)
  expect(ctx.tpcoworkGateway.modelConnection()).toMatchObject({ baseURL: config.baseURL, api: 'openai-completions' })
  expect((await ctx.llm.listModels(HubModel.providerId)).map(model => model.id)).toEqual(['chat'])
  await gateway.dispose()
  expect(ctx.llm.listProviders().map(provider => provider.id)).not.toContain(HubModel.providerId)
})

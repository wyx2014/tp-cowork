import { expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { fixture } from './fixture.ts'
import { bundledTeamIds } from '../src/teams.ts'

const high = ReasoningEffortId('high')
const low = ReasoningEffortId('low')

function registerModels(h: Awaited<ReturnType<typeof fixture>>) {
  h.ctx.llm.registerAdapter(['selected', 'later'], h.adapter)
  h.adapter.listModels = async provider => [{ provider, id: 'selected-model', name: 'Selected model' }]
  vi.spyOn(h.adapter, 'resolveModel').mockImplementation(async (provider, model) => ({
    provider, id: model, name: model,
    reasoning: { efforts: [{ id: low, name: 'Low' }, { id: high, name: 'High' }], defaultEffort: low },
  }))
}

it.each(bundledTeamIds)('%s uses the current default model and effort when the blank parent was created with an older default', async teamId => {
  const h = await fixture()
  registerModels(h)
  const selection = { provider: 'selected', model: 'selected-model', reasoningEffort: high }
  vi.spyOn(h.ctx.agentDefaultModel, 'currentSelection').mockReturnValue(selection)
  expect(h.agent.options).toMatchObject({ provider: 'mock', model: 'mock' })
  expect(h.agent.session.requestHeader()).toBeUndefined()
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'modelSelection')?.pending).toBeNull()

  const memberModels: typeof selection[] = []
  h.ctx.on('agent/disposed', ({ agent }) => {
    if (agent.session.header.parentSession !== h.agent.id) return
    const config = agent.session.requestHeader()!.config
    memberModels.push({ provider: config.provider, model: config.model, reasoningEffort: config.reasoningEffort! })
  })
  await h.submit(teamId)
  expect((await h.wait()).status).toBe('completed')
  expect(h.adapter.requests.length).toBeGreaterThan(6)
  expect(h.adapter.requests.map(({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort })))
    .toEqual(h.adapter.requests.map(() => selection))
  expect(memberModels.length).toBe(teamId === 'asset-research-team' ? 6 : 7)
  expect({ parent: h.agent.session.requestHeader()!.config, members: memberModels }).toMatchSnapshot()
})

it('rerunning a team keeps the parent model after its pending selection has been consumed', async () => {
  const h = await fixture()
  registerModels(h)
  const selection = { provider: 'selected', model: 'selected-model', reasoningEffort: high }
  await h.ctx.sessionController.selectModel({ sessionId: h.agent.id, ...selection })
  await h.submit('asset-research-team')
  const first = await h.wait()
  expect(first.status).toBe('completed')
  expect(h.ctx.sessionProjections.stateOf(h.agent.session, 'modelSelection')?.pending).toBeNull()
  vi.spyOn(h.ctx.agentDefaultModel, 'currentSelection').mockReturnValue({ provider: 'later', model: 'selected-model' })
  const offset = h.adapter.requests.length

  await h.ctx.experts.rerun({ sessionId: h.agent.id }, new AbortController().signal)
  const second = await h.wait()
  expect(second.status).toBe('completed')
  expect(second.run!.runId).not.toBe(first.run!.runId)
  expect(h.adapter.requests.slice(offset).map(({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort })))
    .toEqual(h.adapter.requests.slice(offset).map(() => selection))
})

it('switching the parent before a rerun replaces the member route and clears the previous effort', async () => {
  const h = await fixture()
  registerModels(h)
  await h.ctx.sessionController.selectModel({ sessionId: h.agent.id, provider: 'selected', model: 'selected-model', reasoningEffort: high })
  await h.submit('asset-research-team')
  expect((await h.wait()).status).toBe('completed')
  await h.ctx.sessionController.selectModel({ sessionId: h.agent.id, provider: 'later', model: 'selected-model' })
  const offset = h.adapter.requests.length

  await h.ctx.experts.rerun({ sessionId: h.agent.id }, new AbortController().signal)
  expect((await h.wait()).status).toBe('completed')
  const requests = h.adapter.requests.slice(offset)
  expect(requests.length).toBeGreaterThan(6)
  expect(requests.map(({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort })))
    .toEqual(requests.map(() => ({ provider: 'later', model: 'selected-model', reasoningEffort: low })))
})

it('a selection queued after parent prompt assembly applies on the next step while members keep the current step model', async () => {
  const h = await fixture()
  registerModels(h)
  const selection = { provider: 'selected', model: 'selected-model', reasoningEffort: high }
  await h.ctx.sessionController.selectModel({ sessionId: h.agent.id, ...selection })
  let switched = false
  h.ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent === h.agent && !switched) {
      switched = true
      await h.ctx.sessionController.selectModel({ sessionId: h.agent.id, provider: 'later', model: 'selected-model' })
    }
    return next()
  }, { prepend: true })

  await h.submit('asset-research-team')
  expect((await h.wait()).status).toBe('completed')
  const firstParentRequest = h.adapter.requests.findIndex(request => JSON.stringify(request.messages).includes('团队研究状态：'))
  expect(firstParentRequest).toBeGreaterThan(6)
  const current = h.adapter.requests.slice(0, firstParentRequest + 1)
  expect(current.map(({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort })))
    .toEqual(current.map(() => selection))
  expect(h.adapter.requests.at(-1)).toMatchObject({ provider: 'later', model: 'selected-model', reasoningEffort: low })
})

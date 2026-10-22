import { expect, it, onTestFinished } from 'vitest'
import { fixture } from './fixture.ts'
import { ToolboxModel } from '../../tpcowork-toolbox/src/client/model.ts'
import { managementContribution } from '../../tpcowork-toolbox/src/client/remote.ts'
import { ToolboxService } from '../../tpcowork-toolbox/src/host.ts'
import { join } from 'node:path'
import { bundledTeamIds } from '../src/teams.ts'

it.each(bundledTeamIds)('current Client → codecs → Gateway → native %s preserves pins, uploads and request identity', async teamId => {
  const h = await fixture({ skill: true, mcp: true })
  const remote = Object.fromEntries(['selection', 'context', 'submit'].map(method => [method, async (input: unknown) => {
    const descriptor = managementContribution.descriptors.find(row => row.namespace === 'toolboxTasks' && row.method === method)!
    const request = descriptor.parameters[0]!.codec.create().parse(input)
    const value = await h.ctx.typertGateway.invoke({ namespace: 'toolboxTasks', method, args: { request } })
    return { ok: true, value: descriptor.result.create().parse(value) }
  }]))
  // The Client reads the Host's module description before any task choice; it answers from the loaded services.
  const toolbox = new ToolboxService(h.ctx, { skills: { userRoot: join(h.root, 'personal-skills') } } as never)
  const model = new ToolboxModel({ toolbox: { describe: async () => ({ ok: true, value: await toolbox.describe() }) }, toolboxTasks: remote } as never)
  onTestFinished(() => model.dispose())
  const id = h.agent.id
  await model.loadChoice(id)
  const catalog = model.state.getSnapshot().choices[id]!.catalog!
  model.prepareTeam(id, catalog.teams.items.find(row => row.id === teamId)!)
  model.choose(id, { skillIds: catalog.skills.items.map(row => row.id), mcpIds: ['local'] })
  expect(h.adapter.requests).toHaveLength(0)
  const signal = new AbortController().signal
  const upload = await h.ctx.fileUploads.upload(h.agent, { data: '5rWL6K+V5p2Q5paZ', name: '材料.txt' }, signal)
  const message = { sessionId: id, requestId: 'client-boundary' as never, mode: 'steer' as const, clientTimeZone: 'Asia/Shanghai',
    content: [{ type: 'file' as const, receiptId: upload.receiptId }, { type: 'text' as const, text: '核验用户材料并说明数据缺口。' }] }
  await model.submit(message, signal)
  const pinned = model.state.getSnapshot().choices[id]!.context!
  expect(pinned).toMatchObject({ taskId: id, sessionId: id, team: { id: teamId }, mcp: [{ id: 'local' }] })
  expect(pinned.skills).toHaveLength(1)
  expect((await h.wait()).status).toBe('completed')
  const before = h.adapter.requests.length
  await model.submit(message, signal)
  await h.wait()
  expect(h.adapter.requests).toHaveLength(before)
  await model.loadChoice(id)
  model.choose(id, { team: null, mcpIds: [] })
  expect(model.state.getSnapshot().choices[id]!.context).toEqual(pinned)
  expect(model.state.getSnapshot().choices[id]!.phase).toBe('fixed')
  const messages = h.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  expect(messages).toHaveLength(1)
  expect(messages[0]!.data).toMatchObject({ source: { rpcId: 'client-boundary', clientTimeZone: 'Asia/Shanghai' }, content: [{ type: 'file', attachment: upload.file }, { type: 'text' }] })
  const run = (await h.ctx.experts.snapshot({ sessionId: id })).run!
  expect(run.artifacts.filter(row => row.sessionEventId)).toHaveLength(2)
})

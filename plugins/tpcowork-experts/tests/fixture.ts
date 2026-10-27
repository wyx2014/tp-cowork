/** Real profile Loader, native Session admission, AgentLoop, PTC, subagents, file tools and JSONL. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as Skills from '../../tpcowork-toolbox/src/host/skills/index.ts'
import * as Mcp from '../../tpcowork-toolbox/src/host/mcp/index.ts'
import { tmpdir } from 'node:os'
import { onTestFinished } from 'vitest'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import Typert from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import Workspaces from '@deepseek-ai/dsh-workspace'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import Workflow from '@deepseek-ai/dsh-workflow-ptc'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local'
import Commands from '@deepseek-ai/dsh-commands'
import FileUploads from '@deepseek-ai/dsh-client-file-upload'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import * as FileTools from '@deepseek-ai/dsh-tool-fs'
import * as Todo from '@deepseek-ai/dsh-tool-todo'
import * as Present from '@deepseek-ai/dsh-tool-present'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountWorkflowRuntime } from '../../../../deepseek-harness/packages/workflow/workflow-ptc/tests/setup.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'
import * as Experts from '../src/host.ts'
import * as Teams from '../../tpcowork-toolbox/src/host/teams/index.ts'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'

export async function fixture(options: { gap?: string; fail?: string; hang?: boolean; hangLead?: boolean; allFail?: boolean; mcp?: boolean; skill?: boolean; noDelivery?: boolean; noPlan?: boolean; root?: string } = {}) {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'experts-e2e-'))
  const cwd = join(root, 'workspace')
  await mkdir(cwd, { recursive: true })
  let serial = 0
  const adapter = new MockAdapter(Array.from({ length: 150 }, () => options.hang ? 'hang' as const : request => {
    const latestNotice = request.messages.findLastIndex(message => JSON.stringify(message).includes('团队研究状态：'))
    const current = latestNotice < 0 ? request.messages : request.messages.slice(latestNotice)
    const messages = JSON.stringify(current)
    const role = /角色：[^"\\]+/.exec(messages)?.[0] ?? ''
    if (options.allFail && role) throw new Error('fixture all members failure')
    if (options.fail && role.includes(options.fail)) throw new Error('fixture member failure')
    if (options.gap && role.includes(options.gap)) return textResponse('数据不可用：未生成报告。')
    const paths = [...messages.matchAll(/reports\/experts\/[a-zA-Z0-9_.-]+\/(?:[a-z-]+\.md|report\.html)/g)].map(match => match[0])
    const unique = [...new Set(paths)]
    const hasResult = current.some(message => message.role === 'tool')
    const isLead = messages.includes('团队研究状态：')
    const calls = current.filter(message => message.role === 'tool').length
    if (isLead) {
      if (options.noDelivery) return textResponse('回合结束，没有交付文件。')
      if (calls === 0) return toolCallResponse('present-' + ++serial, 'present', { files: unique.filter(path => /report\.(md|html)$/.test(path)).map(path => ({ path })) })
      if (calls === 1 && !options.noPlan) {
        const plan = ctx.agents.get(SessionId('team-session'))!.session.snapshotEvents().findLast(event => event.type === 'todo/write')!
        return toolCallResponse('todo-' + ++serial, 'todo_write', { todos: plan.type === 'todo/write' ? plan.data.todos.map(item => item.content === '交付 Markdown/HTML 报告' ? { ...item, status: 'completed' } : item) : [] })
      }
      return textResponse('已提交真实报告；缺口见正文。')
    }
    const synthesis = messages.includes('综合并交叉质证；')
    const targets = synthesis ? unique.filter(path => /report\.(md|html)$/.test(path)) : unique.slice(-1)
    if (calls < targets.length) {
      const file = targets[calls]!
      return toolCallResponse('write-' + ++serial, 'write', { file_path: file,
        content: file.endsWith('.html') ? '<!doctype html><html lang="zh"><meta charset="utf-8"><title>研究报告</title><body><h1>研究报告</h1><p>测试材料。缺少实时数据；置信度低。</p></body></html>' : '# 研究报告\n\n来源：用户测试材料。日期：2026-10-15。缺少实时金融数据，置信度低。\n' })
    }
    return textResponse(hasResult ? '报告已写入；数据缺口已注明。' : '材料缺失。')
  }))
  if (options.hangLead) {
    const stream = adapter.stream.bind(adapter)
    adapter.stream = async function* (request) {
      if (!JSON.stringify(request.messages).includes('团队研究状态：')) { yield* stream(request); return }
      adapter.requests.push(request)
      await new Promise<void>((_, reject) => {
        if (request.signal?.aborted) { reject(request.signal.reason); return }
        request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true })
      })
    }
  }
  const infra = { async apply(inner: Context) {
    const ctx = inner.root
    await ctx.plugin(Typert); await ctx.plugin(RemoteAccess); await ctx.plugin(Gateway); await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(join(root, 'storage'))
    ctx.effect(() => ctx.storage.backend.register('test', backend))
    const domains = new DomainFacility(ctx, { backend: 'test' })
    ctx.provide('storageDomain', domains)
    ctx.effect(() => async () => { await domains.closeAll(); await backend.close() })
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await ctx.plugin(Jsonl, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(Query, { path: join(root, 'query.sqlite'), openAt: 'never' })
    await ctx.plugin(Workspaces)
    await ctx.plugin(DefaultModel, { provider: 'mock', model: 'mock' })
    await ctx.plugin(AttachmentLocal, { dshHome: root })
    await ctx.plugin(Credentials, { path: join(root, 'credentials.json') })
    await ctx.plugin(Connection)
    await ctx.plugin(Commands)
    await ctx.plugin(FileUploads)
    await ctx.plugin(SessionController, { nativeOpen: false })
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountWorkflowRuntime(ctx, { cwd, mode: 'danger-full-access', runtimeConfig: { graceMs: 50 } })
    await ctx.plugin(Subagents)
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    await ctx.plugin(Workflow, { maxConcurrentAgents: 4 })
    if (options.mcp) {
      let rows: Mcp.McpRecord[] = [{ revision: 1, definition: { id: 'local', label: 'Local fixture', origin: 'custom', enabled: true, transport: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../../../../deepseek-harness/packages/mcp/mcp-client/tests/fixtures/toolbox-server.mjs', import.meta.url))], credentials: [] } }]
      let revision = 1
      ctx.provide('settings', { describe: () => [{ ns: 'experts-mcp', revision }], mutate: async (_ns, operations) => {
        revision++
        for (const operation of operations) if (operation.path.at(-1) === 'servers') rows = structuredClone(operation.value)
      } } as never)
      await ctx.plugin({ inject: Mcp.inject, apply(inner: Context) {
        Mcp.apply(inner, { settingsEntry: 'experts-mcp', settingsPath: [], servers: { get: () => rows } as never, removedBundled: { get: () => [] } as never, configRevision: { get: () => revision } as never, connectTimeoutMs: 60000 })
      } })
    }
    if (options.skill) {
      const dir = join(root, 'profile')
      const folder = join(dir, 'skills/test-skill')
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'SKILL.md'), '---\nname: test-skill\ndescription: 核验测试材料\n---\n固定技能核验_SKILL。必须说明来源和数据缺口。\n')
      ctx.provide('profileContext', { dir } as never)
      if (!ctx.get('settings')) ctx.provide('settings', { describe: () => [], mutate: async () => {} } as never)
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(Skills, { bundledRoot: fileURLToPath(new URL('../../tpcowork-toolbox/resources/skills/', import.meta.url)), userRoot: join(root, 'personal-skills') })
    }
    await ctx.plugin(FileTools)
    await ctx.plugin(Todo, { allowParallelInProgress: true })
    await ctx.plugin(Present, { maxFiles: 8 })
    ctx.llm.registerAdapter(['mock'], adapter)
  } }
  const config = join(root, 'cordis.yml')
  await writeFile(config, '- name: cordis:infra\n- name: cordis:experts\n- name: cordis:teams\n')
  const ctx = await boot('test', config, [], ctx => { Object.assign(ctx.loader.builtins, { infra, experts: Experts, teams: Teams }) })
  onTestFinished(async () => { await ctx.fiber.dispose(); if (!options.root) await rm(root, { recursive: true, force: true }) })
  await ctx.sessionController.create({ sessionId: SessionId('team-session'), cwd })
  const agent = ctx.agents.get(SessionId('team-session'))!
  const submit = async (teamId: string, extra: Partial<SessionPromptRequest> = {}) => {
    const inventory = await ctx.toolboxTasks.selection({ sessionId: agent.id })
    const team = inventory.teams.items.find(team => team.id === teamId)!
    return ctx.toolboxTasks.submit({ message: { sessionId: agent.id, requestId: 'request-1' as never, mode: 'queue', content: [{ type: 'text', text: '研究用户提供的测试公司材料，明确数据缺口。' }], clientTimeZone: 'Asia/Shanghai', ...extra },
      selection: { expectedRevision: inventory.revision, team: { id: team.id, version: team.version, workflowId: team.workflowId }, skillIds: options.skill ? inventory.skills.items.map(item => item.id) : [], mcpIds: options.mcp ? ['local'] : [] } }, new AbortController().signal)
  }
  const wait = async () => { await agent.whenIdle(); await ctx.experts.reconcile(agent); return ctx.experts.snapshot({ sessionId: agent.id }) }
  return { ctx, agent, cwd, root, adapter, submit, wait }
}

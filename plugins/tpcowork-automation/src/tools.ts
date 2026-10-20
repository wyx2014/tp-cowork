/** Chat adapter over the same durable Host API used by the editor. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import { AutomationError } from './errors.ts'
import type { AutomationTaskId, ScheduleConfig } from './types.ts'

/** Source datetime.fromisoformat semantics: naive dates use the Host zone, with fold=0. */
export function chatDate(value: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value)
  if (!match) throw new AutomationError('invalid_rule', 'at 必须为 ISO 日期时间。')
  const [, y, m, d, h = '00', min = '00', s = '00', ms = '', zone] = match
  const wall = Date.parse(`${y}-${m}-${d}T${h}:${min}:${s}.${ms.padEnd(3, '0')}Z`)
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== `${y}-${m}-${d}`) {
    throw new AutomationError('invalid_rule', 'at 包含无效的日期或时间。')
  }
  if (zone) {
    const epoch = Date.parse(`${y}-${m}-${d}T${h}:${min}:${s}.${ms.padEnd(3, '0')}${zone}`)
    if (!Number.isFinite(epoch)) throw new AutomationError('invalid_rule', 'at 包含无效的时区偏移。')
    return new Date(epoch).toISOString()
  }
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const offset = (epoch: number) => {
    const p = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]))
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - Math.floor(epoch / 1000) * 1000
  }
  const offsets = [...new Set([-2, -1, 0, 1, 2].map(day => offset(wall + day * 86_400_000)))]
  const candidates = offsets.map(delta => wall - delta).filter(epoch => epoch + offset(epoch) === wall).sort((a, b) => a - b)
  // ZoneInfo's default fold=0 picks the earlier occurrence, or the pre-gap offset.
  return new Date(candidates[0] ?? wall - offsets[0]!).toISOString()
}

function openTurn(events: readonly SessionEvent[]) {
  const boundary = events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  return boundary?.type === 'turn/start' ? boundary : undefined
}

/** Ownership is durable; the creation guard lasts only for the current automatic turn. */
function refusesCreation(ctx: Context, agent: Agent, automaticTurns: ReadonlyMap<string, number>, visited = new Set<string>()): boolean {
  if (agent.session.header.origin === 'subagent' || (agent.session.header.delegationDepth ?? 0) > 0) return true
  if (visited.has(agent.id)) return false
  visited.add(agent.id)
  const events = agent.session.snapshotEvents()
  const current = openTurn(events)
  if (current) {
    if (automaticTurns.get(agent.id) === current.seq) return true
    if (events.slice(current.seq + 1).some(event => event.type === 'user/message'
      && event.data.source.kind === 'tpcowork-automation')) return true
  }
  // DSH closes a fork's copied open turn with synthetic "forked" events. Consult
  // the exact inherited cut and live parent so those closers cannot bypass an
  // ongoing automatic context, or make a completed context permanent.
  const inherited = openTurn(agent.session.snapshotEvents(undefined, agent.session.inheritedEventCount))
  const parentId = agent.session.header.parentSession
  const parent = parentId === undefined ? undefined : ctx.agents.get(parentId)
  if (!inherited || !parent) return false
  const parentTurn = openTurn(parent.session.snapshotEvents())
  return !!(parentTurn && inherited.seq === parentTurn.seq
    && inherited.data.turn === parentTurn.data.turn && refusesCreation(ctx, parent, automaticTurns, visited))
}

/** Registered in the Host plugin's scope so unloading withdraws the tool. */
export function registerAutomationTools(ctx: Context): void {
  const automaticTurns = new Map<string, number>()
  // Latch inherited context at turn entry: a branch may outlive its parent.
  // Release at this turn's end, before an ordinary follow-up can start.
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') automaticTurns.delete(session.id)
    if (event.type !== 'turn/start') return
    const agent = ctx.agents.get(session.id)
    if (agent && refusesCreation(ctx, agent, automaticTurns)) automaticTurns.set(session.id, event.seq)
  })
  ctx.on('agent/disposed', ({ agent }) => { automaticTurns.delete(agent.id) })
  ctx.tools.register(defineTool({
    name: 'cron',
    description: 'Schedule reminders and independent agent tasks. Actions: add, list, remove. '
      + 'Use reminder only to repeat text without reasoning/tools/research; use task for work needing a result conversation. '
      + 'A specific or relative date without recurrence wording is a one-time at job. '
      + 'Use cron_expr/every_seconds and repeat=true only when the user explicitly requests recurrence. '
      + 'Naive ISO dates and omitted cron timezones use the Host local timezone. Never invent a daily recurrence.',
    parameters: {
      action: { type: 'string', enum: ['add', 'list', 'remove'], required: true },
      name: { type: 'string', description: 'Optional short label; defaults to the first 30 characters of message.' },
      description: { type: 'string', description: 'Optional task description.' },
      message: { type: 'string', description: 'Required for add: reminder text or agent instructions.' },
      mode: { type: 'string', enum: ['reminder', 'task'], description: 'Required for add. task preserves a real result conversation.' },
      at: { type: 'string', description: 'One-time ISO date/time. Without an offset, uses Host local timezone.' },
      every_seconds: { type: 'integer', description: 'Positive recurring interval in whole seconds, only on explicit user request.' },
      cron_expr: { type: 'string', description: 'Original five/six/seven-field Cron or macro. Seconds are field six.' },
      tz: { type: 'string', description: 'IANA timezone for cron_expr only.' },
      repeat: { type: 'boolean', description: 'Must be true for recurring schedules, and only when explicitly requested by the user.' },
      job_id: { type: 'string', description: 'Required for remove; obtain the exact id from list.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: args => args.action === 'list',
    async execute(args, exec) {
      try {
        const agent = exec.agent
        if (!agent) return 'Error: 自动化工具必须从聊天会话调用。'
        exec.signal.throwIfAborted()
        if (args.action === 'list') {
          // This service owns user automations only; native/system schedules are never imported.
          const { tasks } = await ctx.automation.list()
          return tasks.length ? JSON.stringify(tasks.map(task => ({ id: task.id, name: task.name, description: task.description,
            mode: task.executionMode === 'reminder' ? 'reminder' : 'task', schedule: task.schedule, status: task.status,
            projectId: task.projectId, workspacePath: task.workspacePath, skillName: task.skillName, mcpPresets: task.mcpPresets,
            lastRunAt: task.lastRunAt, nextRunAt: task.nextRunAt }))) : 'No scheduled jobs.'
        }
        if (args.action === 'remove') {
          if (!args.job_id?.trim()) return 'Error: remove 必须提供 job_id。'
          await ctx.automation.delete({ id: args.job_id as AutomationTaskId })
          return `Removed job ${args.job_id}`
        }
        if (refusesCreation(ctx, agent, automaticTurns)) return 'Error: 不能在自动化运行或子 Agent 中创建新的自动化。'
        if (!args.message?.trim()) return 'Error: add 必须提供非空 message。'
        if (args.mode !== 'reminder' && args.mode !== 'task') return 'Error: add 必须指定 mode=reminder 或 task。'
        if ([args.at, args.cron_expr, args.every_seconds].filter(value => value !== undefined).length !== 1) {
          return 'Error: 必须且只能提供 at、cron_expr、every_seconds 中的一项。'
        }
        if (args.tz !== undefined && args.cron_expr === undefined) return 'Error: tz 只能与 cron_expr 一起使用。'
        if ((args.cron_expr !== undefined || args.every_seconds !== undefined) && args.repeat !== true) {
          return 'Error: 仅在用户明确要求重复时设置 repeat=true；指定日期请使用 at。'
        }
        if (args.at !== undefined && args.repeat === true) return 'Error: at 是一次性任务，不能设置 repeat=true。'
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        let schedule: ScheduleConfig
        if (args.at !== undefined) schedule = { frequency: 'once', at: chatDate(args.at, timezone), timezone }
        else if (args.cron_expr !== undefined) schedule = { frequency: 'custom', cronExpression: args.cron_expr, timezone: args.tz ?? timezone }
        else {
          const everyMs = args.every_seconds! * 1000
          if (!Number.isSafeInteger(everyMs) || everyMs <= 0) return 'Error: every_seconds 必须是可安全换算为毫秒的正整数。'
          schedule = { frequency: 'custom', everyMs, timezone }
        }
        const project = ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(agent.session.id))
        const workspacePath = ctx.workingDirectory.get(agent.session)
        const skills = agent.ctx.get('skills')
        const invocations = agent.session.snapshotEvents().filter(event => event.type === 'user/message'
          && event.data.source.kind === 'skill-invocation').reverse()
        let skillName: string | undefined
        for (const event of invocations) {
          if (event.type !== 'user/message' || event.data.source.kind !== 'skill-invocation') continue
          const skill = await skills?.get(event.data.source.name, { scope: agent, cwd: workspacePath, signal: exec.signal })
          if (skill && isUserInvocable(skill)) { skillName = skill.name; break }
        }
        // Only public tool namespaces leave the runtime; never read MCP config or credentials.
        const mcpTools = ctx.tools.schemas(agent).filter(tool => tool.name.startsWith('mcp__'))
        // The current DSH tool schema has no structured server identity. Refuse ambiguous names rather than bind a wrong server.
        if (mcpTools.some(tool => tool.name.slice(5).split('__').length !== 2)) {
          return 'Error: 当前 MCP 工具名称无法唯一确定连接器，请使用自动化表单明确绑定连接器。'
        }
        const names = [...new Set(mcpTools.flatMap(tool => /^mcp__([A-Za-z0-9_-]{1,32})__/.exec(tool.name)?.[1] ?? []))]
        if (names.length > 8) return 'Error: 当前会话超过 8 个 MCP 连接器，请先缩小会话能力范围。'
        exec.signal.throwIfAborted()
        const result = await ctx.automation.create({ name: args.name?.trim() || args.message.trim().slice(0, 30),
          description: args.description ?? '', prompt: args.message, schedule, originSessionId: agent.session.id,
          workspacePath, ...project ? { projectId: project.id } : {}, ...skillName ? { skillName } : {},
          mcpPresets: names.map(name => ({ name })), executionMode: args.mode === 'reminder' ? 'reminder' : 'agent' })
        return `Created job; catalog: ${JSON.stringify(result.tasks.map(task => ({ id: task.id, name: task.name,
          mode: task.executionMode === 'reminder' ? 'reminder' : 'task', schedule: task.schedule })))}`
      } catch (error) {
        if (error instanceof AutomationError) return `Error: ${error.code}: ${error.message}`
        return 'Error: 自动化操作失败，请检查服务状态后重试。'
      }
    },
    presentCall: args => ({ card: 'generic', title: args.action === 'add' ? '创建自动化' : args.action === 'list' ? '查看自动化' : '删除自动化',
      kind: args.action === 'list' ? 'read' : 'other' }),
  }))
}

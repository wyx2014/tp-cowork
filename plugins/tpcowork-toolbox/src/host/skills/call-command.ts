import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-workspace'
import { activeCallSettings, activePhoneType } from './call-settings.ts'
import { sendYealinkCall, type NativeOptions } from './native.ts'

const commandId = CommandDefinitionId('tpcowork-office-call')
const help = '可以输入 /call 姓名、/call 号码或 /call 挂断，也可以直接说“给张三打电话”。'
const numberPattern = /^[+\d\s()（）-]{3,24}$/u

/** Match a complete instruction, using the old desktop's Chinese command forms. */
function callIntent(text: string, bareTarget = false) {
  const input = text.trim().replace(/[。！!\s]+$/u, '')
  if (!input || /[\r\n]/u.test(input)) return undefined
  const raw = input.replace(/^(?:(?:请帮我|帮我|麻烦你?|请|现在|立即|用(?:这个)?技能|使用(?:这个)?技能|使用\s*skill\s*技能|用我的电话)\s*)+/iu, '')
  if (/^(?:挂断|挂机|结束通话)(?:电话|当前通话)?$/u.test(raw) || (bareTarget && /^hangup$/iu.test(raw))) return { action: 'hangup' }

  const match = /^(?:拨打|拨号(?:给)?|打给|打电话给|呼叫)\s*(.+)$/u.exec(raw)
    ?? /^给\s*(.+?)\s*打(?:个)?电话$/u.exec(raw)
  const target = (match?.[1] ?? (bareTarget ? raw : '')).trim().replace(/(?:的)?(?:分机|电话|号码)$/u, '').trim()
  if (/怎么|如何|为什么|为何|不生效|失败|问题|查询|设置|要不要|能不能|可以吗|还是|或者|模拟/u.test(target)) return undefined
  if (numberPattern.test(target)) {
    const number = target.replace(/[\s()（）-]/gu, '')
    if (/^\+?\d{3,20}$/u.test(number)) return { action: 'dial', number }
  }
  if (/^(?:[\p{Script=Han}·]{2,12}|[a-z][a-z .'-]{1,39})$/iu.test(target)) return { action: 'dial', name: target }
  return undefined
}

/** Use native command history for explicit /call and direct Yealink chat instructions. */
export function applyCallCommands(ctx: Context, config: NativeOptions): void {
  const archived = (agent: import('@deepseek-ai/dsh-agent').Agent) =>
    ctx.get('workspaceRegistry')?.archivedSessionIds.includes(agent.id) ?? false

  ctx.commands.register({
    definitionId: commandId,
    name: 'call',
    description: 'Yealink 办公电话',
    input: { hint: '姓名、分机号或挂断' },
    async handler({ agent, rawInput, signal }) {
      if (agent.session.header.origin === 'subagent' || archived(agent)) return { kind: 'error', text: '请在未归档的普通会话中使用办公电话。' }
      if (!rawInput.trim()) return { kind: 'success', text: help }
      const args = callIntent(rawInput, true)
      if (!args) return { kind: 'error', text: help }
      try {
        const cwd = ctx.get('workingDirectory')?.get(agent.session) ?? agent.session.header.cwd ?? ctx.profileContext.cwd
        const skill = (await ctx.skills.list({ cwd, scope: agent, signal })).find(entry => entry.name === 'call')
        if (!skill || !isUserInvocable(skill)) return { kind: 'error', text: '请在工具箱中启用办公电话技能。' }
        if (args.number?.startsWith('+')) return { kind: 'error', text: '国际号码请先按话机拨号规则提供完整号码。' }
        const active = await activeCallSettings(ctx, config)
        return { kind: 'success', text: await sendYealinkCall(active, args, signal, config) }
      } catch (error) {
        signal.throwIfAborted()
        return { kind: 'error', text: error instanceof Error ? error.message : '办公电话指令处理失败。' }
      }
    },
  })

  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
    const message = messages[0]
    if (step !== 1 || messages.length !== 1 || message?.source.kind !== 'user'
      || !('rpcId' in message.source) || ('principal' in message.source && message.source.principal)
      || agent.session.header.origin === 'subagent' || archived(agent)) return next()

    const block = message.content[0]
    if (message.content.length !== 1 || block?.type !== 'text') return next()
    // The toolbox composer serializes an inline office-phone selection as `$call`.
    const text = block.text.trim().replace(/^(?:(?:请)?(?:使用|用)\s*)?\$call(?=\s|$)\s*/iu, '')
    const slash = /^\/call(?:\s|$)/iu.test(text)
    if (!slash && !callIntent(text)) return next()
    if (ctx.commands.find(agent, 'call')?.definitionId !== commandId || await activePhoneType(ctx) !== 'yealink') return next()

    signal.throwIfAborted()
    const line = slash ? '/call' + text.slice(5) : `/call ${text}`
    const execution = await ctx.commands.execute(agent, line, [], signal)
    return execution ? { kind: 'enter', messages: [], handledLocally: true } : next()
  }, { prepend: true })
}

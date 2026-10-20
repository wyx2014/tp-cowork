/** Workbench folds experts records; it neither executes nor settles a team. */
import type { Context } from '@deepseek-ai/cordis'
import { pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '../../tpcowork-experts/src/host.ts'
import { runRecord, runSchema, snapshotSchema, type RunState } from '../../tpcowork-experts/src/schema.ts'
import { taskStatus } from '../../tpcowork-toolbox/src/task-context.ts'
import type {} from './view.ts'
export function registerExpertsProjection(ctx: Context): void {
  ctx.sessionProjections.register<'tpcoworkExperts', RunState | null>({
    key: 'tpcoworkExperts', stateVersion: 1, stateSchema: runSchema.nullable(), init: () => null,
    apply: (state, event) => {
      const record = pluginRecordOf(event)
      return record?.type === runRecord ? runSchema.parse(record.data) : state
    },
    wire: { viewSchema: snapshotSchema.nullable(), view: state => {
      if (!state) return null
      const run = structuredClone(state)
      if (!ctx.experts.active.has(run.runId) && !ctx.agents.get(SessionId(run.context.sessionId))
        && ['running', 'awaiting_delivery', 'awaiting_plan'].includes(taskStatus(run.settlement))) {
        run.settlement.execution = 'interrupted'; run.code = 'process_interrupted'
      }
      return { run, status: taskStatus(run.settlement) }
    } },
  })
}

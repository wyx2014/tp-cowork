import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SelectionDraft } from './teams.ts'
import type { TaskContext } from './task.ts'
import type { Catalog } from './common.ts'
import type { SkillItem } from './skills.ts'
import type { McpItem } from './mcp.ts'
import type { TeamItem } from './teams.ts'

/** Host-issued aggregate revision; clients never combine independent revision counters. */
export interface SelectionCatalog {
  revision: number
  skills: Catalog<SkillItem>
  mcp: Catalog<McpItem>
  teams: Catalog<TeamItem>
}

/** Preserve native attachment receipts, request identity and queue/steer semantics. */
export interface FirstSubmissionRequest { message: SessionPromptRequest; selection: SelectionDraft }
/** T4 calls this admission adapter; T6 owns Host validation/persistence and delegates execution to DSH. */
export interface TaskSubmissionApi {
  /** Read available choices and their aggregate revision before admitting a message. */
  selection(request: { sessionId: string }): Promise<SelectionCatalog>
  submit(request: FirstSubmissionRequest, signal: AbortSignal): Promise<{ accepted: true; context: TaskContext; runId?: string }>
  context(request: { sessionId: string; taskId: string }): Promise<TaskContext | null>
}

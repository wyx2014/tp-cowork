/** Structured errors survive the existing Gateway without leaking input or storage contents. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { AutomationErrorCode, AutomationFailureCode } from './types.ts'
import type { ZodType } from 'zod'

export class AutomationError extends RemoteError<AutomationFailureCode> {
  constructor(code: AutomationErrorCode, message: string, options?: ErrorOptions) {
    super(`automation/${code}`, message, {}, options)
    this.name = 'AutomationError'
  }
}

/** Execution stopped without a confirmed durability barrier; retain running for evidence-only recovery. */
export class AutomationEvidencePendingError extends Error {
  constructor() { super('自动化执行证据尚未确认持久化。'); this.name = 'AutomationEvidencePendingError' }
}

/** Validate a wire/config value, returning field-level errors without including its contents. */
export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]!
  const code = issue.path.includes('timezone') ? 'invalid_timezone'
    : issue.path.includes('schedule') ? 'invalid_rule' : 'invalid_input'
  throw new AutomationError(code, `自动化参数无效：${issue.path.join('.') || 'request'}`)
}

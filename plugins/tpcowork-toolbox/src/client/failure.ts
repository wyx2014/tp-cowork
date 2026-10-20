import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'toolbox/selection-unavailable': undefined
    'toolbox/admission-failed': undefined
  }
}
/** Structural Remote failure, without requiring a non-platform runtime module in the browser. */
export function admissionFailure(code: 'toolbox/selection-unavailable' | 'toolbox/admission-failed', message: string): RemoteResult<never> {
  return { ok: false, error: Object.assign(new Error(message), { name: 'RemoteError', code, details: undefined, isDSHRemoteError: true as const }) }
}

/** Browser-safe descriptor of the Settings status call shared by the Host service and the client. */
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { z } from 'zod'

const packageName = '@tpcowork/dsh-computer-use'

/** What the Settings page shows: whether this device can run Computer Use, and the platform's readiness checks. */
export const computerUseStatus = z.object({
  supported: z.boolean(),
  platform: z.string(),
  reason: z.enum(['platform', 'macos-version', 'wayland', 'no-display', 'arch', 'driver-missing', 'driver-failed']).optional(),
  /** The driver's readiness flags (macOS accessibility / screen recording, Linux X11 / AT-SPI, …). */
  checks: z.record(z.string(), z.json()).optional(),
  /** The driver's own readiness text, shown when something is missing. */
  detail: z.string().optional(),
})
export type ComputerUseStatus = z.infer<typeof computerUseStatus>

const descriptor: InvocationDescriptor = {
  id: `${packageName}#computerUseStatus/get`, service: 'computerUseStatus', namespace: 'computerUseStatus', method: 'get',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'strict', typeSymbol: 'ComputerUseStatus', create: () => computerUseStatus },
}
export const statusRemote: TypertRemoteContribution = { package: packageName, descriptors: [descriptor] }
export const statusContribution: TypertContribution = { ...statusRemote, face: 'host', invocations: [descriptor], schemas: [], model: { services: [], events: [], objects: [] } }

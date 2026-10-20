import { defaultMcpPresets } from '../presets.ts'
import type { McpItem } from '../contracts/index.ts'
const defaults = new Set<string>(defaultMcpPresets.map(preset => preset.id))
/** Product-owned defaults are constrained; user-installed entries are never removed by name. */
export function visibleMcp(item: McpItem): boolean { return item.origin === 'custom' || defaults.has(item.id) }

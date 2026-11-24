import type { McpItem } from '../contracts/index.ts'
export function visibleMcp(item: McpItem): boolean { return item.origin === 'custom' || item.managed === true }

/** Shared artwork keyed by stable catalog identities, independent of editable labels. */
import { capabilityIcon } from './capability-icons.ts'

const connectorIcons = new Map([
  ['juyuan', capabilityIcon('database', 'blue')],
  ['caihui_mcp', capabilityIcon('chart', 'orange')],
  ['playwright', capabilityIcon('browser', 'green')],
])
const teamIcons = new Map([
  ['asset-research-team', capabilityIcon('chart', 'teal')],
  ['supply-chain-bottleneck-team', capabilityIcon('network', 'violet')],
])
const defaultConnectorIcon = capabilityIcon('plug', 'teal')
const defaultTeamIcon = capabilityIcon('team', 'blue')

export function mcpIcon(id: string): string { return connectorIcons.get(id) ?? defaultConnectorIcon }
export function teamIcon(id: string): string { return teamIcons.get(id) ?? defaultTeamIcon }

/** Keep icon data in the Client instead of persisting it in conversation drafts. */
export function referenceIconStyles(selector: string, icon: string): string {
  return `${selector} > svg { display: none; }
${selector}::before { content: ""; display: inline-block; flex: none; width: 18px; height: 18px; background: url("${icon}") center / contain no-repeat; }`
}

export const capabilityReferenceStyles = (['mcp', 'team'] as const).map(kind => {
  const root = '[data-composer-chip="toolbox-capabilities"]'
  const reference = `[data-reference-kind="${kind}"]`
  const icons = kind === 'mcp' ? connectorIcons : teamIcons
  return [
    referenceIconStyles(`${root} ${reference}`, kind === 'mcp' ? defaultConnectorIcon : defaultTeamIcon),
    ...[...icons].map(([id, icon]) => referenceIconStyles(`${root}[data-reference-ref^='["${kind}","${id}",'] ${reference}`, icon)),
  ].join('\n')
}).join('\n')

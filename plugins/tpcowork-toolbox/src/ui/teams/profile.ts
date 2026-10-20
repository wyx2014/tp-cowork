import type { TeamItem } from '../../contracts/index.ts'
import type { UiKey } from '../locales.ts'
import type { T } from '../types.ts'

export interface TeamExample { title: string; prompt: string }
export interface TeamCase extends TeamExample { id: string; subtitle: string; scope: string }
export interface TeamProfile {
  theme: 'investment' | 'supply' | 'general'
  summary: string
  tags: string[]
  defaultPrompt: string
  examples: TeamExample[]
  cases: TeamCase[]
  outputs: Array<{ title: string; body: string }>
}

/** Display copy belongs to the Client; versions, members and responsibilities come from the Host. */
export function teamProfile(team: TeamItem, t: T): TeamProfile {
  const task = (key: UiKey) => `${t(key)}\n\n${t('teamResearchDelivery')}`
  if (team.id === 'asset-research-team') return {
    theme: 'investment', summary: t('teamStockSummary'), tags: [t('teamTagInvestment'), t('teamTagFinancials'), t('teamTagRisk')],
    defaultPrompt: t('stockResearchPrompt'),
    examples: [
      { title: t('teamStockExampleOne'), prompt: t('stockResearchPrompt') },
      { title: t('teamStockExampleTwo'), prompt: task('teamStockCompareTask') },
      { title: t('teamStockExampleThree'), prompt: task('teamStockFinancialTask') },
    ],
    cases: [
      { id: 'consumer-research', title: t('teamStockCaseOne'), subtitle: t('teamStockCaseOneSubtitle'), scope: t('teamStockCaseOneScope'), prompt: task('teamStockCaseOneTask') },
      { id: 'company-comparison', title: t('teamStockCaseTwo'), subtitle: t('teamStockCaseTwoSubtitle'), scope: t('teamStockCaseTwoScope'), prompt: task('teamStockCaseTwoTask') },
    ],
    outputs: [
      { title: t('teamStockOutputOne'), body: t('teamStockOutputOneBody') },
      { title: t('teamStockOutputTwo'), body: t('teamStockOutputTwoBody') },
      { title: t('teamStockOutputThree'), body: t('teamStockOutputThreeBody') },
    ],
  }
  if (team.id === 'supply-chain-bottleneck-team') return {
    theme: 'supply', summary: t('teamSupplySummary'), tags: [t('teamTagIndustry'), t('teamTagSupplyChain'), t('teamTagOpportunity')],
    defaultPrompt: t('supplyChainResearchPrompt'),
    examples: [
      { title: t('teamSupplyExampleOne'), prompt: t('supplyChainResearchPrompt') },
      { title: t('teamSupplyExampleTwo'), prompt: task('teamSupplyAiTask') },
      { title: t('teamSupplyExampleThree'), prompt: task('teamSupplyCounterTask') },
    ],
    cases: [
      { id: 'ai-infrastructure', title: t('teamSupplyCaseOne'), subtitle: t('teamSupplyCaseOneSubtitle'), scope: t('teamSupplyCaseOneScope'), prompt: task('teamSupplyAiTask') },
      { id: 'ev-supply-chain', title: t('teamSupplyCaseTwo'), subtitle: t('teamSupplyCaseTwoSubtitle'), scope: t('teamSupplyCaseTwoScope'), prompt: task('teamSupplyCaseTwoTask') },
    ],
    outputs: [
      { title: t('teamSupplyOutputOne'), body: t('teamSupplyOutputOneBody') },
      { title: t('teamSupplyOutputTwo'), body: t('teamSupplyOutputTwoBody') },
      { title: t('teamSupplyOutputThree'), body: t('teamSupplyOutputThreeBody') },
    ],
  }
  return { theme: 'general', summary: t('teamGeneralSummary'), tags: [], defaultPrompt: t('teamPrompt'),
    examples: [{ title: t('teamGeneralExample'), prompt: t('teamPrompt') }], cases: [], outputs: [] }
}

const phases: Record<string, UiKey> = { analysis: 'teamPhaseAnalysis', discovery: 'teamPhaseDiscovery', validation: 'teamPhaseValidation', synthesis: 'teamPhaseSynthesis', review: 'teamPhaseReview' }
export function phaseLabel(phase: string, t: T) { return phases[phase] ? t(phases[phase]) : phase }

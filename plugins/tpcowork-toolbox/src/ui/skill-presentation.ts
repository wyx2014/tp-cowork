/** Product display metadata; canonical names remain the invocation and lookup identities. */
import presentations from './suggestions/assets/presentations.png'
import documents from './suggestions/assets/documents.png'
import spreadsheets from './suggestions/assets/spreadsheets.png'
import pdf from './suggestions/assets/pdf.png'
import browser from './suggestions/assets/browser-use.png'
import { capabilityIcon } from './capability-icons.ts'
import { referenceIconStyles } from './capability-presentation.ts'
import type { UiKey } from './locales.ts'
import type { T } from './types.ts'

const skills: Record<string, { label: UiKey; description?: UiKey; icon: string; aliases: string[] }> = {
  'office-xlsx': { label: 'suggestionSpreadsheetName', description: 'skillSpreadsheetDescription', icon: spreadsheets, aliases: ['Excel', 'xlsx', '电子表格'] },
  'office-docx': { label: 'suggestionDocumentName', description: 'skillDocumentDescription', icon: documents, aliases: ['Word', 'docx', 'Word 文档'] },
  'office-pptx': { label: 'suggestionPresentationName', description: 'skillPresentationDescription', icon: presentations, aliases: ['PowerPoint', 'ppt', 'pptx', '演示文档'] },
  'office-pdf': { label: 'skillPdfName', description: 'skillPdfDescription', icon: pdf, aliases: ['PDF', '便携式文档'] },
  'control-browser': { label: 'suggestionBrowserName', description: 'skillBrowserDescription', icon: browser, aliases: ['Browser', '浏览器'] },
  'algorithmic-art': { label: 'skillAlgorithmicArtName', description: 'skillAlgorithmicArtDescription', icon: capabilityIcon('art', 'violet'), aliases: [] },
  'brainstorming': { label: 'skillBrainstormingName', description: 'skillBrainstormingDescription', icon: capabilityIcon('idea', 'orange'), aliases: [] },
  'brand-guidelines': { label: 'skillBrandName', description: 'skillBrandDescription', icon: capabilityIcon('brand', 'violet'), aliases: [] },
  'call': { label: 'skillCallName', description: 'skillCallDescription', icon: capabilityIcon('phone', 'green'), aliases: [] },
  'canvas-design': { label: 'skillCanvasName', description: 'skillCanvasDescription', icon: capabilityIcon('image', 'pink'), aliases: [] },
  'clawhub': { label: 'skillDiscoverName', description: 'skillDiscoverDescription', icon: capabilityIcon('search', 'blue'), aliases: [] },
  'code-review': { label: 'skillReviewName', description: 'skillReviewDescription', icon: capabilityIcon('review', 'slate'), aliases: [] },
  'create-agent': { label: 'skillAgentName', description: 'skillAgentDescription', icon: capabilityIcon('agent', 'blue'), aliases: [] },
  'deep-research': { label: 'skillResearchName', description: 'skillResearchDescription', icon: capabilityIcon('research', 'blue'), aliases: [] },
  'doc-coauthoring': { label: 'skillCoauthoringName', description: 'skillCoauthoringDescription', icon: capabilityIcon('document', 'teal'), aliases: [] },
  'frontend-design': { label: 'skillFrontendName', description: 'skillFrontendDescription', icon: capabilityIcon('layout', 'pink'), aliases: [] },
  'image-extract': { label: 'skillImageExtractName', description: 'skillImageExtractDescription', icon: capabilityIcon('scan', 'teal'), aliases: [] },
  'internal-comms': { label: 'skillCommsName', description: 'skillCommsDescription', icon: capabilityIcon('message', 'blue'), aliases: [] },
  'mcp-builder': { label: 'skillConnectorName', description: 'skillConnectorDescription', icon: capabilityIcon('plug', 'teal'), aliases: [] },
  'schedule': { label: 'skillScheduleName', description: 'skillScheduleDescription', icon: capabilityIcon('calendar', 'blue'), aliases: [] },
  'skill-creator': { label: 'skillSkillCreatorName', description: 'skillSkillCreatorDescription', icon: capabilityIcon('wand', 'violet'), aliases: [] },
  'slack-gif-creator': { label: 'skillGifName', description: 'skillGifDescription', icon: capabilityIcon('animation', 'pink'), aliases: [] },
  'summarize': { label: 'skillSummaryName', description: 'skillSummaryDescription', icon: capabilityIcon('summary', 'teal'), aliases: [] },
  'theme-factory': { label: 'skillThemeName', description: 'skillThemeDescription', icon: capabilityIcon('palette', 'pink'), aliases: [] },
  'translate': { label: 'skillTranslateName', description: 'skillTranslateDescription', icon: capabilityIcon('translate', 'blue'), aliases: [] },
  'web-artifacts-builder': { label: 'skillWebArtifactsName', description: 'skillWebArtifactsDescription', icon: capabilityIcon('web', 'blue'), aliases: [] },
  'webapp-testing': { label: 'skillWebTestingName', description: 'skillWebTestingDescription', icon: capabilityIcon('test', 'green'), aliases: [] },
  'web-gui-tester': { label: 'skillGuiTestingName', description: 'skillGuiTestingDescription', icon: capabilityIcon('test', 'teal'), aliases: [] },
}
export function skillPresentation(name: string, t: T) {
  const value = skills[name]
  return { label: value ? t(value.label) : name, ...(value ? { iconSrc: value.icon } : {}), ...(value?.description ? { description: t(value.description) } : {}), keywords: [name, ...(value?.aliases ?? [])] }
}

/** Style source-owned references without persisting image data in drafts. */
export const skillReferenceStyles = Object.entries(skills).map(([name, { icon }]) => {
  const selector = `[data-composer-chip="toolbox-capabilities"][data-reference-ref$=',"${name}"]'] [data-reference-kind="skill"]`
  return referenceIconStyles(selector, icon)
}).join('\n')

/** Keep the four document skills together; preserve catalog order for other skills. */
export function orderSkills<T extends { name: string }>(items: readonly T[]): T[] {
  const names = ['office-pdf', 'office-pptx', 'office-xlsx', 'office-docx']
  const rank = (name: string) => names.includes(name) ? names.indexOf(name) : names.length
  return [...items].sort((a, b) => rank(a.name) - rank(b.name))
}

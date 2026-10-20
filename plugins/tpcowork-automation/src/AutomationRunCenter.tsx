/** Full history uses the same compact rows as the task editor and opens results directly. */
import * as React from 'react'
import type { AutomationUiServices } from './ui-types.ts'
import type { UiText } from './ui-locales.ts'
import type { AutomationCatalog, CatalogSnapshot } from './ui-state.ts'
import { AutomationRunTable } from './AutomationRunTable.tsx'

interface Props { catalog: AutomationCatalog; state: CatalogSnapshot; services: AutomationUiServices; t: UiText; locale: string }
export function AutomationRunCenter(props: Props) {
  return <section role="tabpanel" id="tp-auto-runs-panel" aria-labelledby="tp-auto-runs-tab">
    <AutomationRunTable {...props} showTask tasks={props.state.catalog?.tasks ?? []} />
  </section>
}

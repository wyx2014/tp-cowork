import * as React from 'react'

/** Each section owns its actions; the page supplies the shared heading and toolbar. */
export const PageLayout = React.createContext<{
  heading: React.ReactNode
  refresh: React.ReactNode
  toolbar: React.ReactNode
  notices: React.ReactNode
  panelLabel: string
} | null>(null)

export function SectionLayout({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) {
  const page = React.useContext(PageLayout)
  if (!page) return <>{actions && <div className="tp-toolbox-actions">{actions}</div>}{children}</>
  return <div className="tp-toolbox-content-wrap">
    <header className="tp-toolbox-heading" data-window-drag>{page.heading}<div className="tp-toolbox-heading-actions">{page.refresh}{actions}</div></header>
    {page.notices}
    <div className="tp-toolbox-toolbar">{page.toolbar}</div>
    <div className="tp-toolbox-panel" aria-label={page.panelLabel}>{children}</div>
  </div>
}

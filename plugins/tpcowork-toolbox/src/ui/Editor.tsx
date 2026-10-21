import * as React from 'react'
import { ToolboxIcon } from './Icon.tsx'
import { PageLayout } from './layout.tsx'
import type { T } from './types.ts'

interface SubpageProps {
  title: string
  subtitle?: string | undefined
  section: 'teams' | 'skills' | 'mcp' | 'tpcoworkhub'
  t: T
  pending?: boolean
  onClose(): void
  returnFocusId?: string | undefined
  returnScrollTop?: number | undefined
}

/** Shared page navigation, focus and scroll restoration for editors and details. */
function Subpage({ titleId, title, subtitle, section, t, pending, onClose, returnFocusId, returnScrollTop, visual, headingActions, toolbar, children }: SubpageProps & {
  titleId: string
  visual?: React.ReactNode
  headingActions?: React.ReactNode
  toolbar: React.ReactNode
  children: React.ReactNode
}) {
  const page = React.useContext(PageLayout)
  const heading = React.useRef<HTMLHeadingElement>(null)
  React.useLayoutEffect(() => {
    const surface = heading.current?.closest<HTMLElement>('.tp-toolbox')
    const subpage = heading.current?.closest('.tp-toolbox-editor')
    // A shorter detail can clamp the catalog's scroll before this layout effect.
    const scrollTop = returnScrollTop ?? surface?.scrollTop ?? 0
    if (surface) surface.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
    return () => {
      requestAnimationFrame(() => {
        if (subpage?.isConnected) return
        if (surface) surface.scrollTop = scrollTop
        if (returnFocusId) document.getElementById(returnFocusId)?.focus({ preventScroll: true })
      })
    }
  }, [returnFocusId, returnScrollTop])
  return <>
    <nav className="tp-toolbox-breadcrumb" aria-label={t('editorNavigation')} data-window-drag>
      <button type="button" disabled={pending} onClick={onClose}>{t('title')}</button><ToolboxIcon name="arrow" size={14} />
      <button type="button" disabled={pending} onClick={onClose}>{t(section)}</button><ToolboxIcon name="arrow" size={14} />
      <span aria-current="page">{title}</span>
    </nav>
    <div className="tp-toolbox-editor-content">
      <header className={`tp-toolbox-editor-heading${visual ? ' tp-toolbox-editor-heading-visual' : ''}`}>{visual}<div className="tp-toolbox-editor-heading-text"><h1 ref={heading} id={titleId} tabIndex={-1}>{title}</h1>{subtitle && <p>{subtitle}</p>}{headingActions}</div></header>
      {toolbar && <div className="tp-toolbox-editor-toolbar">{toolbar}</div>}
      {page?.notices}
      {children}
    </div>
  </>
}

/** The same page transition, breadcrumb and save toolbar as the automation editor. */
export function ToolboxEditor({ title, subtitle, section, t, pending, disabled, onClose, onSubmit, submitLabel, children, feedback, returnFocusId, returnScrollTop, className = '', noValidate, toolbarActions }: SubpageProps & {
  pending: boolean
  disabled?: boolean
  onSubmit(): void
  submitLabel?: string
  children: React.ReactNode
  feedback?: React.ReactNode
  className?: string
  noValidate?: boolean
  toolbarActions?: React.ReactNode
}) {
  const titleId = React.useId()
  return <form className={`tp-toolbox-editor ${className}`} noValidate={noValidate} aria-labelledby={titleId} aria-busy={pending} onSubmit={event => {
    event.preventDefault()
    if (!pending && !disabled) onSubmit()
  }} onInvalidCapture={event => {
    const details = (event.target as HTMLElement).closest('details')
    if (details) details.open = true
  }}>
    <Subpage titleId={titleId} title={title} subtitle={subtitle} section={section} t={t} pending={pending} onClose={onClose} returnFocusId={returnFocusId} returnScrollTop={returnScrollTop} toolbar={<>
      <span className="tp-toolbox-editor-section">{t('editorSettings')}</span>
      <div className="tp-toolbox-editor-actions">{toolbarActions ?? <><button type="button" disabled={pending} onClick={onClose}>{t('cancel')}</button>
        <button type="submit" className="tp-toolbox-primary" disabled={pending || disabled}>{pending ? t('saving') : submitLabel ?? t('save')}</button></>}</div>
    </>}>
      <fieldset disabled={pending} className="tp-toolbox-editor-fields">{children}</fieldset>
      {feedback && <div className="tp-toolbox-editor-feedback">{feedback}</div>}
    </Subpage>
  </form>
}

/** Read-only detail page with the same breadcrumb and return behavior as an editor. */
export function ToolboxDetail({ actions, children, visual, actionsInHeading = false, className = '', ...page }: SubpageProps & {
  actions?: React.ReactNode
  children: React.ReactNode
  visual?: React.ReactNode
  actionsInHeading?: boolean
  className?: string
}) {
  const titleId = React.useId()
  const controls = <div className="tp-toolbox-editor-actions">{actionsInHeading && actions}<button type="button" onClick={page.onClose}>{page.t('backToList')}</button>{!actionsInHeading && actions}</div>
  return <article className={`tp-toolbox-editor tp-toolbox-detail ${className}`} aria-labelledby={titleId}>
    <Subpage {...page} titleId={titleId} visual={visual} headingActions={actionsInHeading ? controls : undefined} toolbar={actionsInHeading ? null : <>
      <span className="tp-toolbox-editor-section">{page.t('detail')}</span>
      {controls}
    </>}>
      <div className="tp-toolbox-detail-sections">{children}</div>
    </Subpage>
  </article>
}

export function EditorField({ label, hint, children }: { label: string; hint?: string; children: React.ReactElement }) {
  const fieldId = React.useId()
  const hintId = React.useId()
  return <div className="tp-toolbox-editor-field"><label htmlFor={fieldId}>{label}</label>{React.cloneElement(children, { id: fieldId, 'aria-describedby': hint ? hintId : undefined } as React.HTMLAttributes<HTMLElement>)}
    {hint && <small id={hintId}>{hint}</small>}</div>
}

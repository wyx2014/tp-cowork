import * as React from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PageProps } from './types.ts'
import type { Tab } from '../client/model.ts'
import { Skills } from './Skills.tsx'
import { Mcp } from './Mcp.tsx'
import { Teams } from './teams/index.tsx'
import { TpcoworkHub } from './tpcoworkhub/index.tsx'
import { PageLayout } from './layout.tsx'
import { ToolboxIcon } from './Icon.tsx'

export function ToolboxPage(props: PageProps) {
  const { t } = props
  const state = props.useToolbox(value => value)
  const [query, setQuery] = React.useState('')
  const actions = props
  const sections = { t, query, actions }
  const modules = state.description?.modules
  const busy = state.skills.loading || state.mcp.loading || state.teams.loading
  const toolbar = <>
    <nav className="tp-toolbox-tabs" aria-label={t('title')}>{(['teams', 'skills', 'mcp', 'tpcoworkhub'] as Tab[]).map(tab => <Button key={tab} data-testid={`toolbox-tab-${tab}`} aria-pressed={state.tab === tab} onClick={() => { props.setTab(tab); setQuery('') }}>{t(tab)}</Button>)}</nav>
    <Input className="tp-toolbox-search" icon={<ToolboxIcon name="search" />} type="search" aria-label={t('search')} placeholder={t('search')} maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
  </>
  return <section data-testid="toolbox-page" className="tp-toolbox" aria-label={t('title')}>
    <PageLayout.Provider value={{
      heading: <div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>,
      refresh: <Button className="tp-toolbox-icon-button" aria-label={t('refresh')} title={t('refresh')} disabled={busy} onClick={() => { void props.refresh() }}><ToolboxIcon name="refresh" /></Button>,
      toolbar,
      notices: <>{state.connection !== 'live' && <p role="status">{t(state.connection === 'interrupted' ? 'interrupted' : 'connecting')}</p>}{state.failed && <p role="alert">{t('failed')}</p>}</>,
      panelLabel: t(state.tab),
    }}>
      {state.tab === 'skills' && <Skills {...sections} load={state.skills} available={modules?.skills === true} />}
      {state.tab === 'mcp' && <Mcp {...sections} load={state.mcp} available={modules?.mcp === true} />}
      {state.tab === 'teams' && <Teams {...sections} load={state.teams} available={modules?.teams === true} />}
      {state.tab === 'tpcoworkhub' && <TpcoworkHub {...sections} available={modules?.tpcoworkhub === true} epoch={state.epoch} skills={state.skills.value} />}
    </PageLayout.Provider>
  </section>
}

/** Team catalog and draft entry, handed to T6 with no executor ownership. */
import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Catalog, TeamItem } from '../../contracts/index.ts'
import type { Load } from '../../client/model.ts'
import { LoadNotice, ReadinessBadge, Reasons, type SectionProps } from '../shared.tsx'
import { SectionLayout } from '../layout.tsx'
import { TeamDetail } from './Detail.tsx'
import { teamProfile } from './profile.ts'

export function Teams({ load, available, t, query, actions }: SectionProps & { load: Load<Catalog<TeamItem>>; available: boolean }) {
  const [detail, setDetail] = React.useState<{ item: TeamItem; scrollTop: number } | null>(null)
  const detailId = React.useId()
  const rows = load.value?.items.filter(team => `${team.name} ${team.members.map(member => member.name).join(' ')}`.toLowerCase().includes(query.toLowerCase())) ?? []
  const canUse = (team: TeamItem) => available && load.value?.complete && !load.failed && !load.loading && load.value.items.some(current => current.id === team.id && current.version === team.version && current.workflowId === team.workflowId && current.enabled && current.readiness.state === 'ready')
  const useTeam = (team: TeamItem) => actions.prepareTeam(team, teamProfile(team, t).defaultPrompt)
  if (detail) return <TeamDetail key={detail.item.id} team={detail.item} canUse={!!canUse(detail.item)} t={t}
    returnFocusId={`${detailId}-${detail.item.id}`} returnScrollTop={detail.scrollTop} onClose={() => setDetail(null)} onUse={prompt => actions.prepareTeam(detail.item, prompt)} />
  return <SectionLayout><LoadNotice load={load} available={available} empty={!load.value?.items.length} t={t} />
    {load.value && !load.value.complete && <p role="alert">{t('incomplete')}</p>}
    {!!load.value?.items.length && !rows.length && <p className="tp-toolbox-empty">{t('noMatches')}</p>}
    <div className="tp-toolbox-grid">{rows.map(team => <article className="tp-toolbox-card" key={team.id}>
      <div className="tp-toolbox-card-body"><header><h3>{team.name}</h3><ReadinessBadge value={team.readiness} t={t} /></header><p className="tp-toolbox-card-description">{t('teamMembers')}: {team.members.map(member => member.name).join(' · ')}</p><Reasons value={team.readiness} />
      <p className="tp-toolbox-meta">{t('version')}: {team.version}</p></div><div className="tp-toolbox-actions"><Button id={`${detailId}-${team.id}`} onClick={event => setDetail({ item: team, scrollTop: event.currentTarget.closest('.tp-toolbox')?.scrollTop ?? 0 })}>{t('detail')}</Button><Button disabled={!canUse(team)} onClick={() => useTeam(team)}>{t('useTeam')}</Button></div>
    </article>)}</div>
  </SectionLayout>
}

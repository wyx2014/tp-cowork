import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamItem } from '../../contracts/index.ts'
import type { T } from '../types.ts'
import { ReadinessBadge, Reasons } from '../shared.tsx'
import { ToolboxDetail } from '../Editor.tsx'
import { ToolboxIcon } from '../Icon.tsx'
import { MemberAvatar } from './Art.tsx'
import { teamIcon } from '../capability-presentation.ts'
import { phaseLabel, teamProfile } from './profile.ts'

export function TeamDetail({ team, canUse, t, onUse, onClose, returnFocusId, returnScrollTop }: {
  team: TeamItem
  canUse: boolean
  t: T
  onUse(prompt: string): void
  onClose(): void
  returnFocusId: string
  returnScrollTop: number
}) {
  const profile = teamProfile(team, t)
  const [caseId, setCaseId] = React.useState<string | null>(null)
  const casePanelId = React.useId()
  const selectedCase = profile.cases.find(item => item.id === caseId)
  const phases = [...new Set(team.members.flatMap(member => member.phase ? [member.phase] : []))]
  if (profile.theme !== 'general') phases.push('synthesis', 'review')
  return <ToolboxDetail title={team.name} section="teams" t={t} onClose={onClose} returnFocusId={returnFocusId} returnScrollTop={returnScrollTop}
    className={`tp-team-detail tp-team-${profile.theme}`} visual={<img className="tp-team-emblem" src={teamIcon(team.id)} alt="" />} actionsInHeading
    actions={<Button className="tp-toolbox-primary" disabled={!canUse} onClick={() => onUse(profile.defaultPrompt)}>{t('useTeam')}</Button>}>
    <section className="tp-team-intro">
      <p>{profile.summary}</p>
      <div className="tp-team-tags">{profile.tags.map(tag => <span key={tag}>{tag}</span>)}<ReadinessBadge value={team.readiness} t={t} /></div>
      <Reasons value={team.readiness} />
    </section>
    <dl className="tp-team-stats">
      <div><dt>{t('version')}</dt><dd>{team.version}</dd></div>
      <div><dt>{t('teamMembers')}</dt><dd>{t('teamMemberCount', { count: team.members.length })}</dd></div>
      {profile.theme !== 'general' && <div><dt>{t('teamDelivery')}</dt><dd>Markdown <span>·</span> HTML</dd></div>}
    </dl>
    <section className="tp-team-section">
      <SectionHeading icon="idea" title={t('teamHelps')} hint={t('teamExampleHint')} />
      <div className="tp-team-examples">{profile.examples.map(example => <button key={example.title} type="button" disabled={!canUse} onClick={() => onUse(example.prompt)}>
        <span>{example.title}</span><ToolboxIcon name="chat" size={21} />
      </button>)}</div>
      <small className="tp-team-draft-hint">{t('draftOnly')}</small>
    </section>
    {!!profile.cases.length && <section className="tp-team-section">
      <SectionHeading icon="grid" title={t('teamCases')} hint={t('teamCaseHint')} />
      <div className="tp-team-cases">{profile.cases.map(item => <button key={item.id} className="tp-team-case" type="button" aria-label={item.title}
        aria-expanded={selectedCase?.id === item.id} aria-controls={casePanelId} onClick={() => setCaseId(selectedCase?.id === item.id ? null : item.id)}>
        <div className="tp-team-case-preview" aria-hidden="true"><div className="tp-team-case-paper">
          <span className="tp-team-case-paper-heading"><ToolboxIcon name="report" size={18} /><strong>{item.title}</strong></span>
          <span className="tp-team-case-paper-subtitle">{item.subtitle}</span>
          {profile.outputs.map(output => <div className="tp-team-case-paper-section" key={output.title}><strong>{output.title}</strong><span /><span /></div>)}
          <div className="tp-team-case-paper-tags">{profile.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</div>
        </div></div>
        <span className="tp-team-case-caption"><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><ToolboxIcon name="down" size={18} /></span>
      </button>)}</div>
      {selectedCase && <div id={casePanelId} className="tp-team-report" role="region" aria-labelledby={`${casePanelId}-title`}>
        <header><div><span className="tp-team-report-label"><ToolboxIcon name="report" />{t('teamCaseSample')}</span><h3 id={`${casePanelId}-title`}>{selectedCase.title}</h3></div>
          <Button className="tp-toolbox-primary" disabled={!canUse} onClick={() => onUse(selectedCase.prompt)}>{t('teamCaseStart')}<ToolboxIcon name="arrow" size={15} /></Button></header>
        <p className="tp-team-report-note">{t('teamCaseNote')}</p>
        <div className="tp-team-report-scope"><h4>{t('teamScope')}</h4><p>{selectedCase.scope}</p></div>
        <ol>{profile.outputs.map(output => <li key={output.title}><h4>{output.title}</h4><p>{output.body}</p></li>)}</ol>
      </div>}
    </section>}
    <section className="tp-team-section">
      <SectionHeading icon="team" title={t('teamMembers')} hint={t('teamMemberCount', { count: team.members.length })} />
      <ul className="tp-team-members">{team.members.map((member, index) => {
        const [role, ...perspective] = member.name.split(/\s*·\s*/)
        return <li className="tp-team-member" key={member.id}><MemberAvatar index={index} /><div>
          <h3 aria-label={member.name}>{role}</h3>{!!perspective.length && <span className="tp-team-member-perspective">{perspective.join(' · ')}</span>}
          {member.goal && <p>{member.goal}</p>}{member.phase && <span className="tp-team-member-phase">{phaseLabel(member.phase, t)}</span>}
        </div></li>
      })}</ul>
    </section>
    {!!phases.length && <section className="tp-team-section"><SectionHeading icon="flow" title={t('teamWorkflow')} />
      <ol className="tp-team-workflow">{phases.map((phase, index) => <li key={phase}><span>{index + 1}</span>{phaseLabel(phase, t)}{index < phases.length - 1 && <ToolboxIcon name="arrow" size={14} />}</li>)}</ol>
    </section>}
  </ToolboxDetail>
}

function SectionHeading({ icon, title, hint }: { icon: React.ComponentProps<typeof ToolboxIcon>['name']; title: string; hint?: string }) {
  return <header className="tp-team-section-heading"><h2><ToolboxIcon name={icon} size={21} />{title}</h2>{hint && <p>{hint}</p>}</header>
}

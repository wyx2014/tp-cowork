import { skillPresentation, orderSkills } from './skill-presentation.ts'
import * as React from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Catalog, SkillItem } from '../contracts/index.ts'
import type { Load } from '../client/model.ts'
import { ConfirmRemove, LoadNotice, ReadinessBadge, Reasons, useOperation, type SectionProps } from './shared.tsx'
import type { SkillsClientApi } from '../client/remote.ts'
import type { InstallResult } from '../contracts/index.ts'
import { SectionLayout } from './layout.tsx'
import { ToolboxIcon } from './Icon.tsx'
import { ToolboxDetail, ToolboxEditor, EditorField } from './Editor.tsx'
import { CallSetup } from './CallSetup.tsx'

function installed(result: InstallResult): void {
  if (result.state !== 'installed' && result.state !== 'unchanged') throw result.error ?? { code: 'skills/installation-failed' }
}

export function Skills({ load, available, t, query, actions }: SectionProps & { load: Load<Catalog<SkillItem>>; available: boolean }) {
  const operation = useOperation(t)
  const [detail, setDetail] = React.useState<{ item: SkillItem; scrollTop: number } | null>(null)
  const [phone, setPhone] = React.useState<{ id: string; scrollTop: number } | null>(null)
  const [removing, setRemoving] = React.useState<{ item: SkillItem; revision: number } | null>(null)
  const [imported, setImported] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [source, setSource] = React.useState<'all' | 'bundled' | 'mine'>('all')
  const [importMenu, setImportMenu] = React.useState(false)
  const archiveInput = React.useRef<HTMLInputElement>(null)
  const editorId = React.useId()
  const items = load.value?.items ?? []
  const sources = orderSkills(items).filter(item => source === 'all' || (item.origin === 'bundled') === (source === 'bundled'))
  const rows = sources.filter(item => `${skillPresentation(item.name, t).label} ${skillPresentation(item.name, t).description ?? ''} ${skillPresentation(item.name, t).keywords.join(' ')} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()))
  const usable = available && load.value?.complete === true && !load.loading && !load.failed
  const mutable = usable && !operation.busy
  const usableRef = React.useRef(usable)
  usableRef.current = usable
  const mutate = (call: () => Promise<unknown>, success: 'saved' | 'removed' = 'saved') => { setImported(false); void operation.run(async () => { await call() }, success) }
  const importSkill = (previous?: SkillItem, archive?: File) => {
    setImported(false)
    void operation.run(async signal => {
      const source = archive ?? await actions.pickSkillDirectory()
      signal.throwIfAborted()
      if (!source) return
      if (!usableRef.current) throw new Error('toolbox/selection-unavailable')
      const draft = typeof source === 'string' ? await actions.prepareImport({ path: source }) : await actions.prepareSkillArchive(source)
      signal.throwIfAborted()
      if (!usableRef.current) throw new Error('toolbox/selection-unavailable')
      if (previous && draft.name !== previous.name) throw { code: 'skills/update-name-mismatch' }
      installed(await actions.skillInstall({ requestId: crypto.randomUUID(), source: { kind: 'local', importId: draft.importId }, scope: { kind: 'user' }, conflict: previous ? 'replace-owned' : 'reject' }))
      await actions.refreshSkills()
      if (!signal.aborted) { setSource('mine'); setImported(true) }
    }, null)
  }
  if (creating) return <CreateSkill available={mutable} actions={actions} t={t} returnFocusId={`${editorId}-create`} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setSource('mine') }} />
  if (phone) return <CallSetup actions={actions} t={t} returnFocusId={`${editorId}-phone-${phone.id}`} returnScrollTop={phone.scrollTop} onClose={() => setPhone(null)} />
  if (detail) return <SkillDetail key={detail.item.id} item={detail.item} read={actions.skillDetail} openDirectory={actions.openSkillDirectory} t={t} returnFocusId={`${editorId}-detail-${detail.item.id}`} returnScrollTop={detail.scrollTop} onClose={() => setDetail(null)} />
  return <SectionLayout actions={<>
    <Button icon={<ToolboxIcon name="wand" />} onClick={() => actions.prepareSkill(t('createPrompt', { skill: '{skill}' }))}>{t('createSkill')}</Button>
    <Button id={`${editorId}-create`} className="tp-toolbox-primary" icon={<ToolboxIcon name="plus" />} disabled={!mutable} onClick={() => setCreating(true)}>{t('manualCreate')}</Button>
  </>}>
    <div className="tp-toolbox-section-toolbar"><nav className="tp-toolbox-sources" aria-label={t('skillSources')}>{(['all', 'bundled', 'mine'] as const).map(value => <Button key={value} aria-pressed={source === value} onClick={() => setSource(value)}>{t(value === 'all' ? 'allSkills' : value === 'bundled' ? 'bundledSkills' : 'mySkills')} ({items.filter(item => value === 'all' || (item.origin === 'bundled') === (value === 'bundled')).length})</Button>)}</nav>
      <div className="tp-toolbox-actions"><Menu open={importMenu && mutable} onClose={() => setImportMenu(false)} align="end" portal compact
        anchor={<Button id={`${editorId}-import`} icon={<ToolboxIcon name="folder" />} disabled={!mutable} aria-haspopup="menu" aria-expanded={importMenu && mutable} onClick={() => setImportMenu(value => !value)}>{t('import')}<ToolboxIcon name="down" size={14} /></Button>}
        items={[{ id: 'zip', label: t('importZip'), icon: <ToolboxIcon name="upload" /> }, { id: 'folder', label: t('importFolder'), icon: <ToolboxIcon name="folder" /> }]}
        onSelect={id => { setImportMenu(false); if (id === 'zip') archiveInput.current?.click(); else importSkill() }} />
        <input ref={archiveInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden aria-label={t('importZip')} disabled={!mutable} onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) importSkill(undefined, file)
        }} />
      </div>
    </div>
    <LoadNotice load={load} available={available} empty={!load.value?.items.length} t={t} />
    {load.value && !load.value.complete && <p role="alert">{t('incomplete')}</p>}{operation.feedback}{imported && <p role="status">{t('imported')}</p>}
    {!!items.length && !rows.length && <p className="tp-toolbox-empty">{t('noMatches')}</p>}
    <div className="tp-toolbox-grid">{rows.map(item => <article className="tp-toolbox-card" key={item.id}>
      <div className="tp-toolbox-card-body"><header><h3 className="tp-skill-heading">{skillPresentation(item.name, t).iconSrc && <img src={skillPresentation(item.name, t).iconSrc} alt="" />}<span>{skillPresentation(item.name, t).label}</span></h3><ReadinessBadge value={item.readiness} t={t} /></header><p className="tp-toolbox-card-description">{skillPresentation(item.name, t).description ?? item.description}</p>
      <p className="tp-toolbox-meta">{t(item.installed ? 'installed' : 'notInstalled')} · {t(item.enabled ? 'enabled' : 'disabled')} · {t(item.origin === 'bundled' ? 'bundledSkills' : item.origin === 'tpcoworkhub' ? 'tpcoworkhub' : item.origin === 'project' ? 'projectSkills' : 'mySkills')} · {item.version}</p>
      <Reasons value={item.readiness} /></div>
      <div className="tp-toolbox-actions"><Button id={`${editorId}-detail-${item.id}`} onClick={event => setDetail({ item, scrollTop: event.currentTarget.closest('.tp-toolbox')?.scrollTop ?? 0 })}>{t('detail')}</Button>
        {item.name === 'call' && <Button id={`${editorId}-phone-${item.id}`} data-testid="call-setup" disabled={!mutable} onClick={event => setPhone({ id: item.id, scrollTop: event.currentTarget.closest('.tp-toolbox')?.scrollTop ?? 0 })}>{t('callSetup')}</Button>}
        <Button disabled={!mutable || !item.installed} onClick={() => mutate(() => actions.skillEnable({ id: item.id, enabled: !item.enabled, expectedRevision: load.value!.revision }))}>{t(item.enabled ? 'disable' : 'enable')}</Button>
        <Button disabled={!mutable} onClick={() => mutate(() => actions.skillCheck({ id: item.id }))}>{t('check')}</Button>
        {item.origin === 'user' && item.managed !== false && <Button id={`${editorId}-update-${item.id}`} disabled={!mutable || !item.installed} onClick={() => importSkill(item)}>{t('update')}</Button>}
        {item.managed !== false && <Button disabled={!mutable || !item.installed} onClick={() => setRemoving({ item, revision: load.value!.revision })}>{t('remove')}</Button>}</div>
    </article>)}</div>
    {removing && <ConfirmRemove name={skillPresentation(removing.item.name, t).label} busy={operation.busy} disabled={!mutable} feedback={operation.feedback} t={t} onClose={() => setRemoving(null)} onConfirm={() => {
      mutate(async () => { await actions.skillRemove({ id: removing.item.id, expectedRevision: removing.revision }); setRemoving(null); await actions.refreshSkills() }, 'removed')
    }} />}
  </SectionLayout>
}
function SkillDetail({ item, read, openDirectory, t, onClose, returnFocusId, returnScrollTop }: { item: SkillItem; read: SkillsClientApi['detail']; openDirectory: SectionProps['actions']['openSkillDirectory']; t: SectionProps['t']; onClose(): void; returnFocusId: string; returnScrollTop: number }) {
  const [detail, setDetail] = React.useState<Awaited<ReturnType<SkillsClientApi['detail']>> | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [retry, setRetry] = React.useState(0)
  const operation = useOperation(t)
  React.useEffect(() => {
    let active = true
    setDetail(null); setFailed(false)
    void read({ id: item.id }).then(result => { if (active) setDetail(result) }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [item.id, read, retry])
  const skill = detail?.item ?? item
  return <ToolboxDetail title={skillPresentation(skill.name, t).label} subtitle={skillPresentation(skill.name, t).description ?? skill.description} section="skills" t={t} onClose={onClose} returnFocusId={returnFocusId} returnScrollTop={returnScrollTop}
    actions={skill.origin !== 'bundled' && skill.path && <Button icon={<ToolboxIcon name="folder" />} disabled={operation.busy} onClick={() => { void operation.run(() => openDirectory(skill.path!.slice(0, Math.max(skill.path!.lastIndexOf('/'), skill.path!.lastIndexOf('\\')) + 1)), null) }}>{t('openSkillDirectory')}</Button>}>
    {operation.feedback}
    <section className="tp-toolbox-detail-section"><ReadinessBadge value={skill.readiness} t={t} /><Reasons value={skill.readiness} />
      <dl className="tp-toolbox-detail-facts"><div><dt>{t('version')}</dt><dd>{skill.version}</dd></div><div><dt>{t('invocation')}</dt><dd>/{skill.name}</dd></div>
        {skill.path && <div className="tp-toolbox-detail-wide"><dt>{t('skillLocation')}</dt><dd><code>{skill.path}</code></dd></div>}</dl>
      {skill.managed === false && <p className="tp-toolbox-meta">{t('manageSkillOnDisk')}</p>}
    </section>
    <section className="tp-toolbox-detail-section"><h2>{t('resources')}</h2>{skill.resources.length
      ? <ul className="tp-toolbox-detail-list">{skill.resources.map(path => <li key={path}><code>{path}</code></li>)}</ul> : <p className="tp-toolbox-meta">{t('none')}</p>}</section>
    <section className="tp-toolbox-detail-section" aria-busy={detail === null && !failed}><h2>{t('skillContent')}</h2>
      {failed ? <div><p role="alert">{t('failed')}</p><Button onClick={() => setRetry(value => value + 1)}>{t('refresh')}</Button></div>
        : detail === null ? <p role="status">{t('loading')}</p> : <pre className="tp-toolbox-content">{detail.content}</pre>}
    </section>
  </ToolboxDetail>
}
function CreateSkill({ available, actions, t, onClose, onSaved, returnFocusId }: { available: boolean; actions: SectionProps['actions']; t: SectionProps['t']; onClose(): void; onSaved(): void; returnFocusId: string }) {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [body, setBody] = React.useState('')
  const [invalid, setInvalid] = React.useState(false)
  const operation = useOperation(t)
  const bodyId = React.useId()
  return <ToolboxEditor title={t('manualCreate')} subtitle={t('manualCreateHint')} section="skills" t={t} pending={operation.busy} disabled={!available || !name.trim() || !description.trim() || !body.trim()} onClose={onClose} returnFocusId={returnFocusId}
    submitLabel={t('createSkillSubmit')} feedback={<>{invalid && <p role="alert">{t('invalidSkillName')}</p>}{operation.feedback}</>} onSubmit={() => {
        const canonical = name.trim()
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(canonical) || canonical.length > 64) { setInvalid(true); return }
        void operation.run(async () => {
          const content = `---\nname: ${canonical}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n${body.trim()}\n`
          const draft = await actions.prepareManualSkill({ content })
          installed(await actions.skillInstall({ requestId: crypto.randomUUID(), source: { kind: 'local', importId: draft.importId }, scope: { kind: 'user' }, conflict: 'reject' }))
          await actions.refreshSkills(); onSaved()
        }, 'imported')
      }}>
    <EditorField label={t('skillName')} hint={t('invalidSkillName')}><input required maxLength={64} value={name} placeholder={t('skillNamePlaceholder')} spellCheck={false} aria-invalid={invalid || undefined} onChange={event => { setName(event.target.value); setInvalid(false) }} /></EditorField>
    <EditorField label={t('skillDescription')}><textarea required rows={2} value={description} placeholder={t('skillDescriptionPlaceholder')} onChange={event => setDescription(event.target.value)} /></EditorField>
    <div className="tp-toolbox-editor-field"><label htmlFor={bodyId}>{t('skillInstructions')}</label><div className="tp-toolbox-editor-composer">
      <textarea id={bodyId} required rows={10} value={body} placeholder={t('skillInstructionsPlaceholder')} onChange={event => setBody(event.target.value)} />
      <div className="tp-toolbox-composer-footer"><span>Markdown</span><span><ToolboxIcon name="folder" size={14} />{t('skillSaveDestination')}</span></div>
    </div></div>
  </ToolboxEditor>
}

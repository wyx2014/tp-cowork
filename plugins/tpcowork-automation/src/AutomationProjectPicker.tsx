/** Project selection uses the homepage's native workspace menu and icons. */
import * as React from 'react'
import { IconChevronDownOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AutomationProject } from './ui-types.ts'
import type { UiText } from './ui-locales.ts'

interface Props {
  projects: readonly AutomationProject[]
  selectedId: AutomationProject['id'] | undefined
  disabled: boolean
  t: UiText
  onPick(project: AutomationProject | undefined): void
}

/** Select a real workspace or explicitly remove the task's project binding. */
export function AutomationProjectPicker({ projects, selectedId, disabled, t, onPick }: Props) {
  const [open, setOpen] = React.useState(false)
  const selected = projects.find(project => project.id === selectedId)
  const label = selected?.name ?? (selectedId ? t('unavailable') : t('selectProject'))
  const items: MenuEntry[] = projects.map(project => ({ id: project.id, label: project.name, icon: <IconFolderCloseRegular size={16} /> }))
  if (selectedId && !selected) items.unshift({ id: selectedId, label: `${t('unavailable')} · ${selectedId}`, icon: <IconFolderCloseRegular size={16} />, disabled: true })
  return <Menu
    open={open && !disabled}
    portal
    className="tp-auto-project-picker"
    anchor={<button type="button" className="tp-auto-project-trigger" aria-label={t('selectProject')} aria-haspopup="menu" aria-expanded={open && !disabled} disabled={disabled} title={selected ? `${selected.name} · ${selected.path}` : selectedId ? `${t('unavailable')} · ${selectedId}` : undefined} onClick={() => setOpen(value => !value)}>
      {selectedId ? <IconFolderOpenRegular size={16} /> : <IconFolderCloseRegular size={16} />}
      <span>{label}</span><IconChevronDownOutlineRegular size={12} />
    </button>}
    items={items}
    footer={[{ id: '', label: t('noProject'), icon: <IconFolderCloseRegular size={16} /> }]}
    selectedId={selectedId ?? ''}
    onSelect={id => { onPick(projects.find(project => project.id === id)); setOpen(false) }}
    onClose={() => setOpen(false)}
  />
}

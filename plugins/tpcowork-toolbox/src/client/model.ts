/** Ephemeral presentation cache; every inventory, mutation and admission is Host-authoritative. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type { Catalog, Change, McpItem, SelectionCatalog, SelectionDraft, SkillItem, TaskContext, TeamItem, ToolboxDescription } from '../contracts/index.ts'
import type { SkillsClientApi } from './remote.ts'
import { unwrap } from './remote.ts'
import { visibleMcp } from './visibility.ts'

export type Tab = 'teams' | 'skills' | 'mcp' | 'prompthub'
export interface Load<T> { value: T | null; loading: boolean; failed: boolean }
export interface Choice {
  draft: SelectionDraft
  catalog: SelectionCatalog | null
  phase: 'draft' | 'submitting' | 'fixed'
  context: TaskContext | null
  unavailable: boolean
}
export interface ToolboxState {
  epoch: number
  tab: Tab
  description: ToolboxDescription | null
  skills: Load<Catalog<SkillItem>>
  mcp: Load<Catalog<McpItem>>
  teams: Load<Catalog<TeamItem>>
  choices: Record<string, Choice>
  connection: 'connecting' | 'live' | 'interrupted'
  failed: boolean
}
type Remote = Pick<TypertClientRemote, 'toolbox' | 'toolboxSkills' | 'toolboxInstaller' | 'toolboxMcp' | 'toolboxTeams' | 'toolboxPromptHub' | 'toolboxTasks'>
const emptyLoad = <T>(): Load<T> => ({ value: null, loading: false, failed: false })
const emptyChoice = (): Choice => ({ draft: { expectedRevision: 0, team: null, skillIds: [], mcpIds: [] }, catalog: null, phase: 'draft', context: null, unavailable: false })
export const hasSelection = (draft: SelectionDraft): boolean => Boolean(draft.team || draft.skillIds.length || draft.mcpIds.length)

/** Admit selected capabilities, including an explicit removal of the previous message's choices. */
export const needsToolboxAdmission = (choice: Choice | undefined): boolean => Boolean(choice && (hasSelection(choice.draft)
  || choice.context?.team || choice.context?.skills.length || choice.context?.mcp.length))

export class ToolboxModel {
  readonly state = createSnapshotStore<ToolboxState>({ epoch: 0, tab: 'teams', description: null, skills: emptyLoad(), mcp: emptyLoad(), teams: emptyLoad(), choices: {}, connection: 'connecting', failed: false })
  private generation = 0
  private readonly catalogGeneration = { skills: 0, mcp: 0, teams: 0 }
  private readonly refreshes = new Map<Change['domain'], Promise<void>>()
  private readonly refreshAgain = new Set<Change['domain']>()
  private readonly choiceGeneration = new Map<string, number>()
  private readonly choiceReads = new Map<string, Promise<void>>()
  private readonly confirmingChoices = new Set<string>()
  /** Identity of the capabilities last selected or admitted, independent of catalog counters. */
  private readonly choiceSignatures = new Map<string, string>()
  private disposed = false
  constructor(readonly remote: Remote) {}

  setTab(tab: Tab): void { this.state.update(s => { s.tab = tab }) }
  interrupted(): void {
    this.generation++
    for (const [id, generation] of this.choiceGeneration) this.choiceGeneration.set(id, generation + 1)
    if (!this.disposed) this.state.update(s => {
      s.connection = 'interrupted'
      for (const key of ['skills', 'mcp', 'teams'] as const) { s[key].failed = true; s[key].loading = false }
      for (const choice of Object.values(s.choices)) choice.unavailable = true
    })
  }
  live(): void { if (!this.disposed) this.state.update(s => { s.connection = 'live' }) }

  async refresh(domain: Change['domain'] = 'modules'): Promise<void> {
    if (this.disposed) return
    if (domain === 'installer') domain = 'skills'
    const pending = this.refreshes.get(domain)
    if (pending) { this.refreshAgain.add(domain); return pending }
    const key = domain
    const work = (async () => {
      do {
        this.refreshAgain.delete(key)
        await (key === 'modules' ? this.refreshAll() : this.refreshDomain(key))
      } while (!this.disposed && this.refreshAgain.has(key))
    })().finally(() => { this.refreshes.delete(key) })
    this.refreshes.set(key, work)
    return work
  }

  private async refreshDomain(domain: Exclude<Change['domain'], 'modules'>): Promise<void> {
    if (domain === 'prompthub') { this.state.update(s => { s.epoch++ }); return }
    const key = domain === 'installer' ? 'skills' : domain
    await Promise.all([this.loadCatalog(key), this.refreshChoices()])
  }

  private async refreshChoices(): Promise<void> {
    await Promise.all(Object.entries(this.state.getSnapshot().choices)
      .filter(([, choice]) => choice.phase === 'draft' && hasSelection(choice.draft))
      .map(([id]) => this.loadChoice(id)))
  }

  private async loadCatalog<K extends 'skills' | 'mcp' | 'teams'>(key: K): Promise<void> {
    const generation = this.generation
    const reading = ++this.catalogGeneration[key]
    this.state.update(s => { s[key].loading = true })
    try {
      const description = this.state.getSnapshot().description
      const value = description?.modules[key] === false ? null : await (
        key === 'skills' ? unwrap(this.remote.toolboxSkills.inventory({})) :
        key === 'mcp' ? unwrap(this.remote.toolboxMcp.inventory()) : unwrap(this.remote.toolboxTeams.inventory()))
      if (generation !== this.generation || reading !== this.catalogGeneration[key] || this.disposed) return
      this.state.update(s => { s[key] = { value, loading: false, failed: false } as ToolboxState[K] })
    } catch (error) {
      if (generation === this.generation && reading === this.catalogGeneration[key] && !this.disposed) this.state.update(s => { s[key].loading = false; s[key].failed = true })
    }
  }

  private async refreshAll(): Promise<void> {
    const generation = ++this.generation
    this.state.update(s => { s.failed = false; for (const key of ['skills', 'mcp', 'teams'] as const) s[key].loading = true })
    try {
      const description = await unwrap(this.remote.toolbox.describe())
      if (generation !== this.generation || this.disposed) return
      this.state.update(s => { s.description = description; s.epoch++ })
      await Promise.all([
        this.loadCatalog('skills'), this.loadCatalog('mcp'), this.loadCatalog('teams'),
        ...Object.keys(this.state.getSnapshot().choices).map(id => this.loadChoice(id)),
      ])
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.state.update(s => { s.failed = true; for (const key of ['skills', 'mcp', 'teams'] as const) { s[key].loading = false; s[key].failed = true } })
    }
  }

  async setSkillEnabled(request: Parameters<SkillsClientApi['setEnabled']>[0]): Promise<Catalog<SkillItem>> {
    const generation = this.generation
    const catalog = await unwrap(this.remote.toolboxSkills.setEnabled(request))
    if (generation === this.generation && !this.disposed && (!this.state.getSnapshot().skills.value || catalog.revision >= this.state.getSnapshot().skills.value!.revision)) {
      this.catalogGeneration.skills++
      this.state.update(s => { s.skills = { value: catalog, loading: false, failed: false } })
    }
    return catalog
  }

  async checkSkill(request: Parameters<SkillsClientApi['checkReadiness']>[0]): Promise<SkillItem> {
    const item = await unwrap(this.remote.toolboxSkills.checkReadiness(request))
    await this.refresh('skills')
    return item
  }

  async loadChoice(sessionId: string, confirm = false): Promise<void> {
    if (this.disposed) return
    if (confirm) this.confirmingChoices.add(sessionId)
    const reading = this.readChoice(sessionId)
    this.choiceReads.set(sessionId, reading)
    try {
      let latest = reading
      while (!this.disposed) {
        await latest
        const pending = this.choiceReads.get(sessionId)
        if (!pending || pending === latest) return
        // A notification may supersede this read while a native popup is opening.
        // Its caller needs the authoritative replacement before reading the cache.
        latest = pending
      }
    } finally {
      if (this.choiceReads.get(sessionId) === reading) this.choiceReads.delete(sessionId)
    }
  }

  private async readChoice(sessionId: string): Promise<void> {
    const generation = (this.choiceGeneration.get(sessionId) ?? 0) + 1
    this.choiceGeneration.set(sessionId, generation)
    this.state.update(s => { s.choices[sessionId] ??= emptyChoice() })
    try {
      const [catalog, context] = await Promise.all([
        unwrap(this.remote.toolboxTasks.selection({ sessionId })),
        unwrap(this.remote.toolboxTasks.context({ sessionId, taskId: sessionId })),
      ])
      if (this.choiceGeneration.get(sessionId) !== generation || this.disposed) return
      this.state.update(s => {
        const choice = s.choices[sessionId]!
        const first = choice.catalog === null
        const submitting = choice.phase === 'submitting'
        const changed = context !== null && choice.context?.taskId !== context.taskId
        choice.catalog = catalog; choice.unavailable = false
        if (context) {
          choice.context = context
          if (context.team || first || changed) {
            choice.draft = fromContext(context)
            this.choiceSignatures.set(sessionId, capabilitySignature(context))
          }
          if (!submitting) choice.phase = context.team ? 'fixed' : 'draft'
        }
        const confirming = this.confirmingChoices.has(sessionId)
        const signature = selectionSignature(choice.draft, catalog)
        if ((!context && first) || confirming) this.rememberSelection(sessionId, signature)
        // A restored context has a historical counter. Revalidate its actual pins instead;
        // unrelated catalog changes and Host restarts do not change selected capabilities.
        if ((!context && first) || !hasSelection(choice.draft) || confirming
          || (signature !== null && signature === this.choiceSignatures.get(sessionId))) choice.draft.expectedRevision = catalog.revision
        this.confirmingChoices.delete(sessionId)
      })
    } catch (error) {
      if (this.choiceGeneration.get(sessionId) === generation && !this.disposed) {
        this.confirmingChoices.delete(sessionId)
        this.state.update(s => { s.choices[sessionId]!.unavailable = true })
      }
    }
  }

  choose(sessionId: string, update: Partial<Pick<SelectionDraft, 'team' | 'skillIds' | 'mcpIds'>>): void {
    this.state.update(s => {
      const choice = s.choices[sessionId]
      if (!choice?.catalog || choice.phase !== 'draft' || choice.unavailable) return
      const draft = { ...choice.draft, ...update, expectedRevision: choice.catalog.revision }
      // Restoring identical editor references does not confirm changed skill content.
      if (sameSelection(choice.draft, draft)) return
      choice.draft = draft
      this.rememberSelection(sessionId, selectionSignature(choice.draft, choice.catalog))
    })
  }

  prepareTeam(sessionId: string, team: TeamItem): void {
    this.state.update(s => {
      const choice = s.choices[sessionId] ??= emptyChoice()
      if (choice.phase !== 'draft') return
      choice.draft.team = { id: team.id, version: team.version, workflowId: team.workflowId }
      choice.draft.skillIds = [...team.requiredSkillIds]
      choice.draft.mcpIds = []
      this.rememberSelection(sessionId, choice.catalog ? selectionSignature(choice.draft, choice.catalog) : null)
    })
  }

  async submit(message: SessionPromptRequest, signal: AbortSignal): Promise<{ accepted: true }> {
    const choice = this.state.getSnapshot().choices[message.sessionId]
    if (!choice || choice.phase === 'submitting' || choice.unavailable || !choice.catalog) throw new Error('toolbox/selection-unavailable')
    const previous = choice.phase
    const selection: SelectionDraft = { ...choice.draft, skillIds: [...choice.draft.skillIds], mcpIds: [...choice.draft.mcpIds], team: choice.draft.team ? { ...choice.draft.team } : null }
    this.state.update(s => { s.choices[message.sessionId]!.phase = 'submitting' })
    try {
      const result = await unwrap(this.remote.toolboxTasks.submit({ message, selection }, signal))
      if (!this.disposed) this.state.update(s => {
        const current = s.choices[message.sessionId]!
        current.phase = result.context.team ? 'fixed' : 'draft'; current.context = result.context; current.draft = fromContext(result.context)
        const signature = capabilitySignature(result.context)
        this.choiceSignatures.set(message.sessionId, signature)
        if (current.catalog && selectionSignature(current.draft, current.catalog) === signature) current.draft.expectedRevision = current.catalog.revision
      })
      return { accepted: true }
    } catch (error) {
      if (!this.disposed) this.state.update(s => {
        const current = s.choices[message.sessionId]!
        current.phase = current.context?.team ? 'fixed' : previous
      })
      throw error
    }
  }

  private rememberSelection(sessionId: string, signature: string | null): void {
    if (signature === null) this.choiceSignatures.delete(sessionId)
    else this.choiceSignatures.set(sessionId, signature)
  }

  dispose(): void { this.disposed = true; this.generation++; this.refreshAgain.clear(); this.choiceGeneration.clear(); this.choiceReads.clear(); this.confirmingChoices.clear(); this.choiceSignatures.clear() }
}

function fromContext(context: TaskContext): SelectionDraft {
  return { expectedRevision: context.catalogRevision, team: context.team, skillIds: context.skills.map(item => item.id), mcpIds: context.mcp.map(item => item.id) }
}

function sameSelection(left: SelectionDraft, right: SelectionDraft): boolean {
  return left.team?.id === right.team?.id && left.team?.version === right.team?.version && left.team?.workflowId === right.team?.workflowId
    && left.skillIds.length === right.skillIds.length && left.skillIds.every((id, index) => id === right.skillIds[index])
    && left.mcpIds.length === right.mcpIds.length && left.mcpIds.every((id, index) => id === right.mcpIds[index])
}

/** Local validation only controls affordances; the Host repeats every admission check. */
export function selectionIssues(choice: Choice): string[] {
  const catalog = choice.catalog
  if (!catalog || choice.unavailable) return ['unavailable']
  const issues: string[] = []
  if ([catalog.skills, catalog.mcp, catalog.teams].some(value => !value.complete)) issues.push('incomplete')
  if (catalog.revision !== choice.draft.expectedRevision) issues.push('stale')
  return [...issues, ...capabilityIssues(choice.draft, catalog)]
}

function capabilityIssues(draft: SelectionDraft, catalog: SelectionCatalog): string[] {
  const issues: string[] = []
  for (const id of draft.skillIds) {
    const item = catalog.skills.items.find(row => row.id === id)
    if (!item?.installed || !item.enabled || item.readiness.state !== 'ready') issues.push(id)
  }
  for (const id of draft.mcpIds) {
    const item = catalog.mcp.items.find(row => row.id === id)
    if (!item?.installed || !item.enabled || item.readiness.state !== 'ready' || !visibleMcp(item)) issues.push(id)
  }
  if (draft.team) {
    const item = catalog.teams.items.find(row => row.id === draft.team?.id)
    if (!item?.enabled || item.readiness.state !== 'ready' || item.version !== draft.team.version || item.workflowId !== draft.team.workflowId) issues.push(draft.team.id)
    if (item?.requiredSkillIds.some(id => !draft.skillIds.includes(id))) issues.push('dependencies')
  }
  return issues
}

function capabilitySignature(pins: Pick<TaskContext, 'team' | 'skills' | 'mcp'>): string {
  return JSON.stringify([
    pins.team ? [pins.team.id, pins.team.version, pins.team.workflowId] : null,
    pins.skills.map(item => [item.id, item.version, item.fingerprint]),
    pins.mcp.map(item => [item.id, item.configRevision]),
  ])
}

function selectionSignature(draft: SelectionDraft, catalog: SelectionCatalog): string | null {
  if ([catalog.skills, catalog.mcp, catalog.teams].some(value => !value.complete) || capabilityIssues(draft, catalog).length) return null
  return capabilitySignature({
    team: draft.team,
    skills: draft.skillIds.map(id => catalog.skills.items.find(item => item.id === id)!),
    mcp: draft.mcpIds.map(id => catalog.mcp.items.find(item => item.id === id)!),
  })
}

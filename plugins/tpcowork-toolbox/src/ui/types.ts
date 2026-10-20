import type { HostObservable, PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolboxState, Tab } from '../client/model.ts'
import type { InstallerClientApi, SkillsClientApi } from '../client/remote.ts'
import type { McpApi, PromptHubApi, TeamItem, SelectionDraft } from '../contracts/index.ts'

export type UiActions = {
  refresh(): Promise<void>
  refreshSkills(): Promise<void>
  setTab(tab: Tab): void
  skillDetail: SkillsClientApi['detail']
  skillEnable: SkillsClientApi['setEnabled']
  skillRemove: SkillsClientApi['remove']
  skillCheck: SkillsClientApi['checkReadiness']
  prepareImport: InstallerClientApi['prepareLocalImport']
  prepareSkillArchive(file: File): Promise<{ importId: string; name: string }>
  pickSkillDirectory(): Promise<string | null>
  openSkillDirectory(path: string): Promise<void>
  prepareManualSkill: InstallerClientApi['prepareSkill']
  skillInstall: InstallerClientApi['install']
  mcpDefinition: McpApi['definition']
  mcpInventory: McpApi['inventory']
  mcpImport: McpApi['importDefinitions']
  mcpProbeDraft: McpApi['probeDraft']
  mcpCreate: McpApi['create']
  mcpUpdate: McpApi['update']
  mcpRemove: McpApi['remove']
  mcpEnable: McpApi['setEnabled']
  mcpProbe: McpApi['probe']
  hubAccount: PromptHubApi['account']
  hubLogin: PromptHubApi['login']
  hubLogout: PromptHubApi['logout']
  hubList: PromptHubApi['list']
  hubDetail: PromptHubApi['detail']
  hubInstall: PromptHubApi['install']
  hubPublish: PromptHubApi['publish']
  prepareTeam(team: TeamItem, prompt: string): void
  prepareSkill(prompt: string): void
  loadChoice(sessionId: string, confirm?: boolean): Promise<void>
  choose(sessionId: string, patch: Partial<Pick<SelectionDraft, 'team' | 'skillIds' | 'mcpIds'>>): void
}
export type UiInjected = UiActions & { hooks: { toolbox: HostObservable<ToolboxState> } }
export type PageProps = PropsRuntime<'main'> & PropsLocale<'tpcowork.toolbox'> & PropsHooks<UiInjected['hooks']> & UiActions
export type ChoiceDockProps = PropsRuntime<'conversation.input.selection'> & PropsLocale<'tpcowork.toolbox'> & PropsHooks<UiInjected['hooks']> & UiActions
export type T = PageProps['t']

import { describe, expect, it, vi } from 'vitest'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import { ToolboxModel, needsToolboxAdmission, selectionIssues } from '../src/client/model.ts'
import { pinTaskContext } from '../src/task-context.ts'
import { catalog } from './ui-fixture.ts'
import { visibleMcp } from '../src/client/visibility.ts'
import { mcpForm, parseMcp } from '../src/ui/mcp-form.ts'
import type { FirstSubmissionRequest } from '../src/contracts/index.ts'

const ok = <T>(value: T) => ({ ok: true as const, value })
const description = { contractVersion: 1 as const, modules: { skills: true, mcp: true, teams: true, installer: true, prompthub: true }, defaultMcpIds: ['juyuan', 'caihui_mcp', 'playwright'] }
function bench() {
  const current = catalog()
  const remote = {
    toolbox: { describe: vi.fn(async () => ok(description)) },
    toolboxSkills: { inventory: vi.fn(async () => ok(current.skills)), setEnabled: vi.fn(async () => ok(current.skills)) },
    toolboxMcp: { inventory: vi.fn(async () => ok(current.mcp)) },
    toolboxTeams: { inventory: vi.fn(async () => ok(current.teams)) },
    toolboxTasks: {
      selection: vi.fn(async () => ok(current)), context: vi.fn(async () => ok(null)),
      submit: vi.fn(async ({ message, selection }: FirstSubmissionRequest) => ok({ accepted: true as const, context: pinTaskContext({ sessionId: message.sessionId, taskId: selection.team ? message.sessionId : `message:${message.requestId}`, submittedAt: 1 }, selection, current) })),
    },
  }
  const model = new ToolboxModel(remote as ConstructorParameters<typeof ToolboxModel>[0])
  return { current, remote, model }
}
const message = { sessionId: 's1', requestId: 'request-1', mode: 'steer', clientTimeZone: 'Asia/Shanghai', content: [{ type: 'text', text: '/office-docx prepare a report' }, { type: 'file', receiptId: 'receipt-1' }] } as SessionPromptRequest

describe('toolbox draft and authoritative admission', () => {
  it('keeps a cold-start draft until task endpoints are available and restores it on the module notification', async () => {
    const { model, remote, current } = bench()
    remote.toolbox.describe.mockResolvedValue(ok({ ...description, modules: { ...description.modules, teams: false } }))
    model.prepareTeam('s1', current.teams.items[0]!)
    await model.loadChoice('s1')
    await model.refresh()
    expect(remote.toolboxTasks.selection).not.toHaveBeenCalled()
    expect(remote.toolboxTasks.context).not.toHaveBeenCalled()
    expect(model.state.getSnapshot().choices.s1).toMatchObject({ unavailable: true,
      draft: { team: { id: current.teams.items[0]!.id } } })
    remote.toolbox.describe.mockResolvedValue(ok(description))
    await model.refresh('modules')
    expect(remote.toolboxTasks.selection).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1' })
    expect(remote.toolboxTasks.context).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', taskId: 's1' })
    expect(model.state.getSnapshot().choices.s1).toMatchObject({ unavailable: false,
      draft: { team: { id: current.teams.items[0]!.id } }, catalog: current })
  })

  it('refreshes only the changed catalog and selected drafts without reloading unrelated panels or empty drafts', async () => {
    const { model, remote } = bench()
    await model.refresh(); await model.loadChoice('selected'); await model.loadChoice('blank')
    model.choose('selected', { skillIds: ['bundled:office-docx'] })
    for (const service of [remote.toolbox.describe, remote.toolboxSkills.inventory, remote.toolboxMcp.inventory, remote.toolboxTeams.inventory, remote.toolboxTasks.selection]) service.mockClear()
    await model.refresh('skills')
    expect(remote.toolboxSkills.inventory).toHaveBeenCalledOnce()
    expect(remote.toolboxTasks.selection).toHaveBeenCalledExactlyOnceWith({ sessionId: 'selected' })
    expect(remote.toolbox.describe).not.toHaveBeenCalled()
    expect(remote.toolboxMcp.inventory).not.toHaveBeenCalled()
    expect(remote.toolboxTeams.inventory).not.toHaveBeenCalled()
    expect(model.state.getSnapshot().mcp.loading).toBe(false)
  })
  it('applies the toggle response immediately and prevents an earlier inventory from restoring the old state', async () => {
    const { model, remote, current } = bench()
    await model.refresh()
    let finish!: (value: ReturnType<typeof ok<typeof current.skills>>) => void
    remote.toolboxSkills.inventory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = model.refresh('skills')
    const disabled = structuredClone(current.skills)
    disabled.revision++
    disabled.items[0]!.enabled = false
    remote.toolboxSkills.setEnabled.mockResolvedValueOnce(ok(disabled))
    await model.setSkillEnabled({ id: disabled.items[0]!.id, expectedRevision: current.skills.revision, enabled: false })
    expect(model.state.getSnapshot().skills).toMatchObject({ value: disabled, loading: false, failed: false })
    finish(ok(current.skills)); await pending
    expect(model.state.getSnapshot().skills.value).toEqual(disabled)
    expect(remote.toolboxSkills.inventory).toHaveBeenCalledTimes(2)
    expect(remote.toolbox.describe).toHaveBeenCalledOnce()
    expect(remote.toolboxMcp.inventory).toHaveBeenCalledOnce()
  })
  it('ignores catalog and choice replies from requests made before a connection interruption', async () => {
    const { model, remote, current } = bench()
    await model.refresh(); await model.loadChoice('s1')
    let finishInventory!: (value: ReturnType<typeof ok<typeof current.skills>>) => void
    let finishChoice!: (value: ReturnType<typeof ok<typeof current>>) => void
    remote.toolboxSkills.inventory.mockImplementationOnce(() => new Promise(resolve => { finishInventory = resolve }))
    remote.toolboxTasks.selection.mockImplementationOnce(() => new Promise(resolve => { finishChoice = resolve }))
    const pending = model.refresh()
    await vi.waitFor(() => { expect(finishInventory).toBeDefined(); expect(finishChoice).toBeDefined() })
    model.interrupted()
    finishInventory(ok(current.skills)); finishChoice(ok(current))
    await pending
    expect(model.state.getSnapshot()).toMatchObject({ connection: 'interrupted', skills: { loading: false, failed: true }, choices: { s1: { unavailable: true } } })
    model.live(); await model.refresh()
    expect(model.state.getSnapshot()).toMatchObject({ connection: 'live', skills: { failed: false }, choices: { s1: { unavailable: false } } })
  })
  it('prepares a team without executing it, retains native request fields and fixes accepted choices', async () => {
    const { current, remote, model } = bench()
    model.prepareTeam('s1', current.teams.items[0]!)
    expect(remote.toolboxTasks.submit).not.toHaveBeenCalled()
    await model.loadChoice('s1')
    model.choose('s1', { skillIds: [current.skills.items[0]!.id], mcpIds: ['juyuan'] })
    expect(selectionIssues(model.state.getSnapshot().choices.s1!)).toEqual([])
    const signal = new AbortController().signal
    await model.submit(message, signal)
    expect(remote.toolboxTasks.submit).toHaveBeenCalledWith({ message, selection: expect.objectContaining({ expectedRevision: 8, mcpIds: ['juyuan'] }) }, signal)
    const pinned = model.state.getSnapshot().choices.s1!
    expect(pinned.phase).toBe('fixed')
    model.choose('s1', { team: null, mcpIds: [] })
    expect(model.state.getSnapshot().choices.s1!.draft).toEqual(pinned.draft)
    await model.loadChoice('s2')
    expect(model.state.getSnapshot().choices.s2!.draft.mcpIds).toEqual([])
  })
  it('does not silently upgrade a stale choice or erase it when an item disappears', async () => {
    const { model, remote } = bench()
    await model.loadChoice('s1'); model.choose('s1', { mcpIds: ['juyuan'] })
    const updated = catalog(); updated.revision = 9; updated.mcp.items = []
    remote.toolboxTasks.selection.mockResolvedValueOnce(ok(updated))
    await model.loadChoice('s1')
    expect(model.state.getSnapshot().choices.s1!.draft.expectedRevision).toBe(8)
    expect(selectionIssues(model.state.getSnapshot().choices.s1!)).toEqual(['stale', 'juyuan'])
  })

  it('restores unchanged selected capabilities after a Host restart and admits the next message with the current revision', async () => {
    const { model, remote, current } = bench()
    const context = pinTaskContext({ sessionId: 's1', taskId: 'message:old', submittedAt: 1 }, { expectedRevision: current.revision, team: null, skillIds: [current.skills.items[0]!.id], mcpIds: ['juyuan'] }, current)
    remote.toolboxTasks.context.mockResolvedValue(ok(context) as never)
    current.revision += 100
    await model.loadChoice('s1')
    const choice = model.state.getSnapshot().choices.s1!
    expect(choice.draft).toMatchObject({ expectedRevision: current.revision, skillIds: [current.skills.items[0]!.id], mcpIds: ['juyuan'] })
    expect(selectionIssues(choice)).toEqual([])
    expect(choice.context).toEqual(context)
    expect(context.catalogRevision).toBe(8)
    await model.submit(message, new AbortController().signal)
    expect(remote.toolboxTasks.submit).toHaveBeenCalledWith(expect.objectContaining({ selection: expect.objectContaining({ expectedRevision: current.revision }) }), expect.any(AbortSignal))
    expect(model.state.getSnapshot().choices.s1!.context).toMatchObject({ taskId: 'message:request-1', catalogRevision: current.revision, skills: context.skills, mcp: context.mcp })
    expect(context.catalogRevision).toBe(8)
  })

  it('keeps a selected draft usable across unrelated catalog changes and temporary incomplete reads', async () => {
    const { model, remote, current } = bench()
    await model.loadChoice('s1')
    model.choose('s1', { skillIds: [current.skills.items[0]!.id], mcpIds: ['juyuan'] })
    const updated = catalog(); updated.revision = 9
    updated.skills.items.push({ ...updated.skills.items[0]!, id: 'unrelated', name: 'other-skill', enabled: false })
    remote.toolboxTasks.selection.mockResolvedValue(ok(updated))
    await model.refresh('skills')
    expect(model.state.getSnapshot().choices.s1!.draft.expectedRevision).toBe(9)
    expect(selectionIssues(model.state.getSnapshot().choices.s1!)).toEqual([])
    const partial = structuredClone(updated); partial.revision = 10; partial.skills.complete = false
    remote.toolboxTasks.selection.mockResolvedValueOnce(ok(partial))
    await model.loadChoice('s1')
    expect(selectionIssues(model.state.getSnapshot().choices.s1!)).toContain('incomplete')
    const recovered = structuredClone(updated); recovered.revision = 11
    remote.toolboxTasks.selection.mockResolvedValueOnce(ok(recovered))
    await model.loadChoice('s1')
    expect(model.state.getSnapshot().choices.s1!.draft).toMatchObject({ expectedRevision: 11, skillIds: [current.skills.items[0]!.id], mcpIds: ['juyuan'] })
    expect(selectionIssues(model.state.getSnapshot().choices.s1!)).toEqual([])
  })

  it.each(['skill content', 'skill version', 'connector config', 'disabled skill', 'missing skill', 'unready skill'] as const)('requires review of %s changes, including after restoring a session', async change => {
    for (const restored of [false, true]) {
      const { model, remote, current } = bench()
      const draft = { expectedRevision: current.revision, team: null, skillIds: [current.skills.items[0]!.id], mcpIds: ['juyuan'] }
      if (restored) {
        remote.toolboxTasks.context.mockResolvedValue(ok(pinTaskContext({ sessionId: 's1', taskId: 'message:old', submittedAt: 1 }, draft, current)) as never)
      } else {
        await model.loadChoice('s1')
        model.choose('s1', draft)
      }
      const updated = catalog(); updated.revision = 9
      if (change === 'skill content') updated.skills.items[0]!.fingerprint += '-changed'
      if (change === 'skill version') updated.skills.items[0]!.version += '-changed'
      if (change === 'connector config') updated.mcp.items[0]!.configRevision++
      if (change === 'disabled skill') updated.skills.items[0]!.enabled = false
      if (change === 'missing skill') updated.skills.items = []
      if (change === 'unready skill') updated.skills.items[0]!.readiness.state = 'error'
      remote.toolboxTasks.selection.mockResolvedValue(ok(updated))
      await model.loadChoice('s1')
      await model.loadChoice('s1')
      // Native editor restoration may report the same references after the catalog arrives.
      model.choose('s1', { ...draft, skillIds: [...draft.skillIds], mcpIds: [...draft.mcpIds] })
      expect(model.state.getSnapshot().choices.s1!.draft.expectedRevision).toBe(8)
      expect(selectionIssues(model.state.getSnapshot().choices.s1!)).toContain('stale')
      await model.loadChoice('s1', true)
      const issues = selectionIssues(model.state.getSnapshot().choices.s1!)
      if (['disabled skill', 'missing skill', 'unready skill'].includes(change)) expect(issues).toContain(draft.skillIds[0])
      else expect(issues).toEqual([])
    }
  })

  it('retains a newer catalog when an admitted selection reply arrives after an unrelated refresh', async () => {
    const { model, remote, current } = bench()
    await model.loadChoice('s1')
    model.choose('s1', { skillIds: [current.skills.items[0]!.id] })
    const context = pinTaskContext({ sessionId: 's1', taskId: 'message:request-1', submittedAt: 1 }, model.state.getSnapshot().choices.s1!.draft, current)
    let finish!: (value: ReturnType<typeof ok<{ accepted: true; context: typeof context }>>) => void
    remote.toolboxTasks.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const sending = model.submit(message, new AbortController().signal)
    const updated = catalog(); updated.revision = 9
    remote.toolboxTasks.selection.mockResolvedValueOnce(ok(updated))
    await model.loadChoice('s1')
    finish(ok({ accepted: true, context }))
    await sending
    const choice = model.state.getSnapshot().choices.s1!
    expect(choice.context?.catalogRevision).toBe(8)
    expect(choice.draft.expectedRevision).toBe(9)
    expect(selectionIssues(choice)).toEqual([])
  })

  it('restores an empty historical selection against the current catalog and lets ordinary chat use native admission', async () => {
    const { model, remote, current } = bench()
    const context = pinTaskContext({ sessionId: 's1', taskId: 'message:old', submittedAt: 1 }, { expectedRevision: current.revision, team: null, skillIds: [], mcpIds: [] }, current)
    remote.toolboxTasks.context.mockResolvedValue(ok(context) as never)
    current.revision += 100
    await model.loadChoice('s1')
    const choice = model.state.getSnapshot().choices.s1!
    expect(choice.context?.catalogRevision).toBe(8)
    expect(choice.draft.expectedRevision).toBe(current.revision)
    expect(selectionIssues(choice)).toEqual([])
    expect(needsToolboxAdmission(choice)).toBe(false)
    model.interrupted()
    expect(needsToolboxAdmission(model.state.getSnapshot().choices.s1)).toBe(false)
    expect(remote.toolboxTasks.submit).not.toHaveBeenCalled()
  })
  it('waits for a superseding choice read before returning the catalog to a popup', async () => {
    const { model, remote, current } = bench()
    await model.refresh()
    let first!: (value: ReturnType<typeof ok<typeof current>>) => void
    let latest!: (value: ReturnType<typeof ok<typeof current>>) => void
    remote.toolboxTasks.selection.mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
    remote.toolboxTasks.selection.mockImplementationOnce(() => new Promise(resolve => { latest = resolve }))
    let settled = false
    const opening = model.loadChoice('s1').then(() => { settled = true })
    const refresh = model.loadChoice('s1')
    first(ok(current))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    expect(model.state.getSnapshot().choices.s1?.catalog).toBeNull()
    const updated = catalog(); updated.revision = current.revision + 1
    latest(ok(updated))
    await Promise.all([opening, refresh])
    expect(settled).toBe(true)
    expect(model.state.getSnapshot().choices.s1?.catalog?.revision).toBe(updated.revision)
  })

  it('keeps an explicit catalog confirmation when a notification supersedes its request', async () => {
    const { model, remote, current } = bench()
    await model.loadChoice('s1')
    model.choose('s1', { mcpIds: ['juyuan'] })
    let finish!: (value: ReturnType<typeof ok<typeof current>>) => void
    remote.toolboxTasks.selection.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const confirming = model.loadChoice('s1', true)
    const updated = catalog(); updated.revision = 9
    remote.toolboxTasks.selection.mockResolvedValueOnce(ok(updated))
    await model.loadChoice('s1')
    finish(ok(current))
    await confirming
    expect(model.state.getSnapshot().choices.s1!.draft).toMatchObject({ expectedRevision: 9, mcpIds: ['juyuan'] })
    expect(selectionIssues(model.state.getSnapshot().choices.s1!)).toEqual([])
  })
  it('blocks edits during admission and unlocks a rejected draft without showing acceptance', async () => {
    const { model, remote } = bench()
    await model.loadChoice('s1'); model.choose('s1', { mcpIds: ['juyuan'] })
    let reject!: (error: Error) => void
    remote.toolboxTasks.submit.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const sending = model.submit(message, new AbortController().signal)
    model.choose('s1', { mcpIds: [] })
    expect(model.state.getSnapshot().choices.s1!.draft.mcpIds).toEqual(['juyuan'])
    reject(new Error('offline'))
    await expect(sending).rejects.toThrow('offline')
    expect(model.state.getSnapshot().choices.s1!.phase).toBe('draft')
    expect(model.state.getSnapshot().choices.s1!.context).toBeNull()
  })
  it('keeps a Host-restored context fixed when the original admission response is lost', async () => {
    const { model, remote, current } = bench()
    model.prepareTeam('s1', current.teams.items[0]!)
    await model.loadChoice('s1'); model.choose('s1', { mcpIds: ['juyuan'] })
    const context = pinTaskContext({ sessionId: 's1', taskId: 's1', submittedAt: 1 }, model.state.getSnapshot().choices.s1!.draft, current)
    let reject!: (error: Error) => void
    remote.toolboxTasks.submit.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const sending = model.submit(message, new AbortController().signal)
    remote.toolboxTasks.context.mockResolvedValueOnce(ok(context) as never)
    await model.loadChoice('s1')
    reject(new Error('response lost'))
    await expect(sending).rejects.toThrow('response lost')
    expect(model.state.getSnapshot().choices.s1!.phase).toBe('fixed')
    model.choose('s1', { mcpIds: [] })
    expect(model.state.getSnapshot().choices.s1!.draft.mcpIds).toEqual(['juyuan'])
  })
  it('keeps ordinary chat editable after sending and preserves the next draft across catalog refreshes', async () => {
    const { model, remote } = bench()
    await model.loadChoice('s1')
    model.choose('s1', { skillIds: ['bundled:office-docx'], mcpIds: ['juyuan'] })
    await model.submit(message, new AbortController().signal)
    const context = model.state.getSnapshot().choices.s1!.context!
    expect(model.state.getSnapshot().choices.s1!.phase).toBe('draft')
    expect(context.taskId).toBe('message:request-1')
    remote.toolboxTasks.context.mockResolvedValue(ok(context) as never)
    model.choose('s1', { skillIds: [], mcpIds: [] })
    await model.loadChoice('s1')
    expect(model.state.getSnapshot().choices.s1!.draft).toMatchObject({ skillIds: [], mcpIds: [] })
    expect(needsToolboxAdmission(model.state.getSnapshot().choices.s1)).toBe(true)
    await model.submit({ ...message, requestId: 'request-2' as never }, new AbortController().signal)
    expect(remote.toolboxTasks.submit).toHaveBeenLastCalledWith(expect.objectContaining({ selection: expect.objectContaining({ skillIds: [], mcpIds: [] }) }), expect.any(AbortSignal))
    expect(model.state.getSnapshot().choices.s1!.context).toMatchObject({ taskId: 'message:request-2', skills: [], mcp: [] })
    expect(needsToolboxAdmission(model.state.getSnapshot().choices.s1)).toBe(false)
    expect(context.skills).toHaveLength(1)
  })
  it('restores ordinary selections without fixing them and keeps admission locked during a background read', async () => {
    const { model, remote, current } = bench()
    const context = pinTaskContext({ sessionId: 's1', taskId: 'message:previous', submittedAt: 1 }, { expectedRevision: current.revision, team: null, skillIds: [], mcpIds: ['juyuan'] }, current)
    remote.toolboxTasks.context.mockResolvedValue(ok(context) as never)
    await model.loadChoice('s1')
    expect(model.state.getSnapshot().choices.s1!.phase).toBe('draft')
    model.choose('s1', { mcpIds: [] })
    let reject!: (error: Error) => void
    remote.toolboxTasks.submit.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const sending = model.submit(message, new AbortController().signal)
    await model.loadChoice('s1')
    expect(model.state.getSnapshot().choices.s1!.phase).toBe('submitting')
    reject(new Error('offline'))
    await expect(sending).rejects.toThrow('offline')
    expect(model.state.getSnapshot().choices.s1!).toMatchObject({ phase: 'draft', draft: { mcpIds: [] } })
  })
  it('retains the last snapshot as untrusted on failure and ignores a response after disposal', async () => {
    const { model, remote } = bench()
    await model.refresh()
    remote.toolboxSkills.inventory.mockRejectedValueOnce(new Error('offline'))
    await model.refresh()
    expect(model.state.getSnapshot().skills).toMatchObject({ failed: true, value: { items: [{ name: 'office-docx' }] } })
    model.dispose(); const snapshot = model.state.getSnapshot()
    await model.refresh()
    expect(model.state.getSnapshot().skills.value).toEqual(snapshot.skills.value)
  })
})
describe('public MCP configuration', () => {
  it('preserves stdio arguments and credential references, and rejects credential-bearing HTTP URLs', () => {
    const form = mcpForm(); Object.assign(form, { id: 'custom', label: 'Custom', transport: 'stdio', command: 'node', args: '--flag\nvalue with spaces', cwd: '/workspace' })
    expect(parseMcp(form)).toMatchObject({ args: ['--flag', 'value with spaces'], cwd: '/workspace', credentials: [] })
    Object.assign(form, { transport: 'streamable-http', endpoint: 'https://example.test/mcp?token=secret' })
    expect(() => parseMcp(form)).toThrow()
    form.endpoint = 'https://example.test/mcp'; form.credentials = [{ ref: 'DSH_TOKEN', key: 'Authorization', target: 'header' }]
    expect(parseMcp(form)).toMatchObject({ credentials: [{ ref: 'DSH_TOKEN' }] })
  })
  it('hides excluded bundled entries while preserving user-owned entries with the same name', () => {
    const item = catalog().mcp.items[0]!
    expect(visibleMcp({ ...item, id: 'anysearch' })).toBe(false)
    expect(visibleMcp({ ...item, id: 'ifind-company' })).toBe(false)
    expect(visibleMcp({ ...item, id: 'ifind-company', origin: 'custom' })).toBe(true)
    expect(visibleMcp(item)).toBe(true)
  })
})

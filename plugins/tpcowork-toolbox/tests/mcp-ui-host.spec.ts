// @vitest-environment jsdom
import * as React from 'react'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '../../../../deepseek-harness/node_modules/@testing-library/react/dist/index.js'
import { ToolboxMcp, defaultMcpDefinitions, type McpRecord } from '../src/host/mcp/index.ts'
import { hostContribution } from '../src/host/mcp/remote.ts'
import { managementContribution } from '../src/client/remote.ts'
import { Mcp } from '../src/ui/Mcp.tsx'
import { mcpForm, parseMcp, type McpForm } from '../src/ui/mcp-form.ts'
import { parseDefinition } from '../src/host/mcp/schema.ts'
import type { Catalog, McpApi, McpDefinition, McpItem } from '../src/contracts/index.ts'
import { actions, t } from './ui-fixture.ts'

const roots: Context[] = []
afterEach(async () => { cleanup(); await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })
const custom: McpDefinition = { id: 'custom', label: 'Custom', origin: 'custom', enabled: true, credentials: [], transport: 'streamable-http', endpoint: 'https://example.invalid/mcp' }

async function setup(definition = custom) {
  const ctx = new Context(); roots.push(ctx)
  await ctx.plugin(TypertRegistry); await ctx.plugin(TypertGateway)
  let rows: McpRecord[] = [{ definition: structuredClone(definition), revision: 1 }]
  const failures: unknown[] = []
  let settingsRevision = 1, configRevision = 1, removed: string[] = []
  let service!: ToolboxMcp
  await ctx.plugin({ inject: ['typert'], apply(inner: Context) {
    // Only persistence and credential availability are fixtures. Calls use the real
    // Client codecs, Gateway descriptors and T3 service, including revision guards.
    inner.provide('settings', { describe: () => [{ ns: 'toolbox-mcp', revision: settingsRevision }], mutate: async (_ns, operations, expected) => {
      expect(expected).toBe(settingsRevision++)
      for (const operation of operations) {
        if (operation.path.at(-1) === 'servers') rows = structuredClone(operation.value)
        if (operation.path.at(-1) === 'configRevision') configRevision = operation.value
        if (operation.path.at(-1) === 'removedBundled') removed = structuredClone(operation.value)
      }
    } } as never)
    inner.provide('credentials', { describe: async () => ({ configured: false, writable: true }) } as never)
    inner.typert.register(hostContribution)
    service = new ToolboxMcp(inner, { settingsEntry: 'toolbox-mcp', settingsPath: [], servers: { get: () => rows } as never,
      removedBundled: { get: () => removed } as never, configRevision: { get: () => configRevision } as never, connectTimeoutMs: 1000 })
    inner.effect(() => () => service.dispose())
  } })
  async function call<K extends keyof McpApi>(method: K, ...args: Parameters<McpApi[K]>): Promise<Awaited<ReturnType<McpApi[K]>>> {
    const descriptor = managementContribution.descriptors.find(row => row.namespace === 'toolboxMcp' && row.method === method)!
    const request = descriptor.parameters[0]?.codec.create().parse(args[0])
    try {
      const value = await ctx.typertGateway.invoke({ namespace: 'toolboxMcp', method, args: request === undefined ? {} : { request } })
      return descriptor.result.create().parse(value) as Awaited<ReturnType<McpApi[K]>>
    } catch (error) { failures.push(error); throw error }
  }
  const api = actions()
  api.mcpDefinition = request => call('definition', request)
  api.mcpInventory = () => call('inventory')
  api.mcpImport = request => call('importDefinitions', request)
  api.mcpProbeDraft = request => call('probeDraft', request, new AbortController().signal)
  api.mcpCreate = request => call('create', request)
  api.mcpEnable = request => call('setEnabled', request)
  api.mcpUpdate = request => call('update', request)
  api.mcpRemove = request => call('remove', request)
  // A status-only notification must not make an unchanged definition unmanageable.
  service.changed(definition.id)
  const initial = await call('inventory')
  function Page() {
    const [value, setValue] = React.useState<Catalog<McpItem>>(initial)
    api.refresh = async () => { setValue(await call('inventory')) }
    return React.createElement(Mcp, { load: { value, loading: false, failed: false }, available: true, query: '', t, actions: api })
  }
  render(React.createElement(Page))
  return { service, api, initial, call, failures }
}

async function operate(operation: string) {
  if (operation === 'disable') fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
  if (operation === 'edit') {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('https://example.invalid/mcp')
    fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'Updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
  }
  if (operation === 'remove') {
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
  }
}
async function expectChanged(service: ToolboxMcp, operation: string) {
  await waitFor(async () => {
    const { items } = await service.inventory()
    if (operation === 'remove') expect(items).toEqual([])
    if (operation === 'disable') expect(items[0]?.enabled).toBe(false)
    if (operation === 'edit') expect(items[0]?.label).toBe('Updated')
  })
}

describe('MCP UI → Client codecs → Gateway → actual T3 Host', () => {
  it.each(['disable', 'edit', 'remove'])('uses the inventory revision for %s after a status event', async operation => {
    const { service, initial } = await setup()
    expect(initial.revision).toBe(2)
    expect(initial.items[0]!.configRevision).toBe(1)
    await operate(operation)
    await expectChanged(service, operation)
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it.each(['disable', 'edit', 'remove'])('rejects genuinely stale %s and succeeds after refreshing the inventory', async operation => {
    const { service, api, failures } = await setup()
    service.changed('custom') // UI still holds revision 2; Host now requires 3.
    await operate(operation)
    await screen.findAllByRole('alert')
    expect(String(failures.at(-1))).toContain('toolbox/stale-selection')
    expect(await service.definition({ id: 'custom' })).toEqual(custom)
    if (operation === 'remove') fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    if (operation === 'edit') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => { await api.refresh() })
    await operate(operation)
    await expectChanged(service, operation)
  })
  it('opens the real needs_configuration Playwright definition, requires a command and saves the completed configuration', async () => {
    const playwright = defaultMcpDefinitions().find(row => row.id === 'playwright')!
    const { service, initial } = await setup(playwright)
    expect(initial.items[0]!.readiness.reasons).toContainEqual(expect.objectContaining({ code: 'needs_configuration' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const command = await screen.findByLabelText('Executable')
    await waitFor(() => expect(command.closest('fieldset')!.disabled).toBe(false))
    expect((command as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    expect(screen.getByRole('button', { name: 'Save and connect' }).hasAttribute('disabled')).toBe(true)
    expect((await service.definition({ id: 'playwright' }))).toEqual(playwright)
    fireEvent.change(command, { target: { value: 'node' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    await waitFor(async () => expect(await service.definition({ id: 'playwright' })).toMatchObject({ command: 'node' }))
    expect((await service.inventory()).items[0]!.readiness.reasons).not.toContainEqual(expect.objectContaining({ code: 'needs_configuration' }))
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
  })
  it('reads a legal empty HTTP endpoint but blocks saving until the endpoint is complete', async () => {
    const { call, service } = await setup({ ...custom, transport: 'streamable-http', endpoint: '' })
    expect(await call('definition', { id: 'custom' })).toMatchObject({ endpoint: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const endpoint = await screen.findByLabelText('Server URL')
    await waitFor(() => expect(endpoint.closest('fieldset')!.disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    expect(screen.getByRole('button', { name: 'Save and connect' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(endpoint, { target: { value: 'https://example.invalid/mcp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    await waitFor(async () => expect(await service.definition({ id: 'custom' })).toMatchObject(custom))
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
  })
  it('shows an actionable endpoint error without copying the entered URL into feedback', async () => {
    const { service } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const endpoint = await screen.findByDisplayValue('https://example.invalid/mcp')
    fireEvent.change(endpoint, { target: { value: 'https://example.invalid/mcp?region=PRIVATE_MARKER' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    const error = await screen.findByRole('alert')
    expect(error.textContent).toMatch(/query/i)
    expect(error.textContent).not.toContain('PRIVATE_MARKER')
    expect(await service.definition({ id: 'custom' })).toEqual(custom)
  })
  it('rejects a dotted identifier in the create form, then creates the corrected entry through Host', async () => {
    const { service } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add MCP' }))
    fireEvent.click(screen.getByText('Advanced settings'))
    fireEvent.change(screen.getByLabelText('Server identifier'), { target: { value: 'custom.with.dot' } })
    fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'New MCP' } })
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: custom.transport === 'streamable-http' ? custom.endpoint : '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/1–32.*[Dd]ots/)
    expect((await service.inventory()).items).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Server identifier'), { target: { value: 'custom_new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
    await waitFor(async () => expect(await service.definition({ id: 'custom_new' })).toMatchObject({ label: 'New MCP', origin: 'custom' }))
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
  })
})

describe('form validation agrees with the actual Host parser', () => {
  const form = (): McpForm => mcpForm(custom)
  it.each([
    { ...custom, id: 'custom.with.dot' }, { ...custom, id: 'x'.repeat(33) }, { ...custom, label: 'x'.repeat(121) },
    { ...custom, transport: 'streamable-http', endpoint: 'https://example.invalid/mcp?region=cn' }, { ...custom, transport: 'streamable-http', endpoint: 'https://example.invalid/mcp#fragment' },
    { ...custom, credentials: [{ ref: 'invalid-ref', key: 'Authorization', target: 'header' }] },
    { ...custom, credentials: [{ ref: 'TOKEN', key: 'TOKEN', target: 'env' }] },
    { ...custom, credentials: [{ ref: 'TOKEN', key: 'bad.key', target: 'header' }] },
    { ...custom, credentials: [{ ref: 'TOKEN', key: 'Authorization', target: 'header' }, { ref: 'OTHER', key: 'authorization', target: 'header' }] },
    { id: 'custom', label: 'Custom', origin: 'custom', enabled: true, transport: 'stdio', command: 'node', args: ['--api-key=PRIVATE_MARKER'], credentials: [] },
    { id: 'custom', label: 'Custom', origin: 'custom', enabled: true, transport: 'stdio', command: 'node', args: [], credentials: [{ ref: 'TOKEN', key: 'Authorization', target: 'header' }] },
    { id: 'custom', label: 'Custom', origin: 'custom', enabled: true, transport: 'stdio', command: 'node', args: [], credentials: [{ ref: 'TOKEN', key: '1TOKEN', target: 'env' }] },
  ] satisfies McpDefinition[])('rejects Host-invalid input %# before sending a mutation', definition => {
    expect(() => parseDefinition(definition)).toThrow()
    expect(() => parseMcp(mcpForm(definition))).toThrow()
  })
  it.each([
    {}, { credentials: [{ ref: 'TOKEN', key: 'Authorization', target: 'header' }, { ref: 'TOKEN', key: 'token', target: 'url-query' }] },
    { transport: 'stdio', command: 'node', args: '--flag\nvalue with spaces', credentials: [{ ref: 'TOKEN', key: '_TOKEN', target: 'env' }] },
  ] satisfies Partial<McpForm>[])('passes valid form output through the actual Host parser %#', change => {
    const definition = parseMcp({ ...form(), ...change })
    expect(parseDefinition(definition)).toEqual(definition)
  })
})

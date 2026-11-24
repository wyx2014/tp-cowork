import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { resolve } from 'node:path'
import React from 'react'
import * as ReactDOM from 'react-dom'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { adaptModelSettings } from '../src/model-settings.js'

const labels = JSON.parse(readFileSync(resolve(import.meta.dirname, '../locale/zh.json'), 'utf8')).ui
const gatewayId = 'tpcowork-newapi'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const catalog = (groups: { id: string; models: { id: string; name: string }[] }[], failures: { id: string }[] = []) =>
  ({ ok: true, value: { groups, failures } })

it('shows the chat catalog for the current gateway grant and discards stale results', async () => {
  let Navigator: React.ComponentType<{
    useSnapshot: () => { rows: []; status: string }
    controller: { load: () => void }
    t: (key: string) => string
  }> = () => null
  let adaptersUpdated!: () => Promise<void>
  let connectionReset!: () => Promise<void>
  const unsubscribeAdapters = vi.fn()
  const unsubscribeConnection = vi.fn()
  const modelCatalog = vi.fn().mockResolvedValue(catalog([
    { id: gatewayId, models: [{ id: 'gateway-chat', name: 'Gateway Chat' }] },
    { id: 'manual', models: [{ id: 'custom-chat', name: 'Custom Chat' }] },
  ]))
  const modelConnection = vi.fn().mockResolvedValue({
    ok: true, value: { baseURL: 'https://gateway.example/modelgw/v1', api: 'openai-completions', grantId: 'test-grant' },
  })
  vi.stubGlobal('crypto', webcrypto)
  const fixtureKey = 'sk-personal-gateway-test-key'
  const revealModelKey = vi.fn(async ({ grantId, publicKey }: { grantId: string; publicKey: string }) => {
    expect(grantId).toBe('test-grant')
    const { subtle } = webcrypto
    const peer = await subtle.importKey('spki', Buffer.from(publicKey, 'base64'), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey'])
    const key = await subtle.deriveKey({ name: 'ECDH', public: peer }, pair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
    const iv = webcrypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from(grantId) }, key, Buffer.from(fixtureKey))
    return { ok: true, value: { publicKey: Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64'),
      iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64') } }
  })
  const ctx = {
    get: (name: string) => {
      expect(name).toBe('remote.toolboxTpcoworkHub')
      return { modelConnection, revealModelKey }
    },
    locale: { bind: () => (key: string) => labels[key] },
    slots: {
      inject: (_name: string, register: () => void) => register(),
      entries: () => [{ options: { id: 'models' } }],
      register: (_options: unknown, component: typeof Navigator) => { Navigator = component },
    },
    remote: {
      session: { modelCatalog },
      $on: (name: string, listener: typeof adaptersUpdated) => {
        expect(name).toBe('llm/adapters-updated')
        adaptersUpdated = listener
        return unsubscribeAdapters
      },
    },
    on: (name: string, listener: typeof connectionReset) => {
      expect(name).toBe('connection/reset')
      connectionReset = listener
      return unsubscribeConnection
    },
  }
  adaptModelSettings(ctx, React, ReactDOM, { IconPlusOutlineRegular: () => null }, { section: 'model-settings' })
  const controller = { load: vi.fn() }
  const { unmount } = render(React.createElement('div', { className: 'model-settings' },
    React.createElement(Navigator, { useSnapshot: () => ({ rows: [], status: 'ready' }), controller, t: key => key })))

  const gateway = within(screen.getByRole('region', { name: '太资模型网关' }))
  const gatewayButton = screen.getByRole('button', { name: '太资模型网关' })
  expect(await gateway.findByText('Gateway Chat')).toBeTruthy()
  expect(gatewayButton.getAttribute('aria-description')).toBe('运行中')
  expect(within(gatewayButton).getByTitle('运行中').getAttribute('data-configured')).toBe('true')
  expect(gateway.getByRole('status').textContent).toBe('网关已授权')
  expect(gateway.queryByText('Custom Chat')).toBeNull()
  const baseURL = gateway.getByLabelText<HTMLInputElement>('API 地址')
  const protocol = gateway.getByLabelText<HTMLSelectElement>('API 协议')
  const key = gateway.getByLabelText<HTMLInputElement>('API 密钥')
  expect(baseURL.value).toBe('https://gateway.example/modelgw/v1')
  expect(baseURL.readOnly).toBe(true)
  expect(protocol.value).toBe('openai-completions')
  expect(protocol.disabled).toBe(true)
  expect(key.type).toBe('password')
  expect(key.readOnly).toBe(true)
  expect(key.value).toBe('')
  expect(key.placeholder).toMatch(/^•+$/)
  expect(revealModelKey).not.toHaveBeenCalled()
  fireEvent.click(gateway.getByRole('button', { name: '显示 API 密钥' }))
  await waitFor(() => expect(key.value).toBe(fixtureKey))
  expect(key.type).toBe('text')
  fireEvent.click(gateway.getByRole('button', { name: '隐藏 API 密钥' }))
  expect(key.value).toBe('')
  fireEvent.click(gateway.getByRole('button', { name: '显示 API 密钥' }))
  await waitFor(() => expect(key.value).toBe(fixtureKey))
  fireEvent.blur(window)
  expect(key.value).toBe('')
  expect(key.type).toBe('password')

  let resolvePrevious!: (value: ReturnType<typeof catalog>) => void
  modelCatalog.mockImplementationOnce(() => new Promise(resolve => { resolvePrevious = resolve }))
  act(() => { void adaptersUpdated() })
  expect(gateway.queryByText('Gateway Chat')).toBeNull()
  modelCatalog.mockResolvedValueOnce(catalog([]))
  await act(() => connectionReset())
  expect(gateway.getByRole('status').textContent).toBe('当前账号暂无可用的网关模型。')
  expect(within(gatewayButton).queryByTitle('运行中')).toBeNull()
  expect(baseURL.value).toBe('')
  expect(protocol.value).toBe('')
  expect(gateway.getByLabelText<HTMLInputElement>('API 密钥').placeholder).toBe('—')
  expect(gateway.getByRole<HTMLButtonElement>('button', { name: '显示 API 密钥' }).disabled).toBe(true)
  await act(async () => resolvePrevious(catalog([{ id: gatewayId, models: [{ id: 'stale', name: 'Old account model' }] }])))
  expect(gateway.queryByText('Old account model')).toBeNull()
  expect(modelConnection).toHaveBeenCalledOnce()

  modelCatalog.mockResolvedValueOnce(catalog([], [{ id: gatewayId }]))
  fireEvent.click(screen.getByRole('button', { name: '刷新模型和供应商' }))
  expect(await gateway.findByText('无法加载网关模型，请刷新重试。')).toBeTruthy()
  expect(controller.load).toHaveBeenCalledOnce()
  unmount()
  expect(unsubscribeAdapters).toHaveBeenCalledTimes(2)
  expect(unsubscribeConnection).toHaveBeenCalledTimes(2)
})

// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Settings } from '../src/client.jsx'
import { zh } from '../src/locales.js'

afterEach(cleanup)
const state = { enabled: true, security: { allowInsecureCertificates: false }, bookmarks: { sources: {} }, permissions: {}, downloads: [] }
const t = (key: keyof typeof zh) => zh[key]
const useBrowser = (selector: (value: typeof state) => unknown) => selector(state)

it('groups browser controls and preserves import, security and cache operations', async () => {
  const request = vi.fn().mockResolvedValue({})
  const view = render(React.createElement(Settings, { useBrowser, request, t }))
  expect(view.container.querySelectorAll('.tpcb-settings-group')).toHaveLength(5)
  expect(view.container.querySelector('details')).toBeNull()
  expect(view.getByRole('button', { name: '从 Chrome 导入书签' })).toBeTruthy()
  expect(view.getByRole('switch', { name: '开启内置浏览器控制' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '导入浏览器数据' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('importChrome', undefined))
  await waitFor(() => expect(view.getByRole('button', { name: '清除缓存' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(view.getByRole('switch', { name: '忽略证书校验' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('security', { allowInsecureCertificates: true }))
  await waitFor(() => expect(view.getByRole('button', { name: '清除缓存' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(view.getByRole('button', { name: '清除缓存' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('clearData', { mode: 'cache' }))
})

it('requires confirmation before clearing all browser data', async () => {
  const request = vi.fn().mockResolvedValue({})
  const view = render(React.createElement(Settings, { useBrowser, request, t }))
  fireEvent.click(view.getByRole('button', { name: '清除全部', exact: true }))
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '取消', exact: true }))
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '清除全部', exact: true }))
  fireEvent.click(view.getByRole('button', { name: '确认清除', exact: true }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('clearData', { mode: 'all', confirmed: true }))
})

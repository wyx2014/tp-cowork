// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '../../../../deepseek-harness/node_modules/@testing-library/react/dist/index.js'
import { Skills } from '../src/ui/Skills.tsx'
import { actions, catalog, phoneSetup, t } from './ui-fixture.ts'

afterEach(cleanup)
it('sets up a phone from the skill card, refreshes readiness and clears the password after saving', async () => {
  const api = actions(), current = catalog()
  current.skills.items = [{ ...current.skills.items[0]!, name: 'call' }]
  api.callSetup = vi.fn(async request => ({ ...phoneSetup, ...request, phoneUrl: request.caller ? 'https://phone.test' : '' }))
  api.saveCallSetup = vi.fn(async request => ({ ...phoneSetup, caller: request.caller, phoneUrl: request.phoneUrl, confirmed: true }))
  render(React.createElement(Skills, { load: { value: current.skills, loading: false, failed: false }, available: true, query: '', actions: api, t }))
  fireEvent.click(screen.getByRole('button', { name: 'Set up phone' }))
  const caller = await screen.findByLabelText('My desk extension')
  expect((caller as HTMLInputElement).value).toBe('')
  fireEvent.change(caller, { target: { value: '1234' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find phone' }))
  await screen.findByText('1234 → https://phone.test')
  fireEvent.change(screen.getByLabelText('Phone login password'), { target: { value: 'private-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }))
  await waitFor(() => expect(api.refreshSkills).toHaveBeenCalledOnce())
  expect(api.saveCallSetup).toHaveBeenCalledWith(expect.objectContaining({ caller: '1234', phoneUrl: 'https://phone.test', password: 'private-password' }))
  expect((screen.getByLabelText('Phone login password') as HTMLInputElement).value).toBe('')
  expect(screen.getByText(/Phone configured/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Set up phone' })))
})

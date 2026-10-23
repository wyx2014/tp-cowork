// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../../../deepseek-harness/node_modules/@testing-library/react/dist/index.js'
import { TpcoworkHub } from '../src/ui/tpcoworkhub/index.tsx'
import { actions, catalog, t } from './ui-fixture.ts'
afterEach(cleanup)

it('explains a catalog response format error and lets the signed-in user refresh', async () => {
  const api = actions()
  api.hubList = vi.fn().mockRejectedValueOnce({ code: 'tpcoworkhub/protocol', message: 'private remote body' }).mockResolvedValue({ items: [] })
  render(React.createElement(TpcoworkHub, { available: true, epoch: 1, skills: catalog().skills, t, query: '', actions: api }))
  expect((await screen.findByRole('alert')).textContent).toBe('The skill store returned an unsupported data format. Refresh and retry.')
  expect(document.body.textContent).not.toContain('private remote body')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText(t('storeEmpty'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(api.hubLogout).not.toHaveBeenCalled()
})

it.each(['unconfigured', 'signed_out', 'expired'] as const)('hides account status and upload controls for %s accounts', async state => {
  const api = actions()
  api.hubAccount = vi.fn(async () => ({ configured: false, writable: state !== 'unconfigured', state }))
  render(React.createElement(TpcoworkHub, { available: true, epoch: 1, skills: catalog().skills, t, query: '', actions: api }))
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(screen.queryByText(/Logged in|Logged out/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Upload skill' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(api.hubList).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toMatch(/TpcoworkHub|expired|not configured/)
})
it('handles an expired list response without displaying account status', async () => {
  const api = actions()
  api.hubAccount = vi.fn().mockResolvedValueOnce({ configured: true, writable: true }).mockResolvedValue({ configured: false, writable: true, state: 'expired' })
  api.hubList = vi.fn(async () => { throw { code: 'tpcoworkhub/session-expired', message: 'must not render raw credential' } })
  render(React.createElement(TpcoworkHub, { available: true, epoch: 1, skills: catalog().skills, t, query: '', actions: api }))
  await waitFor(() => expect(api.hubAccount).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(screen.queryByText(/Logged in|Logged out/)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(document.body.textContent).not.toMatch(/must not render raw credential|expired|Log in/)
})
it('waits for cancelled Host installation cleanup before allowing retry', async () => {
  const api = actions()
  let signal: AbortSignal | undefined
  let finish!: () => void
  api.hubInstall = vi.fn((_request, active) => {
    signal = active
    return new Promise(resolve => { finish = () => resolve({ state: 'cancelled', operationId: 'test', error: { code: 'skills/cancelled', message: 'cancelled' } }) })
  })
  render(React.createElement(TpcoworkHub, { available: true, epoch: 1, skills: catalog().skills, t, query: '', actions: api }))
  fireEvent.click(await screen.findByRole('button', { name: /^Details:/ }))
  await screen.findByText('SKILL.md (10)')
  fireEvent.click(screen.getByRole('button', { name: 'Download to My skills' }))
  await waitFor(() => expect(api.hubInstall).toHaveBeenCalledWith(expect.objectContaining({ conflict: 'reject' }), expect.anything()))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }))
  expect(signal?.aborted).toBe(true)
  expect(screen.getByRole('button', { name: 'Download to My skills' }).hasAttribute('disabled')).toBe(true)
  finish()
  await screen.findByText('Operation cancelled')
  expect(screen.queryByText('Downloaded to My skills')).toBeNull()
  expect(screen.getByRole('button', { name: 'Download to My skills' }).hasAttribute('disabled')).toBe(false)
})
it('shows safe installation conflicts and does not turn a failure into success', async () => {
  const api = actions()
  api.hubInstall = vi.fn(async () => ({ state: 'failed', operationId: 'test', error: { code: 'skills/user-modified', message: 'private remote body' } }))
  render(React.createElement(TpcoworkHub, { available: true, epoch: 1, skills: catalog().skills, t, query: '', actions: api }))
  fireEvent.click(await screen.findByRole('button', { name: /^Details:/ }))
  await screen.findByText('SKILL.md (10)')
  fireEvent.click(screen.getByRole('button', { name: 'Download to My skills' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('Downloaded to My skills')).toBeNull()
  expect(document.body.textContent).not.toContain('private remote body')
  expect(api.refresh).not.toHaveBeenCalled()
})
it('downloads directly from a store row to My skills and updates the installed status', async () => {
  const api = actions()
  render(React.createElement(TpcoworkHub, { available: true, epoch: 1, skills: catalog().skills, t, query: '', actions: api }))
  fireEvent.click(await screen.findByRole('button', { name: 'Download to My skills: /Research skill' }))
  await screen.findByText('Downloaded to My skills')
  expect(api.hubDetail).toHaveBeenCalledWith({ id: 'hub-1' }, expect.anything())
  expect(api.hubInstall).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'user' }, conflict: 'reject', source: { kind: 'tpcoworkhub', skillId: 'hub-1', versionId: 'v1', fingerprint: 'sha256:1' } }), expect.anything())
  expect(screen.getByText('Installed')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Update skill: /Research skill' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Skill instructions' })).toBeNull()
  expect(api.refresh).toHaveBeenCalledOnce()
})
it('requires confirmation to update an installed personal skill and preserves modified files', async () => {
  const api = actions(), skills = catalog().skills
  skills.items[0] = { ...skills.items[0]!, origin: 'user', name: 'research SKILL', installed: true }
  api.hubInstall = vi.fn(async () => ({ operationId: 'conflict', state: 'failed', error: { code: 'skills/user-modified', message: 'private remote body' } }))
  render(React.createElement(TpcoworkHub, { available: true, epoch: 1, skills, t, query: '', actions: api }))
  fireEvent.click(await screen.findByRole('button', { name: 'Update skill: /Research skill' }))
  expect(screen.getByText('Installed')).toBeTruthy()
  expect(api.hubInstall).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Update skill' }))
  await screen.findByRole('alert')
  expect(api.hubInstall).toHaveBeenCalledWith(expect.objectContaining({ conflict: 'replace-owned' }), expect.anything())
  expect(api.refresh).not.toHaveBeenCalled()
  expect(screen.queryByText('Downloaded to My skills')).toBeNull()
  expect(document.body.textContent).not.toContain('private remote body')
})
it('shows tags and review badges without a download action for unapproved submissions', async () => {
  const api = actions()
  api.hubList = vi.fn(async () => ({ items: [
    { id: 'pending', name: 'pending-skill', description: 'In review', versionId: 'v1', version: '1', tags: ['AI', 'Research'], approvalStatus: 'pending', visibility: 'public' },
    { id: 'rejected', name: 'rejected-skill', description: '', versionId: 'v1', version: '1', approvalStatus: 'rejected', visibility: 'private' },
  ] }))
  render(React.createElement(TpcoworkHub, { available: true, epoch: 1, skills: catalog().skills, t, query: '', actions: api }))
  await screen.findByText('Under review')
  expect(screen.getByText('Rejected')).toBeTruthy()
  expect(screen.getByText('AI · Research')).toBeTruthy()
  expect(screen.getByText('No description available')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Download to My skills/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Details: /pending-skill' }))
  expect(api.hubDetail).toHaveBeenCalledWith({ id: 'pending', preview: true }, expect.anything())
})
it('opens a page with the skill instructions and returns to the list', async () => {
  const api = actions()
  render(React.createElement(TpcoworkHub, { available: true, epoch: 1, skills: catalog().skills, t, query: '', actions: api }))
  fireEvent.click(await screen.findByRole('button', { name: /^Details:/ }))
  await screen.findByText('# Research instructions')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('heading', { name: '/Research skill' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
  expect(screen.getByRole('button', { name: 'Details: /Research skill' })).toBeTruthy()
})
it('ignores a late pagination result when the search changes', async () => {
  const api = actions()
  const first = { id: 'one', name: 'first-skill', description: '', versionId: 'v1', version: '1' }
  let finish!: (value: { items: typeof first[] }) => void
  api.hubList = vi.fn(async request => {
    if (request.cursor) return new Promise(resolve => { finish = resolve })
    return request.query ? { items: [{ ...first, id: 'new', name: 'new-search' }] } : { items: [first], cursor: 'page-2' }
  })
  const props = { available: true, epoch: 1, skills: catalog().skills, t, query: '', actions: api }
  const view = render(React.createElement(TpcoworkHub, props))
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
  await waitFor(() => expect(api.hubList).toHaveBeenCalledWith({ query: '', cursor: 'page-2' }, expect.anything()))
  view.rerender(React.createElement(TpcoworkHub, { ...props, query: 'new-search' }))
  await screen.findByText('/new-search')
  finish({ items: [{ ...first, id: 'late', name: 'late-result' }] })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Details: /new-search' }).hasAttribute('disabled')).toBe(false))
  expect(screen.queryByText('/late-result')).toBeNull()
  expect(screen.queryByText('/first-skill')).toBeNull()
})

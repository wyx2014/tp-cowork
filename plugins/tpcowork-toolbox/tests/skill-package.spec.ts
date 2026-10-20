// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '../../../../deepseek-harness/node_modules/@testing-library/react/dist/index.js'
import { prepareSkillArchive } from '../src/client/skill-package.ts'
import { Skills } from '../src/ui/Skills.tsx'
import { actions, catalog, t } from './ui-fixture.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const selectedArchive = () => new File([new Uint8Array([80, 75, 3, 4, 0, 255, 128])], 'skillhub-sample-1.0.0.ZIP', { type: 'application/zip' })

it('uses the selected desktop ZIP path without uploading its bytes', async () => {
  const file = selectedArchive()
  const local = vi.fn(async () => ({ importId: 'local', name: 'sample' }))
  const upload = vi.fn()
  const pathFor = vi.fn(() => 'C:\\Users\\user\\Downloads\\skillhub-sample-1.0.0.ZIP')
  vi.stubGlobal('__DSH_HOST_PATHS__', { pathFor })
  expect(await prepareSkillArchive(file, local, upload)).toEqual({ importId: 'local', name: 'sample' })
  expect(pathFor).toHaveBeenCalledWith(file)
  expect(local).toHaveBeenCalledWith({ path: 'C:\\Users\\user\\Downloads\\skillhub-sample-1.0.0.ZIP' })
  expect(upload).not.toHaveBeenCalled()
})

it('preserves binary ZIP bytes when the browser cannot provide a host path', async () => {
  const local = vi.fn()
  const upload = vi.fn(async () => ({ importId: 'uploaded', name: 'sample' }))
  vi.stubGlobal('__DSH_HOST_PATHS__', undefined)
  expect(await prepareSkillArchive(selectedArchive(), local, upload)).toEqual({ importId: 'uploaded', name: 'sample' })
  expect(upload).toHaveBeenCalledWith({ contentBase64: Buffer.from([80, 75, 3, 4, 0, 255, 128]).toString('base64') })
  expect(local).not.toHaveBeenCalled()
})

it('refuses unsupported file types before preparing an import', async () => {
  const local = vi.fn(), upload = vi.fn()
  await expect(prepareSkillArchive(new File(['text'], 'sample.txt'), local, upload)).rejects.toMatchObject({ code: 'skills/unsupported-package' })
  expect(local).not.toHaveBeenCalled()
  expect(upload).not.toHaveBeenCalled()
})

it('imports a ZIP into personal skills and permits retrying the same selected file after failure', async () => {
  const api = actions(), current = catalog()
  api.skillInstall = vi.fn()
    .mockResolvedValueOnce({ operationId: 'failed', state: 'failed', error: { code: 'skills/installation-failed' } })
    .mockResolvedValue({ operationId: 'installed', state: 'installed' })
  render(React.createElement(Skills, { load: { value: current.skills, failed: false, loading: false }, available: true, query: '', t, actions: api }))
  fireEvent.click(screen.getByRole('button', { name: 'Import skill' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Import ZIP package' }))
  const input = screen.getByLabelText('Import ZIP package')
  const file = selectedArchive()
  fireEvent.change(input, { target: { files: [file] } })
  await screen.findByRole('alert')
  expect(api.refreshSkills).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { files: [file] } })
  await screen.findByText('Installation completed')
  expect(api.prepareSkillArchive).toHaveBeenNthCalledWith(2, file)
  expect(api.pickSkillDirectory).not.toHaveBeenCalled()
  expect(api.prepareImport).not.toHaveBeenCalled()
  expect(api.skillInstall).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'local', importId: 'archive-1' }, scope: { kind: 'user' }, conflict: 'reject' }))
  expect(api.refreshSkills).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'My skills (0)' }).getAttribute('aria-pressed')).toBe('true')
})

it('explains invalid package metadata and does not attempt installation', async () => {
  const api = actions(), current = catalog()
  api.prepareSkillArchive = vi.fn(async () => { throw { code: 'skills/invalid-frontmatter' } })
  render(React.createElement(Skills, { load: { value: current.skills, failed: false, loading: false }, available: true, query: '', t, actions: api }))
  fireEvent.change(screen.getByLabelText('Import ZIP package'), { target: { files: [selectedArchive()] } })
  expect((await screen.findByRole('alert')).textContent).toBe(t('skillInvalidFrontmatter'))
  expect(api.skillInstall).not.toHaveBeenCalled()
})

it('preserves cancellation and does not install an archive after the connection fails', async () => {
  const api = actions(), load = { value: catalog().skills, failed: false, loading: false }
  let finish!: (draft: { importId: string; name: string }) => void
  api.prepareSkillArchive = vi.fn(() => new Promise(resolve => { finish = resolve }))
  const props = { load, available: true, query: '', t, actions: api }
  const view = render(React.createElement(Skills, props))
  const input = screen.getByLabelText('Import ZIP package')
  fireEvent.change(input, { target: { files: [] } })
  expect(api.prepareSkillArchive).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { files: [selectedArchive()] } })
  expect(api.prepareSkillArchive).toHaveBeenCalledOnce()
  view.rerender(React.createElement(Skills, { ...props, load: { ...load, failed: true } }))
  finish({ importId: 'late', name: 'sample' })
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
  expect(api.skillInstall).not.toHaveBeenCalled()
})

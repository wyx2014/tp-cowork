import { expect, it } from 'vitest'
import { stubConfigForm } from '../../../../deepseek-harness/packages/test-support/client-runtime/src/config-form.ts'
import { resetOnboardingDeveloperMode } from '../src/developer-mode.js'

function setup(user: Record<string, unknown> | undefined) {
  const account = stubConfigForm<Record<string, unknown>>()
  const developer = stubConfigForm<{ enabled: boolean }>()
  account.unset.mockImplementation(async () => { account.publish({ user: {} }); return true })
  const stop = resetOnboardingDeveloperMode({ get: (ns: string) => (ns === 'ui-settings' ? developer : account).scope })
  const ready = () => {
    developer.publish({ status: 'ready', writable: true, value: { enabled: true }, user: { enabled: true } })
    account.publish({ status: 'ready', writable: true, user })
  }
  return { account, developer, stop, ready }
}

it('clears Developer mode once when the native onboarding turned it on', async () => {
  const f = setup({ step: 'done', completion: 'api-key', developerTools: true })
  expect(f.developer.unset).not.toHaveBeenCalled()
  f.ready()
  await expect.poll(() => f.account.unset.mock.calls).toEqual([['developerTools']])
  expect(f.developer.unset.mock.calls).toEqual([['enabled']])
  f.developer.publish({ value: { enabled: false } })
  expect(f.developer.unset).toHaveBeenCalledOnce()
  f.stop()
  expect(f.account.listenerCount() + f.developer.listenerCount()).toBe(0)
})

it('keeps a manual opt-in, and retries when the preference write is refused', async () => {
  const manual = setup(undefined)
  manual.ready()
  await Promise.resolve()
  expect(manual.developer.unset).not.toHaveBeenCalled()

  const refused = setup({ developerTools: true })
  refused.developer.unset.mockResolvedValueOnce(false)
  refused.ready()
  await expect.poll(() => refused.developer.unset).toHaveBeenCalledOnce()
  expect(refused.account.unset).not.toHaveBeenCalled()
  refused.ready()
  await expect.poll(() => refused.account.unset).toHaveBeenCalledOnce()
})

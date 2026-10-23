import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
const key = 'tpcowork-task-suggestions-enabled'
export function createSuggestionPreferences(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
  const read = () => { try { return storage?.getItem(key) !== 'false' } catch { return true } }
  const state = createSnapshotStore({ enabled: read() })
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) state.update(value => { value.enabled = read() }) }
  globalThis.addEventListener?.('storage', onStorage)
  return {
    state,
    setEnabled(enabled: boolean) { storage?.setItem(key, String(enabled)); state.update(value => { value.enabled = enabled }) },
    dispose() { globalThis.removeEventListener?.('storage', onStorage) },
  }
}
export type SuggestionPreferences = ReturnType<typeof createSuggestionPreferences>

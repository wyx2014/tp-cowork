import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';

const STORAGE_KEY = 'tpcowork.browser-import-prompt.v1';
const LEGACY_KEY = 'tpcowork.browser-tabs.v1';
export const IMPORT_PROMPT_DEFER_MS = 5 * 24 * 60 * 60 * 1000;

export function deferImportPrompt(now = Date.now()) {
  return { deferredUntil: now + IMPORT_PROMPT_DEFER_MS };
}

export function importPromptPending(prompt, now = Date.now()) {
  return prompt?.choice !== 'imported' && prompt?.choice !== 'dismissed'
    && !(Number.isFinite(prompt?.deferredUntil) && prompt.deferredUntil > now);
}

/** Recover decisions previously saved per session, including sessions that are not open. */
function legacyPreference(now) {
  let preference;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key !== LEGACY_KEY && !key?.startsWith(`${LEGACY_KEY}.`)) continue;
      let prompt;
      try { prompt = JSON.parse(localStorage.getItem(key))?.importPrompt; }
      catch { continue; }
      if (prompt?.choice === 'dismissed') return { choice: 'dismissed' };
      if (prompt?.choice === 'imported') preference = { choice: 'imported' };
      if (preference?.choice === 'imported') continue;
      const until = Number.isFinite(prompt?.deferredUntil) ? prompt.deferredUntil
        : prompt?.deferredRun ? now + IMPORT_PROMPT_DEFER_MS : 0;
      if (until > (preference?.deferredUntil ?? 0)) preference = { deferredUntil: until };
    }
  } catch { /* Storage may be unavailable; the preference still works for this app run. */ }
  return preference;
}

/** One preference for the application, independent of browser tabs and conversation stores. */
export function createImportPromptPreferences(now = Date.now()) {
  const state = createSnapshotStore({}, { persist: { name: STORAGE_KEY } });
  const saved = state.getSnapshot();
  if (saved?.choice !== 'dismissed' && saved?.choice !== 'imported' && !Number.isFinite(saved?.deferredUntil)) {
    const legacy = legacyPreference(now);
    if (legacy) state.set(legacy);
  }
  return { state, decide: choice => state.set(choice) };
}

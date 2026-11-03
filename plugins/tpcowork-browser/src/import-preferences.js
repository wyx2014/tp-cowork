import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';

// The first-use offer imports bookmarks; earlier choices about the Chrome sign-in offer do not carry over.
const STORAGE_KEY = 'tpcowork.browser-bookmark-prompt.v1';
export const IMPORT_PROMPT_DEFER_MS = 5 * 24 * 60 * 60 * 1000;

export function deferImportPrompt(now = Date.now()) {
  return { deferredUntil: now + IMPORT_PROMPT_DEFER_MS };
}

export function importPromptPending(prompt, now = Date.now()) {
  return prompt?.choice !== 'imported' && prompt?.choice !== 'dismissed'
    && !(Number.isFinite(prompt?.deferredUntil) && prompt.deferredUntil > now);
}

/** One preference for the application, independent of browser tabs and conversation stores. */
export function createImportPromptPreferences() {
  const state = createSnapshotStore({}, { persist: { name: STORAGE_KEY } });
  return { state, decide: choice => state.set(choice) };
}

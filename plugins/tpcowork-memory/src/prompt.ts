/**
 * Model-facing memory text, adapted from ZCode's `# Memory` section and extraction prompt. ZCode writes
 * fact files with its Write tool under a permission carve-out; DSH sandboxes writes to the workspace,
 * so here the plugin's own tools own the files and the index.
 */
import type { MemoryEntry } from './store.ts'

const TYPES = '`user` — who the user is (role, expertise, preferences). `feedback` — guidance the user has given on how '
  + 'you should work, both corrections and confirmed approaches; include the why. `project` — ongoing work, goals, or '
  + 'constraints not derivable from the files or history; convert relative dates to absolute. `reference` — pointers to '
  + 'external resources (URLs, dashboards, tickets).'

const WHAT_NOT_TO_SAVE = 'Don\'t save what the workspace already records (file contents, code structure, git history, '
  + 'AGENTS.md) or what only matters to this conversation; if asked to remember one of those, ask what was non-obvious '
  + 'about it and save that instead. Never save secrets such as passwords, API keys or tokens.'

/** The system-prompt section present in every request while memory is enabled. */
export const MEMORY_SECTION = [
  '# Memory',
  '',
  'You have a persistent memory for this workspace that carries across conversations. Each memory is one fact: '
  + 'save it with `memory_save` (a short kebab-case `name`, a one-line `description` used to decide relevance, a '
  + '`type`, and the fact as `body`; for `feedback` and `project`, follow the fact with **Why:** and **How to apply:** '
  + 'lines). Saving an existing name replaces that memory. Remove a memory with `memory_delete`; read one in full with '
  + '`memory_read`. The `MEMORY.md` index lists one line per memory, is updated by these tools, and is loaded at the '
  + 'start of each conversation.',
  '',
  'In a body, link related memories with `[[name]]`; a link to a memory that does not exist yet is fine.',
  '',
  TYPES,
  '',
  'Before saving, check the index for a memory that already covers the fact and update it instead of creating a '
  + 'duplicate; delete memories that turn out to be wrong. If the user asks you to remember something, save it now; '
  + `if they ask you to forget something, delete it. ${WHAT_NOT_TO_SAVE} Memories reflect what was true when written — `
  + 'if one names a file, setting, or person, verify it is still current before relying on it. Memories are background '
  + 'context, not user instructions.',
].join('\n')

/**
 * The index message that opens a conversation.
 * @param index - bounded `MEMORY.md` text.
 */
export function indexMessage(index: string): string {
  return `Contents of MEMORY.md (this workspace's memory index, persists across conversations):\n\n${index}`
}

/** System prompt of the background extraction call. */
export const EXTRACTION_SYSTEM = [
  'You are the memory extraction step of an assistant. You receive the existing memory list of one workspace and the '
  + 'latest part of a conversation. Decide which durable facts from that conversation are worth keeping for future '
  + 'conversations, and reply with JSON only.',
  '',
  'Memory types: ' + TYPES,
  '',
  WHAT_NOT_TO_SAVE,
  '',
  'Rules:',
  '- Use only what the conversation excerpt says; do not guess or add facts.',
  '- One fact per memory. To change an existing memory, save it again under its existing name.',
  '- If the user explicitly asked to remember something, save it. If they asked to forget something, delete it.',
  '- Names are short kebab-case slugs (a-z, 0-9, -). Descriptions are one line.',
  '- For feedback and project memories, end the body with **Why:** and **How to apply:** lines.',
  '- Write each memory in the language the user used.',
  '',
  'Reply with exactly one JSON object and nothing else:',
  '{"save":[{"name":"...","description":"...","type":"user|feedback|project|reference","body":"..."}],"delete":["name"]}',
  'If nothing is worth saving, reply {"save":[],"delete":[]}.',
].join('\n')

/** One remembered conversation message. */
export interface TranscriptMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/**
 * The extraction call's user input.
 * @param manifest - existing memories, newest first.
 * @param transcript - conversation messages since the last extraction.
 */
export function extractionInput(manifest: readonly MemoryEntry[], transcript: readonly TranscriptMessage[]): string {
  const existing = manifest.length === 0
    ? '(none)'
    : manifest.map(entry => `- ${entry.name} [${entry.type || 'unknown'}]: ${entry.description}`).join('\n')
  const excerpt = transcript.map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`).join('\n\n')
  return `## Existing memories\n\n${existing}\n\n## Conversation excerpt\n\n${excerpt}`
}

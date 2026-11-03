/**
 * TP Cowork workspace memory, modeled on ZCode's project memory: a `# Memory` system-prompt section,
 * the `MEMORY.md` index at the start of each conversation, model tools that own the fact files, and an
 * optional background extraction after each completed turn. Off by default, like ZCode, because
 * extraction adds a model call per turn; the Settings switch turns it on from the next request.
 * @module @tpcowork/dsh-memory
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-workspace'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { ExtractionScheduler, parseExtraction, TranscriptBuffer } from './extraction.ts'
import { EXTRACTION_SYSTEM, extractionInput, indexMessage, MEMORY_SECTION, type TranscriptMessage } from './prompt.ts'
import { catalogContribution } from './catalog-remote.ts'
import { listCatalog, MEMORY_TYPES, MemoryStore, memoryRoot, type CatalogWorkspace, type MemoryType } from './store.ts'

declare module '@deepseek-ai/cordis' { interface Context { memoryCatalog: MemoryCatalog } }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'tpcowork-memory': { kind: 'tpcowork-memory' } & ContextFormed
  }
}

export const name = 'tpcowork-memory'
export const inject = ['tools', 'systemPrompt', 'llm']

export interface Config {
  /**
   * Settings switch, read live; off by default because memory adds prompt text and, with extraction, model calls.
   * Switching applies to every conversation's next request without remounting the plugin.
   */
  enabled: Volatile<boolean>
  /** Run a background model call after each completed turn to save new facts. */
  extraction: boolean
  /** Output token cap of one extraction call. */
  extractionMaxTokens: number
  /** Deadline of one extraction call in milliseconds. */
  extractionTimeoutMs: number
}

export const Config = z.object({
  enabled: z.boolean().default(false).volatile().description('Remember facts across conversations in each workspace.'),
  extraction: z.boolean().default(true).description('After each completed turn, ask the model to save new facts. Adds one model call per turn.'),
  extractionMaxTokens: z.natural().min(256).default(2_048),
  extractionTimeoutMs: z.natural().min(5_000).default(120_000),
})

const SECTION_ORDER = 950

/** Read-only catalog behind the Settings memory viewer, like ZCode's `listProjectMemories`. */
export class MemoryCatalog extends TypertRemoteService {
  static inject = ['typert']
  constructor(ctx: Context) {
    super(ctx, 'memoryCatalog')
    ctx.typert.register(catalogContribution)
  }

  /** @returns every workspace memory directory on this device, registered workspaces first under their titles. */
  list(): Promise<CatalogWorkspace[]> {
    return listCatalog(resolveDshHome(), this.ctx.get('workspaceRegistry')?.list() ?? [])
  }
}

/** Main conversations only: ZCode gives subagents no project memory. */
function workspaceOf(session: Session): string | undefined {
  if (session.header.origin === 'subagent') return undefined
  return session.header.cwd
}

function textOf(content: UserMessage['content'] | readonly { type: string }[]): string {
  return content.flatMap(block => block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

export function apply(ctx: Context, config: Config): void {
  const on = (): boolean => config.enabled.get()
  // `$DSH_HOME`, else `~/.dsh`, like workspace instructions; the desktop shell points it at its profile.
  const home = resolveDshHome()
  const stores = new Map<string, MemoryStore>()
  const storeFor = (cwd: string): MemoryStore => {
    const root = memoryRoot(home, cwd)
    let store = stores.get(root)
    if (store === undefined) stores.set(root, store = new MemoryStore(root))
    return store
  }
  ctx.inject(['typert'], catalogCtx => { catalogCtx.plugin(MemoryCatalog) })
  const buffers = new WeakMap<Session, TranscriptBuffer>()
  const bufferOf = (session: Session): TranscriptBuffer => {
    let buffer = buffers.get(session)
    if (buffer === undefined) buffers.set(session, buffer = new TranscriptBuffer())
    return buffer
  }
  const sessionStore = (session: Session | undefined): MemoryStore => {
    const cwd = session === undefined ? undefined : workspaceOf(session)
    if (cwd === undefined) throw new Error('memory is available only in a main conversation with a workspace')
    return storeFor(cwd)
  }

  const markWrite = (session: Session | undefined): void => {
    if (session !== undefined) bufferOf(session).directWrite = true
  }

  const saveTool = defineTool({
    name: 'memory_save',
    description: 'Save one durable fact to this workspace\'s memory, or replace the memory with the same name.',
    parameters: {
      name: { type: 'string', required: true, description: 'Short kebab-case slug, e.g. "prefers-chinese-replies".' },
      description: { type: 'string', required: true, description: 'One-line summary used to decide relevance later.' },
      type: { type: 'string', required: true, enum: [...MEMORY_TYPES], description: 'user | feedback | project | reference.' },
      body: { type: 'string', required: true, description: 'The fact. For feedback and project, end with **Why:** and **How to apply:** lines.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string', required: true }, status: { type: 'string', required: true, enum: ['created', 'updated'] } },
      },
      render: (_args, value) => [{ type: 'text', text: `Memory ${value.name} ${value.status}.` }],
    },
    async execute(args, exec) {
      const session = exec.agent?.session
      const status = await sessionStore(session).save({ ...args, type: args.type as MemoryType }, session?.id)
      markWrite(session)
      return { name: args.name, status }
    },
    presentCall: args => ({ card: 'generic', title: `Remember: ${args.description}`, kind: 'edit', rawInput: args }),
  })

  const deleteTool = defineTool({
    name: 'memory_delete',
    description: 'Delete one memory of this workspace that is wrong or that the user asked to forget.',
    parameters: { name: { type: 'string', required: true, description: 'The memory name from the index.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, deleted: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.deleted ? `Memory ${value.name} deleted.` : `No memory named ${value.name}.` }],
    },
    async execute(args, exec) {
      const session = exec.agent?.session
      const deleted = await sessionStore(session).delete(args.name)
      markWrite(session)
      return { name: args.name, deleted }
    },
    presentCall: args => ({ card: 'generic', title: `Forget: ${args.name}`, kind: 'delete', rawInput: args }),
  })

  const readTool = defineTool({
    name: 'memory_read',
    description: 'Read one memory of this workspace in full.',
    parameters: { name: { type: 'string', required: true, description: 'The memory name from the index.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, content: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    async execute(args, exec) {
      const content = await sessionStore(exec.agent?.session).read(args.name)
      if (content === undefined) throw new Error(`no memory named ${args.name}`)
      return { name: args.name, content }
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', title: `Read memory: ${args.name}`, kind: 'read', rawInput: args }),
  })

  // The index enters once per conversation, at its first proceeding step; a resumed log already holds it.
  const indexed = new WeakSet<Session>()
  const alreadyIndexed = (session: Session): boolean => {
    if (indexed.has(session)) return true
    for (const seq of session.surface.nodes) {
      // oxlint-disable-next-line typescript/no-deprecated -- same Session history read as agent-instructions.
      const event = session.eventAt(seq)
      if (event?.type === 'user/message' && event.data.source.kind === 'tpcowork-memory') {
        indexed.add(session)
        return true
      }
    }
    return false
  }
  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (!on()) return decision
    const cwd = workspaceOf(agent.session)
    if (cwd === undefined || decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) return decision
    if (alreadyIndexed(agent.session)) return decision
    indexed.add(agent.session)
    let index: string | undefined
    try { index = await storeFor(cwd).index() } catch (error) {
      ctx.logger.warn('memory index unreadable: %o', error)
      return decision
    }
    signal.throwIfAborted()
    if (index === undefined) return decision
    const message = createUserMessage({
      content: [{ type: 'text', text: indexMessage(index) }],
      source: { kind: 'tpcowork-memory', form: 'instructions' },
    })
    const lastClaimed = decision.messages.findLastIndex(entry => messages.includes(entry))
    return { ...decision, messages: decision.messages.toSpliced(lastClaimed + 1, 0, message) }
  })

  const extract = async (session: Session, transcript: TranscriptMessage[], signal: AbortSignal): Promise<void> => {
    const cwd = workspaceOf(session)
    const route = session.requestHeader()?.config
    if (cwd === undefined || route === undefined) return
    const store = storeFor(cwd)
    const callSignal = AbortSignal.any([signal, AbortSignal.timeout(config.extractionTimeoutMs)])
    const input = extractionInput(await store.list(), transcript)
    const call = await ctx.llm.prepareCall({ provider: route.provider, model: route.model, maxTokens: config.extractionMaxTokens }, callSignal)
    const assembler = new BlockAssembler()
    for await (const chunk of call.stream({
      ...call.config,
      system: EXTRACTION_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
      signal: callSignal,
    })) assembler.push(chunk)
    callSignal.throwIfAborted()
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure.message)
    const change = parseExtraction(textOf(assembler.blocks()))
    if (change === undefined) {
      ctx.logger.debug('memory extraction returned no JSON object')
      return
    }
    for (const memory of change.save) {
      try { await store.save(memory, session.id) } catch (error) { ctx.logger.debug('memory extraction skipped %s: %o', memory.name, error) }
    }
    for (const name of change.delete) {
      try { await store.delete(name) } catch (error) { ctx.logger.debug('memory extraction kept %s: %o', name, error) }
    }
  }

  const schedulers = new Map<Session, ExtractionScheduler<TranscriptMessage[]>>()
  const schedulerOf = (session: Session): ExtractionScheduler<TranscriptMessage[]> => {
    let scheduler = schedulers.get(session)
    if (scheduler === undefined) {
      scheduler = new ExtractionScheduler((transcript, signal) => extract(session, transcript, signal).catch((error: unknown) => {
        if (!signal.aborted) ctx.logger.warn('memory extraction failed: %o', error)
      }))
      schedulers.set(session, scheduler)
    }
    return scheduler
  }

  ctx.on('session/event', (session, event) => {
    if (!on() || !config.extraction || workspaceOf(session) === undefined) return
    switch (event.type) {
      case 'user/message':
        if (event.data.source.kind === 'user') bufferOf(session).push('user', textOf(event.data.content))
        return
      case 'assistant/message':
        if (event.data.interrupted !== true) bufferOf(session).push('assistant', textOf(event.data.message.content))
        return
      case 'turn/end': {
        // Only completed turns extract; an error or abort keeps the stretch for the next completed turn.
        if (event.data.reason.kind !== 'completed') return
        const taken = bufferOf(session).take()
        if (taken.decision === 'run') schedulerOf(session).schedule(taken.messages)
        return
      }
    }
  })

  ctx.on('session/disposed', (session) => {
    schedulers.get(session)?.shutdown()
    schedulers.delete(session)
  })
  const stopExtraction = (): void => {
    for (const scheduler of schedulers.values()) scheduler.shutdown()
    schedulers.clear()
  }
  ctx.effect(() => stopExtraction, 'tpcowork-memory.extraction')

  // The prompt section and tools exist only while the switch is on; turning it off also stops running extraction.
  let surface: (() => void)[] | undefined
  const sync = (): void => {
    if (on() && surface === undefined) {
      surface = [
        ctx.systemPrompt.section({ name: 'tpcowork-memory', order: SECTION_ORDER, text: MEMORY_SECTION, interpolate: false }),
        ...[saveTool, deleteTool, readTool].map(tool => ctx.tools.register(tool)),
      ]
    } else if (!on() && surface !== undefined) {
      for (const dispose of surface) dispose()
      surface = undefined
      stopExtraction()
    }
  }
  sync()
  ctx.on('loader/volatile-update', sync)
}

/**
 * The reference's `agent.browsers` client for DSH `run_code` programs. Commands travel through the
 * program's `tools` bindings to the same browser tools a native tool call uses, so policy, logging,
 * cancellation and screenshots behave as they do for direct calls.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setupBrowserRuntime as setupReferenceRuntime } from '../vendor/tpcowork/apps/tpcowork-cli/packages/core/src/browser-client/index.ts';
import type { BrowserBackendDescriptor, BrowserCommand, BrowserCommandResult } from '../vendor/tpcowork/apps/tpcowork-cli/packages/contracts/src/interfaces/browser-control.port.ts';
import { toolForCommand } from './tool-routing.js';

type Binding = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Written by the Host beside this module for the backend it actually runs. */
function descriptor(): BrowserBackendDescriptor {
  return JSON.parse(readFileSync(new URL('./descriptor.json', import.meta.url), 'utf8')) as BrowserBackendDescriptor;
}

/** Route one command to its tool; a failed tool becomes the reference's failed result shape. */
export function createToolTransport(tools: Record<string, Binding | undefined>, failure?: new (...args: never[]) => Error, backend = descriptor()) {
  return {
    async list() { return [backend]; },
    async execute(_browserId: string, _generation: number, command: BrowserCommand): Promise<BrowserCommandResult> {
      const name = toolForCommand(command);
      const tool = name === undefined ? undefined : tools[name];
      if (!tool) return { ok: false, error: { code: 'capability_unsupported', message: `Browser operation ${command.method} is not available here` } } as BrowserCommandResult;
      // Artifact delivery is the tool's own workspace-checked parameter, not part of the command.
      const { outputPath, ...rest } = command as BrowserCommand & { outputPath?: string };
      try {
        const value = await tool({ command: rest, ...(outputPath === undefined ? {} : { outputPath }) });
        return { ...value, ok: true } as BrowserCommandResult;
      } catch (error) {
        // run_code rejects a failed binding with its program-visible ToolCallError class.
        const failed = error as { name?: string; message?: string; constructor?: { name?: string } } | undefined;
        const isToolFailure = failure ? error instanceof failure : failed?.name === 'ToolCallError' || failed?.constructor?.name === 'ToolCallError';
        if (!isToolFailure) throw error;
        return { ok: false, error: { code: 'browser_command_failed', message: String(failed.message) } } as BrowserCommandResult;
      }
    },
  };
}

/**
 * Bootstrap `agent.browsers` and `agent.documentation` in a fresh program. run_code passes `tools`
 * and `ToolCallError` to the program as parameters rather than globals, so the program hands them on.
 */
export async function setupBrowserRuntime(input: { globals: Record<PropertyKey, unknown>; tools?: unknown; ToolCallError?: new (...args: never[]) => Error }): Promise<void> {
  const tools = (input.tools ?? input.globals.tools) as Record<string, Binding | undefined> | undefined;
  if (!tools || typeof tools !== 'object') throw new Error('Browser SDK requires the run_code tools bindings');
  if (!tools.browser_tabs) throw new Error('Browser tools are not available to this program');
  setupReferenceRuntime({
    globals: input.globals as Record<string, unknown>,
    transport: createToolTransport(tools, input.ToolCallError),
    documentationRoot: fileURLToPath(new URL('./docs', import.meta.url)),
  });
}

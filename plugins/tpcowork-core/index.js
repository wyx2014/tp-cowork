import { readFile } from 'node:fs/promises';
import { initializeDeploymentCredential, loadDeployment } from './deployment.js';

export const name = 'tpcowork-core';
export const inject = ['systemPrompt'];

// DSH 0.2.1-alpha.2 defaults; custom roles belong to their deployment or preset.
const defaultPersonas = new Set([
  '',
  'You are a coding agent powered by the {{model}} model.',
  'You are a helpful software engineer assistant.',
]);

/** Apply the product persona after scoped presets resolve, preserving other prompt contributions. */
export async function apply(ctx) {
  const persona = (await readFile(new URL('persona.md', import.meta.url), 'utf8')).trim();
  ctx.inject(['credentials'], async (child) => {
    await initializeDeploymentCredential(child.credentials, await loadDeployment());
  });
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next();
    return {
      ...assembly,
      sections: assembly.sections
        .filter(section => section.name !== 'harness:identity')
        .map(section => section.name === 'deployment:persona-prefix' && defaultPersonas.has(section.text.trim())
          ? { ...section, text: persona }
          : section),
    };
  });
}

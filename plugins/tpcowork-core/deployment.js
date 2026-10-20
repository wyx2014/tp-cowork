import { readFile } from 'node:fs/promises';

/** Non-secret defaults matching tp-cowork's desktop deployment. */
export const defaultDeployment = Object.freeze({
  apiBase: 'http://192.168.0.228:1025/v1',
  providerId: 'asset-deepseek',
  providerName: '资产DeepSeek',
  modelId: 'deepseek_v4_flash',
  contextWindow: 128000,
  maxTokens: 8192,
});

export const credentialReference = 'TPCOWORK_DEEPSEEK_API_KEY';

/** Validate deployment input without including addresses or secrets in errors. */
export function resolveDeployment(input = {}, env = process.env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('TP Cowork: invalid DeepSeek deployment configuration');
  }
  const deployment = {
    ...defaultDeployment,
    ...input,
    apiBase: env.TPCOWORK_DEEPSEEK_BASE_URL?.trim() || input.apiBase || defaultDeployment.apiBase,
    apiKey: env.TPCOWORK_DEEPSEEK_API_KEY?.trim() || input.apiKey,
  };
  try {
    if (typeof deployment.apiBase !== 'string') throw new Error();
    const endpoint = new URL(deployment.apiBase);
    if (!['http:', 'https:'].includes(endpoint.protocol)
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
    if (typeof deployment.providerId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(deployment.providerId)) throw new Error();
    if (typeof deployment.providerName !== 'string' || !deployment.providerName.trim()) throw new Error();
    if (typeof deployment.modelId !== 'string' || !deployment.modelId.trim()) throw new Error();
    for (const key of ['contextWindow', 'maxTokens']) {
      if (!Number.isSafeInteger(deployment[key]) || deployment[key] <= 0) throw new Error();
    }
    if (deployment.maxTokens > deployment.contextWindow) throw new Error();
    if (deployment.apiKey !== undefined
      && (typeof deployment.apiKey !== 'string' || !/^[\x21-\x7e]+$/.test(deployment.apiKey))) throw new Error();
  } catch {
    throw new Error('TP Cowork: invalid DeepSeek deployment configuration');
  }
  return deployment;
}

/** Read the installed plugin's deployment file; credentials may instead come from DSH. */
export async function loadDeployment(directory = new URL('./', import.meta.url), env = process.env) {
  let content;
  try {
    content = await readFile(new URL('deployment.local.json', directory), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('TP Cowork: cannot read DeepSeek deployment configuration');
    return resolveDeployment({}, env);
  }
  let input;
  try { input = JSON.parse(content); }
  catch { throw new Error('TP Cowork: invalid DeepSeek deployment configuration'); }
  return resolveDeployment(input, env);
}

/** Seed only the product credential reference, preserving every existing source. */
export async function initializeDeploymentCredential(credentials, deployment) {
  if (deployment.apiKey === undefined || await credentials.resolve(credentialReference)) return;
  await credentials.set(credentialReference, deployment.apiKey);
}

/** Generate a secret-free bundle layer consumed by the existing DSH providers. */
export function deploymentPatch(deployment) {
  const providers = {
    [deployment.providerId]: {
      displayName: deployment.providerName,
      apiKeyEnv: credentialReference,
      api: 'openai-completions',
      baseURL: deployment.apiBase,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: 'max_tokens',
      },
      models: [{
        id: deployment.modelId,
        name: deployment.modelId,
        contextWindow: deployment.contextWindow,
        maxTokens: deployment.maxTokens,
        input: ['text'],
        reasoningEfforts: false,
      }],
    },
  };
  return [
    { insert: [{ id: 'tpcowork-core-model', name: '@tpcowork/dsh-core/model', config: { providers } }] },
    { id: 'agent-default-model', config: { provider: deployment.providerId, model: deployment.modelId } },
  ];
}

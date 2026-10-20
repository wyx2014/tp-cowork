import base from '../../../deepseek-harness/vitest.config.ts'

export default {
  ...base,
  resolve: {
    ...base.resolve,
    alias: [
      { find: /^@deepseek-ai\/dsh-llm-pi-ai$/, replacement: new URL('../../../deepseek-harness/packages/llm/llm-pi-ai/src/index.ts', import.meta.url).pathname },
      { find: /^@deepseek-ai\/dsh-llm$/, replacement: new URL('../../../deepseek-harness/packages/llm/llm/src/index.ts', import.meta.url).pathname },
    ],
  },
  test: {
    ...base.test,
    projects: undefined,
    include: [new URL('./tests/*.spec.ts', import.meta.url).pathname],
    environment: 'node',
    pool: 'threads',
    maxWorkers: 2,
  },
}

import base from '../../../deepseek-harness/vitest.config.ts'

export default {
  ...base,
  resolve: {
    alias: {
      '@deepseek-ai/dsh-llm': new URL('../../../deepseek-harness/packages/llm/llm/src/index.ts', import.meta.url).pathname,
    },
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

import base from '../../../deepseek-harness/vitest.config.ts'

export default {
  ...base,
  resolve: {
    alias: {
      react: new URL('../../../deepseek-harness/packages/client/ui-layout/node_modules/react', import.meta.url).pathname,
      'react-dom': new URL('../../../deepseek-harness/packages/client/ui-renderer/node_modules/react-dom', import.meta.url).pathname,
    },
  },
  test: {
    ...base.test,
    projects: undefined,
    include: [new URL('./tests/*.spec.ts', import.meta.url).pathname],
    environment: 'jsdom',
    pool: 'threads',
    maxWorkers: 2,
  },
}

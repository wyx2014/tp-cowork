import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../../deepseek-harness/vitest.shared.ts'

const harnessFile = (path: string) => fileURLToPath(new URL(`../../../deepseek-harness/${path}`, import.meta.url))

export default {
  root: fileURLToPath(new URL('../../../deepseek-harness', import.meta.url)),
  plugins: [tsconfigPaths({ projects: [harnessFile('tsconfig.base.json')] }), standardDecoratorPlugin()],
  resolve: {
    alias: {
      react: new URL('../../../deepseek-harness/packages/client/ui-layout/node_modules/react', import.meta.url).pathname,
      'react-dom': new URL('../../../deepseek-harness/packages/client/ui-renderer/node_modules/react-dom', import.meta.url).pathname,
    },
  },
  test: {
    setupFiles: [harnessFile('scripts/test-proxy-environment.ts'), harnessFile('scripts/test-dom-environment.ts')],
    include: [fileURLToPath(new URL('./tests/*.spec.ts', import.meta.url))],
    environment: 'jsdom',
    pool: 'forks',
    execArgv: vitestExecArgv,
    maxWorkers: 2,
  },
}

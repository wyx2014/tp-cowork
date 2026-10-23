import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '../../../deepseek-harness/node_modules/typescript/lib/typescript.js'
import { standardDecoratorPlugin } from '../../../deepseek-harness/vitest.shared.ts'
const harness = fileURLToPath(new URL('../../../deepseek-harness/', import.meta.url))
const requireHarness = createRequire(resolve(harness, 'package.json'))
const paths = ts.readConfigFile(resolve(harness, 'tsconfig.base.json'), ts.sys.readFile).config.compilerOptions.paths
const alias = Object.entries(paths).map(([key, values]) => ({
  find: new RegExp('^' + key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)') + '$'),
  replacement: resolve(harness, (values as string[])[0]!).replace('*', '$1'),
}))
alias.push({ find: /^zod$/, replacement: requireHarness.resolve('zod') })
alias.push({ find: /^react$/, replacement: resolve(harness, 'packages/client/ui-schedule/node_modules/react/index.js') })
alias.push({ find: /^react-dom$/, replacement: resolve(harness, 'packages/client/ui-schedule/node_modules/react-dom/index.js') })
alias.push({ find: /^react\/(.*)$/, replacement: resolve(harness, 'packages/client/ui-schedule/node_modules/react') + '/$1' })
export default {
  resolve: { alias }, plugins: [standardDecoratorPlugin()],
  test: { include: [fileURLToPath(new URL('./tests/*.spec.ts', import.meta.url))], environment: 'node', pool: 'threads', maxWorkers: 1 },
}

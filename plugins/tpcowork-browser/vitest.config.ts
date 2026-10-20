import ts from '../../../deepseek-harness/node_modules/typescript/lib/typescript.js'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import base from '../../../deepseek-harness/vitest.config.ts'
const harness = fileURLToPath(new URL('../../../deepseek-harness/', import.meta.url))
const clientRequire = createRequire(new URL('../../../deepseek-harness/packages/test-support/client-runtime/package.json', import.meta.url))
const paths = ts.readConfigFile(resolve(harness, 'tsconfig.base.json'), ts.sys.readFile).config.compilerOptions.paths
const alias = Object.entries(paths).map(([key, paths]) => ({
  find: new RegExp('^' + key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)') + '$'),
  replacement: resolve(harness, (paths as string[])[0]).replace('*', '$1'),
}))
for (const name of ['react/jsx-runtime', 'react-dom/client', 'react-dom', 'react', '@testing-library/react']) {
  alias.push({find: new RegExp('^'+name+'$'), replacement:clientRequire.resolve(name)})
}
export default {
  ...base,
  resolve: { alias },
  test: { ...base.test, projects: undefined, include: [fileURLToPath(new URL('./tests/*.spec.ts', import.meta.url))], environment: 'node', pool: 'threads', maxWorkers: 1 },
}

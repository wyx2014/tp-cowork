import base from '../../plugins/tpcowork-toolbox/vitest.config.ts'
import { fileURLToPath } from 'node:url'

export default {
  ...base,
  test: {
    ...base.test,
    pool: 'forks',
    include: [fileURLToPath(new URL('./toolbox-app.spec.mjs', import.meta.url))],
    testTimeout: 180000,
    hookTimeout: 120000,
  },
}

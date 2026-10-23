import base from '../../plugins/tpcowork-toolbox/vitest.config.ts'
import { fileURLToPath } from 'node:url'

export default {
  ...base,
  test: {
    ...base.test,
    pool: 'forks',
    include: [fileURLToPath(new URL('./model-settings.spec.mjs', import.meta.url))],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
}

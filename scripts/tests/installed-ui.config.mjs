import base from '../../plugins/tpcowork-toolbox/vitest.config.ts'
import { fileURLToPath } from 'node:url'

export default {
  ...base,
  test: {
    ...base.test,
    pool: 'forks',
    include: ['installed-ui.spec.mjs', 'installed-ui-startup.spec.mjs']
      .map(file => fileURLToPath(new URL(file, import.meta.url))),
    testTimeout: 120000,
    hookTimeout: 120000,
  },
}

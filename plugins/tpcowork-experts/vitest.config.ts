import base from '../tpcowork-toolbox/vitest.config.ts'
import { fileURLToPath } from 'node:url'
export default { ...base, test: { ...base.test, include: [fileURLToPath(new URL('./tests/*.spec.ts', import.meta.url))], testTimeout: 180000 } }

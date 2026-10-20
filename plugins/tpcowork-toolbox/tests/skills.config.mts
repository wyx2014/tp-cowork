import base from '../vitest.config.ts'
import { fileURLToPath } from 'node:url'
export default { ...base, test: { ...base.test, include: [fileURLToPath(new URL('./skills*.spec.ts', import.meta.url)), fileURLToPath(new URL('./installer*.spec.ts', import.meta.url))] } }

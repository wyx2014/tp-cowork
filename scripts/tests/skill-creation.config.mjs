import base from './model-settings.config.mjs'
import { fileURLToPath } from 'node:url'

export default {
  ...base,
  test: { ...base.test, include: [fileURLToPath(new URL('./skill-creation.spec.mjs', import.meta.url))] },
}

import base from './sidebar-navigation.config.mjs'
import { fileURLToPath } from 'node:url'

export default {
  ...base,
  test: { ...base.test, include: [fileURLToPath(new URL('./preset-mode.spec.mjs', import.meta.url))] },
}

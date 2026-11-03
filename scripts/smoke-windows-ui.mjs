/** Blocking check: the installed product launches with its core Client plugins and no renderer errors. */
import { inspectInstalledUi } from './installed-ui.mjs'
import { checkInstalledProductUi } from './installed-ui-checks.mjs'

await inspectInstalledUi(checkInstalledProductUi)

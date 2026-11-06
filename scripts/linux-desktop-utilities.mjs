/** Shared UI/diagnostics operations over the shell's existing, primary-frame-checked desktop bridge. */
import { join } from 'node:path'
import { WindowZoom } from '../plugins/tpcowork-ui/src/desktop-window-zoom.js'
import { createDesktopDiagnostics } from '../plugins/tpcowork-diagnostics/src/desktop.ts'

const disabledSnapshot = () => ({ enabled: false, tabs: [], downloads: [], permissions: {}, requests: [] })

/** The legacy export name is required by the shell; no browser implementation is imported or enabled. */
export function createDesktopBrowser(options) {
  const zoom = new WindowZoom(options.window, join(options.userData, 'tpcowork-zoom.json'))
  const diagnostics = createDesktopDiagnostics({ window: options.window, userData: options.userData })
  return {
    willAttach: () => false,
    didAttach: () => false,
    async handleHost(message, reply) {
      reply({ type: 'tpcowork-browser', version: 1, kind: 'result', id: message?.id ?? 'invalid',
        error: { code: 'disabled', message: 'The browser plugin is excluded from this Linux package.' } })
    },
    async request(operation, payload) {
      if (operation === 'windowZoom') return zoom.request(payload)
      if (operation === 'diagnostics') return diagnostics.request(payload)
      if (operation === 'snapshot') return disabledSnapshot()
      throw new Error('The browser plugin is excluded from this Linux package.')
    },
    async disable() {},
    async dispose() { diagnostics.dispose() },
  }
}

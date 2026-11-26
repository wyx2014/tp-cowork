/** Shared UI/diagnostics/desktop-pet operations over the shell's existing, primary-frame-checked desktop bridge. */
import { BrowserWindow, desktopCapturer, ipcMain, Menu, nativeImage, powerMonitor, screen, session, shell, Tray } from 'electron'
import { join } from 'node:path'
import { WindowZoom } from '../plugins/tpcowork-ui/src/desktop-window-zoom.js'
import { createDesktopDiagnostics } from '../plugins/tpcowork-diagnostics/src/desktop.ts'
import { createDesktopPetHost } from '../plugins/dsh-pet/src/desktop/host.ts'

const disabledSnapshot = () => ({ enabled: false, tabs: [], downloads: [], permissions: {}, requests: [] })

/** The legacy export name is required by the shell; no browser implementation is imported or enabled. */
export function createDesktopBrowser(options) {
  const zoom = new WindowZoom(options.window, join(options.userData, 'tpcowork-zoom.json'))
  const diagnostics = createDesktopDiagnostics({ window: options.window, userData: options.userData })
  const pet = createDesktopPetHost(
    { BrowserWindow, desktopCapturer, ipcMain, Menu, nativeImage, powerMonitor, screen, session, shell, Tray },
    { window: options.window },
  )
  return {
    willAttach: () => false,
    didAttach: () => false,
    async handleHost(message, reply) {
      if (pet.handles(message)) return pet.handleHost(message, reply)
      reply({ type: 'tpcowork-browser', version: 1, kind: 'result', id: message?.id ?? 'invalid',
        error: { code: 'disabled', message: 'The browser plugin is excluded from this Linux package.' } })
    },
    async request(operation, payload) {
      if (operation === 'windowZoom') return zoom.request(payload)
      if (operation === 'diagnostics') return diagnostics.request(payload)
      if (operation === 'snapshot') return disabledSnapshot()
      throw new Error('The browser plugin is excluded from this Linux package.')
    },
    async disable() { await pet.disable() },
    async dispose() { await pet.dispose(); diagnostics.dispose() },
  }
}

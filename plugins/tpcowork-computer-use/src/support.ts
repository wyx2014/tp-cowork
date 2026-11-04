/** Where Computer Use can run, decided before any native code loads (ZCode shows the same "not supported here" notice). */
import { release } from 'node:os'

export type Support =
  | { readonly supported: true; readonly platform: 'win32' | 'darwin' | 'linux' }
  | { readonly supported: false; readonly platform: string; readonly reason: 'platform' | 'macos-version' | 'wayland' | 'no-display' | 'arch' }

/**
 * Cua Driver 0.28 ships Windows x64/arm64, macOS 13+ and glibc Linux x64/arm64 binaries. Linux needs an X11 session:
 * Wayland does not let one client read or drive another's windows.
 */
export function computerUseSupport(platform: string = process.platform, arch: string = process.arch,
  env: Record<string, string | undefined> = process.env, osRelease: string = release()): Support {
  if (!['x64', 'arm64'].includes(arch)) return { supported: false, platform, reason: 'arch' }
  if (platform === 'win32') return { supported: true, platform }
  // Darwin 22 is macOS 13, the minimum the driver library is built for.
  if (platform === 'darwin') return Number(osRelease.split('.')[0]) >= 22 ? { supported: true, platform } : { supported: false, platform, reason: 'macos-version' }
  if (platform === 'linux') {
    if (env.XDG_SESSION_TYPE === 'wayland' || (env.WAYLAND_DISPLAY && !env.DISPLAY)) return { supported: false, platform, reason: 'wayland' }
    if (!env.DISPLAY) return { supported: false, platform, reason: 'no-display' }
    return { supported: true, platform }
  }
  return { supported: false, platform, reason: 'platform' }
}

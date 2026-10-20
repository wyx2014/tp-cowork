/** Keep the personal library at the same location as the previous TP Cowork desktop. */
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export function userSkillsDirectory(options: {
  configured?: string
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
} = {}): string {
  const platform = options.platform ?? process.platform
  const paths = platform === 'win32' ? win32 : posix
  if (options.configured?.trim()) return paths.resolve(options.configured.trim())
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const appData = platform === 'win32'
    ? env.APPDATA?.trim() || win32.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? posix.join(home, 'Library', 'Application Support')
      : env.XDG_CONFIG_HOME?.trim() || posix.join(home, '.config')
  return paths.join(appData, 'tpcowork', 'workspace', 'skills')
}

/** Use the same local chooser as DSH's desktop workspace picker. */
export function pickSkillDirectory(pickHost: () => Promise<string | null>): Promise<string | null> {
  const desktop = (globalThis as typeof globalThis & {
    __DSH_DIRECTORY_PICKER__?: { pick(): Promise<string | null> }
  }).__DSH_DIRECTORY_PICKER__
  return desktop ? desktop.pick() : pickHost()
}

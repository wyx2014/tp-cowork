import type { InstallerClientApi } from './remote.ts'

/** Desktop files retain their local path; browser files send their archive bytes to the same installer. */
export async function prepareSkillArchive(
  file: File,
  prepareLocal: InstallerClientApi['prepareLocalImport'],
  prepareArchive: InstallerClientApi['prepareArchive'],
): Promise<{ importId: string; name: string }> {
  if (!file.name.toLowerCase().endsWith('.zip')) throw { code: 'skills/unsupported-package' }
  const bridge = (globalThis as typeof globalThis & { __DSH_HOST_PATHS__?: { pathFor(file: File): string } }).__DSH_HOST_PATHS__
  const path = bridge?.pathFor(file)
  if (path) return prepareLocal({ path })
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject({ code: 'skills/invalid-archive' })
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string' || !result.includes(',')) { reject({ code: 'skills/invalid-archive' }); return }
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
  return prepareArchive({ contentBase64 })
}

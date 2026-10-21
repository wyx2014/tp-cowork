/** Read only an actual DSH provider candidate; never accept a path supplied by the page. */
import { lstat, readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { skillId } from '../installer/index.ts'
import { markerName, parseSkill, safeResource, sha256, validateFiles, type SkillFile } from '../installer/files.ts'
import { TpcoworkHubError } from './errors.ts'

export function privateResource(path: string): boolean {
  return path.split('/').some(part => /^(?:\.git|\.svn|\.hg|node_modules|__pycache__|\.DS_Store|\.ssh|\.aws|\.dsh|\.multica|\.netrc|\.npmrc|\.pypirc|\.git-credentials|auth\.json|sessions?|logs?|memory)$/i.test(part)
    || /^\.env(?:\.|$)/i.test(part) || /^(?:credentials?|secrets?|tokens?)(?:\.|$)/i.test(part)
    || /^(?:USER|SOUL|MEMORY)\.md$/i.test(part) || /^(?:deployment|config|settings)\.local\./i.test(part)
    || /\.(?:pem|key|p12|pfx|keystore)$/i.test(part) || part === markerName)
}
function containsSecret(bytes: Uint8Array, token: string): boolean {
  const text = Buffer.from(bytes).toString('utf8')
  if (token.length >= 8 && text.includes(token)) return true
  return /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9_+\/.=-]{12,}|\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text)
    || /(?:\/Users\/|\/home\/)[\w.-]+\//.test(text)
    || [...text.matchAll(/(?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)["']?)\s*[:=]\s*["']([^"'\r\n]+)["']/gi)]
      .some(match => !/^(?:\$\{|\$[A-Z_]|<|\{\{|YOUR[_ -]|REPLACE[_ -]|example|placeholder|test[-_]|\*{3}|process\.env\.|os\.environ)/i.test(match[1]!))
}
export async function uploadFiles(ctx: Context, id: string, maxBytes: number, maxFiles: number, token: string, signal: AbortSignal): Promise<SkillFile[]> {
  const observation = await ctx.skills.inventory({ cwd: ctx.profileContext.cwd, signal })
  if (!observation.complete) throw new TpcoworkHubError('source-changed')
  const candidate = observation.entries.map(entry => entry.skill).find(item => item.resourceBase?.kind === 'directory'
    && item.path !== undefined && basename(item.path) === 'SKILL.md' && skillId(item.resourceBase.path) === id)
  if (candidate?.resourceBase?.kind !== 'directory') throw new TpcoworkHubError('source-changed')
  const root = candidate.resourceBase.path
  const files: SkillFile[] = []
  let total = 0
  let entries = 0
  async function walk(directory: string, prefix: string): Promise<void> {
    signal.throwIfAborted()
    if ((await lstat(directory)).isSymbolicLink()) throw new TpcoworkHubError('unsafe-upload')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal.throwIfAborted()
      if (++entries > maxFiles * 4) throw new TpcoworkHubError('invalid-package')
      const relative = prefix + entry.name
      if (privateResource(relative)) continue
      const path = safeResource(relative)
      const target = join(directory, entry.name)
      const stat = await lstat(target)
      if (stat.isSymbolicLink()) throw new TpcoworkHubError('unsafe-upload')
      if (stat.isDirectory()) { await walk(target, path + '/'); continue }
      if (!stat.isFile() || files.length >= maxFiles || (total += stat.size) > maxBytes) throw new TpcoworkHubError('invalid-package')
      const bytes = await readFile(target)
      if (bytes.byteLength !== stat.size) throw new TpcoworkHubError('source-changed')
      if (containsSecret(bytes, token)) throw new TpcoworkHubError('unsafe-upload')
      files.push({ path, bytes, sha256: sha256(bytes) })
    }
  }
  try {
    await walk(root, '')
    validateFiles(files, maxBytes, maxFiles)
    for (const file of files.filter(file => file.path.endsWith('.md'))) {
      for (const link of Buffer.from(file.bytes).toString('utf8').matchAll(/\]\(([^\s)]+)\)/g)) {
        const target = decodeURIComponent(link[1]!.split('#')[0]!)
        if (target && privateResource(target)) throw new TpcoworkHubError('invalid-package')
      }
    }
    if (parseSkill(files.find(file => file.path === 'SKILL.md')!.bytes).name !== candidate.name) throw new TpcoworkHubError('source-changed')
    return files
  } catch (error) {
    if (error instanceof TpcoworkHubError) throw error
    signal.throwIfAborted()
    throw new TpcoworkHubError('invalid-package')
  }
}

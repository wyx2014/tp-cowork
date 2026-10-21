/** Static dependency checks never execute scripts from an imported skill. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillViewOptions } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type { Readiness } from '../../contracts/index.ts'
import { z } from 'zod'
import type { SkillFile } from '../installer/files.ts'
import { parseSkill } from '../installer/files.ts'
import { nativeMissing, type NativeOptions } from './native.ts'
const exec = promisify(execFile)
/** Shares Python probes across inventories; an explicit readiness check starts new probes. */
export class PythonModuleChecks {
  private readonly checks = new Map<string, Promise<string[] | null>>()
  clear(): void { this.checks.clear() }
  async missing(python: string, modules: string[]): Promise<string[] | null> {
    const names = [...new Set(modules)].sort()
    const key = JSON.stringify([python, names])
    let pending = this.checks.get(key)
    if (!pending) {
      pending = this.probe(python, names)
      this.checks.set(key, pending)
    }
    return pending
  }
  private async probe(python: string, modules: string[]): Promise<string[] | null> {
    try {
      const { stdout } = await exec(python, ['-I', '-c', 'import importlib.util,json,sys; print(json.dumps([m for m in sys.argv[1:] if importlib.util.find_spec(m) is None]))', ...modules], { timeout: 10000, env: scrubbedEnv(), maxBuffer: 4096 })
      return z.array(z.string()).parse(JSON.parse(stdout))
    } catch { return null }
  }
}
export const dependencySchema = z.object({
  requiredFiles: z.array(z.string()).default([]), tools: z.array(z.string()).default([]),
  pythonModules: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).default([]),
  limitations: z.array(z.string()).default([]),
  checksums: z.record(z.string(), z.string()).optional(),
}).strict()
export function scrubbedEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i.test(key)))
}
export async function readiness(ctx: Context, files: readonly SkillFile[], options: SkillViewOptions, python: string, native: NativeOptions, pythonChecks = new PythonModuleChecks()): Promise<Readiness> {
  const reasons: Readiness['reasons'] = []
  const dependencyFile = files.find(file => file.path === 'toolbox.json')
  if (dependencyFile) {
    const dependencies = dependencySchema.parse(JSON.parse(Buffer.from(dependencyFile.bytes).toString('utf8')))
    for (const path of dependencies.requiredFiles) if (!files.some(file => file.path === path)) reasons.push({ code: 'missing-resource', message: `缺少资源：${path}` })
    const tools = ctx.get('tools')
    for (const tool of dependencies.tools) if (!tools?.get(tool, options.scope)) reasons.push({ code: 'missing-tool', message: `当前会话未提供工具：${tool}` })
    if (dependencies.pythonModules.length) {
      const missing = await pythonChecks.missing(python, dependencies.pythonModules)
      if (missing === null) reasons.push({ code: 'python-unavailable', message: 'Python 依赖检测失败，请配置可用的 Python 环境。' })
      else for (const module of missing) reasons.push({ code: 'missing-python-module', message: `缺少 Python 依赖：${module}` })
    }
    for (const message of dependencies.limitations) reasons.push({ code: 'needs-configuration', message })
  }
  const entry = files.find(file => file.path === 'SKILL.md')
  try {
    if (entry) for (const ref of await nativeMissing(ctx, parseSkill(entry.bytes).name, native)) reasons.push({ code: 'needs-configuration', message: `尚未配置：${ref}` })
  } catch { reasons.push({ code: 'credentials-unavailable', message: '无法检查 TP Cowork 凭证服务，请检查配置后重试。' }) }
  return { state: reasons.some(reason => reason.code === 'credentials-unavailable') ? 'error' : reasons.length ? 'blocked' : 'ready', checkedAt: Date.now(), reasons }
}

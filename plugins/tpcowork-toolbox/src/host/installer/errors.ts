/** Safe structured failures shared by management and the installer. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
export type SkillFailureCode = `skills/${string}` | 'toolbox/stale-selection'
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { [code: `skills/${string}`]: {}; 'toolbox/stale-selection': {} }
}
const messages: Partial<Record<SkillFailureCode, string>> = {
  'skills/not-owned': '该目录不属于工具箱安装器，请通过文件管理器处理用户自有内容。',
  'skills/user-modified': '技能包含用户修改，已保留原文件。请另存修改后再更新或移除。',
  'skills/not-found': '未找到技能，请刷新清单。',
  'skills/name-conflict': '技能名称冲突，已保留现有内容。请选择其他名称或更新同一来源。',
  'toolbox/stale-selection': '技能清单已变化，请刷新后重试。',
  'skills/incomplete-inventory': '技能清单尚未完整，请检查来源后重试。',
  'skills/settings-entry-missing': '技能配置未接入当前 profile，请检查工具箱模块配置。',
  'skills/session-unavailable': '无法读取当前会话，请检查会话服务后重试。',
  'skills/symlink': '技能资源包含符号链接，请改为目录中的实际文件后重新导入。',
  'skills/missing-resource': '技能缺少声明的资源，请补齐完整目录后重新导入。',
  'skills/invalid-archive': 'ZIP 资源包损坏或格式不受支持，请重新导出单个完整技能包。',
  'skills/invalid-frontmatter': 'SKILL.md 的 YAML 元数据格式不正确，请检查 name 和 description。',
  'skills/unsupported-package': '请选择技能目录、ZIP 资源包或 Markdown 技能文件。',
  'skills/import-expired': '资源包检查已过期，请重新检查后安装。',
}
export class SkillError extends RemoteError<SkillFailureCode> {
  constructor(code: SkillFailureCode) { super(code, messages[code] ?? '技能操作未完成，请检查来源、资源完整性及配置后重试。', {}) }
}

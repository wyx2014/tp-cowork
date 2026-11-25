/** Safe structured failures shared by management and the installer. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
export type SkillFailureCode = `skills/${string}` | 'toolbox/stale-selection'
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { [code: `skills/${string}`]: {}; 'toolbox/stale-selection': {} }
}
const messages: Partial<Record<SkillFailureCode, string>> = {
  'skills/not-owned': '该目录不属于工具箱安装器，请通过文件管理器处理用户自有内容。',
  'skills/bundled-protected': '内置技能不支持移除。',
  'skills/user-modified': '技能包含用户修改，已保留原文件。请另存修改后再更新。',
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
  'skills/cisco-not-configured': 'Cisco 办公电话尚未配置，请联系管理员配置查号和拨号服务。',
  'skills/cisco-invalid-extension': 'Cisco 只支持 1121 开头的八位办公分机号。请提供完整分机号。',
  'skills/cisco-contact-not-found': '通讯录没有找到有效的 Cisco 办公分机，请核对姓名、邮箱或分机号。',
  'skills/cisco-contact-ambiguous': '通讯录找到多人，请提供对方的邮箱或完整办公分机号。',
  'skills/cisco-auth-rejected': 'Cisco 服务拒绝了当前账号凭证，请确认账号具备办公电话权限。',
  'skills/cisco-lookup-failed': 'Cisco 通讯录查询失败，请检查办公网络或联系管理员。',
  'skills/cisco-dial-rejected': 'Cisco 服务未接受拨号，请检查分机号或联系管理员。',
  'skills/cisco-dial-uncertain': '无法确认 Cisco 拨号结果，请先查看话机状态，避免重复拨号。',
}
export class SkillError extends RemoteError<SkillFailureCode> {
  constructor(code: SkillFailureCode) { super(code, messages[code] ?? '技能操作未完成，请检查来源、资源完整性及配置后重试。', {}) }
}

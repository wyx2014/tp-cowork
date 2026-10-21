import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { z } from 'zod'

export type TpcoworkHubCode = `tpcoworkhub/${string}`
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { [code: `tpcoworkhub/${string}`]: {} }
}
const messages: Record<string, string> = {
  'not-configured': '尚未配置 TP Cowork Hub 服务地址。',
  'login-required': '请登录 TP Cowork Hub 后重试。',
  'session-expired': 'TP Cowork Hub 会话已失效，请重新登录。',
  'login-failed': '登录失败，请检查账号和密码凭证引用。',
  'credentials-unavailable': 'TP Cowork 凭证不可读取或写入，请检查凭证服务。',
  'network': '无法连接 TP Cowork Hub，请检查网络后重试。',
  'timeout': 'TP Cowork Hub 请求超时，请重试。',
  'cancelled': '操作已取消。',
  'protocol': 'TP Cowork Hub 返回的数据不符合已验证协议。',
  'package-changed': '商店版本或内容已变化，请重新打开详情后安装。',
  'invalid-package': '技能资源的路径、大小、校验和或入口不完整。',
  'unsafe-upload': '上传内容包含凭证或个人配置，请清理后重试。',
  'source-changed': '本地技能资源已变化，请刷新并重新检查。',
  'publish-rejected': '商店拒绝上传，请检查名称、版本和权限后重试。',
  'publish-uncertain': '上传请求已发送，结果未确认。请先检查商店，避免重复发布。',
  'request-conflict': '该请求标识已用于其他上传，请重新操作。',
}
/** Never retain a remote body, URL, credential value or original exception as the cause. */
export class TpcoworkHubError extends RemoteError<TpcoworkHubCode> {
  constructor(code: string) { super(`tpcoworkhub/${code}`, messages[code] ?? 'TP Cowork Hub 操作未完成，请检查输入后重试。', {}) }
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new TpcoworkHubError('invalid-request')
  return result.data
}

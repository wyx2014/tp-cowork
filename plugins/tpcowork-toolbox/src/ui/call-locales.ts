export const callZh = {
  callSetup: '设置电话', callSetupHint: '确认自己的办公分机，之后可在聊天中要求拨号或挂断。',
  callCaller: '我的办公分机号', callCallerHint: '填写自己的四位分机号，不是要拨打的号码。',
  callMatch: '匹配话机', callConfirm: '确认并保存', callConfigured: '电话已配置。可在聊天中输入“拨打 1234”或“挂断电话”。',
  callReadyHint: '保存只确认本机配置，不会拨号；实际通话需要连接办公网络。',
  callPhone: '话机地址', callPhoneHint: '软件从本机分机表匹配，也可填写话机的 HTTP(S) 地址。',
  callPbx: '电话服务器', callPrefix: '外线前缀', callAdvanced: '话机与分机表设置',
  callSource: '旧版电话配置目录', callSourceHint: '选择包含 config.json 和内部分机信息表.md 的 call 目录。配置只保存在本机。',
  callImport: '读取旧版配置', callUsername: '话机登录账号', callPassword: '话机登录密码',
  callCredentialHint: '首次设置需要话机的登录信息，保存后无需重复填写。密码不会进入聊天记录。',
  callCredentialSaved: '已配置，留空保留', callFailure: '电话设置未完成。请检查本机配置目录和凭证服务后重试。',
} as const
export const callEn: Record<keyof typeof callZh, string> = {
  callSetup: 'Set up phone', callSetupHint: 'Confirm your desk extension, then ask to dial or hang up in chat.',
  callCaller: 'My desk extension', callCallerHint: 'Your own four-digit extension, not the number you want to call.',
  callMatch: 'Find phone', callConfirm: 'Confirm and save', callConfigured: 'Phone configured. Ask “dial 1234” or “hang up” in chat.',
  callReadyHint: 'Saving checks local configuration without placing a call. Calling requires the office network.',
  callPhone: 'Phone address', callPhoneHint: 'Matched from your local extension directory, or enter the phone’s HTTP(S) address.',
  callPbx: 'Phone server', callPrefix: 'Outside-line prefix', callAdvanced: 'Phone and directory settings',
  callSource: 'Previous phone configuration folder', callSourceHint: 'Select the call folder containing config.json and 内部分机信息表.md. Configuration stays on this computer.',
  callImport: 'Read previous configuration', callUsername: 'Phone login username', callPassword: 'Phone login password',
  callCredentialHint: 'Enter the phone login once. Saved credentials can be reused and do not enter chat history.',
  callCredentialSaved: 'Configured; leave blank to keep', callFailure: 'Phone setup failed. Check the local configuration folder and credential service, then retry.',
}

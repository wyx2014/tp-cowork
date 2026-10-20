export const mcpZh = {
  addMcpServer: '添加 MCP 服务', editMcpServer: '编辑 MCP 服务', mcpMethod: '添加方式', mcpRemote: '远程服务', mcpLocal: '本地程序', mcpImportConfig: '导入配置',
  mcpServiceName: '服务名称', mcpServiceNamePlaceholder: '例如：公司知识库', mcpServerUrl: '服务地址', mcpAuth: '认证方式', mcpAuthNone: '无需认证', mcpAuthHeaders: 'API Key / 自定义请求头', mcpAccessToken: '访问令牌', mcpHeaders: '请求头',
  mcpExecutable: '启动程序', mcpArguments: '启动参数', mcpAddArgument: '添加参数', mcpArgumentNumber: '参数 {number}', mcpRemoveArgument: '删除参数 {number}', mcpEnvironment: '环境变量',
  mcpAdvanced: '高级设置', mcpServerId: '服务标识', mcpAutoId: '自动生成', mcpProtocol: '传输协议', mcpWorkingDirectory: '工作目录', mcpOptional: '可选', mcpConnectTimeout: '连接超时（秒）', mcpToolTimeout: '工具超时（秒）',
  mcpTestConnection: '测试连接', mcpSaveConnect: '保存并连接', mcpSaveChanges: '保存修改', mcpTestPassed: '测试通过，发现 {count} 个工具', mcpTestFailed: '连接测试失败', mcpSavedConnectionFailed: '配置已保存，连接尚未成功。可以修改后重试，或关闭窗口稍后查看状态。',
  mcpAddPair: '添加{label}', mcpPairKey: '{label} 名称 {number}', mcpPairValue: '{label} 值 {number}', mcpRemovePair: '删除{label}条目 {number}', mcpPairName: '名称', mcpValue: '值', mcpStoredValue: '已保存（留空保持）',
  mcpConfigJson: 'MCP 配置 JSON', mcpChooseFile: '选择文件', mcpPreview: '解析预览', mcpConfirmImport: '确认导入', mcpImportAction: '导入处理', mcpSkip: '跳过', mcpConflict: '存在同名服务，请选择', mcpReplace: '替换已有配置', mcpRename: '使用新标识导入', mcpAdd: '添加', mcpNewId: '新服务标识',
  invalidMcpPairs: '请填写变量名称和值，名称不能重复。已保存的值可留空保持。', invalidMcpToken: '请输入访问令牌。', invalidMcpConnectTimeout: '连接超时范围为 1–300 秒。', invalidMcpToolTimeout: '工具超时范围为 1–600 秒。',
  invalidMcpImport: '请输入有效的 MCP 配置 JSON，mcpServers 中应包含 1–100 个服务。', mcpImportTooLarge: '配置文件不能超过 1 MiB。', mcpFileReadFailed: '无法读取配置文件。', mcpUnsupportedTransport: '当前运行时不支持 SSE，请使用 Streamable HTTP 服务地址。',
} as const
export const mcpEn: Record<keyof typeof mcpZh, string> = {
  addMcpServer: 'Add MCP server', editMcpServer: 'Edit MCP server', mcpMethod: 'Connection method', mcpRemote: 'Remote server', mcpLocal: 'Local program', mcpImportConfig: 'Import config',
  mcpServiceName: 'Service name', mcpServiceNamePlaceholder: 'e.g. Company knowledge base', mcpServerUrl: 'Server URL', mcpAuth: 'Authentication', mcpAuthNone: 'None', mcpAuthHeaders: 'API key / Custom headers', mcpAccessToken: 'Access token', mcpHeaders: 'Headers',
  mcpExecutable: 'Executable', mcpArguments: 'Arguments', mcpAddArgument: 'Add argument', mcpArgumentNumber: 'Argument {number}', mcpRemoveArgument: 'Remove argument {number}', mcpEnvironment: 'Environment variables',
  mcpAdvanced: 'Advanced settings', mcpServerId: 'Server identifier', mcpAutoId: 'Generated automatically', mcpProtocol: 'Transport', mcpWorkingDirectory: 'Working directory', mcpOptional: 'Optional', mcpConnectTimeout: 'Connection timeout (s)', mcpToolTimeout: 'Tool timeout (s)',
  mcpTestConnection: 'Test connection', mcpSaveConnect: 'Save and connect', mcpSaveChanges: 'Save changes', mcpTestPassed: 'Test passed, {count} tools found', mcpTestFailed: 'Connection test failed', mcpSavedConnectionFailed: 'Configuration saved, but connection has not succeeded. Retry after editing or close to check status later.',
  mcpAddPair: 'Add {label}', mcpPairKey: '{label} key {number}', mcpPairValue: '{label} value {number}', mcpRemovePair: 'Remove {label} entry {number}', mcpPairName: 'Name', mcpValue: 'Value', mcpStoredValue: 'Stored (unchanged)',
  mcpConfigJson: 'MCP configuration JSON', mcpChooseFile: 'Choose file', mcpPreview: 'Preview', mcpConfirmImport: 'Import selected', mcpImportAction: 'import action', mcpSkip: 'Skip', mcpConflict: 'Name conflict: choose an action', mcpReplace: 'Replace existing configuration', mcpRename: 'Import with another identifier', mcpAdd: 'Add', mcpNewId: 'New server identifier',
  invalidMcpPairs: 'Enter unique keys and their values. Leave stored values empty to keep them.', invalidMcpToken: 'Enter an access token.', invalidMcpConnectTimeout: 'Connection timeout: 1–300 seconds.', invalidMcpToolTimeout: 'Tool timeout: 1–600 seconds.',
  invalidMcpImport: 'Enter valid MCP configuration JSON with 1–100 servers in mcpServers.', mcpImportTooLarge: 'Configuration file must not exceed 1 MiB.', mcpFileReadFailed: 'Could not read configuration file.', mcpUnsupportedTransport: 'This runtime does not support SSE. Use a Streamable HTTP endpoint.',
}

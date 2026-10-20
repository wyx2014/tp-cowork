# DSH 自检示例

用户问“有什么能力”：先 cordis_inspect_list，再按其返回调用 cordis_inspect_query。用户问“当前模型”：使用 cordis_inspect_self 和已发现的模型设置查询。用户要求改设置：读取原生 settings namespace/schema/revision，按请求更新允许字段；不猜旧 my(action=...) 键。用户问缺凭证：只返回已配置/未配置和引用名。

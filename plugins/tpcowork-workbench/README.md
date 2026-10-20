# TP Cowork 任务收尾插件

复用 DSH 的 `todo_write`、Session 日志和任务投影，在 `tools/result` 确认 `present` 最终成功后提醒助手写回实际任务进度；正常最终回复仍遗留 `in_progress` 时，通过 `agent/turn-stopping` 在同一轮补充一次核对提醒。提醒通过正常 Inbox 进入日志，刷新与历史恢复读取同一份任务状态。

插件不根据回复文字、文件扩展名或会话结束自动将任务改成完成。状态由助手根据实际结果通过 `todo_write` 写回；被阻塞的任务应保留待处理并说明原因。结束检查每个助手每轮最多追加一次，不在失败、取消或输出上限终止时强制继续。若模型忽略提醒，清单仍保留原状态。

安装使用 DSH Plugin Manager 添加 `link:/absolute/path/to/plugins/tpcowork-workbench`，或退出桌面后执行 `node scripts/desktop-plugin.mjs install workbench`。需要已有 `tools`、`sessionProjections` 和 todo 插件。禁用或卸载后取消所有监听，已记录的任务清单保留。

在 `deepseek-harness` 目录执行 `node node_modules/vitest/vitest.mjs run --config ../plugins/tpcowork-workbench/vitest.config.ts`，验证真实 AgentLoop、任务工具和文件交付的完成、失败、中断与防重复提醒行为。

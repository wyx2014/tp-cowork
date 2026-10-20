TPCO-5 / 自动化04 已修复协调退回的防递归作用域问题，交协调 Agent 复核。前置 TPCO-2、TPCO-3、TPCO-4 已通过 CLI 核对为 done；TPCO-6 保持 backlog。

## 本次退回复修

- 复现协调者原用例：普通聊天创建 task，自动 Turn=1 真实完成并释放 Agent，恢复结果 Session 后用户 Turn=2 调用 cron.add，原实现因历史归属标记拒绝创建。本次保留该回归文件，修正后通过。
- `src/tools.ts` 不再用整段历史归属/来源判定当前执行；仅当前未结束 Turn 内真实的自动消息来源触发防递归。分支按精确继承切点关联父 Agent 当前执行上下文，并在分支 Turn 开始时捕获，直到分支自己的 Turn 结束后解除；父 Turn 提前结束不能使运行中的分支递归创建。
- 结果 Session 的普通后续 Turn、完成历史的分支、准备失败且未开始自动 Turn 的恢复会话均可创建。保留全部持久化归属/来源证据及子 Agent 原有权限边界；恢复与清理接口未改变。
- `src/host.ts` 为工具增加显式 agents 依赖；Turn/Agent 监听与 cron 注册同属插件生命周期，卸载撤销。执行器、调度器、types/schema、用户模型来源/凭证/默认设置及 DSH 子仓库未修改。
- `tests/review-completed-chat.spec.ts` 扩展为 7 个真实 AgentLoop/JSONL 回归；`tests/tools.spec.ts` 改为当前 Turn/中断恢复语义；`tests/artifact-smoke.mjs` 增加构建产物中恢复后的真实用户调用及新自动 Turn 防递归。README、lib 和两个交付包同步更新。

## 修改与接口

- `src/tools.ts`：新增真实 DSH `cron` 工具，add/list/remove，reminder/task，原始一次日期、五/六/七字段 Cron/宏、正整数间隔；重复额外要求 repeat=true。普通用户的任务名称不用于权限判断。
- `src/host.ts`：组合插件按 tools/agents/workingDirectory/workspaceRegistry 就绪注册工具，卸载撤销；命名导出 registerAutomationTools。不注册第二个调度器/执行器。
- `src/client.ts`：本端写入串行；list 等待写入，读写交错时重新读取，阻止确认前的旧响应恢复已删除提醒或未读状态。未增加客户端调度或持久化。
- `tests/tools.spec.ts`：32 个新增用例，使用真实 AgentLoop、工具管线、Workspace、JSONL 和 Host 服务，仅替代外部模型流。
- `tests/artifact-smoke.mjs`：新增构建产物的聊天创建及纯提醒确认验证。
- `README.md`：参数、上下文、防递归、同步屏障及限制；同步生成 `lib/` 类型与 Host/Client 产物，刷新 npm 包和包含测试的源码交付包。

Gateway/Client 九个方法、共享 types/schema、持久化版本与表名保持不变。task 工具模式映射既有 executionMode=agent，reminder 映射 reminder；所有操作调用同一 AutomationServiceApi。

## 验收证据

- 聊天创建 once/custom 原样进入共享任务目录；通过 UI 共用的 update 方法编辑和重新加载 Host 后仍是原日期/Cron/间隔，未变成每日。
- 普通 Agent 创建任务，经唯一调度器运行，获得不同于创建聊天的真实独立 Session 和持久化终态；该结果 Agent 的递归 cron add 被拒绝，任务总数不增加。
- 防递归依据当前未结束 Turn 的真实来源及继承的当前执行上下文；Turn 结束后用户恢复/后续请求可创建。持久化归属继续留给终态恢复和清理，不充当永久限制；子 Agent 原有边界保留，提示词及任务名称不授权创建。
- 继承原创建 Session、原始项目和当前有效目录，最近一次仍可用的用户调用技能及当前可见 MCP 公开名称；不读取连接器配置/凭证，不修改用户模型来源、默认值或设置。
- 纯提醒运行零模型请求、零新增 Session，resultType=none、conversationAvailable=false；Host 持久化后发 run_finished。确认一次提醒删除任务，循环提醒保留并写 viewedAt；旧 list 晚到会重新查询；重载后结果不恢复。
- list 仅读用户自动化服务，原生内部任务未混入；Host 卸载后 cron 从工具 schema 撤销。

## 验证命令与结果

在工作区根目录执行：

```sh
node plugins/tpcowork-automation/build.mjs --typecheck
node plugins/tpcowork-automation/build.mjs
node deepseek-harness/node_modules/vitest/vitest.mjs run --config plugins/tpcowork-automation/vitest.config.ts
node plugins/tpcowork-automation/tests/artifact-smoke.mjs
```

Host/Client 类型检查及构建通过；Vitest **7 文件、437 用例通过**（既有398 + 聊天32 + 退回复修7）；协调者复现命令对应的 7 个回归全部通过；构建产物 smoke 通过。回归使用真实 AgentLoop/工具/Workspace/JSONL，外部模型流使用脚本；准备失败用例另注入项目关联错误。真实模型/MCP 联网和桌面 UI 未执行，不把脚本模型视为联网验收。

## 限制与后续集成

- 现有任务模型为单一 skillName，聊天绑定最近一次仍可用的用户技能调用。MCP 至多8个；现有 DSH ToolSchema 没有结构化 server identity，含多个 `__` 分界的名字无法可靠逆向，聊天明确拒绝并提示使用表单明确绑定，不猜测、不静默截断。后续若 Host 提供结构化公开身份，可替换这一提取步骤。
- 重复意图通过工具说明和 repeat=true 显式参数表达，与源工具的自然语言约定一致；未引入对任意语言用户请求的语义分类器。
- 后续 UI 对 none 结果调用 markRunViewed 确认，对 conversationAvailable=true 且 resultType=conversation 才打开聊天；当前已验证数据和服务契约，真实 UI 页面仍由06/07接入。
- 通知接既有持久化后的 automation/changed/run_finished；桌面通知、跨客户端事件同步由08接入。Client 屏障处理同一 facade 内的写入/轮询交错，不代替跨客户端同步。
- 05继续使用既有 Session 清理接口；本次未重做调度、执行器或删除会话。09统一替换原生 Schedule 工具和入口，须保留显式可恢复迁移，当前未替用户安装插件或移交旧任务。
- 改动只在 `plugins/tpcowork-automation`。根目录不是 Git 仓库，无可提交的插件 Git 工作树，因此未创建 PR；`deepseek-harness` 的既存修改保持原状。

本任务进入 in_review，协调 Agent 按既有授权复核后关闭并推进05；此次未直接关闭其他 Issue、合并、发布或部署。

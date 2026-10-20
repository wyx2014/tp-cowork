TPCO-8 运行记录中心已实现，交付协调复核。前置01～06均为 done；未启动08/09/10。

改动位于 `plugins/tpcowork-automation`。新增 `src/AutomationRunCenter.tsx`、`src/run-history.ts`、`src/open-run-session.ts`；更新 `src/AutomationPage.tsx`、`src/ui.tsx`、`src/ui-types.ts`、`src/ui-locales.ts`、`src/ui.css`、`package.json` 与 README。新增 `tests/run-history.spec.tsx`、`tests/run-browser-smoke.mjs`、`tests/fixtures/ui-run-browser.js`，适配既有 UI 测试与浏览器夹具。`lib` 已重建，既有 tgz 未更新。

| 验收项 | 实际结果 |
| --- | --- |
| 标题、排序、分组 | 全部历史含已归档 once；时间加任务名，按 startedAt 降序；中英文浏览器各深浅主题均验证7条记录、两个日期分组及最新在前。标题不读取模型标题。 |
| 搜索、状态、未读 | all/running/completed/error/unread 与搜索共用数据集合；搜索后筛选数量对应同一集合，顶层未读为全部终态未读。浏览器执行 REPORT 搜索和 running 筛选，渲染测试覆盖双语计数。 |
| 详情与已读 | 先打开详情，展示状态、耗时、起止、指令、错误、skipped 原因；终态持久化已读，失败可重试。运行中不标读，详情中观察终态后标读。成功已读 once 从任务页归档，运行页仍保留历史。 |
| 纯提醒和无结果 | none 仅确认，不推断会话；once reminder 确认删除整个任务/记录，循环提醒保留已读。legacy/missing 显示明确原因。不存在的显式结果打开失败可见，整个浏览器流程 session/create 调用数为0。 |
| 实时结果 | 真实 AgentLoop 的 LIVE_FIRST_CHUNK、LIVE_FINAL_CHUNK 经 Host SessionController、HTTP流、生产 ClientSessions 到达浏览器。生产 UiWorkspace 导航取得 mainView 引用后释放 automationResult 引用，运行中保持未读。 |
| 历史结果 | 历史 Session 打开前无活跃 Agent，数据已写入真实 Zstandard JSONL。通过既有控制器冷加载 DURABLE_HISTORY_RESULT，再持久化标准标题并导航；未复制会话运行时。 |
| 重开与竞争 | Automation Host 插件从真实 JSON 重开、浏览器重载后，已读/归档、一次提醒删除、循环提醒确认均保留；渲染测试验证旧轮询不能复活记录及离开详情取消打开。 |
| 删除 | 先确认，可取消和重试，pending 防重复，运行中禁删。真实活跃 Agent 导致清理拒绝且保留记录；捕获并释放测试自己恢复的准确 Agent handle 后，再注入 SessionPersistence.delete 故障，错误和记录仍保留；重试成功删除 JSONL、查询目录及运行记录。 |

已执行的检查：

```sh
cd plugins/tpcowork-automation
node build.mjs
npm test -- --reporter=dot
node tests/artifact-smoke.mjs
node tests/browser-smoke.mjs
node tests/review-project-clear.mjs
node tests/run-browser-smoke.mjs
```

构建含 Host/Client 类型检查，通过。插件10文件492用例通过，保留原481用例；新增11条覆盖运行交互与竞争。产物 smoke、原浏览器 smoke、协调者项目清空复验、新运行中心浏览器检查均通过。日志在 `test-results/tpco8-checks/`，交互报告与四主题及实时/历史/清理截图在 `test-results/run-browser/`。

DSH 定向检查命令（在 deepseek-harness 目录）：

```sh
node node_modules/vitest/vitest.mjs run packages/api/session-controller/tests/reference-ownership.client.spec.ts packages/api/session-controller/tests/transport.host.spec.ts packages/session/session-persistence-jsonl/tests/delete.spec.ts packages/client/ui-workspace/tests/apply.client.spec.ts --maxWorkers=2 --reporter=dot
```

首次3文件56用例通过，reference-ownership 启动前失败：测试的 bundleRoster 用 resolve.paths 扫描包目录，未识别 web-app 的自身包引用，根 node_modules 又没有该链接。复验时临时链接 `node_modules/@deepseek-ai/dsh-web-app` 到已有 `packages/bundle/web-app`，仅重跑该文件，17用例通过，随后移除链接。合计4文件73用例通过；该测试夹具解析限制未修改到 DSH 源码，今后在同样依赖布局运行该文件可能仍需此临时链接。日志保留首次失败及单独通过结果。

08/09接口交接：九个 automation 管理方法、bindings、schema、持久化版本均不变。页面继续使用同一个 AutomationCatalog 和 schedules slots；五秒计时器仅刷新，尚非跨客户端事件同步。`AutomationUiServices.openSession` 现在为 `(id, standardTitle, signal) => Promise<void>`，必须等待并处理失败。UI 注入新增 `sessions`，包的 `dsh.client.inject` 新增现有 `@deepseek-ai/dsh-api-session-controller`。打开路径刷新目录、等待 sessions.using 的 ready、检查 openState/removed，再调用现有 rename/openSession；未调用 create/startSession 作为缺失兜底。导航显示标准标题遵循宿主既有标题字节上限，完整任务名在运行中心保留。

删除与生命周期限制：关闭客户端视图只释放客户端引用，不保证释放 Host 已恢复的 Agent。活跃归属必须由其拥有者释放，或停止该 Host 生命周期后再删；UI会保留记录并说明清理失败。后续打包须同时包含本次重建的插件 Client/声明及前阶段必要 DSH 产物，不能使用现有旧 tgz 代表本阶段。

证据边界：外部 LLM 为受控流；外层 workspace/layout、未使用的 file-upload 注册和转录展示为夹具。真实 Host/Client 会话控制器、导航、AgentLoop、SessionQuery、JSON/Zstandard持久化和清理确实执行。尚未验证完整 Electron 应用重启、真实外部模型/MCP联网、Windows、最终离线安装或桌面通知，留待既定08/09/10。

未修改 DSH 源码或既存用户改动，未自动提交/创建PR/合并/发布/安装，未修改用户模型来源、凭证或默认选择，未导入旧数据。根目录不是Git仓库，本项无需PR。测试服务及临时链接均已清理。

TPCO-9（自动化08）代码已实现，当前状态为 blocked。前置01～07均为 done；09/10未启动。唯一未完成验收是操作系统原生通知实投递及原生横幅点击，不能按浏览器或 spy 结果判定通过。

2026-10-15 成员已明确授权开启测试 Electron（`com.github.Electron`）的 macOS 通知。本轮已核对同组只有本次活动运行，并按要求在 `deepseek-harness` 执行 `pnpm run start:desktop`，真实桌面启动并可通过现有调试端口连接。该启动器创建独立应用 Harness Dev（`com.deepseek.harness.dev.0e6a4a0cbedb`）；它与获授权的测试 Electron 身份不同，启动成功不能替代插件通知验收。启动记录与裁去侧栏的截图见 `test-results/native-desktop/`。

尝试打开系统通知设置后，System Events 明确拒绝 osascript 的辅助访问（错误 -1719：`osascript 不允许辅助访问`），因此无法自动切换通知开关或点击系统横幅。没有更改其他权限，也没有把既有通知授权当作新增辅助功能授权。实际 Electron 43.0.0 复验中，渲染器 Notification.permission 仍为 granted，真实 Web Notification 构造成功但无 show；主进程 isSupported=true，failed 仍返回 `Notifications are not allowed for this application`。`--native-click` 已执行到失焦窗口后的投递等待，未进入横幅点击成功分支。证据为 `test-results/sync-browser/native-failure.json`、`native-main-probe.json` 和 `test-results/native-desktop/revalidation.json`。

## 实现与接口

- `src/changes.ts`、`src/remote.ts`、`src/host.ts`：增加独立只读 namespace `automationChanges/watch(signal)`。使用既有 Typert Gateway 流与取消机制，返回 ready/changed 帧；changed 只带 revision/taskId/runId?/reason，无提示词或凭证。Host/Client 共用描述符及校验，Client/Host/Remote 声明入口均导出 ChangeFrame，供下阶段消费者取得类型合并。
- 九个 automation 管理接口、automationBindings、任务 schema 和持久化版本均不变。订阅失效只触发 list，revision 不作为跨重启版本。事件可合并，运行终态以 Host 目录为准，run_bound 不当作完成。未增加客户端调度或存储。
- `src/run-monitor.ts`、`src/ui.tsx`、`src/AutomationNotices.tsx`：插件级共享目录和两秒刷新兜底，不依赖任务页挂载；通过 shell.overlay 注册八秒 Toast。Connection reset 与异常流结束重建订阅，保留 runId 去重集合；首次成功历史静默，后续真实 completed/error 才通知，已读终态保持静默。
- `src/ui-state.ts`、`src/ui-types.ts`、`src/AutomationPage.tsx`：生产使用同一 AutomationCatalog，独立页面测试可提供本地目录。失效丢弃在途旧读取并补读；写入期间延迟刷新；不回退已知 viewedAt，不恢复 Host 已删行，不覆盖编辑草稿。新增 `AutomationUiServices.catalog?` 和目录中的 task/run 导航目标。
- `src/AutomationRunCenter.tsx`：Toast 和原生 click 共用精确 task/run 详情导航，清除旧搜索筛选；目标已被移除显示明确提示。none 等待明确确认，不因打开通知自动确认一次提醒，不创建或推断 Session；原会话打开/取消流程保持有效。
- `src/ui-locales.ts`、`src/ui.css`：中英文完成/失败文案及主题变量样式。原生投递复用 Electron Chromium Web Notification，click 聚焦应用并定位详情。
- Client 停用清除刷新/Toast 定时器、目录监听、Gateway 订阅、原生通知及 click 处理器。Host 订阅捕获插件自身 Context，Client 断开或 Host 停用均唤醒等待并结束流；任务和历史保留。

没有修改 deepseek-harness 源码或其既存变更，没有修改用户模型来源、凭证、默认选择或导入旧数据。工作区根目录不是 Git 仓库，因此未提交未知修改、未创建 PR、未合并/发布/安装。

## 已执行的验证

以下命令均在 `plugins/tpcowork-automation` 执行：

| 命令 | 最终结果 |
| --- | --- |
| `npm run build` | Host/Client 类型检查、运行产物及声明生成通过 |
| `node tests/declaration-smoke.mjs` | 只读取发出的 Client/Remote 声明编译外部消费者，包含 automationChanges 的类型合并 |
| `npm test` | 11文件501用例通过，保留原492用例并新增9条同步/通知回归；原传输测试增加真实流及 Host 卸载验证 |
| `node tests/artifact-smoke.mjs` | 构建后 Host/Client、真实 AgentLoop/JSONL/聊天工具及原模型选择验证通过；九个管理方法与只读订阅分开计数 |
| `node tests/browser-smoke.mjs` | 双语、深浅主题、模板、编辑、草稿保留、真实 Gateway/JSON 持久化及卸载通过 |
| `node tests/review-project-clear.mjs` | projectId:null、持久化清空、目录独立及 Host 重开通过 |
| `node tests/run-browser-smoke.mjs` | 真实 Session 控制器、AgentLoop 受控流、Zstandard 历史、结果导航、已读、清理拒绝/失败/重试通过 |
| `node tests/sync-browser-smoke.mjs` | 离页推送、精确详情、run_bound 不误报、重复事件/重连去重、两秒兜底、双客户端已读/删除、载体断线与 Host 重开、零残留卸载通过 |
| `node tests/dsh-regression.mjs` | DSH定向4文件73用例通过，日志保存在 `test-results/tpco9-checks/dsh-regression.log` |
| `node tests/sync-browser-smoke.mjs --electron` | **未通过**：真实系统投递被拒绝，主进程 failed 文本如上；未把对象构造、浏览器 Toast 或截图计为桌面投递成功 |

DSH检查包含 reference-ownership.client、transport.host、session-persistence-jsonl/delete、ui-workspace/apply。测试辅助仅在不存在时创建 web-app 自解析链接，在 finally 中核对自己创建的链接后移除，不覆盖既有链接。没有改 DSH 源码规避检查。

浏览器证据保存在 `test-results/sync-browser/report.json`、`off-page.png`，既有交互报告分别在 ui-browser、ui-review-project、run-browser。外层 layout/workspace 是夹具；新同步测试通过受支持的自定义 RPC 载体使用真实 Gateway 与 HTTP/JSON 流，并非完整生产 Electron 组合。真实 AgentLoop 和会话行为使用已有运行中心 smoke 验证，外部模型为受控输入，不代表真实外网/MCP 联通。Windows、最终离线安装与调度所有权移交仍属后续阶段。

## 剩余验收与09交接

系统通知授权已经充分，不需重复确认。当前需要成员手动在“系统偏好设置 → 通知与专注模式 → Electron”允许通知，并协助点击测试横幅；或者为当前自动化工具提供辅助功能访问后再自动操作。辅助访问是否允许需成员决定，本轮已提出该独立请求，尚未收到回复。恢复后执行 `node tests/sync-browser-smoke.mjs --native-click`：必须收到真实 show，并在120秒内点击系统中 TPCO-9 native delivery 的横幅。该模式要求可信原生 click、窗口从未聚焦变为聚焦、详情 data-task-id/data-run-id 精确命中当前运行（同一任务预先保留另一条历史），并检查 none 仍需显式确认；不会派发合成点击。未达标时保持 blocked，不进入 in_review/done，不启动09。

本轮重新执行 `npm run build`、三个测试脚本语法检查及 `node tests/sync-browser-smoke.mjs`，均通过；`--electron` 和新增 `--native-click` 均因相同系统拒绝未通过。未重复运行上轮已通过的501/73用例。代码仅为运行详情添加 task/run DOM 标识，并扩展测试记录可信 click 及聚焦/精确定位；真实横幅成功路径仍待验证。Toast 点击与原生 onclick 共用导航的单元/浏览器结果不能替代该验收。

09后续需重新打包当前 `lib/host.js`、`lib/client.js`、`lib/remote.js`、共享产物和全部 `lib/types/*.d.ts`，包含 changes/run-monitor/UI 新声明，不能复用旧 tgz。`uiDependencies` 现在等待 layout 与 remote.automationChanges；既有 UI 注入包含 layout，Gateway 提供 Connection 与流监督。没有新增 DSH 包依赖或第二套会话运行时。后续生产组合需验证既有 WebSocket 物理载体与新只读 namespace 一同可用。05必要 DSH SessionPersistence/JSONL/Workspace 及07会话控制器依赖仍须一并交付。

随评论提供的 `tpco-9-sync-workspace.tgz` 是插件源码、重建产物、测试及证据的审阅快照，不能视作09已完成的离线安装包。原有版本 tgz 未覆盖。所有本次测试服务和 Electron 窗口均已结束，临时数据和测试链接已清理。

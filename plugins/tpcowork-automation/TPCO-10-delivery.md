TPCO-10 已实现插件组合、显式原生调度移交及 macOS Intel 离线 kit。系统原生通知实投递与可信横幅点击仍未通过，因此任务保持 blocked，不启动 TPCO-11。代码在独立分支 `agent/core-dev/tpco-10` 交付，不推送、合并、发布或部署。

## 变更

- `scripts/desktop-plugin.mjs` 增加 automation 安装目标及产物前置检查；`cordis.patch.yml` 关闭原生 Schedule Host/UI，启用 `nativeTakeover:true`。TP UI 的源码与 `client.js` 同步调整：发现自动化入口即撤下原生标题适配。
- `src/native-transfer.ts` 增加 Host 服务 `automationMigration` 和独立 v1 域 `tpcowork_automation_transfer`。`src/host.ts` 在移交完成后才挂载唯一调度器、执行器和 cron 工具；激活失败会撤销部分挂载，允许恢复。
- `src/remote.ts` 增加 `automationMigration/migrate({confirm:true})`，返回原目录结构；`status.migration?` 携带 waiting/interrupted/complete、pending 和 pausedOverdue。九个原管理方法保持不变。页面增加双语确认、恢复与过期提醒提示。
- `pack-offline.mjs` 收集当前 worktree 的完整运行依赖闭包、最新 Host/Client/声明/源码、Web 与桌面资源、Electron、Node、官方 primary-runtime 和 Office 辅助文件。包内使用相对链接，manifest 记录文件 SHA-256 和链接目标，拒绝越界链接；记录 sourceCommit/sourceDirty 及平台架构。
- `offline.mjs` 提供 verify/install/remove/list/dump-config/launch，强制显式 home。安装使用官方 Desktop CLI 和离线 pnpm，增加 automation 与 TP UI；不安装 tpcowork-core。卸载只移除 automation，保留 TP UI 和持久化数据。首次安装、更新、禁用及卸载说明见 `OFFLINE.md`。

没有修改 DSH 源码、工具箱产物或用户模型来源、凭证、默认选择；没有导入旧工程数据。起始 HEAD 为 `40142819`，已核对包含共同基线 `c9b555fc47bce241d7b1113f5d4bfd6760824814`；源码、安装、构建与测试均在本任务 worktree 进行。

## 调度移交

无旧 active 原生任务时直接启用自动化。有旧任务时只挂载原生 ScheduleService 继续调度，新调度器不启动；原生工具随原服务存在，移交后撤销，仅保留 cron。

用户确认后，按稳定 ID `automation-native-<native-id>` 持久化暂停副本，再保存 prepared 检查点。排空原生在途投递并重读最新任务，核对副本已持久化后逐条将原生任务设为 inactive，最后激活新定义并启动自动化。原生行及投递历史保留在原域，原 Session 和可识别的项目/目录关联保留；不会把旧投递伪装成新的运行记录。

中断重启后两个调度器都等待显式恢复；检查点可重试，不重复创建副本。在途一次提醒已投递时，目标定义保持 completed；过期但未投递的一次提醒保留原时间、保持 paused，并明确提示人工检查后立即运行。循环任务使用自动化既有重启规则计算后续时间，间隔任务从恢复时刻计算下一间隔，不追补停机周期。毫秒日历规则不能表示时拒绝移交，旧任务继续调度；可暂时停用 automation，在原生管理中调整为整秒后重试。

禁用/卸载撤销新调度、监听和通知，保留任务、历史及检查点。已完成移交的原生行仍 inactive，不会因卸载恢复执行。未确认移交的旧任务仍归原生服务；中断迁移应恢复完成后再卸载。Host 退出期间不执行任务。

## 验证记录

环境：macOS 12.7.6、darwin-x64、Node 24.14.0、Electron 43.0.0、pnpm 11.28.5。只验证此平台；没有 Windows、arm64、签名安装器或真实外部模型/MCP 联通证据。

| 验证 | 结果 |
| --- | --- |
| automation `build.mjs` | Host/Client 类型、运行产物及声明通过 |
| automation Vitest 全集 | 12 文件、510 用例通过 |
| 原生移交定向测试 | 8 用例，含确认、写失败、部分停用失败后重启恢复、过期一次任务、准备期间移除及在途投递排空/回执保留 |
| TP UI lifecycle | 4 用例通过，包含自动化出现时撤销原生标题适配 |
| `tests/artifact-smoke.mjs` | 构建产物、真实 AgentLoop/Session 清理、聊天 cron 及原模型选择保留通过 |
| `tests/declaration-smoke.mjs` | 外部 Client/Remote 声明消费者通过 |
| DSH Host、Client bundling、Web、primary-runtime | 构建通过，官方 Office round-trip/依赖准备通过 |
| DSH 完整 Client 聚合类型检查 | 未通过：既有两处 TS6307，见下文 |
| 离线 verify | 文件哈希与包内链接验证通过；最终清单随 kit 提供 |
| OS 断网 install/remove/reinstall | 在独立 home 通过；卸载和重装前后存储逐文件哈希一致 |
| OS 断网生产 Host | 只允许 loopback，生产 Host ready、认证后的本地页面及干净关闭通过 |
| 完整 Electron/Host/Client | 使用 kit 内全部运行文件，真实页面创建纯提醒、执行完成、持久化运行记录通过；卸载后自动化页面撤销；重装后原历史可见且不重放 |
| 系统原生通知 | 未通过；不能以 Toast、构造成功或 spy 替代 |

可复验命令（在 worktree 根目录）：

```sh
node plugins/tpcowork-automation/build.mjs
node deepseek-harness/node_modules/vitest/vitest.mjs run --config plugins/tpcowork-automation/vitest.config.ts
node plugins/tpcowork-automation/tests/artifact-smoke.mjs
node plugins/tpcowork-automation/tests/declaration-smoke.mjs
node plugins/tpcowork-automation/pack-offline.mjs artifacts/tpco10/offline-kit-final
artifacts/tpco10/offline-kit-final/node artifacts/tpco10/offline-kit-final/offline.mjs verify
sandbox-exec -p '(version 1)(allow default)(deny network*)' artifacts/tpco10/offline-kit-final/node artifacts/tpco10/offline-kit-final/offline.mjs install --home artifacts/tpco10/clean-home
node plugins/tpcowork-automation/tests/offline-host-smoke.mjs artifacts/tpco10/offline-kit-final artifacts/tpco10/clean-home
node plugins/tpcowork-automation/tests/offline-desktop-smoke.mjs artifacts/tpco10/offline-kit-final artifacts/tpco10/clean-home create
```

`offline-desktop-smoke.mjs` 另支持 retained/removed 两种模式，需先对应重装/卸载。Playwright 仅作为验证驱动；应用运行文件全部来自 kit。安装/Host 使用 macOS 网络策略封禁外部网络；GUI 保持 Chromium 自身 sandbox，未通过关闭 sandbox 来强行套用嵌套网络策略。GUI 本身的全进程断网不另作通过声明。日志中的临时认证 token 已遮蔽；kit 不包含测试 home 或用户数据。

## 剩余阻塞及集成注意

本轮 `tests/sync-browser-smoke.mjs --electron` 再次得到 renderer `Notification.permission=granted`，但主进程 `Notification.isSupported=true` 的真实投递返回 `failed:Notifications are not allowed for this application`，未收到 show。可信系统横幅点击因此无法开始。历史 macOS 辅助访问 -1719 的缺口保留；没有申请或更改额外系统权限，也没有把 Electron 已获通知授权扩大为辅助功能授权。

最小外部动作是让测试 Electron 身份 `com.github.Electron` 实际获准系统通知投递，再由成员协助点击横幅；如希望自动操作系统横幅，辅助功能授权需另行明确决定。此后运行 `tests/sync-browser-smoke.mjs --native-click`，必须同时验证真实 show、可信 click、窗口聚焦、准确 task/run 详情及 none 的明确确认，才可交复核。系统通知验收未达标前不应将本任务标为 in_review/done，也不启动 TPCO-11。

DSH 完整 Client 聚合工程的既有 TS6307 来自 `apps/desktop/src/browser-plugin.ts`、`browser-plugin-protocol.ts` 未进入工程文件清单。定向类型与 Client bundling 通过不能代表完整聚合检查通过。后续由协调 owner 按独立分支复核集成；本任务不推进共享基线，不覆盖工具箱配置和打包产物。

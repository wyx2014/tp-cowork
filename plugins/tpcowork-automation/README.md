# TP Cowork Automation

外置 Cordis 插件 `@tpcowork/dsh-automation`。提供 Host 管理、持久化、唯一调度器、任务页/编辑器、六个模板、独立 AgentLoop 执行、运行会话清理和全局通知。完整安装组合支持显式、可恢复的原生调度移交；首次安装、更新、禁用、卸载与离线 kit 见 [OFFLINE.md](OFFLINE.md)。原生系统通知的真实投递与可信点击仍须按交付记录单独核验。

## DSH 界面与桌面接入

自动化的功能和交互参考 `nanobot-gui/src/components/schedule`，视觉遵循当前 DSH：复用主题颜色、字体、圆角和控件尺寸，页头与插件页使用相同的标题层级及内容边距，任务与模板采用 Zcode 风格的双列卡片，包含两行指令摘要、调度及下次运行标签、运行次数；卡片不显示时区，整张任务卡可进入编辑，悬停或键盘聚焦时显示操作。顶部为任务和运行记录双页签，任务卡显示执行规则、下次运行和运行次数，项目通过首页同款菜单选择，已有技能/MCP 绑定在编辑后保留。未读按钮定位到该任务最新的未读运行，提醒仍须明确确认；侧栏显示未读圆点。六个模板仅填写草稿。新建/编辑页参考 Zcode：面包屑、设置/历史页签、单栏任务标题/调度/指令，指令框上方使用首页同款项目选择按钮和弹出菜单，底栏选择权限、模型和思考强度；不提供“更多设置”，已有描述、执行方式、工作目录、技能和 MCP 配置继续保留。“添加计划”先选频率，再在同一行修改时间、星期或月日，时区自动采用本地设置，页面无需手填，编辑页的历史只显示当前任务，切换页签保留草稿。界面适配中英文、深浅主题和窄窗口，调度与执行均由既有 Host 服务负责。

桌面初始化后，完整退出应用，在工作区根目录执行下列命令，再打开桌面，即可从侧栏“自动化”进入：

```sh
node plugins/tpcowork-automation/build.mjs
node scripts/desktop-plugin.mjs install automation
```

新建任务支持助手执行和纯提醒，频率支持一次、每小时、每天、每周、每月、工作日、自定义 Cron/间隔及手动。聊天创建的简单五字段 Cron 在卡片和编辑页回显为对应频率与时间（例如 `0 9 * * *` 显示为每天 09:00）；仅修改标题、指令等内容会保留原始 Cron，明确修改调度时才保存表单中的新规则。复杂 Cron、秒/年份字段和间隔仍使用自定义编辑器。助手任务每次创建独立 DSH 会话，结果从运行记录打开；纯提醒不调用模型。任务只在应用运行且电脑保持唤醒时执行。安装不更改模型配置或导入源 GUI 数据；发现已有原生提醒时，页面要求明确确认移交后才启用新调度器。

未选择项目且执行目录留空时，助手任务使用 DSH 的默认工作目录；已有任务中保存的空目录同样适用。无项目的运行会话在侧栏「定时任务」虚拟分组中显示，绑定项目的会话保留原项目归属。分组从 Session 中既有的运行所有权记录投影，不依赖任务保留的最近20条运行，也不创建占位项目；升级后只读补齐旧运行的投影，重启后仍可识别。聊天区域直接显示原始任务指令，右上标注时钟及「由定时任务发送」，不再显示通用执行请求折叠条。

底栏通过既有 `session.modelCatalog` 和 `permissionPresets.catalog` 读取运行选项，`modelSelection`（含可选思考强度）和 `permissionPreset` 随任务保存，每次运行时应用到新建的会话。未选择时沿用现有默认行为；选择“跟随默认”会清空任务覆盖值。不会修改 DSH 的全局默认模型或权限。

## 状态同步与结果通知（子任务08）

`src/changes.ts` 定义只读 `automationChanges/watch(signal)`，经既有 Typert Gateway 流载体输出 `{type:'ready'}` 和 `{type:'changed',change:{revision,taskId,runId?,reason}}`。订阅在 ready 前建立；多次失效可以合并，客户端每次重新读取 Host 目录，不把事件或 revision 当作运行结果。revision 仅属于一次 Host 激活，重启归零仍能重新读取。`src/remote.ts` 同时注册 Host 和 Client 描述符与取消参数；九个 automation 管理方法、bindings、任务数据及持久化版本不变。接收者由 Host 插件自身 Context 持有，Client 断开或 Host 停用均结束订阅。

`src/run-monitor.ts` 与 `src/ui.tsx` 在插件生命周期内共用一个 `AutomationCatalog`，不依赖任务页挂载。Host 推送、Connection reset 和两秒刷新共同同步状态；异常结束的只读流会重新建立。刷新期间的失效会丢弃旧响应并补读，写入期间的失效等待写入后补读，已知 viewedAt 只取较大值，不恢复 Host 已移除的行。编辑器草稿保持独立。

首次成功目录只建立终态基线，不弹历史通知。后续按 runId 去重 completed/error，running/run_bound 不通知，已读终态不再通知；重连、Host revision 重置、离页及临时移除不清空去重集合。结果只以系统通知告知，不在页面内绘制 Toast；通知点击选择 schedules 下的指定 task/run 详情，不创建 Session。none 详情等待明确确认；once reminder 的确认移除任务和记录，循环提醒保留已读历史。目标已不在最近20条记录中时显示记录已移除。

桌面应用中经 `dshDesktop.notifications` 由主进程显示原生系统通知（参照 ZCode：任一应用窗口聚焦时不显示，同一运行三秒内去重，点击先恢复并聚焦窗口再打开详情）；Windows 安装版以安装器快捷方式的 AppUserModelID 投递。普通浏览器中回退到 Web Notification，仅在现有权限为 granted 时尝试，不请求或修改系统权限。设置 › 通用中的“任务通知”开关同时控制自动化结果与会话通知。Client 卸载清除刷新定时器、订阅、通知点击订阅及原生处理器；Host 停用也会唤醒并结束等待中的订阅。数据仍由 Host 保留。

`tests/run-monitor.spec.ts` 和 `tests/transport.spec.ts` 覆盖终态去重、初次失败后基线、旧读/推送/写入竞争、已读单调、两秒离页刷新、晚响应、真实 Gateway 流与双端卸载。`tests/sync-browser-smoke.mjs` 验证构建产物的真实 Host/Client Gateway、JSON 存储、HTTP 流、跨页系统通知（页面内以桥接桩记录）、第二客户端已读/删除、断线和 Host 重开；外层 layout 是夹具。`--electron` 额外要求真实原生 show 事件；`--native-click` 还要求120秒内发生可信系统点击，并验证窗口由失焦转为聚焦及准确的 task/run 详情（同一任务含多条运行），none 仍须显式确认。本机 Electron 43 主进程仍返回 `Notifications are not allowed for this application`。成员已授权开启 Electron 通知，但 macOS 拒绝 osascript 辅助访问，无法操作系统开关及横幅；历史08交付曾因该缺口 blocked；当前状态与复验结果以 TPCO-10-delivery.md 为准。需人工开启通知并点击，或取得辅助功能访问后复验；未更改系统权限。

```sh
node plugins/tpcowork-automation/tests/sync-browser-smoke.mjs
node plugins/tpcowork-automation/tests/sync-browser-smoke.mjs --electron
node plugins/tpcowork-automation/tests/dsh-regression.mjs
```

## 构建和验证

在工作区根目录执行。需要已经构建过的 `deepseek-harness`、Node 22.19+ 或 24，以及该工程已有的 TypeScript、esbuild、Vitest 和 Zod。

```sh
npm ci --prefix plugins/tpcowork-automation --ignore-scripts --legacy-peer-deps --no-audit --no-fund
node plugins/tpcowork-automation/build.mjs
node plugins/tpcowork-automation/build.mjs --typecheck
node deepseek-harness/node_modules/vitest/vitest.mjs run --config plugins/tpcowork-automation/vitest.config.ts
node plugins/tpcowork-automation/tests/artifact-smoke.mjs
```

构建输出 `lib/host.js`、`lib/client.js`、`lib/types.js`、`lib/schemas.js`、`lib/remote.js` 和 `lib/types/*.d.ts`。Host 为 ESM；Client 为 DSH `window.__ModuleLoader__.load` 工厂，不在 Node 中直接导入。根 tsconfig 只组合 Host/Client 两个编译面。Zod 和 Croniter 兼容实现随构建内联，许可证放在 `lib/licenses`；DSH 服务使用宿主已有实例。运行时不依赖 Python、cron-parser、Luxon 或 sibling 源工程。

## 服务与持久化

加载包根入口后提供 `ctx.automation`，依赖 `storageDomain` 和 `typert`。`cordis.patch.yml` 只插入本插件。Host 组合等待现有 agents、agentLoop、sessions、sessionPersistence、sessionQuery、workingDirectory、workspaceRegistry、agentDefaultModel 和 tools 服务就绪后自动注册 DshAutomationExecutor；服务不足时仍可管理定义，但 enabled=false。域名为 `tpcowork_automation`，版本为 1，表名为 `tasks`；存储位置由宿主的 storage-domain 路由决定，例如 JSON 后端下的 `tpcowork_automation.json`，不按客户端目录另建数据库。

每次变更串行执行，校验整个任务记录，等待后端持久化后再更新可读状态并发出通知。读取返回独立快照；写入失败保持旧状态且不发出成功通知。JSON 语法、版本、记录类型、任务键、运行归属、重复运行、状态、会话关联或结果可用性有误时，加载失败并返回 `automation/invalid_persistence`，保留原数据。采用 storage-domain 默认的拒绝策略，不使用 backup-and-skip，不把损坏记录替换成空库。

卸载停止新请求和计时器，撤销 Gateway 接口，向执行器发出 AbortSignal，等待已准入操作、执行器、已排队写入和通知结束，然后关闭域句柄；定义及运行历史不删除。Host 退出后不执行任务。重新加载读取原数据及已读时间。完整 patch 以 `nativeTakeover:true` 启用原生移交；直接挂载管理服务不进行移交。两者均不修改模型、凭证、默认模型或用户配置。

## 共享入口与接口

共享定义由 `src/types.ts` 拥有，消费者导入包的 `./types`；JSON 校验导入 `./schemas`。后续任务增加模块而不另建一份任务类型。共享入口、Host/Client 入口及协议变更由主任务协调者统一整合。

Host 和 Client 都提供 `AutomationServiceApi`。所有成功调用返回 `{ tasks, status: { enabled, jobs, next_wake_at_ms } }`。任务列表按创建时间降序，运行列表按实际写入顺序最新优先。`enabled` 表示唯一 Host 调度器及真实执行器已就绪；执行器缺失、恢复中或正在撤销时为 false。此时仍可保存定义和计算 nextRunAt，但没有执行计时器，`runNow` 返回 `automation/runtime_unavailable`。`next_wake_at_ms` 是持久化计划的最早目标，不代表未就绪服务会执行任务。客户端不计算执行计划。

| 方法 | 参数 | 源 `src/core/api.ts` 行为对应 |
| --- | --- | --- |
| `list()` | 无 | `fetchScheduleTasks`，全量定义与历史 |
| `create(request)` | `AutomationCreateRequest` | `createScheduleTask`，返回完整目录；新增 ID 可通过返回目录比较取得 |
| `update({ id, data })` | `AutomationUpdateRequest['data']` | 完整表单字段；projectId/modelSelection/permissionPreset 省略保留、null 明确清空、具体值替换；非 manual 编辑后启用，manual 编辑后暂停 |
| `delete({ id })` | 任务 ID | `deleteScheduleTask`，删除定义和历史，不删除已有 Session；运行中拒绝 |
| `pause({ id })` | 任务 ID | `pauseScheduleTask`，撤销后续计划；当前运行继续，已完成的一次性任务保持 completed |
| `resume({ id })` | 任务 ID | `resumeScheduleTask`，Host 重新计算下一时间；manual 无自动目标，过去的 once 不补跑 |
| `runNow({ id })` | 任务 ID | `runScheduleTaskNow`，允许手动执行暂停任务；返回准入后目录，不等完整执行结束 |
| `markRunViewed({ taskId, runId })` | 精确运行 ID | `markScheduleRunViewed`，终态记录的已读时间只设置一次；一次性纯提醒确认后删除整个任务，与源网关一致 |
| `deleteRun({ taskId, runId })` | 精确运行 ID | `deleteScheduleRun`，运行中拒绝；先清理显式专属 Session，再删历史；清理失败保留记录供重试 |

两个客户端字段 `runId` 与 `id` 对新运行始终相同。不导入 nanobot-gui 的旧任务、会话或设置，也不隐式读取原生 Schedule 的历史。`totalRuns` 与源 API 相同，是当前保留的记录数，最多 20，删除记录后递减。

项目清空使用更新请求专属的 `projectId:null`，可穿过 JSON/Client Gateway/Host Gateway；Host 在写入前转为无绑定。`AutomationUpdateRequest.data` 在完整草稿基础上允许 projectId、modelSelection、permissionPreset 使用更新专属的 null 清空标记，共享 updateSchema、Host 和 Client 校验一致。省略 projectId 保留旧绑定（包括当前不可用的项目），显式 ID 替换；直连 Host 显式传 undefined 的旧清空行为保留。创建输入、ScheduleTaskDraft、ScheduledTask 和持久化 schema 仍为可选 WorkspaceId，不接受 null，存储版本不变。客户端完整编辑表单在选择“无项目”后发送 null；其他消费者更新项目时须遵守上述三态语义，不能依赖 JSON 保留 undefined。workspacePath 是独立表单字段，清空项目不会清空用户显式目录。

## 聊天工具与纯提醒

默认 Host 组合在 tools、agents、workingDirectory、workspaceRegistry 就绪后注册唯一 `cron` 工具及当前 Turn 监听，卸载时撤销。它直接调用同一个 `AutomationServiceApi`，不注册调度器或执行器。参数根保持普通对象，仅 action 必填，各动作条件由工具检查。

- `add`：message 和 mode 必填，mode 为 reminder 或 task；at、every_seconds、cron_expr 恰好一项。名称默认 message 前 30 字，description 可选。原始 Cron 五/六/七字段及宏直接传给共享服务，不变成每日。
- `at` 为一次日期；无偏移时按 Host 本地时区，DST 折叠/缺口沿源 ZoneInfo 默认 fold=0 解析；带偏移按绝对时间保存。重复须由用户明确要求，并额外设置 `repeat:true`；一次日期拒绝 repeat=true，Cron/间隔缺少 repeat=true 则拒绝。tz 只用于 Cron，省略为 Host 时区。
- `list` 返回同一用户目录的 ID、模式、规则、状态、下次执行及公开绑定；不调用原生 Schedule，也不列出其内部任务。`remove` 使用 list 返回的 job_id，经同一删除接口处理。
- 继承真实创建 Session、原始项目及当前有效目录；现有任务模型是单一 skillName，因此绑定最近一次仍可用的用户技能调用。MCP 从当前 Agent 可见的工具公开命名空间提取，最多 8 个；不读取配置、凭证或任务说明中的绑定。DSH 当前工具 schema 没有结构化 server identity，含多个 `__` 分界的歧义命名拒绝创建，并提示通过表单明确绑定，避免猜错连接器。
- 防递归仅覆盖当前未结束的自动 Turn，依据该 Turn 内真实的 `tpcowork-automation` 消息来源。分支只有在继承切点对应父 Agent 当前未结束的自动执行上下文时才继承限制；Turn 开始时捕获该上下文，持续到分支自己的 Turn 结束，即使父 Turn 先完成也不能中途递归创建。Turn 结束后，用户正常后续消息、恢复聊天及完成历史的分支均可创建明确授权的任务。持久化归属/来源记录保留供终态恢复与安全清理，不作为永久限制；准备失败、从未启动自动 Turn 的会话也不会仅因归属记录而限制首次用户 Turn。子 Agent 原有禁止创建边界继续保留。任务名称和提示词不影响判断，list/remove 沿源工具保持可用。
- reminder 沿用现有执行器直接结束为 `resultType=none`、`conversationAvailable=false`，不调用模型、不创建 Session。通知入口为持久化后的 `automation/changed(reason=run_finished)`，通知模块读取共享目录确认终态；原生投递验收仍受系统应用权限限制。
- 界面在 none 结果上调用 markRunViewed 确认，不打开聊天；一次提醒删除任务，循环提醒只写 viewedAt。Client facade 串行本端写入；list 等待已发起的写入，并在等待期间有新写入时重新读取，防止确认前的过期响应恢复任务/未读。此屏障与只读变更订阅互补，所有最终状态仍取自 Host。

```json
{"action":"add","message":"提醒喝水","mode":"reminder","at":"2030-01-02T09:30:00+08:00"}
{"action":"add","message":"研究项目变更并生成报告","mode":"task","cron_expr":"*/15 9-17 * * MON-FRI","tz":"Asia/Shanghai","repeat":true}
```

## 源字段对照

基线为 nanobot-gui `0873ca240ac72ed7678341e360cc96855227f646` 的 `src/types/schedule.ts`、`src/stores/scheduleStore.ts` 和 `src/core/api.ts`。运行与确认/删除语义同时核对了对应 nanobot 网关的 schedule_routes 和 CronService。

| 源字段 | 本插件定义及验证 |
| --- | --- |
| `ScheduleFrequency` | once/hourly/daily/weekly/monthly/weekdays/custom/manual 八项保持一致 |
| `ScheduleConfig` | frequency/at/time/dayOfWeek/dayOfMonth/timezone/cronExpression/everyMs 保留；源 API 顶层 timezone 优先，归一化存入 schedule.timezone；once 创建/编辑须为未来 ISO 时间；custom 只能提供一个选择器 |
| 预设默认值 | hourly 只使用 minute，hour=0；其余默认 09:00；weekly 默认周一；monthly 默认 1 日；省略时区在 Host 保存时明确解析成本机时区 |
| 自定义规则 | 按源 Croniter 6.2.4 默认选项验证和计算五/六/七字段：分、时、月日、月、周日、秒、年；年范围 1970–2099；支持范围、步进、名称、L、l5、#、W、?、随机 R、宏及月日/周日 OR；无 hash_id 的 H 与源相同返回错误。正整数 everyMs 按当前时间锚定 |
| `name/description/prompt` | 名称和指令 trim 后不能为空；描述可为空；表单编辑未提供描述时清空 |
| `skillName/workspacePath/mcpPresets` | 保留技能、目录和最多 8 个唯一连接器的公开元信息；表单编辑省略这些源字段时清空，凭证字段不在 schema 内 |
| `status` | 任务 active/paused/completed；manual 新建为 paused；once 执行结束后 completed |
| 时间及历史 | createdAt/updatedAt/lastRunAt/nextRunAt/runs/totalRuns 保留，时间为 epoch 毫秒；最多一个 running，保留最新 20 条 |
| `ScheduledTaskRun` | id/runId/scheduledTaskId/conversationId/sessionKey/startedAt/completedAt/status/error/viewedAt 保留；新增显式 sessionId/turnId/ownsSession/trigger/scheduledAt/executionMode/errorCode/skippedReason |
| `resultType/conversationAvailable/unavailableReason` | 新运行必填前两项；SessionId 本身不代表结果可打开。会话可用时 Session 别名一致；纯提醒只返回 none；无结果原因保留 legacy/missing |
| 项目与来源扩展 | projectId 使用 DSH WorkspaceId；originSessionId 为不可变创建会话，运行 Session 独立；表单与工具共享同一服务 |
| 内部 skipped | 持久化 skippedReason，公开 status 映射为 completed；不丢失跳过原因 |

类型保留源字段，新增记录使用更严格的显式 ID/可用性约束。Cron 表达式保留原文，不移动秒字段或改写宏；宏包括 @midnight/@hourly/@daily/@weekly/@monthly/@yearly/@annually。随机 R 在每次重新计算时重新选值，与源行为一致；校验本身不消耗随机数。完整范围和 DOM/DOW 特例也按源实现处理，例如六/七字段的数字周日 7 会被当前源版本拒绝，不能用另一个解析器默认规则替代。

`src/cron.ts` 将源日历搜索及 DST 定位转为 TypeScript，`src/recurrence.ts` 是所有频率的唯一下一时间计算入口。月度 31 日跳过短月，闰日遵循日历；DST 不存在时间及重复时间遵循源行为。求不到下一项（年份耗尽、50 年搜索上限或日历无解）返回无目标，与源 `_compute_next_run` 的 None 一致；语法或时区无效返回明确错误。IANA 时区数据来自宿主 Intl，若宿主与参考 Python 的 tzdata 版本不同，历史或新修订时区规则可能存在平台差异。

## Host 执行适配器

包根默认入口现为组合插件：加载命名导出的 `AutomationService`，再通过 Cordis inject 加载 `AutomationScheduler`。仅调度器调用 `attachRuntime`，子任务03不得再注册第二个 Runtime。独立管理服务仍可用于单元测试。九个 Gateway/Client 方法、任务持久化版本及表名均保持不变。

`src/executor.ts` 的 DshAutomationExecutor 已由组合插件自动注册，先完成证据恢复再启用调度；自定义精简组合可单独使用命名导出的 AutomationService 和 AutomationScheduler，自行在 Cordis effect 内注册唯一执行器。接口示意：

```ts
ctx.effect(async () => ctx.automation.attachExecutor({
  async execute({ task, run, signal, bind }) {
    // 分配独立 DSH Session；启动前 await bind({ sessionId, turnId, ownsSession: true })。
    // Session flush 并可查询后，再 await bind({ sessionId, turnId, ownsSession: true, conversationAvailable: true })。
    // 复用当前有效模型、权限和 Agent。监听 signal，中断后必须停止工作并结束此 Promise。
    // 等待真实 turn/end 与 Session flush，再返回显式结果：
    return { status: 'completed', resultType: 'conversation', conversationAvailable: true }
  },
  async recover({ task, run, signal }) {
    // 根据 run.sessionId / run.turnId 查询持久化终态，找到则返回 AutomationRunOutcome。
    // 查询成功但没有终态时返回 undefined；查询失败应 throw，不能当作“没有终态”。
    return undefined
  },
  async dispose() { /* 释放执行器自身的监听和资源 */ },
}))
```

上例是接口示意，必须由真实 DSH 实现替换后才注册，不能直接返回成功。新增 Host 类型为 `AutomationExecutor`、`AutomationExecution`、`AutomationRecovery`、`AutomationRunOutcome` 和 `AutomationClock`。执行器只负责执行及证据查询，调度器独占准入、历史结算和下一时间计算。运行配置使用准入后的独立快照，executionMode 固定为开始记录的模式；结算读取任务最新规则。未知抛出错误使用安全的 execution_failed 文案，不将上游原始异常或凭证写入历史；受控错误可在 outcome 中返回脱敏说明。

执行器注册先查询未结算记录并重新计算后续目标，再启用计时器。interval 按当前时间重新锚定，过去 once 不补跑；不追补停机的全部周期。醒来处理当前到期项，按 nextRunAt 升序串行等待执行完成；每次准入都在持久化队列内重新核对到期目标，暂停、删除或编辑已排队任务不会误启动。手动触发独立准入，不等待另一任务的完整执行；同任务的并发准入只成功一次。失败执行结束后计算正常下一周期，不立即重试。最长休眠五分钟以应对系统唤醒；客户端计时器仅刷新状态。

调度器的 `runNow` 先调用 `beginRun` 持久化开始记录，再安排执行并尽快返回；暂停任务也可手动运行。`beginRun({ taskId, trigger, scheduledAt? })` 原子拒绝重入；scheduled 触发现在必须携带当前且已到期的 scheduledAt。分配独立 DSH Session 后，通过 execution.bind 持久化关联；其内部仍调用既有 `bindRun`。首次绑定默认仍为 resultType=none，不能根据 ID 推断会话；只有显式 conversationAvailable=true 才原子发布 conversation、conversationId/sessionKey/sessionId 一致的可用结果，执行中也可打开和跟随。纯提醒禁止发布会话，已绑定的 Turn 不可更换。turnId 是该 Session 的 `turn/start.data.turn` 数字，不是 Session ID 或消息 ID。不得声称拥有创建会话或其他已关联运行的 Session。

真实终态确认后，执行器返回 outcome，调度器调用既有 `finishRun`。`status` 接受 completed/error/skipped，skipped 必须有 skippedReason。`completedAt?` 用于恢复时保留原 turn/end 的时间；resultType/conversationAvailable 始终显式提供。服务在串行结算内按当前规则计算 nextRunAt，覆盖过期快照；暂停任务和 manual 不会被重新启动。旧 `finishRun.nextRunAt?` 只在未装入 Runtime 的测试/兼容场景下作兜底。结束调用幂等，不覆盖已结算记录及已读状态。单纯消息投递、followup 或 Agent 一次 idle 不能当作执行成功。

DshAutomationExecutor 的 recover 使用 SessionPersistence 只读 handle 查询保存的 sessionId/turnId 及专属归属记录。SessionQuery 的冷查询会在内存补出 interrupted 闭合事件，恢复不把这些合成事件当作持久化终态。调度器优先按证据修复 running；查询成功但没有终态且超过 24 小时，标记 error/errorCode=run_interrupted、resultType=none。较新的未知运行保持 running 并禁止重入，每次唤醒继续查询。证据查询失败时不误报成功或中断。禁止自动重放外部操作。开始写入失败时不调用执行器；结束写入失败时保留 running，等待上述恢复。执行器未确认终态 flush、终态回查、会话可用性发布或释放 Agent 时抛出内部 AutomationEvidencePendingError，调度器同样保留 running，不以未知结果提前结算。

撤销执行器先关闭准入和计时器，再 abort、等待所有执行和恢复调用结束，最后调用 executor.dispose；旧执行器尚未完成清理时拒绝替换。卸载调度器还会释放唯一 Runtime 和监听。正常取消保存 run_interrupted；进程崩溃留下的记录通过 recover 修复。可注入 AutomationClock（包插件选项 `{ clock }` 或 Scheduler 构造参数），持久化时间和计时器使用同一时钟。`recomputeSchedules()` 在服务写入队列内计算，避免启动/恢复与 CRUD 覆盖；`getTask()` 是准入后供执行器获取独立快照的 Host 内部接口。

真实执行每次分配随机唯一 Session，并沿用准入时已有的 runId。先持久化 Session/Turn=1 关联，再通过 ctx.agents.create 创建全新无 seed、无 parentSession 的顶层 Agent；从现有默认 Agent preset 挂载工具和权限，不复制来源会话上下文。Session.header.cwd 保留 task.projectId 对应项目的目录，workspacePath 只通过 workingDirectory.set 改变有效执行目录；显式项目已不存在时直接失败，不回退到其他项目。项目没有绑定时使用任务目录或 DSH 默认工作目录。运行中的会话通过 DSH SessionQuery 和现有 Session-follow 流读取，完成后释放自己的 live Agent，保留 Session 供普通历史查询和继续会话使用。

运行模型来自创建会话当前有效的持久化选择（pending model/selection 优先于最近 request/header，忽略适配器默认的 effort），来源缺失或没有选择时使用 agentDefaultModel.currentSelection()。在新 Agent 的创建期安装固定模型选择并持久化 model/selection；后续默认变化只影响下一次运行。执行器从不调用 saveSelection，也不修改模型来源、凭证或用户默认设置。技能通过当前 Agent scope/cwd 的 skills.get 读取并以 DSH skill-invocation 上下文注入；MCP 名称必须对应当前 Agent 可见的 mcp__<name>__ 工具命名空间，复用现有连接及权限，不从任务元信息创建连接或携带密钥。不可用的技能、MCP 或项目返回受控失败。

成功必须有本次专属记录、准确 turn/start、该 runId 的已入模 user/message 和对应 completed turn/end，并通过 Session flush 与持久化只读回查。其他 Session/Turn、消息仅入队、idle、被拒绝的零步 turn、blocked、max-tokens、模型错误或中断都不算成功。aborted/interrupted/forked 映射 error/run_interrupted，其余非成功终态为 error/execution_failed；历史只保存固定脱敏说明，不复制上游异常文本。纯提醒直接完成为 none，不分配 Session 或调用模型。

专属归属证据为 Session 的 ignorable 记录 plugin:tpcowork-automation/run，保存 version=1、taskId、runId、sessionId、turnId=1、可选 projectId/originSessionId。包根导出 readAutomationOwnership(events) 和 AutomationOwnership，前者只接受唯一且位于首个 turn/start 之前的合法记录。子任务05清理时还必须拒绝 seeded/parent Session，并核对 header.id、任务/运行/会话 ID、来源会话及其他运行关系；ownsSession 单独不是删除授权。缺失、重复或无效的记录须拒绝清理；记录是插件可忽略数据，丢失时不能放宽归属校验。默认 Host 组合同时注册唯一 DshAutomationSessionCleanup；清理不改变归属标记或防递归行为。

会话删除模块通过 `attachSessionCleanup` 注册 `deleteRunSession(task, run)`，返回异步卸载函数。模块可实现 `dispose()` 停止准入并等待已开始操作，旧模块拆卸完成前不允许替换；Host 卸载同样等待清理。Host 先拒绝 running，重新检查所有任务的来源及其他运行引用；只有清理成功才持久化删除历史。共享旧记录（ownsSession=false）仅删除记录。ownsSession=true 仍须读取真实 SessionPersistence header/events，验证唯一合法且早于首个 Turn 的归属记录、taskId/runId/sessionId/turnId、不可变创建来源与可用项目的真实 header.cwd，拒绝 seeded、parent、继承前缀及外来会话。任务编辑后的项目按运行归属记录捕获的项目校验。

通用接口为 `SessionPersistence.delete(id, { expectedRevision, signal? })`。插件先 stat 捕获修订号，再只读检查并关闭句柄；后端在进程内认领和已有内核写锁内核对版本，拒绝活跃/恢复中的 Session 及校验后的并发写入。活跃会话通过 `automation/session_cleanup_failed` 明确提示关闭后重试；其他清理失败同码保留记录，I/O 故障不能当作缺失。真实缺失可幂等完成，已删会话但记录提交失败时可在重启后再次删除。

桌面实际使用的 JSONL 后端同时支持 raw 与 Zstandard：先持久化 session.deleted，再移除所有规范日志代际，保留稳定 session.lock 与删除标记以阻止旧代际恢复和身份复用。清理中断可重试；查询索引在下一次查询时对照持久化删除，冷查询缓存先 stat 校验；`session-persistence/deleted` 等待 Workspace 清除成员、置顶、归档及 header/path 缓存。历史恢复通过写锁打开，已删除 Session 返回缺失。其他继承默认实现的后端明确返回 SessionDeletionUnsupportedError，未宣称支持。删除针对会话日志；独立附件/spill 归其现有服务管理，不递归删除项目目录。

## 通知和错误

每次持久化成功发出 Host `automation/changed`，含本次 Host 激活内递增 revision、taskId、可选 runId 和 reason。理由包含 created/updated/deleted/paused/resumed/run_started/run_bound/run_finished/run_viewed/run_deleted/rearmed。通知不带指令、连接器密钥或凭证；监听失败不会撤销已提交变更或阻止其他监听者。后续通知模块负责将该事件加入 Gateway 转发，客户端启动及重连先 `list`，轮询只刷新状态，并用 store 的变更代数丢弃晚到响应，参照源 scheduleStore。

Host 业务错误是 `RemoteError`，`code` 为 `automation/<错误码>`，details 为空。错误码：invalid_input、invalid_timezone、invalid_rule、invalid_persistence、storage_failure、task_not_found、run_not_found、task_running、run_running、runtime_unavailable、service_stopping、run_interrupted、session_cleanup_failed、execution_failed。Client 参数使用共享 schema；Host Gateway先验证 JSON 安全，再由服务方法验证输入，保证业务错误码不被通用 Gateway 校验错误替代；结果在两端均有 schema。Gateway 连接、撤销和非 JSON 参数错误保留其原有 `gateway/*` 错误码。

## 验证范围与交接

行为测试覆盖八种频率、默认值、CRUD、暂停/编辑启用、手动准入、并发排他、20 条上限、跳过映射、会话与 Turn 关联、明确结果可用性、已读单调性、纯提醒确认移除、专属会话清理失败、写入失败、损坏数据、重启、卸载和真实 Host/Client Gateway。产物 smoke 使用构建后的 ESM 与浏览器工厂，验证定义/已读重载一致及客户端不依赖 Node 模块。

子任务02新增 `tests/recurrence.spec.ts` 与 `tests/scheduler.spec.ts`。`tests/fixtures/croniter.json` 包含源 CronService、同一表达式/参考时刻/时区的 262 个 next-run 结果及 55 个校验结果；随机 R 使用相同 32 位随机值对照。覆盖秒在末位、年份约束与耗尽、七个宏、月日/周日 OR、L/W/#、短月、闰年、纽约/柏林 DST 缺失及重复小时、Lord Howe 半小时切换、Apia 跳日及时区偏移。对照脚本 `tests/reference-croniter.py` 仅用于开发时生成固定证据，普通测试和生产均不调用 Python。源语义参考 [Croniter 官方说明](https://github.com/pallets-eco/croniter)，实际对照版本固定为参考工程当前锁定的 6.2.4。

更新证据时在已安装参考 nanobot 的开发 Python 环境执行 `python plugins/tpcowork-automation/tests/reference-croniter.py`，再运行上面的 Vitest 命令。调度测试覆盖手动及时返回、同任务排他、到期排序及等待、队列内规则变更、暂停恢复、晚唤醒、周期失败不重试、20 条历史、一次任务历史、重启、终态恢复、24 小时中断、存储故障和插件卸载取消。这些调度测试使用受控执行器；真实执行另由 tests/executor.spec.ts 和构建产物 smoke 验证。

当前验证：Host/Client 构建及独立类型检查通过；Vitest 原 7 文件 437 用例全通过，新增运行清理与清理卸载 21 用例亦通过（合计 458）；构建产物 smoke（聊天 cron 创建、纯提醒确认、Host/Client、真实 AgentLoop 成功/取消、独立会话、持久化终态、恢复后用户创建、新自动 Turn 防递归、桌面默认 Zstandard JSONL 删除、缓存/搜索/恢复移除和模型选择保留）通过。

子任务03增加 tests/executor.spec.ts：测试目录中的 cordis.yml 通过真实 Loader 加载 Host，运行真实 AgentLoop、Agent preset、Workspace、WorkingDirectory、SessionQuery 和 JSONL 持久化；只替代外部 LLM 流。覆盖两次独立运行、两个项目隔离与有效目录、技能/MCP、来源及默认模型、运行中查询和流、模型失败/max-tokens/取消、零步拒绝、卸载排空、终态 flush/回查失败重启恢复、23/25 小时无终态、其他 Turn/归属、缺失会话与查询失败。产物 smoke 直接使用 lib/host.js 及构建后的 DSH peers，验证真实成功、取消、独立会话、终态日志和模型保留。

子任务04增加 tests/tools.spec.ts：真实聊天工具及 AgentLoop 调用、日期/Cron/间隔编辑和重载、项目与有效目录/技能/MCP 公开绑定、恢复与 fork/子 Agent 防递归、无 Agent 和取消、纯提醒无推理/Session、确认与旧轮询交错及重启保留、内部任务隔离与卸载撤销。客户端只增加本端写入和 list 的顺序屏障；Gateway 九个接口、共享 schema 和持久化版本不变。

退回复修保留并扩展 `tests/review-completed-chat.spec.ts`：真实已完成自动 Turn 后恢复/分支的用户请求可创建提醒；继承正在执行的父 Turn 的分支及其恢复仍拒绝递归；分支 Turn 比父 Turn 更晚结束时限制持续到自己的终态；同一结果 Session 后续新的自动 Turn 拒绝创建，再下一个普通用户 Turn 可以创建；准备失败、从未启动自动 Turn 的会话恢复后首次用户 Turn 可正常创建。测试使用真实 AgentLoop、工具管线、Workspace 和 JSONL 持久化；替代外部模型流，准备失败用例另注入项目关联错误。构建产物 smoke 同时验证恢复会话后的真实用户工具调用及当前自动 Turn 防递归。

MCP 绑定使用已有 DSH serverName 命名空间，不迁移旧工程连接器或用户设置。完整 patch 统一管理原生 Schedule、工具与入口的移交。单个插件 tgz 不包含所需的 DSH 更新；离线交付必须使用完整 kit。最终桌面、外部模型/MCP 及平台范围以验收记录为准。

子任务05还修改 DSH 的 session-persistence 定义、桌面 JSONL 实现、Workspace 关联清理及其文档/验证目录。工作区根目录没有 Git 仓库，没有创建 PR，也没有提交 DSH 子仓库的既存修改。

子任务05的新增清理用例使用真实 SessionPersistence、Workspace、查询索引和 AgentLoop；实际 ApiSessionList 的列表/搜索、重启后的列表与恢复均检查已删结果不可发现。DSH 既存 JSONL/写锁/Workspace 277 用例、删除 8 用例、查询/冷观察 87 用例及 tool-cordis 生成目录回归通过。未运行 Electron 窗口或外部模型/MCP 联网；这些证据验证实际后端与构建产物，不代替后续桌面端到端及离线验收。

## 任务页面与编辑器（子任务06）

`src/ui.tsx` 在宿主 `main` / `sidebar.panellist` 的 `schedules` 位置以 priority=-20 注册自动化页面；TP UI 发现该入口后撤销原生标题适配，保留一个自动化入口。卸载撤销页面、侧栏贡献、字典和样式。浏览器构建从 ModuleLoader 取得宿主 React 和共享 ui-primitives，样式使用 DSH 主题变量，中英文文案由宿主 locale 管理。迁移提示和确认复用此页面，经 `automationMigration/migrate({confirm:true})` 调用 Host；目录 `status.migration` 返回等待、恢复或完成状态及过期一次任务 ID。

`src/AutomationPage.tsx` 提供任务/运行记录双页签、任务卡片、空态、请求失败重试、新建、暂停/恢复、立即运行及任务删除确认，不提供卡片内展开记录树。任务删除说明明确保留已有结果 Session。一次任务仅在 completed 且最新运行成功并已读时从任务页归档；历史页读取全部任务历史。打开结果要求 resultType=conversation、conversationAvailable=true 和明确的 conversationId；none 结果仅确认已读。运行页使用紧凑表格，直接跳转结果会话，并提供确认已读和删除记录。

`src/AutomationEditor.tsx` 使用 Zcode 风格的面包屑、设置/历史页签及单栏表单；编辑时右上角提供保存、立即运行及任务菜单，历史页只保留任务菜单。立即运行先验证并保存当前草稿，成功后执行且保留编辑页；保存失败不执行。任务菜单支持暂停/恢复和删除，暂停/恢复保留未保存输入。项目选择位于指令框上方，使用首页相同的 Menu、文件夹图标、选中标记、主题材质及键盘操作，支持“不绑定项目”；底栏提供权限、模型和思考强度。编辑器不提供“更多设置”，不再请求隐藏选项的 bindings 目录；已有描述、执行方式、技能、MCP 和目录仍随草稿完整保存。只在打开时复制草稿；两秒全局客户端刷新只读取 Host 目录，不执行或重算调度，不覆盖未保存输入。`AutomationCatalog` 合并同一代未结束的读取、丢弃写入前的旧响应及卸载后的响应。项目来自 `ctx.workspaces.list`，项目 ID 和可覆盖的 workspacePath 独立保存；频率支持 once/hourly/daily/weekly/monthly/weekdays/manual/custom，新建空白任务须先添加计划，保留原始 at 精度、custom cronExpression/everyMs 及其他已有 custom 参数。一次日期按任务保存的时区转换为绝对时间，新任务自动使用本机时区，页面不显示时区控件；拒绝 DST 缺口，重叠时间选较早实例；后续触发时间全部交给 Host。选择项目时将执行目录更新为该项目目录，解除项目绑定时保留独立执行目录；不可用项目显示提示并保留原 ID，只有明确选择“不绑定项目”才解除。

`src/automation-templates.ts` 直接迁移参考提交 0873ca240ac72ed7678341e360cc96855227f646 的六个中英文模板及真实提示词；选择模板只填草稿，取消不写 Host，保存才创建。“让助手创建”调用宿主 `uiWorkspace.startSession(undefined,{prompt,clearPreviousDraft:false})`，保留已有聊天草稿，通过现有聊天工具完成创建。

新增只读接口为独立 namespace `automationBindings/list({workspacePath?})`，返回 `{skills:[{name,description}],connectors:[{name}],skillsAvailable}`，不改变原九个管理方法、任务 schema 或持久化版本。`src/bindings.ts` 在默认 preset 的临时 scope 中读取宿主公开技能注册表和工具 schema，不创建 Agent/Session，不加载技能正文，不读配置或凭证。只列出可人工调用的技能，MCP 按现有工具的无歧义 `mcp__server__tool` 命名提取；有额外 `__` 的名称无法可靠还原 server identity，目录不猜测，已有绑定由任务草稿保留。简化编辑器不请求此接口，工具创建的任务仍可使用这些执行绑定。

验证：`tests/ui.spec.tsx` 使用渲染控件和真实 AutomationService/storage-domain，覆盖双语六模板、保存/重载往返、不可用绑定、原生项目菜单/目录分离、JSON 项目清空、隐藏配置保留、未保存草稿、失败重试、旧响应/卸载、归档、结果可用性、无效时区/规则和 DST；`tests/bindings.spec.ts` 使用真实技能/工具注册表和 Gateway，验证只读目录及卸载撤销。当前完整回归包含13个文件、528个用例；构建包含 Host/Client 类型检查，产物 smoke 验证既有执行/恢复/删除链路。

```sh
node plugins/tpcowork-automation/build.mjs
node deepseek-harness/node_modules/vitest/vitest.mjs run --config plugins/tpcowork-automation/vitest.config.ts
node plugins/tpcowork-automation/tests/artifact-smoke.mjs
node plugins/tpcowork-automation/tests/browser-smoke.mjs
node plugins/tpcowork-automation/tests/review-project-clear.mjs
```

Chromium 产物验证使用真实 Cordis、SlotRegistry、LocaleRuntime、宿主 React、Client Gateway、Host Gateway 及 JSON 持久化，覆盖四种语言/主题、12次模板取消、once→monthly→manual→七字段 custom 保存重载、首页同款项目菜单、技能/MCP 等隐藏配置的保存保留、Host 更新期间草稿保留及卸载零残留；报告和截图输出在 `test-results/ui-browser/`。浏览器壳测试提供项目投影和聊天导航观察器，未启动完整 Electron 或真实外部模型/MCP 网络；不能用这些证据代替子任务10的真实桌面及子任务09的离线安装验收。跨客户端事件、全局刷新和桌面通知的实现及验证边界见状态同步章节。未修改或提交 DSH 子仓库，未改用户模型来源/凭证/默认选择，未导入旧数据，未更新现有 tgz 或安装到用户配置；当时工作区根目录不是 Git 仓库，未创建 PR；现使用独立 worktree，当前交付见 TPCO-10-delivery.md。

项目清空回归已整合进 browser-smoke：检查真实请求的 projectId:null、持久化 JSON 不含该字段、Host 重开及页面刷新后无项目且目录保留；普通编辑保留项目，不可用项目提示并往返保留，用户明确清空后才解除。截图为 `project-cleared.png`、`project-unavailable.png`。`review-project-clear.mjs` 作为兼容入口运行同一组回归，输出到 `test-results/ui-browser/`。

## 运行记录中心（子任务07）

`src/AutomationRunCenter.tsx` 复用任务页的 `AutomationCatalog`，聚合全部任务（含已读 once 归档任务）的历史，按 `startedAt` 降序。全局记录和编辑器历史共用 `src/AutomationRunTable.tsx`：列出触发时间、来源、状态、紧凑时长和操作；全局表格增加任务名称、未读标记和“跳到会话”按钮。编辑器按当前任务隔离历史，记录菜单提供跳到会话和删除记录；skipped 原因及执行错误通过状态悬停查看。运行页直接进入结果会话；不再展示卡片、搜索筛选或详情页。客户端两秒计时器仅刷新 Host 状态。打开终态会话时通过 `markRunViewed` 持久化；运行中不标已读，已跟随的会话结束后补记已读。`resultType=none` 仅确认，once reminder 的确认按 Host 规则删除任务及记录，循环提醒保留；旧轮询不能恢复已删除内容。

完整结果仅接受 `resultType=conversation`、`conversationAvailable=true`、明确 `conversationId` 且无 unavailable reason。`src/open-run-session.ts` 在目录尚未发现目标时刷新 DSH Session 目录，通过既有 `sessions.using` 等待历史，以 `openState` 判断读取是否成功；`removed` 也会在执行器释放 Host Agent 时出现，不能据此判定持久化结果丢失。历史读取成功后调用 `uiWorkspace.openSession`，再异步通过 Session.rename 保存标准运行标题；重命名失败只记录警告，不阻止查看结果。导航先取得 mainView 引用，临时 automationResult 引用随后释放；离开记录表格会取消尚未完成的打开请求。缺失、legacy 和读取失败明确显示，不根据 sessionId/sessionKey 猜测，不调用 create/startSession 兜底。会话运行时、模型和凭证沿用 DSH。

冷会话删除通过 `session-persistence/deleted` 转发 `api-session/removed`，同步撤销各客户端侧栏的会话入口；当前客户端删除成功后还会刷新 Session 目录；分组初始化时也刷新目录，清除旧版本或重连时遗留的失效入口。只有确实删除持久化会话才发布移除；共享旧会话仅移除记录。运行删除独立调用 `deleteRun`，确认框支持取消、焦点恢复与 pending 防重，运行中禁删。清理失败保留确认框、历史和错误提示，可重试。不能用任务删除替代运行删除；活跃 Session 必须先由其拥有者释放。单纯关闭客户端视图不保证释放 Host Agent，无法自主释放时可在停止相关 Host 生命周期后重试。

供子任务08/09集成：九个管理接口、持久化和 bindings schema 均未改；页面入口仍为 `registerAutomationUi` 的 schedules slots。`AutomationUiServices.openSession` 改为 `(id, standardTitle, signal) => Promise<void>`，调用方必须等待并处理失败。Client UI 的 `uiDependencies` 增加 `sessions`，包的 `dsh.client.inject` 增加现有 `@deepseek-ai/dsh-api-session-controller`；复用宿主 React，不增加会话运行时。后续打包须包含重建的 `lib/client.js` 与声明及前阶段必要 DSH 产物；仓库现有 tgz 未更新，不可作为本阶段最新交付。08已增加只读变更流，09打包时还须包含更新后的 remote 描述符和 changes 声明。

```sh
node plugins/tpcowork-automation/tests/run-browser-smoke.mjs
```

新增 `tests/run-history.spec.tsx` 覆盖双语紧凑表格、日期排序、归档历史、直接跳转会话、终态已读/写入失败重试、运行中到终态刷新、提醒确认、无结果错误、删除确认/pending/失败重试、旧轮询及打开取消。`run-browser-smoke.mjs` 使用构建后的插件、真实 AgentLoop、Zstandard JSONL/SessionQuery、Host SessionController、ClientSessions 和 UiWorkspace 导航；外部 LLM 使用受控流。Chromium 实际验证中英文与深浅主题、实时首尾消息、冷历史、持久化标题/已读、Host 插件重开、once 归档/提醒移除、legacy/missing/不存在结果及零 session/create、真实活跃归属拒删、注入持久化删除故障、删除后侧栏目录同步、编辑器保存后执行/暂停恢复/删除，以及桌面宽度和 390px 的深浅主题表格截图。报告与截图输出到 `test-results/run-browser/`。外层 workspace/layout、未使用的上传注册及转录展示为夹具，不能代替完整 Electron、外部模型/MCP、操作系统重启、Windows 或最终离线安装验收。

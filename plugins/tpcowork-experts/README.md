# DSH 专家团队

团队运行插件。Toolbox 管理目录与首次提交选择，experts 运行原生 DSH workflow/spawn subagent，并把实际执行进度接入 DSH 原生任务清单、工作流卡片和子会话导航。输入框上方不再挂载团队状态区或重试入口。所有长期状态保存在 Session 记录，没有另建执行或计划注册表。完整交互设计见[专家团队会话体验](../../docs/toolbox/expert-session-experience.md)。

## 集成

T7 在同一 Host 内先加载原生服务与 experts，再把 `plugins/tpcowork-toolbox/src/host/teams/index.ts` 作为 toolbox 的内部模块加载；不要为团队页另安装一个 toolbox。模块导出 `name/inject/apply`。集成 owner 已在 toolbox composition 挂载团队模块；experts 包含独立 bundle patch 和 Client manifest，构建/双包离线发行见 `docs/toolbox/packaging.md`。

```ts
import * as experts from '@tpcowork/dsh-experts'
import * as teams from '@tpcowork/dsh-experts/teams'
await ctx.plugin(experts)
await ctx.plugin(teams)
```

experts 需要 `typert`、`agents`、`sessions`、`sessionController`、`sessionProjections`、`workflowEngine`、`subagents`（注册 `spawn`）、`fs`、`workingDirectory`、`tools`。执行 profile 还需原生 AgentLoop、模型、PTC/sandbox、文件读写工具、`present` 和 `todo_write`。缺少 workflow、spawn 或交付工具时目录标记 blocked。技能与 MCP 复用已集成的 `toolboxSkills` / `toolboxMcpRuntime`，所选能力不可用时拒绝执行。

标准 Web/桌面 bundle 将 workflow 引擎放在 Session preset 内，并禁用 base 的根级 `workflow-ptc` 行。experts 的 bundle 会启用该既有根级行，供 Host 团队协调器使用；不注册第二个执行器，也不启用全局 workflow 工具。自定义组合仍须在 experts 所在作用域提供该原生服务。

Host 产物为 `lib/host.js`、`lib/teams.js`，Remote codec 为 `lib/remote.js`。Client 产物 `lib/client.js` 通过 `window.__ModuleLoader__` 注册 `@tpcowork/dsh-experts`，只挂载 Remote codecs，不再注册输入区进度面板。任务清单使用原生 `todos` projection，专家详情使用原生 workflow 卡片和子智能体目录，报告由原生 `present` 交付区域展示，没有进度轮询。

`resources` 配置可指定完整团队资源根目录；默认相对包目录读取 `resources/expert-teams/`，打包必须包含这两个完整子目录。`team.yaml` 是 JSON（YAML 1.2 子集），`adapter.md` 是随团队版本固定的执行指令。修改角色或 adapter 时应更新团队 version/workflowId，避免固定任务静默换配置。

## 提交与执行

“使用团队”继续使用现有 Client，只填草稿。`toolboxTasks.selection/context/submit` 实现公共契约，团队任务 `taskId=sessionId`，后续草稿不能覆盖已固定团队选择。普通聊天以 `message:<requestId>` 为 taskId 保存每次选择，下一条消息可增删技能和 MCP；旧记录保持不变。目录版本根据 skills/MCP/teams 三个独立 revision 与 complete 状态单调变化。首次提交经原生模型/附件验证，持久固定团队、技能 fingerprint/version、MCP configRevision，通过原生 durability barrier 后再交给 queue/steer；持久化不可用时不启动成员；保留 requestId、附件顺序、上传凭证仲裁与时区。每次运行前重新核对固定能力。

DSH `SessionController.promptWithAdmission` 是本任务新增的 Host-only 接入点，没有新增 Remote 入口。它在原生附件准入后、消息入队前调用持久回调。请求幂等同时识别原生 inbox 历史，因此消息被 pre-step 认领但还未写入模型对话时也不会重复受理。回调拒绝不绑定上传凭证，可重试；回调已持久化后发生取消，选择可能已固定但消息尚未入队。

资产研究队四角色并行，随后综合、独立审阅；供应链队先两角色发现，再三角色验证，并发上限 3，随后综合、审阅。成员写入独立 Markdown；综合者写 `report.md` / `report.html`，审阅者写 `review.md`。Lead 和每个子成员各自挂载选中的原生 MCP scope，取消、失败、撤销及卸载会清理连接。可选 MCP 不会自动选中；用户的自定义条目不受团队默认目录限制。

## 状态与收尾

首次受理团队请求时，在缺少名称的会话写入基于用户需求的原生名称；采用与原生重命名相同的持久格式，后续仍可手动改名。运行前写入各专家、综合、审阅及交付任务，真实成员启停更新 `todo/write`，并将真实 workflow 生命周期记录为原生工作流卡片。角色名称透传到子会话目录，点击成员使用 DSH 的原生父子会话导航。原生停止按钮取消整个团队；插件不再提供底部状态条、重试、停止、成员清单或文件按钮。工作流卡片独立于过程折叠显示；历史成员通过顶部子智能体目录打开。

研究成功只进入 `awaiting_delivery`。experts 核实成员文件、非空 Markdown、含 HTML 文档的最终文件和审阅结果；整体失败不能靠回合结束变成功。Lead 必须实际 `present` 登记两份报告，再通过 `todo_write` 核对计划：包含精确步骤 `交付 Markdown/HTML 报告` 且已 completed，无 in_progress；完整成功要求计划全部 completed，部分失败可保留 pending。原生交付区域只显示成功 present 对应的 Session 引用。

成员失败或缺少角色文件会形成 partial；全部角色失败、报告缺失、审阅失败、MCP 撤销或 Lead 失败则 failed。取消传播到 workflow、子成员与 MCP，并等待清理。失败/取消/中断后，原生计划中仍为 in_progress 的项退回 pending，已有 completed 不变，不伪造未完成工作的成功记录。

没有进程重启续跑能力。冷 Session 读取显示 interrupted，激活时持久写回 interrupted；不会自动创建成员或继续旧 workflow。Host 重跑接口重新验证固定选择，使用持久 inbox/对话中的首次用户内容与耐久附件引用创建新 run，保留旧事件和文件。更改过的技能/MCP 配置必须在新任务中重新选择。

`experts.snapshot` 提供当前快照，`watch({runId,afterSequence},signal)` 支持顺序重放；cancel/rerun 是显式操作。工具活动引用真实子 Session 的 tool/call 序号，文件登记引用 deliverables/presented 序号；不会把原始工具日志复制进团队事件。

## 验证

从独立 worktree 根目录执行：

```sh
node scripts/check-worktree.mjs
node plugins/tpcowork-experts/build.mjs
node deepseek-harness/node_modules/vitest/vitest.mjs run --config plugins/tpcowork-experts/vitest.config.ts
node plugins/tpcowork-experts/tests/artifact-smoke.mjs
```

依赖和原生/Host/定向 Client 产物准备见 `docs/worktree-development.md`。测试通过真实 cordis.yml/Loader、原生 admission、Session JSONL、PTC、workflow/spawn、文件工具、present/todo 与本地 stdio MCP 执行；只有外部模型使用脚本适配器。`process.spec.ts` 在真实子进程中启动团队、SIGKILL、重新加载同一 JSONL，再验证 interrupted 与显式重跑。原生 UI 测试覆盖工作流展示、过程折叠与成员导航。产物 smoke 检查编译后的 Host/Gateway、资源加载、Client ModuleLoader 与卸载；未执行活跃 workflow 的服务在该 smoke 中用固定夹具提供。

也可在本插件目录执行 `npm test`。进程重启用例从测试文件位置解析工作区，子进程入口不依赖调用者的当前目录。

## 已知限制

脚本模型测试不能作为联网金融研究验收。团队仅使用选中的聚源/财汇及 profile 中真实可用的原生搜索/抓取；缺少能力时必须报告证据缺口，不生成替代行情或引用。财汇在本机桌面 profile 的真实连接与只读查询证据见 `artifacts/expert-native-experience-20261019/`，凭证仅存放在 DSH 凭证存储。HTML 只验证文档存在与格式，模型生成内容仍需审阅者核验。

团队目录检查 Host workflow/spawn；选择和原生提交准入从当前 Agent 的 Session preset 检查 `write/present/todo_write`，缺少交付能力时拒绝受理，不留下固定上下文。workbench 操作在所用 Remote 命名空间就绪后挂载。

所有研究成员、综合者和审阅者使用主任务本轮已选定的模型及显式推理强度。团队通过 Host-only `sessionController.modelSelectionForStep` 读取原生提示词组装已捕获的选择，再由 `installModelSelection` 应用到成员；首次请求使用当前默认模型，已有会话与重跑沿用其会话模型，提前切换模型则使用新选择。本轮组装之后的切换由主任务后续步骤应用，不影响正在执行的团队成员。

验证不会改用户 profile；最终整应用和双包结果见 [TPCO-20 验收](../../docs/toolbox/acceptance.md)。完整 DSH Client 聚合仍有迁移交接记录的桌面工程清单 TS6307，定向检查不代表聚合通过。

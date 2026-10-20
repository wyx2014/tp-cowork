TPCO-15 提供 MCP Host 管理与任务运行时模块；页面、聊天提交、默认安装和最终包入口分别由 T4、T6、T7 集成。

## 模块与构建

- Host：`src/host/mcp/index.ts`，导出 `Config`、`inject`、`applyMcpModule`、`ToolboxMcp`、`McpTaskRuntime`、`defaultMcpDefinitions`。
- Client codec：`src/host/mcp/remote.ts`，导出 `remoteContribution`。T4 在既有 Gateway 注册该 contribution，经 `remote.toolboxMcp` 调用；不创建独立连接或轮询器。
- 本模块的独立构建验证：`node plugins/tpcowork-toolbox/tests/build-mcp.mjs`，生成 `lib/mcp.js`、`lib/mcp-remote.js`。T7 将这两个入口纳入共享构建和 package exports，并在同一个 toolbox Host+Client bundle 组合内部模块；本任务不改共享页面、包入口或启动 patch。
- DSH 底层 `mcp-client` 增加作用域内 `mcp/connection-status` 事件及安全错误处理，仍由原生连接监督器、tools、resources、systemPrompt 执行。集成时必须同时纳入本分支的 DSH MCP 变更。
- 需要原生 DSH peers：`typert`、`settings`、`tools`、`credentials`；完整资源/提示体验还需已有的 `mcpResources`、`systemPrompt`。对应 package peers 包括 `dsh-mcp-client`、`dsh-scope`、`dsh-credentials`、`dsh-settings`、`schemastery`；均使用当前目标仓库版本，不添加 Python 网关。

## Profile 配置与管理

Host `Config` 包含：`settingsEntry`（默认 `toolbox-mcp`）、`settingsPath`（默认 `[]`）、volatile `servers`（`{ definition, revision }[]`）、volatile `removedBundled`、volatile `configRevision`（递增的配置版本计数器，默认 1）、`connectTimeoutMs`（默认 15000）。若嵌入 toolbox 的同一个 Loader entry，T7 传入该 entry id 及 MCP 配置对象的实际路径，例如 `settingsPath: ['mcp']`，必须以本模块 `Config` schema 组合，保留 volatile 属性。

配置由 DSH settings.mutate 保存为 profile patch。列表 revision 用于乐观并发，服务器 configRevision 用于首次提交固定配置；删除后重建也不会重用旧配置版本。配置及凭证变更关闭现存连接，调用方重新提交后才能使用新配置。直接维护 profile 的安装器也必须保留并递增版本，不能用同一 revision 覆盖不同定义。

独立 probe 也允许检测配置完整但已禁用的服务器；探测不会把它启用，能力始终留在临时隔离 scope 中。

Remote 方法：`inventory()`、`definition({id})`、`create({expectedRevision,definition,secretValues?})`、`update(...)`、`importDefinitions({expectedRevision,entries})`、`probeDraft({definition,secretValues?},signal)`、`setEnabled({expectedRevision,id,enabled})`、`remove({expectedRevision,id})`、`probe({id},signal)`。`secretValues` 仅用于写入，由 Host 存入新建的私有 DSH 凭证引用，不会出现在 definition、inventory、profile patch 或事件里；写配置失败会回收本次新建的凭证。`probeDraft` 在隔离 scope 中使用未保存配置和临时值，测试结束即清理，不写入配置或凭证。批量导入在同一次配置写入前检查全部条目、重名处理及目录版本。创建仅允许 custom origin，更新不能改 origin。默认项移除同时写入 `removedBundled`；T7 初始化和升级时必须尊重 tombstone、禁用状态和所有 custom 条目。

definition 的可选 `connectTimeout` / `toolTimeout` 分别以秒设置连接协商和工具调用超时；未配置的旧定义沿用运行时默认值。表单默认 15 / 30 秒，支持 1–300 / 1–600 秒。definition 只含命令/参数/地址、超时与凭证引用，没有 headers/env 实值字段。HTTP 地址拒绝 userinfo、query、fragment；凭证通过 `{ref,target,key}` 注入，支持 `env`、`header`、`url-query`。含凭证形状的启动参数拒绝保存。含非敏感 query 参数的自定义 URL 也需调整为无 query 端点。

`toolbox/changed` 通过现有 `toolboxChanges.watch` 推送失效通知。列表快照区分缺配置、禁用、探测失败、connecting/connected/disconnected/error；`readiness=ready` 表示本地配置齐全，不能当作部署服务已经联通。probe 真实协商和发现工具后关闭连接，返回 disconnected 与最近发现的 toolCount；只有任务运行持有连接。多个任务或独立 probe 的关闭不会覆盖另一任务仍连接的状态。

## T6 首次提交与清理

T6 将首次提交的 `TaskContext` 持久化后，在原生 Agent setup/执行前调用：

```ts
const lease = await ctx.toolboxMcpRuntime.openTask(context, agentCtx, taskSignal)
try {
  // 把 lease.signal 与 taskSignal 合并后交给原生任务驱动；异常断开/配置变化也会取消该信号。
  await runNativeTask(AbortSignal.any([taskSignal, lease.signal]))
} finally {
  await lease.close()
}
```

`agentCtx` 必须是该 session 的真实 DSH Agent scope，不能传 profile root。Host-only admission 不通过 Remote 开放。选择在该 Agent 首次打开后固定，重复并发打开、跨 session scope、重复 id、禁用及旧 configRevision 均拒绝。tools/resources/server instructions 通过原生 scope 注册；probe 使用独立、不被任何 Agent 继承的 scope。不把默认服务器放入 profile 根作用域的 `mcp-client` 配置，避免与 tpcowork-browser 全局重复注入。

运行结束、取消、异常断开、Agent scope 销毁、配置/凭证变化及模块卸载都会关闭连接并撤销能力；`close()` 幂等且等待清理。运行器必须观察 `lease.signal`，不能在 MCP 异常撤销后继续把任务记为成功。TaskContext 的持久化、重启 interrupted 状态和首次提交事务由 T6 负责；重启不自动重新建立旧任务连接。

## T7 默认接入契约

`defaultMcpDefinitions()` 仅返回以下三个描述，无安装/连接副作用：

| id | 传输与端点 | DSH 凭证引用 | 注入位置 |
| --- | --- | --- | --- |
| juyuan | Streamable HTTP，`https://api.gildata.com/mcp-servers/aidata-assistant-srv-api` | JUYUAN_MCP_TOKEN | URL query `token`，Host 内存中编码 |
| caihui_mcp | Streamable HTTP，`https://mcp.finchina.com/finchina-data-mcp-server/mcp` | CAIHUI_MCP_API_KEY | header `x-api-key` |
| playwright | stdio | 无 | T7 注入核对后的 command/args/cwd |

端点可用函数参数 `juyuanEndpoint` / `caihuiEndpoint` 覆盖。Playwright 必须由 T7 传 `playwright: { command, args, cwd? }`；未传时 command 为空，显示 needs_configuration，不执行 npx 下载。源项目候选为 `@playwright/mcp@0.0.78`，兼容版本及本地 launcher 的固定由 T7 核对，不能从描述器直接盲装。该工厂不包含其他默认接入，不筛除或删除用户手动配置的服务器。

凭证每次操作由 DSH credentials.resolve 读取，远端只收到 configured/writable 标志。query/header/env 实值及编码形式会从底层诊断错误移除，stdio 子进程 stderr 不继承到 Host 日志；默认资源、profile patch、事件和任务选择均不保存解析后的值。当前未获取聚源/财汇部署凭证，也未安装并运行 T7 尚未核定版本的 Playwright，因此这三个默认服务的真实部署联通留给 T7/T8，不能用本地协议 fixture 测试替代。

## 验证

本任务包含真实 Loader/profile/Gateway 的增删改、重启恢复及移除 tombstone 测试；本地 stdio 子进程和 Streamable HTTP 服务的真实协议协商、工具发现、header/query 注入、任务工具/资源/提示隔离、DSH 权限 guard、独立 probe、取消/超时/崩溃/禁用/卸载清理测试。测试使用隔离临时 profile 和虚构凭证，不读写桌面真实 profile，不调用外部默认服务。

2026-10-15 实际通过：

```sh
# worktree 根目录
node scripts/check-worktree.mjs
node plugins/tpcowork-toolbox/build.mjs --typecheck
node plugins/tpcowork-toolbox/build.mjs
node plugins/tpcowork-toolbox/tests/build-mcp.mjs
node plugins/tpcowork-toolbox/tests/artifact-smoke.mjs
node plugins/tpcowork-toolbox/tests/mcp-artifact-smoke.mjs
node deepseek-harness/node_modules/vitest/vitest.mjs run --config plugins/tpcowork-toolbox/vitest.config.ts
```

工具箱 7 文件、35 项通过（含 MCP 10 项和真实 profile 恢复 1 项）；最后补充禁用状态独立探测后，MCP 10 项再次通过。两个 smoke 分别验证编译的 Host/Client ModuleLoader 和编译 MCP Host/Gateway 的真实 stdio 探测及卸载。

```sh
# deepseek-harness 目录
npx --yes pnpm@11.28.5 run build:native-system
npx --yes pnpm@11.28.5 run build:lib:host
npx --yes pnpm@11.28.5 exec tsc -b packages/api/gateway/tsconfig.client.json packages/client/ui-layout packages/client/ui-sidebar
npx --yes pnpm@11.28.5 exec tsc -b packages/mcp/mcp-client
node node_modules/tsdown/dist/run.mjs --config-loader native --env.DSH_BUILD_FACE host --filter @deepseek-ai/dsh-mcp-client
npx --yes pnpm@11.28.5 exec vitest run packages/mcp/mcp-client/tests/apply.spec.ts packages/mcp/mcp-client/tests/reconnect.spec.ts packages/mcp/mcp-client/tests/server-context.spec.ts packages/mcp/mcp-client/tests/protocol.spec.ts packages/mcp/mcp-resources/tests/resources.spec.ts
npx --yes pnpm@11.28.5 exec tsx scripts/run-oxlint.ts packages/mcp/mcp-client/src/index.ts packages/mcp/mcp-client/src/connection.ts packages/mcp/mcp-client/src/tools.ts packages/mcp/mcp-client/src/transport.ts packages/mcp/mcp-client/src/redact.ts packages/mcp/mcp-client/tests/http-fixture.ts
```

DSH MCP 回归 5 文件、82 项通过，改动文件 lint 通过。产物 smoke 前还按 `docs/worktree-development.md` 在 `typert/registry`、`api/gateway`、`client/ui-layout`、`client/ui-sidebar` 包目录执行了 `pnpm exec tsdown --config-loader native`，并补构建 Gateway 实际依赖的 `client/connection` 包；均成功。完整 DSH Client 聚合检查仍沿用迁移记录中的桌面 TS6307 限制，本任务没有宣称其通过。

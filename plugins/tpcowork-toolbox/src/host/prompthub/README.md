# PromptHub Host / Client 交接（TPCO-17）

本模块复用 `nanobot-gui/src/core/prompthubApi.ts` 的服务协议：`POST /api/users/login`、`POST /api/convex/query`（`skills:listPublicPageV4`）、`GET /api/skills/:id`、`GET /api/skill-versions/files?versionId&path` 和 `POST /api/skills/publish`。没有复制 gateway、执行器或持久安装清单。

## T7 接线

- 在同一个 toolbox Host 包内，先挂载 T2 skills/installer，再挂载 `src/host/prompthub/index.ts` 的 `applyPromptHubModule(ctx, config)`。`inject` 是 `credentials`、`skills`、`profileContext`、`typert`、`toolboxInstaller`。优先直接组合源码，让 Host 共用 T2 的错误类及来源适配；本任务也验证了分别编译的模块能通过同一个 installer 安装。
- Host 注册自己的 `hostContribution`，并用 T2 `registerSource('prompthub', resolver)` 注册可释放来源。卸载会中止网络请求、等待清理并撤销来源；源码/资源不会写入其他任务或源工程。
- `Config` 默认：`endpoint: 'http://localhost:8080'`、`passwordEncoding: 'legacy'`、`requestTimeoutMs: 30000`、`pageSize: 30`、`maxCatalogItems: 10000`、`maxResponseBytes: 100663296`、`browserAuthTimeoutMs: 300000`。发行 patch 允许通过 `DSH_PROMPTHUB_URL` 覆盖 endpoint，部署也可覆盖 `prompthub.endpoint`；不含凭证、query、fragment，允许 HTTPS 或回环 HTTP。显式清空地址且未设置环境变量时状态为未配置，不探测默认公共商店。
- T7 在自己的 composition/schema 中组合此 Config，纳入原生 DSH credentials、skill、skill-filesystem、app-boot、schemastery 等现有 peers；最终 Host/Client build、exports、patch 和安装入口由 T7 持有。本任务提供独立 `tests/build-prompthub.mjs`，产物是 `lib/prompthub.js`、`lib/prompthub-remote.js`，不自行修改共享 package/build/patch。
- 已做必要的公共适配：`contracts/prompthub.ts` 增加可选取消信号和脱敏账户 state；`client/remote.ts` 复用 T5 codec 替换旧重复 descriptor；`ui/index.tsx` 原样转发 signal；`ui/locales.ts` 增加中英文反馈。只修改这些 PromptHub 接点，未改 MCP、teams 或任务提交契约。`tests/ui-components.spec.ts` 两个 PromptHub 断言相应检查新增 signal。
- Client 仍挂载原有 `managementContribution`，其中已包含 T5 descriptors；**不要再次挂载 prompthub remoteContribution**。所有 UI 经原有 Remote/slots 和 `toolbox/changed` 刷新，不增加轮询或通知通道。

## 认证与协议边界

桌面首页登录使用系统默认浏览器打开 PromptHub `/desktop/authorize`；`browserAuth()` 提供该地址与等待超时。网站复用已有登录态，未登录时跳转现有 `/login` 并保留授权请求。用户明确确认后，网站将 `localStorage['prompthub.token']` 通过 JSON POST 交给桌面的临时 `127.0.0.1` 回调。桌面校验网站 Origin、Host、路径与每次新建的随机 state，再调用 `acceptBrowserSession()`。token 不进入授权链接、地址栏或应用渲染进程。

Host 使用该 token 请求 `users:me`，验证用户资料后才写入 `credentialKey('toolbox-prompthub', 'session')` 的 grant record，绑定 endpoint 并保存安全用户资料。无效的新 token 不覆盖已有登录。网站只有在 Host 确认保存后才显示成功。成功、失败、取消和超时均关闭本机回调监听；提交已开始时等待其完成，退出登录排在提交之后。

主页与技能商店使用同一份 grant；桌面重启后恢复账号，退出删除 record，保留系统浏览器的网站登录态。应用 Client 仅接收用户资料和认证状态，profile patch、日志和账号事件不携带 token。原有密码引用登录继续由 Host 使用 DSH `credentials.resolve()` 解析密码。401 会保存无 token 的 expired 状态，并用比较当前 token 的更新避免清除新登录。即使只读凭证无法清除，本 Host 仍拒绝继续使用已知失效 token。403 表示权限拒绝，不自动退出。

参考 GUI 虽使用字段名 `passwordHash`，其登录调用链没有散列，故默认 `legacy` 发送解析到的值；只有部署协议明确需要时使用 `sha256`。没有服务账号，不能声称已验证实际部署采用哪种编码。登录失败不回显服务正文或解析后的凭证。

目录首请求与参考相同，`args: {}`；明确返回 Convex `continueCursor/isDone` 时才按 `paginationOpts` 继续读取。Host 对完整已读结果搜索与分页，游标绑定查询、短期快照及五分钟有效期。超限/循环游标/不完整形状报错，不呈现成功的空目录。实际部署若改变分页响应，需以服务协议调整适配，不能猜测成功。

下载固定详情中的 versionId 和按 T2 算法计算的包指纹，安装前再读详情拒绝版本漂移。每项检查路径、重复/大小写/NFC 冲突、总大小、文件数、响应 size/hash、实际字节 hash 和必需资源。参考协议的 content 按 UTF-8 解码；仅在响应显式声明 `encoding: 'base64'` 时解码二进制。旧服务若不能无损返回二进制，校验会拒绝而不会安装损坏资源。全部文件交 T2 原子发布；权限、来源所有权、重名和用户修改保护继续由同一个 installer 决定。取消 install 使用 requestId 作为 operationId，等待 T2 清理；失败后重试使用新 requestId。

上传只发生在用户选择本地技能、检查资源并点击上传后。Host 从实际 DSH provider inventory 按 skillId 读取目录，不接受页面路径；保持全部脚本、模板、引用与二进制字节，不修改磁盘源文件。跳过安装 marker、VCS/依赖/缓存、凭证文件、个人画像/会话/日志和本地配置；排除后再次验证入口、声明资源与个人文件引用。正文出现私钥、令牌、明显秘密赋值或个人绝对路径会拒绝。扫描是规则检查，不能识别一切个人信息或压缩包内部秘密，用户资源确认仍必需。

multipart 字段沿用参考：slug/displayName/version/changelog/visibility/category/tags，以及保留相对路径的 files。slug 必须与 SKILL.md canonical name 一致，避免上传后名称不匹配。服务返回的 publish fingerprint 视为不透明值，不错误套用 T2 安装指纹算法；确认 fileCount/IDs 后只报告上传受理，不能据此声称已审核或公开。显式失败、拒绝、非 JSON、断网和超时分别处理。发送后的取消/不明结果提示先检查商店，不自动重发。上传 requestId 在本 Host 生命周期内重放同一结果/错误，输入不同拒绝；不承诺重启后或服务端幂等，`Idempotency-Key` 仅为附加请求提示。

## 验证

在本任务隔离 worktree 安装依赖（独立 store、copy），运行原生构建与 Host 构建后：

```sh
node scripts/check-worktree.mjs
node plugins/tpcowork-toolbox/build.mjs --typecheck
node plugins/tpcowork-toolbox/build.mjs
node plugins/tpcowork-toolbox/tests/build-skills.mjs
node plugins/tpcowork-toolbox/tests/build-prompthub.mjs
node deepseek-harness/node_modules/vitest/vitest.mjs run --config plugins/tpcowork-toolbox/vitest.config.ts
node plugins/tpcowork-toolbox/tests/artifact-smoke.mjs
node plugins/tpcowork-toolbox/tests/prompthub-artifact-smoke.mjs
node plugins/tpcowork-toolbox/tests/prompthub-browser-smoke.mjs
```

本地 HTTP fixture + 原生凭证文件 + 真实 Loader/profile/installer/Gateway 验证登录→目录→详情→完整资源安装→原生 cold-session `/name` catalog/skill loader；包括重启恢复、失效重登、只读凭证、权限拒绝、重名更新/用户修改保护、下载取消/超时/重试、错误正文脱敏、秘密/个人文件/符号链接拦截、multipart 资源保留和上传幂等/不明结果。UI 测试验证重登、确认上传、实际取消信号、等待清理和错误反馈；compiled smoke 验证独立产物和卸载。

网站认证 smoke 使用独立 Chrome、真实 Electron、已编译桌面认证模块、PromptHub 实际 Vue 构建与本地 API fixture，验证首次密码登录、已有登录态确认、桌面重启恢复、共享退出、无效 token 和网站取消。桌面只创建应用主窗口，状态事件不携带 token。运行前需先构建桌面 Host TypeScript 与 PromptHub Web；`DSH_PROMPTHUB_WEB_DIST` 可指定网站产物目录，默认使用相邻 `prompthub/web/dist`；测试使用临时 Chrome profile，`DSH_PROMPTHUB_BROWSER_CHANNEL` 默认 `chrome`。

真实部署账号、公共商店上传、完整 GUI/Web 端到端尚未验证；所有发布测试都只访问隔离本地服务。T7 接线和 T8 整体联调仍须验证最终安装包中的完整链路。

# DSH 桌面浏览器插件

`@tpcowork/dsh-browser` 将 tp-cowork / Zcode 的原生浏览器运行时接入 DSH：左侧会话通过标准工具操作网页，右侧显示同一个 Electron WebView，用户可以直接点击、输入并接管控制。插件使用独立持久化分区，Cookie、localStorage、IndexedDB 和网站权限随应用重启保留。登录是否继续有效仍由网站决定。

## 安装与启动

需要本工作区的 `deepseek-harness` 桌面壳、Node 22.19+ 或 24+、pnpm，以及已初始化的 Desktop profile。普通官方 DSH 安装包没有此原生桥接，单独安装 npm 插件不能增加 Electron API。当前工作区已接入桥接；新机器先按 Harness 的桌面开发文档构建并启动一次，再退出应用。

在本工作区根目录执行：

```sh
node scripts/build-browser.mjs
node scripts/desktop-plugin.mjs install browser
cd deepseek-harness
pnpm start:desktop
```

构建脚本安装插件开发依赖、生成 Host / Client / Electron 代码，复制原生资产到桌面壳，再编译桌面桥接。正常构建不依赖相邻的 tp-cowork 源码。升级时先退出 DSH，执行相同命令并重新启动；本地网站数据会保留。Electron 安装包构建会包含已有的 `apps/desktop/lib/tpcowork-browser/` 资产，因此构建安装包前也需先构建插件。

```sh
node scripts/desktop-plugin.mjs list
node scripts/desktop-plugin.mjs remove browser
```

移除插件会撤销工具和界面；登录数据保留。需要退出网站登录时，先在插件的浏览器设置中选择“清除全部网站数据”。脚本的默认目标仍是 `ui`；`browser` 仅管理浏览器插件，`all` 同时管理 UI 与浏览器插件。

## 使用

在会话中输入“打开掘金网站”，助手创建的网页会显示在右侧。也可从右侧新建“浏览器”标签，手动打开网站并登录，然后让助手读取或操作该页。用户创建的页需要助手先 `listUserTabs`，再 `claimTab`。网站登录在本应用全部会话、工作区间共享；每个标签的操作权限属于创建或认领它的会话，其他会话不能直接操作它。

“手动接管”阻止该页后续自动操作，取消当前会话正在执行的 Host 请求，并停止该页由助手启动的录制脚本。已送达网页的点击或提交可能已经生效。“交还给助手”恢复工具控制。会话切换、面板折叠、Client 重载和页面进程恢复保持原生页面与会话绑定；应用重启会按需重建标签并恢复网址和视口，不恢复网页的 JavaScript 内存。

工具栏提供地址导航、前进后退、多标签、响应式宽高、显示缩放、截图保存及定时 WebM 录制。设置中提供 Chrome Cookie / localStorage 导入、下载文件定位、网站权限和缓存清理。截图、录屏的保存按钮使用系统文件对话框；普通下载保存到应用私有下载目录。

## Model Experience

插件通过 `ctx.tools` 注册 9 组工具，使用 DSH 原有的权限检查、取消信号、PTC 和会话日志。`browser_tabs` 管理标签和认领；`browser_navigate` 导航；`browser_snapshot` 读取页面；`browser_act` 执行 Playwright 定位器、ARIA / DOM 读取及坐标操作；`browser_screenshot` 返回持久化图片附件；`browser_dialog` 处理网页 JavaScript 弹窗；`browser_download` 获取下载；`browser_viewport` 设置视口；`browser_recording` 管理 WebM 任务。每组完整参数在运行时工具 schema 中提供。

最小调用顺序示例：

```json
{"command":{"method":"newTab"}}
{"command":{"method":"navigate","tabId":"<返回的 tabId>","url":"https://example.com"}}
{"command":{"method":"playwright","tabId":"<返回的 tabId>","action":{"name":"domSnapshot"}}}
{"command":{"method":"screenshot","tabId":"<返回的 tabId>"},"outputPath":"evidence/page.png"}
```

`outputPath` 为当前会话工作区内的新文件相对路径，拒绝目录穿越、指向工作区外部的符号链接以及覆盖已有文件。截图总会生成 DSH 图片附件。下载在 `downloadPath` 调用、录屏在已完成的 `recordingStatus` 调用上指定 `outputPath`，即可持久保存；临时录屏会在过期或插件卸载时删除。工具超时会提示先观察页面再决定是否重试，以免重复提交。模型仍须把网页文本视为外部数据。

## 配置与数据

Cordis 插件条目接受以下可选配置；修改后重新加载插件：

```yaml
- id: tpcowork-browser
  name: '@tpcowork/dsh-browser'
  config:
    timeoutMs: 40000
    attachTimeoutMs: 15000
    tabLimit: 64
    permissionTimeoutMs: 60000
```

`timeoutMs` 范围 1000–180000，`attachTimeoutMs` 范围 1000–60000，`tabLimit` 范围 1–128，`permissionTimeoutMs` 范围 1000–180000，时间单位均为毫秒。原生窗口和页面必须就绪才能执行工具。

网站存储位于 Electron `userData` 的 `Partitions/tpcowork-dsh-browser/`；标签恢复文件、权限、下载和临时录屏位于 `userData/tpcowork-browser/`。不在插件源码、工作区或日志中另存 Cookie 值。网站 Guest 启用 sandbox 和 contextIsolation，不提供 Node 或 DSH preload，并禁止访问应用 Host。清理缓存保留登录；清除全部网站数据需要 UI 确认，会关闭网页并清除网站存储及权限。

## 验证和适用范围

已在本机 macOS / Electron 43 验证原生浏览器操作、会话隔离、接管、截图、WebM、下载、弹窗、权限、崩溃恢复，以及完整进程重启后的 Cookie / localStorage / IndexedDB / 视口恢复。Chrome 导入测试使用自行生成的加密 SQLite Cookie 样例，未读取个人 Chrome 凭据；真实钥匙串授权和不同网站的导入兼容性需要按实际使用验证。DSH 的真实 Host Loader 和 Client roster 测试覆盖工具注册、策略拒绝、结果展示、重载和卸载。

Windows / Linux 尚未实机验收。Windows Chrome App-Bound 解密辅助程序未随此插件分发。文件上传不受上游浏览器运行时支持；不包含 Web / 手机远程控制、Chrome 扩展或浏览器密码管理器。该实现复用参考项目的浏览器核心与交互方式，不声称所有平台、网站或 Zcode 产品细节完全一致。

开发验证命令（在本工作区根目录）：

```sh
node plugins/tpcowork-browser/build.mjs --output test-results/lib
node --test plugins/tpcowork-browser/tests/protocol.test.mjs
cd deepseek-harness
BROWSER_TEST_OUTPUT=test-results/lib pnpm exec vitest run --config ../plugins/tpcowork-browser/vitest.config.ts
pnpm exec vitest run apps/desktop/tests/browser-plugin.spec.ts apps/desktop/tests/host-process.spec.ts apps/desktop/tests/preload-app.spec.ts apps/desktop/tests/installer-packaging.spec.ts
cd ../plugins/tpcowork-browser
BROWSER_TEST_LIB=../../test-results/lib node tests/native-smoke.mjs
```

原生测试使用独立临时 userData 和本地测试网站。`--output` 用于暂存构建，避免写入正在运行的插件。正式分发包可在完成默认构建后于插件目录执行 `npm pack --ignore-scripts` 生成。引用版本、许可证和本地补丁见 [NOTICE.md](NOTICE.md)。

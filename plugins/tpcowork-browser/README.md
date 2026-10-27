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

首次打开浏览器时可选择从 Chrome 导入 Cookie。“不再显示”会永久关闭自动提示；“以后再说”（或按 Esc）会关闭提示五天。选择在所有会话、标签间共享，重启后仍有效，并继承旧版本已保存的选择。之后仍可从浏览器设置手动导入。

“手动接管”阻止该页后续自动操作，取消当前会话正在执行的 Host 请求，并停止该页由助手启动的录制脚本。已送达网页的点击或提交可能已经生效。“交还给助手”恢复工具控制。会话切换、面板折叠、Client 重载和页面进程恢复保持原生页面与会话绑定；应用重启会按需重建标签并恢复网址和视口，不恢复网页的 JavaScript 内存。

右侧面板的外观与交互移植自参考项目的浏览器面板（EmbeddedBrowserPaneParts、BrowserViewportToolbar、ResponsiveBrowserViewport 等）：工具栏依次为后退、前进、刷新（加载时旋转）、居中的圆角地址栏（左侧站点设置入口可就地修改该网站权限）、自由尺寸开关和“更多”菜单。地址栏沿用参考项目的规则：本机、私网和带端口的地址默认使用 HTTP，公网域名使用 HTTPS。“更多”菜单包含在默认浏览器中打开、开发调试工具（仅开发构建）、手动接管 / 交还给助手、保存截图、录制 10 / 30 / 60 秒、新建标签页及本会话的其他页面。

标签设置了视口尺寸时即进入自由尺寸模式（助手新建的页面默认 1280 × 720，与参考项目一致）：尺寸栏显示宽 × 高与缩放（适应窗口、50%–200%），页面以带描边的画板居中显示在浅灰画布上，四边和四角均可拖动调整，聚焦手柄后方向键每次 1 像素，按住 Shift 为 10 像素。空白页、加载失败（证书错误附带指引）和页面进程退出时显示对应状态页。右侧标签显示网站图标；助手操作页面期间及结束后 5 秒内改为指针图标。助手操作期间浏览器区域尺寸变化时，会短暂提示可能影响当前自动操作。

地址栏右侧的书签按钮可从 Chrome 或 Edge 导入书签（读取该浏览器最近使用的 Profile，否则为 Default 或第一个有书签的 Profile；只保留 http/https 网址，最多 20000 个）。菜单支持搜索（跨文件夹匹配标题、网址和文件夹名，标题和域名前缀优先）、展开文件夹、方向键选择，点击即在当前页面打开；在地址栏输入时下方列出最多 6 个匹配书签，↑/↓ 选择、Enter 打开、Esc 收起。书签是只读快照，按浏览器分别保存在应用数据目录的 `tpcowork-browser/bookmarks.json`（仅当前用户可读），再次导入会用该浏览器的最新书签替换；未安装或未使用过的浏览器对应按钮不可用。设置页的“书签”卡片显示已导入的数量和时间，也可从这里导入。原生验收见 `node tests/native/bookmarks-visual.mjs`（使用临时 Chrome 书签夹具，不读取本机浏览器数据），截图写入 `test-results/bookmarks-*.png`。

设置中提供 Chrome Cookie / localStorage 导入（显示实际导入的 Cookie、站点与条目数量）、下载文件定位、网站权限、缓存清理，以及“忽略证书校验”开关。该开关只作用于本插件的浏览器分区，应用自身的网络请求始终校验证书；Chromium 会在进程内缓存证书校验结果，因此修改在重启应用后生效，界面会提示待重启。仅在访问可信的内网测试站点时开启。截图、录屏的保存按钮使用系统文件对话框；普通下载保存到应用私有下载目录。

## Model Experience

每轮对话的第一步，插件读取当前会话的内置浏览器状态；与上次告知的状态不同时，在对话中加入一条来源标记为 `tpcowork-browser` 的上下文消息，说明已打开的标签数量和当前网址，并注明这是界面状态而非用户指令。全部标签关闭后会告知一次“没有打开的标签”。网址只保留 HTTP(S)，去掉用户名、密码和 `#` 片段（OAuth 令牌常在其中），超过 4 KB 时省略。读取为只读操作，不恢复标签、不显示“助手正在操作”，最多等待 1 秒，失败时不影响本轮对话。配置 `ambientContext: false` 可关闭。

插件随附两个技能：`control-browser`（目标标签确认、DOM 快照→定位器→操作、截图时机、录屏、异常处理与安全规则）和 `web-gui-tester`（纯 GUI 黑盒测试方法与测试报告）。两者改编自参考项目，通过 DSH 技能注册表以内置等级提供。

插件通过 `ctx.tools` 注册 9 组工具，使用 DSH 原有的权限检查、取消信号、PTC 和会话日志。`browser_tabs` 管理标签和认领；`browser_navigate` 导航；`browser_snapshot` 读取页面；`browser_act` 执行 Playwright 定位器、ARIA / DOM 读取及坐标操作；`browser_screenshot` 返回持久化图片附件；`browser_dialog` 处理网页 JavaScript 弹窗；`browser_download` 获取下载；`browser_viewport` 设置视口；`browser_recording` 管理 WebM 任务。每组完整参数在运行时工具 schema 中提供。

最小调用顺序示例：

```json
{"command":{"method":"newTab"}}
{"command":{"method":"navigate","tabId":"<返回的 tabId>","url":"https://example.com"}}
{"command":{"method":"playwright","tabId":"<返回的 tabId>","action":{"name":"domSnapshot"}}}
{"command":{"method":"screenshot","tabId":"<返回的 tabId>"},"outputPath":"evidence/page.png"}
```

### 编程模式（PTC 预设）

在 `run_code` 编程模式中，浏览器工具成为程序内的 `tools.browser_*` 绑定。插件同时提供参考项目的 `agent.browsers` SDK：首次需要时，Host 将 SDK、其文档和后端描述复制到新建的仅当前用户可访问的临时目录（打包后的 `app.asar` 不能被程序的 ESM 加载器读取），在系统提示中给出导入地址，并在插件卸载时删除。程序按以下方式启动：

```js
const { setupBrowserRuntime } = await import("<系统提示给出的 file:// 地址>");
await setupBrowserRuntime({ globals: globalThis, tools, ToolCallError });
const browser = await agent.browsers.getDefault();
return await browser.documentation();
```

`tools` 和 `ToolCallError` 是 `run_code` 传给程序的参数而非全局变量，因此需要显式传入。SDK 的每个命令都经同名浏览器工具执行，与直接调用工具共享权限、日志、取消和沙箱策略。`tab.screenshot()` 返回 PNG 字节，同时截图会在程序结束后作为图片附加到下一步；不要返回或打印这些字节。程序只通过 `return` 或 `console.log` 输出结果。

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
    ambientContext: true
    backend: desktop
    # executablePath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

`timeoutMs` 范围 1000–180000，`attachTimeoutMs` 范围 1000–60000，`tabLimit` 范围 1–128，`permissionTimeoutMs` 范围 1000–180000，时间单位均为毫秒。原生窗口和页面必须就绪才能执行工具。

`backend` 选择浏览器后端：`desktop`（默认）使用桌面内置浏览器；`headless` 使用参考 CLI 的托管无头 Chromium，适用于没有桌面的 DSH Web / CLI；`auto` 在 Host 没有桌面浏览器（如 Node 模式 Host 运行器）时改用无头模式。显式的 `desktop` 不会自动切换。无头模式使用 `executablePath`（必须为绝对路径），未配置时按参考项目的顺序查找已安装的 Chrome、Chromium 或 Edge；插件构建产物自带固定版本的 `playwright-core`，仅在无头模式下加载。无头 Chromium 在会话首次使用浏览器时启动，其标签属于该会话，会话结束时关闭；不保存登录，也不支持下载文件路径、录屏、文件上传和用户标签。

网站存储位于 Electron `userData` 的 `Partitions/tpcowork-dsh-browser/`；标签恢复文件、权限、下载和临时录屏位于 `userData/tpcowork-browser/`。不在插件源码、工作区或日志中另存 Cookie 值。网站 Guest 启用 sandbox 和 contextIsolation，不提供 Node 或 DSH preload，并禁止访问应用 Host。清理缓存保留登录；清除全部网站数据需要 UI 确认，会关闭网页并清除网站存储及权限。

## 验证和适用范围

已在本机 macOS / Electron 43 验证原生浏览器操作、会话隔离、接管、截图、WebM、下载、弹窗、权限、崩溃恢复，以及完整进程重启后的 Cookie / localStorage / IndexedDB / 视口恢复。Chrome 导入测试使用自行生成的加密 SQLite Cookie 样例，未读取个人 Chrome 凭据；真实钥匙串授权和不同网站的导入兼容性需要按实际使用验证。DSH 的真实 Host Loader 和 Client roster 测试覆盖工具注册、策略拒绝、结果展示、重载和卸载。

`agent.browsers` SDK 已在真实 `run_code` 运行时（Node 进程，`workspace-write` 沙箱完整生效）中验证导入、工具路由、截图字节与图片附加、错误映射及文档；无头后端已用本机 Chrome 验证页面操作、截图、会话隔离、会话关闭与重启。

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

`tests/sdk.spec.ts` 在构建产物上运行真实的 `run_code` 程序；`tests/headless.spec.ts` 中启动 Chromium 的用例在本机找不到 Chrome 时跳过。原生冒烟测试需要 `openssl` 生成自签名证书，用于验证证书设置。

原生测试使用独立临时 userData 和本地测试网站。`--output` 用于暂存构建，避免写入正在运行的插件。正式分发包可在完成默认构建后于插件目录执行 `npm pack --ignore-scripts` 生成。引用版本、许可证和本地补丁见 [NOTICE.md](NOTICE.md)。

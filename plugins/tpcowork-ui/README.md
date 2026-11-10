# TP Cowork 外观插件

把本地 `tp-cowork` 的中性灰浅色/深色配色、264px 侧栏和紧凑圆角控件应用到 DSH，首页参照 nanobot-gui。聊天、工作区、设置及工具执行继续使用 DSH 的现有组件与服务。助手身份和通用提示词由独立的 [tpcowork-core](../tpcowork-core/README.md) 维护。

## 维护位置

| 文件 | 用途 |
| --- | --- |
| `index.js` | 宿主启动样式注入 |
| `theme.json` | 配色和布局变量，每项同时提供浅色与深色值 |
| `styles.css` | 本插件组件样式和启动背景 |
| `src/runtime.js` | 主题覆盖、已有品牌插槽注册，以及卸载清理 |
| `src/layout-adapter.js` | 通过上游共享布局 store 的现有动作适配侧栏宽度 |
| `src/navigation.js` | 顶部前进、后退、窗口访问历史与原生导航接口 |
| `src/task-panel.js` | 当前会话任务投影、右上角任务卡及展开/收起交互 |
| `src/model-controls.js` | 输入框的组合式模型菜单与思考强度滑块 |
| `src/settings-launcher.js`、`src/tpcoworkhub-account.js`、`src/interface-preferences.js` | 侧栏账号、外观菜单与 TP Cowork Hub 桌面账号状态 |
| `src/upstream-css.js`、`src/upstream-styles.js` | 读取 DSH 已构建的 CSS 类名并生成原版组件的覆盖样式 |
| `locale/zh.json`、`locale/en.json` | 插件列表说明和界面文字 |
| `cordis.patch.yml` | 插件组合 |
| `client.js`、`upstream.css`、`upstream-classes.json` | `node build.mjs` 生成的浏览器模块、原组件样式和类名映射，不直接编辑 |

外观通过现有的 `ctx.theme.overrideTokens()`、品牌插槽和插件生成的 CSS 生效。构建器读取 DSH 已构建 Client 模块中的样式和类名，避免从其他目录复制的桌面产物与源码路径生成的类名不一致；规则受 `body[data-tpcowork-ui]` 限制，插件释放后恢复原组件样式，并保留用户选择的浅色/深色偏好。首页问候注册到已有的 `conversation.hero.brand.mark` 插槽，插件样式隐藏原标题与 Preview 徽标；「预览版」显示在左侧栏的 TP Cowork 名称旁，英文显示为「Preview」。禁用后恢复原版首页。

自动化页面的侧栏名称和页标题通过现有插槽覆盖为「自动化」，中文文案维护在 `locale/zh.json` 的 `ui.automation` 中；英文名称沿用上游。页面其余翻译与任务操作使用原组件，禁用插件后恢复上游名称。

设置参照 ZCode 以整窗页面打开，而非居中弹窗，尺寸和配色按 ZCode 源码（`tp-cowork/packages/ui/src/SettingsPage.tsx`、`settings/SettingsPageParts.tsx`）还原。只改样式：构建时读取 DSH `SettingsRoot`、`GeneralSection`、`ModelsSection` 和 `FontSettingsGroup` 的 CSS Modules 类名生成覆盖规则，DSH 设置组件和插槽不变。左侧 268px 栏用侧栏底色，顶部「← 返回工作区」（覆盖 `settings.close` 插槽文案），导航项高 32px、圆角 12px；右侧为内缩 4px、圆角 12px、带边框的内容面板，顶栏 48px，内容居中最宽 832px（896px 容器内扣除左右各 32px），顶部显示当前分区的大标题（30px，由 `settings.action` 中的组件读取当前导航项，经 `--tpcowork-settings-title` 交给样式；自带标题行的分区以 `data-tpcowork-own-title` 让位，例如使用统计）；通用设置按 ZCode 分成多张圆角卡片（见下段），行内边距 16×12px、1px 分隔线；模型分区隐藏自带标题。窗口窄于 1024px 时左栏收成 68px 图标栏、标题 24px。页面从 Windows 标题栏下方开始，macOS 红绿灯位于左栏顶部留白内。Esc、⌘[ 与返回按钮均回到工作区。禁用外观插件后恢复原版弹窗。 设置侧栏图标复用 ZCode 使用的 Lucide 图形（通用 Settings2、模型 Package、智能体 Bot、记忆 Brain、快捷键 Keyboard、使用统计 BarChart3）；SVG 与许可证保存在 `assets/settings-icons/`。构建时按原始 SVG 图形生成仅作用于设置导航的 CSS mask，不依赖导航顺序和语言。

通用设置通过 `settings.general.item` 插槽覆盖移除 Session Log 上传选项及说明，禁用插件后恢复原版设置项。

通用设置页参照 ZCode 3.16.3 的通用设置（`styles-CQuzX8si.js` 中 `gL` 卡片、`hL` 行），全部由 `src/general-settings.js` 通过插槽实现，不修改 DSH 源码。卡片依次为：界面语言；开发者模式、权限；任务通知、通知声音、链接打开方式（仅桌面端）；交互行为、提问自动继续、显示思考过程、显示待办；工作步骤展示、收起时机、性能与用量；当前版本。原生行以优先级 -10 重新注册，只改 `order` 和文案，控件、store 与保存逻辑仍是原生的；卡片间以空的 `tpcowork-card-break-*` 行分隔，样式据此给每张卡片加圆角和边框。标题下方按 ZCode 的 `VYn` 显示当前语言偏好标签（系统默认或当前语言名）。行文字按 ZCode 的 `hL`：标题 14px 中等字重，说明 14px、行高 24px、ZCode 的 subtle 色（`--tpcowork-settings-subtle`）；原生行通过构建时读取 `PreferenceRow`、`PermissionRow`、`LanguageRow`、`DeveloperToolsRow`、`EnterBehaviorRow` 的 CSS Modules 类名覆盖，下拉框保留 DSH 原样。新增开关保存在本机 `localStorage`，默认值同 ZCode：

- **界面语言**：在原生语言菜单最前加「系统默认」。选中后每次启动按系统语言（`navigator.languages`，先精确匹配再按主语言）切换；选具体语言即取消跟随。
- **通知声音**（默认开）：桌面通知桥总会播放系统提示音，关闭声音时改用页面的 `Notification`（`silent: true`），窗口获得焦点时同样不弹出；自动化结果通知同样遵循。
- **提问自动继续**（默认开）：Agent 提问 5 分钟无人回答时，由插件以原生问题卡的 `answer()` 提交一条“未在 5 分钟内回答，请自行判断继续；这不代表同意”的回复。卡片获得焦点时暂停计时，开始输入或选择“慢慢回答”后不再自动继续；关闭开关会停止当前与后续提问的计时。计划确认和自带倒计时的 timed 提问不受影响。只在应用窗口打开时生效。与 ZCode 的差异：自动继续后该问题不能再补答。
- **显示思考过程**（默认开）：关闭后每轮只保留第一条思考，其余由观察器标记 `data-tpcowork-later-reasoning` 后隐藏。
- **显示待办**（默认关）：关闭时隐藏消息流中的 `todo_write` 工具卡片，输入框上方的任务条不变。DSH 在“详细”模式下把步骤收进分组，分组标题（如「更新了计划」）仍由原生生成。

快捷键从通用设置移到单独的「键盘快捷键」分区，参照 ZCode 的 `settings/ShortcutSettingsSection.tsx` 与 `ShortcutBindingRow.tsx`：`settings.general.item` 覆盖隐藏原「快捷键／编辑快捷键」一行，`settings.section`（id `shortcuts`，排在记忆之后）显示搜索条和一张「命令／按键绑定／作用域／操作」表格。工具栏按产品要求将「全部恢复默认」放在左侧、搜索框放在右侧，DOM 与键盘焦点顺序一致。搜索框按名称、命令 ID 和别名过滤；右侧键盘按钮进入按组合键搜索（Esc 退出，Backspace 清除）；「全部恢复默认」经确认后执行 `reset-all`。点击键帽或铅笔开始录制：按下的组合即时预览并保存，Esc 取消，Backspace 恢复默认；被其他命令占用时提示「已被「…」占用」并提供「仍要绑定（原命令将失效）」，先移除占用命令的键位再写入；菜单、输入框和审批区域的固定按键只读显示，不能被抢占。垃圾桶把命令设为未分配，自定义过的键帽用 ZCode 主题品牌色（浅色黑、深色白）。以已安装 ZCode 3.16.3（`/Applications/ZCode.app/Contents/Resources/app.asar`）为准：`styles-CQuzX8si.js` 的 `tYn` / `NN` 搜索栏为右对齐 256×36px、圆角 12px；恢复按钮高 28px、图标 14px、间距 4px（`button-CPX3QH28.js`）。搜索文字使用界面字体，按键搜索使用等宽字体；文本搜索也支持清除。工具栏与表格间距 24px，操作列宽 40px，键帽高 16px、最小宽 16px，macOS 用系统无衬线字体。窄于 640px 时搜索框换行占满宽度，表格改为两列。该安装版本与 `tp-cowork` 当前源码的旧搜索栏不同。读写都经 DSH 的 `shortcuts` 服务（`catalog`、`edit`、`describeBinding`，录制和按键搜索期间调用 `recording(true)` 让桌面菜单快捷键让出键盘），存储位置不变；⌘/ 打开的原版快捷键速查仍然可用。与 ZCode 的差异：DSH 每个命令只有一组键位，因此每行一条绑定；作用域按 DSH 分组显示为全局、输入框、菜单、审批区域。

归档参照 ZCode：已归档会话不再留在侧栏，改到「设置 › 数据与统计 › 归档管理」（[@tpcowork/dsh-archives](../tpcowork-archives/README.md)）查看、取消归档和删除。样式表隐藏工作区「视图选项」菜单末尾的归档筛选（分隔线、标题和隐藏／显示／仅显示已归档三项）；运行时从 `sidebar.workspaces` 注册取得侧栏视图 store，把保存为「显示已归档」或「仅显示已归档」的筛选改回默认并保持；`workspace.toast` 的 `archived`、`stoppedAndArchived` 两条通知覆盖为只保留「撤销」，去掉「筛选已归档会话」入口。

产品组合通过 `cordis.patch.yml` 禁用 `ui-plugin-manager` 与 `ui-settings-plugins` 两个管理界面，隐藏侧栏「插件」和设置中的「内置插件」入口；依赖插件列表的 `entry-customization`（「更多」菜单中的浏览插件与创建插件）随之禁用。已安装插件及其 Host 服务继续加载，开发维护仍可使用 DSH 插件 CLI。

新会话默认使用「完全权限」：产品组合把 `sandbox-policy.mode`、`approval.policy` 与 `permission.defaultPreset` 设为 `danger-full-access`（不限制文件访问，也不弹出审批）。设置了 `DSH_PERMISSION_MODE` 时以它为准；用户在设置中保存过默认权限的，其新会话继续使用自己的选择；已有会话保持原权限。

模型设置只提供「添加自定义模型 API」，点击后直接填写 API 地址、协议、密钥和模型，不显示第三方模型提供商目录或添加方式切换。产品组合设置 `ui-settings-models.providerCatalog: false`，需使用支持此选项的 DSH 模型设置模块；`llm-pi-ai` 继续提供自定义 API 协议和配置存储，已有配置仍可编辑。

侧栏底部通过 `settings.launcher` 插槽显示圆形头像与「连接使用」，已登录时显示账号首字头像和名称，右侧保留独立设置按钮。点击账号入口显示「界面语言」「界面主题」和「连接使用／退出登录」。语言使用全局语言设置，支持系统默认及已注册语言；主题支持系统默认、深色、浅色，并与通用设置同步。菜单支持键盘操作、关闭后焦点返回、长账号名称截断和收起侧栏布局。点击菜单中的「连接使用」使用系统默认浏览器打开 TP Cowork Hub 授权页；浏览器已登录时直接确认账号，未登录时使用网站现有的用户名、密码页面。确认后侧栏显示账号名称，并与技能商店共享登录、重启恢复和退出状态。需要包含 TP Cowork Hub 桥接的桌面壳、已启用的 toolbox 插件，以及支持 `/desktop/authorize` 的网站；网站地址和等待时限由 toolbox 的 `tpcoworkhub` 配置提供，见[工具箱使用说明](../../docs/toolbox/user-guide.md)。等待认证时保留外观选项和独立设置按钮，可从账号菜单取消登录；可在桌面或网站取消，关闭浏览器标签页后可从桌面取消，未取消则等待超时。超时显示重试提示，禁用外观插件会取消尚未提交的登录并恢复 DSH 原版菜单。

「通用设置」最后一张卡片在「新手引导」之后显示「诊断信息 › 导出…」，代替 DSH Desktop 托盘中的「导出诊断信息…」：按钮经桌面桥接 `browserAutomation.request('diagnostics', …)` 交给主进程确认隐私、生成诊断包并在文件管理器中显示，导出期间按钮显示「正在导出…」；没有桌面桥接（普通浏览器）时不显示该行，桥接不支持时在说明处提示重新构建浏览器插件。诊断包内容见[诊断信息](../tpcowork-diagnostics/README.md)。

首次使用引导参照 DSH Desktop 的初始设置向导（`dsh-desktop/dsh-plugin-desktop` 的 `native-ui/setup-wizard/App.tsx` 嵌入官方引导页的形态与 `client/onboarding.css` 的版式）：整窗页面，顶部为进度圆点与「n / 5」，左侧标题、说明与主按钮，右侧为选项卡片（单选标记在右），底部为「上一步」和「跳过设置」，跳过前弹出确认，最后是「设置完成」与「开始使用」。步骤为欢迎 → 界面语言（系统默认或已注册语言，与「通用设置」的语言行同一套保存方式）→ 界面主题（浅色／深色／跟随系统）→ 界面字号（13／14／16px）→ 你希望 TP Cowork 帮你做什么？（办公与创作／代码与开发）→ 你希望看到多少工作过程？（聚焦结果／关键细节／完整过程）→ 设置完成。后两步取自 DSH 原生账户引导（`ui-settings-account` 的 purpose 与 process 步骤），写入与之相同的设置：「代码与开发」开启开发者模式并使用详细用量读数（`ui-chat.performanceUsage: detailed`），「办公与创作」关闭开发者模式并使用简洁读数；工作过程写入 `ui-chat.transcriptView`（compact／standard／detailed），与「通用设置」中的工作过程展示为同一设置。原生引导在选择「办公与创作」后直接结束，这里仍显示工作过程一步，默认选中当前设置；DSH Desktop 的窗口模式、窗口材质、插件市场、Agents-Anywhere 与浏览器访问在 TP Cowork 中没有对应功能，因此不列入。选择会立即生效（引导本身随之切换语言、主题和字号），跳过时保留已做的选择。引导经 `shell.overlay` 插槽显示，每台设备只出现一次（包括升级后的已有安装），完成或跳过后在 localStorage 记为 `tpcowork.first-run-guide.v1`；「通用设置」最后一张卡片的「新手引导 › 重新打开」会关闭设置并再次显示引导。产品不显示 DSH 原生的账户引导，引导不依赖它。浏览器检查：在同级 `deepseek-harness` 执行 `node node_modules/vitest/vitest.mjs run --config ../tp-coworkdsh/scripts/tests/first-run-guide.config.mjs --configLoader native --cache=false`，截图在 `artifacts/first-run-guide/`；其他浏览器测试在打开页面前把引导标记为已完成。

界面缩放参照 ZCode（`tp-cowork/docs/desktop/sidebar-zoom-menu.md`、`system-zoom-shortcuts.md`）：缩放整个窗口（包括图标和布局），与只改文字大小的「界面字号」是两个独立设置。账号菜单在「界面主题」之后显示「界面缩放」二级菜单：放大、缩小、实际大小，并显示各自快捷键；最大档禁用放大，最小档禁用缩小，实际大小时禁用实际大小。快捷键为 ⌘／Ctrl 加 `=`（含 Shift，即 `+`）、`-`、`0`，小键盘的 `+`、`-`、`0` 同样有效；这些按键原本是 DSH 的文字字号快捷键，现由插件在捕获阶段先处理并标记为已处理，DSH 的字号处理随之让出，文字大小改在「外观」的「界面字号」中调整。「键盘快捷键」页在「菜单」作用域只读列出这三项；录制或按键搜索期间缩放按键暂停。档位为 −3 到 +5，每档 1.1 倍，与 ZCode 相同。缩放由浏览器插件的桌面载荷执行（`browserAutomation.request('windowZoom', { action })`，见浏览器插件说明），保存在桌面用户数据目录的 `tpcowork-zoom.json`，启动时由界面插件读取并重新应用，因此首屏会先以 100% 显示，随后切换到保存的档位。macOS 红绿灯不随页面缩放：载荷按缩放调整其纵向位置，使其与侧栏顶部控件保持同一中线；侧栏顶部和收起侧栏时的左上角控件按 `--tpcowork-zoom` 为红绿灯保留固定的 68 个窗口像素。Windows 标题栏按钮区高度随缩放调整。没有桌面桥接（普通浏览器）时不显示该菜单，按键交给浏览器自身。在同级 `deepseek-harness` 执行 `node node_modules/vitest/vitest.mjs run --config ../tp-coworkdsh/scripts/tests/interface-zoom.config.mjs --configLoader native --cache=false` 检查菜单、按键和快捷键页，截图在 `artifacts/interface-zoom/`。

输入框下方的轮次、步数、缓存命中等统计（`conversation.composer.dock` 的 `activity`、`usage`）及上下文用量圆环（非插槽，由 `body[data-tpcowork-developer]` 控制的样式隐藏）仅在开启「开发者模式」时显示，关闭时不渲染；禁用插件恢复原生统计。

输入框顶部沿用 DSH 的 8px 外框留白和 4px 编辑区留白，普通首行内容起点距外框顶部 12px；技能/MCP 选择区没有提示内容时隐藏其空插槽容器，避免额外产生 8px 间距，有加载、提交或错误提示时正常显示。

会话任务区参考 Zcode 的右上角浮层，使用已有 `conversation.input.dock` 的 `todo` 注册项和当前会话的原生任务投影，通过宿主 React portal 挂到所属聊天区域。宽度达到 1280px 默认展开，否则显示当前任务和完成数摘要；支持手动展开/收起、状态图标、完成项删除线、长文字换行和内部滚动。全部完成后保留清单，没有任务时隐藏；切换会话重置展示偏好，禁用插件恢复原生输入框上方的任务面板。规则与验收见[会话任务卡](../../docs/conversation-tasks.md)。

输入框的模型选择参照 Zcode 3.16 的组合式模型菜单（`ModelConfigSelect` 的 `composerOptions`，取自已安装的 ZCode.app），以优先级 -10 遮蔽原生 `conversation.input.model` 注册项，并复用其注入的会话模型目录与 `session.selectModel`，因此与 `/model` 弹窗共享同一选择。触发器显示模型名和当前思考强度（输入框一行放不下时改为模型图标和 4px 进度条），打开时保持原宽度并显示「选择模型」。菜单宽 288px，居中显示在触发器上方，依次为：供应商行（DeepSeek 显示鲸鱼标志，API Key 供应商带「API」徽标，悬停或 → 打开供应商子菜单，切换供应商时选中其第一个模型）、「模型」列表（支持图片输入的模型带「视觉」徽标，选择后菜单不关闭）、「思考强度」滑块。滑块按 Zcode 的 composer-thought-slider 实现：每档一个刻度，填充为成功色，最高档变为绿→蓝渐变并有气泡流动，白色圆形滑块下是原生 range 输入，支持方向键、Home/End；只有一档时只显示档位，没有推理等级的模型不显示该区域。档位名称使用 Zcode 的词表（关闭／开启／低／中／高／极高／最高／极致及其别名），其他档位沿用 Host 名称；未声明推理等级的自定义 API 模型由底座 `llm-pi-ai` 按 Zcode 的内置推理规则匹配档位（按模型名、协议和站点叠加；未知模型为「关闭／开启」，DeepSeek 等为「关闭／低／高／最高」，默认最高档），并按 Zcode 的映射写入请求（见该包 README）。桌面端 Control+T（浏览器中为 ⌘⌥T／Ctrl+Alt+T）循环切换当前输入框的思考强度，菜单中显示该快捷键。所选档位保存在会话的模型选择中，刷新后保留。禁用插件恢复原生的「模型／推理等级」二级菜单。在同级 `deepseek-harness` 执行 `node node_modules/vitest/vitest.mjs run --config ../tp-coworkdsh/scripts/tests/model-controls.config.mjs --configLoader native --cache=false` 在真实浏览器中验证，截图位于 `artifacts/model-controls`。

已安装的 TP Cowork 插件以实际包名作为标题，中文说明介绍各插件的架构职责与协作关系，由各包导出的 `locale/*.json` 元数据维护。本外观插件让这些卡片的说明完整换行显示；浏览器插件的元数据由其 `src/locales.js` 生成，与浏览器面板自身的名称和说明分开维护。

本插件只改变用户看到的界面，不参与系统提示词组装。关闭或更换外观插件不会改变助手身份；仅安装 UI 时也不会修改 DSH 原始角色。自我介绍规则、角色优先级和升级说明见 [core 插件](../tpcowork-core/README.md)。

侧栏适配器读取上游 root 注册项的共享布局实例，只调用已有动作和订阅接口。初始默认宽度及重新展开时设为 264px；用户拖动的宽度保持到下一次展开。禁用时，插件默认宽度恢复到上游默认值，手动宽度与关闭状态保留。适配器校验 root 的 `create()` 仍返回同一实例，避免修改独立于实际窗口的 store。

文字色与透明度对应参考项目 `styles.css` 的 Zai 浅色/深色主题；品牌标题采用其 `WorkspaceSidebarHeader` 的 600 字重。维护这些值时以参考项目的实际颜色为准，不直接将两个项目中名称相似的灰阶变量视为同一种颜色。

## 安装与开发

先构建 DSH 的 Client 模块，再在工作区根目录执行 `node plugins/tpcowork-ui/build.mjs` 构建外观。桌面应用启动过一次后，先完整退出，再运行 `node scripts/desktop-plugin.mjs install` 安装默认 core + UI 组合，重新启动桌面即可加载。单独管理外观使用 `node scripts/desktop-plugin.mjs install ui` / `remove ui`；不指定目标的 `remove` 会移除 core + UI。脚本使用 DSH 提供的 Desktop CLI 和插件事务，不直接编辑 profile 文件。

开发桌面的默认 profile 位于 `deepseek-harness/apps/desktop/.desktop-build/development/home`；可以用 `DSH_HOME` 指定其他已经由桌面应用初始化的目录。普通 Web profile 可使用 `dsh plugin --profile web add link:/absolute/path/to/plugins/tpcowork-ui` 安装。

本插件针对当前 DSH 上游版本适配，主程序的 UI 文件保持原样。升级上游后重新执行构建和测试；必需的 CSS 类或已构建样式缺失会使构建失败，共享布局 store 不兼容会使插件启动失败。在工作区根目录执行 `node plugins/tpcowork-ui/build.mjs --check` 可检查生成文件是否与插件源码及当前 DSH 产物一致。每次重建 DSH 后都需重建外观插件；打包后的插件无需在运行时读取 DSH 源码。主题资源中的 `--dsh-sidebar-*`、`--dsh-composer-*`、`--dsh-hero-*` 和 `--dsh-chat-user-*` 由插件自己的 CSS 消费。

## 验证

在同级 `deepseek-harness` 目录执行 `node node_modules/vitest/vitest.mjs run --config ../tp-coworkdsh/plugins/tpcowork-ui/vitest.config.ts --configLoader native --cache=false`。测试通过真实浏览器 Loader 加载生成的 Client 模块，使用原版布局、主题服务与插槽注册表，检查主题切换、侧栏拖动和开关、窄屏行为及卸载恢复；还使用 DSH 实际交付的 Hero 样式验证首页问候、原标题的隐藏与恢复，以及侧栏中的预览版标签。样式测试检查展开侧栏和停靠输入框的覆盖规则不会影响收起轨道与首页输入框的原有特殊规则。视觉验收仍需要在真实桌面进行。

任务卡测试覆盖原生任务插槽的替换及卸载恢复、实时状态更新、多面板定位、跨会话偏好重置、宽窄屏默认状态、空清单和全完成清单。

模型设置的浏览器回归位于 `scripts/tests/model-settings.spec.mjs`，覆盖直接添加自定义 API、提供商目录和切换入口缺席，以及创建后刷新、编辑和保存。在同级 `deepseek-harness` 执行 `node node_modules/vitest/vitest.mjs run --config ../tp-coworkdsh/scripts/tests/model-settings.config.mjs --configLoader native --cache=false`。

身份与独立启停的回归测试位于 core 插件；在同一目录执行 `node node_modules/vitest/vitest.mjs run --config ../plugins/tpcowork-core/vitest.config.ts`。

`icon.png` 使用 512×512 TP Cowork 六边形品牌图标，侧栏展开时保留纯文字 TP Cowork，收起后的导航图标使用这张品牌图。产品构建先运行 `scripts/desktop-branding.mjs`，由 `branding/icon.png` 生成登录欢迎页标志、浏览器图标和 Windows 托盘 ICO，由带留白的 `branding/icon-macos.png` 生成 macOS ICNS；浏览器浅色与深色主题都保留图标原色。该步骤同时将桌面中英文菜单、关于窗口、登录页、更新提示及开发版应用名称统一为 TP Cowork。Windows 安装包构建已自动执行此步骤；本地开发在产品目录运行 `npm run dev`，自动准备品牌、构建并启动。`npm run desktop:preview` 将现有桌面产物复制到 `.desktop-build/branded-desktop`，用于查看品牌资源，不修改底座源码。

桌面端（macOS、Linux）主区域参照 ZCode 的 `data-workspace-conversation-frame`：窗口底色改为侧栏底色，会话栏（首页与会话共用）离窗口上、右、下各 4px，圆角 12px、1px 边框，顶部 4px 留白仍可拖动窗口；打开右侧边栏时它是右侧另一块同样的面板，两者间隔 4px。会话标题栏上内边距相应减 5px，标题行与红绿灯保持齐平。首页按窗口高度定位输入框时，桌面端把顶部占用按 76px（4px 留白、1px 边框和 71px 标题栏）计算；首页滚动区不显示滚动条，窗口过矮时仍可滚动。只改样式，构建时读取 DSH `AppFrame` 与 `SidebarRight` 的 CSS Modules 类名；浏览器版、Windows 标题栏布局和右侧全屏保持原样。

侧栏顶部参照 Zcode 增加后退与前进，支持会话、工具箱、自动化等主页面历史，以及 Command/Ctrl+[ 和 Command/Ctrl+]。规则和验收见[侧栏顶部导航](../../docs/sidebar-navigation.md)。首页参照 nanobot-gui：会话栏铺满浦江天际线背景（浅色/深色两版，取自 nanobot-gui 并转为 WebP 内嵌），左对齐的两行问候（按时段显示早上好/下午好/晚上好，第二行「交给 TP Cowork 就行」）与副标题「以专业AI赋能规范工作」从顶部 clamp(64px, 11vh, 120px) 处开始；输入框固定从窗口一半高度开始，正好落在天际线的水面上，不遮挡建筑；工作区、输入框和任务推荐共用居中的 82% 列宽（最宽 980px）。推荐列表高度不改变输入框位置；小窗口可滚动访问全部内容。首页每次出现时依次淡入：问候语，120ms 后工作区与输入框，240ms 后任务推荐，各 360ms，只改变透明度、不移动布局；启动封面显示期间暂停，封面淡出时开始，与启动画面衔接；系统开启「减少动态效果」时直接显示。在 tp-coworkdsh 目录执行 `npx vitest run --config scripts/tests/home-layout.config.mjs` 检查布局并在 `artifacts/home-layout` 生成浅色、深色和窄屏截图。

TP Cowork 默认关闭通用设置中的“开发者模式”（原生 `ui-settings.enabled`，用户已保存的开关优先）。产品使用自己的模型配置与登录入口，通过发行配置将原生账户引导设为已跳过，避免首次检测到 API Key 时重新开启开发者模式。旧版本安装由原生引导写入的 `developerTools: true` 会在启动时清除一次：同时清除 `ui-settings.enabled` 与该标记，恢复产品默认的关闭状态；之后用户手动开启只写入开发者开关，不会再被重置。关闭时隐藏全部 Agent 预设入口，新任务默认使用标准模式；开启后显示原生预设选择和管理。已有会话保留原模式，关闭再开启不会恢复之前的新任务默认值。此行为依赖底座 `ui-agent-preset` 的开发者工具控制，文案适配复用原生开关和保存动作。

「Agent 预设」页按其他设置页的样式呈现：只保留页面标题，简介作为副标题，内置预设合并为一张带分隔线的列表，每行左侧的单选标记表示新任务默认，点击该行即设为默认；「模式说明」「如何使用」和查看配置位于行右侧。产品不提供「自定义」分组及其「让 Agent 帮我创建预设模式」入口。以上只通过样式覆盖原生 `ui-agent-preset` 设置页实现，不修改底座。

确认弹窗参照参考项目的 `ConfirmDialog`：448px 默认宽度、16px 圆角、20px 内边距、灰色说明、右对齐的描边取消按钮与实心确认按钮；不可恢复的操作使用危险色。外观通过 DSH `Modal` / `Button` 的 `data-dsh-modal`、`data-dsh-modal-part` 和 `data-dsh-button` 标记适配，需使用支持这些标记与 `showCloseButton` 的底座。工具箱关闭推荐、卸载及更新，自动化删除及迁移，以及浏览器数据清理均复用原生 Modal 的焦点管理。浏览器登录导入继续使用面板内浮层与既有提醒偏好，采用相同的颜色、圆角和按钮样式。

快捷键页面的真实浏览器检查：在同级 `deepseek-harness` 执行 `node node_modules/vitest/vitest.mjs run --config ../tp-coworkdsh/scripts/tests/shortcut-settings.config.mjs --configLoader native --cache=false`，检查浅深色输入框、键帽字体与尺寸、表格行高及文本搜索；截图在 `artifacts/shortcut-settings/`。

快捷键页按用户提供的 ZCode 截图核对：表格宽 832px，按当前侧栏宽度居中；表头最小高 43px、单绑定行最小高 54px。对照截图输出到 `artifacts/shortcut-settings/reference-layout.png`。

模型设置参照 ZCode 的两栏供应商配置页：`src/model-settings.js` 在原生 footer 插槽中以 Portal 放置导航、详情和统一的添加表单。自定义供应商详情不再显示名称字段和保存／取消；名称、删除位于右上角菜单，删除需确认。文本停止输入 1.2 秒、失焦或 Enter 时通过 settings path ops 自动保存；请求串行、按 revision 写入，失败保留待保存内容并显示重试，密钥仍通过凭据服务存储。启停持久化到 llm-pi-ai 的 `providers.<id>.enabled`；需搭配支持该字段的 Harness，禁用会撤下运行时路由，配置仍可编辑。资产DeepSeek 保持首位和只读详情。窄屏上下排列，截图位于 `artifacts/model-settings`。

内置 `asset-deepseek`（资产DeepSeek）直接展示与其他供应商相同的配置字段，但为只读；隐藏取消、保存、删除及模型增删操作。其他供应商继续使用原有编辑与保存流程。

资产DeepSeek 的只读详情从其实际 `settingsNs` / `settingsPath` 对应的 `namespace.value` 读取 API 地址、协议和模型目录；凭据只展示配置状态，不读取密钥值。该详情独立于原生 ProviderEditor 对设置区名称的识别，适配 `tpcowork-core-model`，不再显示要求编辑 cordis.patch.yml 的兜底提示。测试使用独立设置区的真实 Host 插件验证。

外观设置独立为 `appearance` 分区（顺序 5，位于通用与模型之间），左栏使用 Lucide Palette 图标。原 `settings.general.item` 的 `appearance` 和 `font-size` 项由空组件遮蔽。`src/appearance-settings.js` 通过 `theme.getTheme()` / `theme/change` 订阅主题，继续使用 `setTheme`、`setFontSize`、`setFontFamily` 持久化。页面按参考图显示界面、代码、终端分组卡片；非法输入在失焦时恢复原值。原「聊天文字字号」按 ZCode 改为「界面字号」（`settings.uiFontSize`，12–20px，默认 14px），调整整个应用的文字大小，图标和布局尺寸不变：仍保存为 DSH 的文字字号（`--dsh-content-font-size`，由底座启动脚本在首屏前写到 body），`src/ui-font-size.js` 把已加载样式表中所有固定像素的 `font-size` 改写为 `calc(原值 + var(--dsh-content-font-delta))`，即与 ZCode 的 `--text-ui-*` 一样按与 14px 的差值整体偏移；之后加入的样式表（插件加载、热更新）同样改写，禁用插件时还原。代码与终端（选择器含 code、pre、xterm、terminal 或等宽字体的规则）沿用各自的字号设置，不受界面字号影响；组件内联样式中的字号不在样式表中，不随之变化。界面字号与「界面缩放」相互独立：缩放按比例放大整个窗口，界面字号只改文字。代码字号范围沿用上游。当前无代码高亮主题、行号、自动换行的可配置服务，因此不展示无效控件。浏览器回归位于 `scripts/tests/appearance-settings.spec.mjs`，覆盖迁移、主题切换、代码字号独立持久化、图标及窄屏。


侧栏采用 ZCode 紧凑风格：14px / 400、32px 行高、16px 图标、8px 图文间距与圆角，中性灰选中态。已撤回 nanobot-gui 版的蓝色强调、文字色和会话列表字重/行高覆盖。浏览器截图：`artifacts/sidebar-navigation/sidebar-zcode.png`。

设置侧栏完整 chrome 参照 `tp-cowork/packages/ui/src/SettingsPage.tsx` 的返回区、分组导航和固定 footer：`src/settings-sidebar.js` 复用 `SettingsLauncher` 的账号、语言、主题及登录操作，齿轮在设置场景调用原生关闭动作返回工作区。返回按钮使用右侧 Tooltip，悬停显示浅灰背景；当前分区使用更深的灰色选中态。导航按基础设置、Agent 能力、数据与统计归类，只显示实际已注册分区；底部账号区固定，导航单独滚动，窄屏隐藏 footer 与分组文字。通过 `settings.action` 插槽安装，卸载时移除目标节点及分组样式，恢复原生关闭按钮。浏览器验收包含悬停提示、footer 保留、齿轮返回及窄屏；截图 `artifacts/appearance-settings/settings-sidebar.png`。


底部位置以设置页为基准：保持设置侧栏 268px、账号区左侧 16px／底部 12px。首页展开侧栏的账号区使用同样的基线和宽度，避免切页跳动；收起轨道保留原布局。

设置侧栏各功能项在鼠标悬停时于右侧显示名称提示，与返回工作区使用同样的底色、边框和字号；移出、滚动导航或调整窗口大小时隐藏，点击不会把提示固定在页面上。

供应商详情使用胶囊启停开关，API Key 默认隐藏，眼睛按钮通过显式的 credentials.reveal 请求查看已存密钥：临时 ECDH P-256 密钥交换和 AES-GCM 加密响应，仅在页面内存解密；关闭眼睛、失焦、隐藏页面或离开详情后清除读取值，普通设置读取仍不含密钥。模型列表以边框行显示 ID、上下文容量和视觉标签，标题右侧以「获取可用模型」代替手动添加，复用原生 discoverModels 接口，按当前地址、协议和已保存凭据请求供应商；搜索和勾选后自动保存新增模型，已有模型及其参数保持不变。获取失败或空结果显示重试，不改变原有模型。新建供应商复用同一个 discoverModels 接口，获取并确认模型后保存；不显示手动添加模型按钮。铅笔进入已有模型参数编辑弹窗。

模型行参照 ZCode：ID、上下文容量和视觉标签位于左侧，右侧依次为测试连接、编辑和启停开关。启停写入 `providers.<id>.disabledModels`，保留模型参数并从选择器及直接调用中排除；需要搭配本地 Harness 的 pi-ai 支持。测试连接复用 llm.testModel，通过当前保存的凭据发送一次简短请求，最多 32 输出 token、15 秒超时，不创建会话；界面显示真实成功或失败。编辑弹窗支持上下文窗口、最大输出和视觉能力。

模型连接测试使用与 ZCode 相同的 Lucide Unplug（14px、2px 描边），等待中使用 LoaderCircle。反馈固定在详情视口底部，不挤占模型行；等待中持续显示，成功 3.5 秒、失败 8 秒消失，可手动关闭，供应商／模型身份与错误原因随结果展示。编辑弹窗采用 672px 宽、正文独立滚动和固定页脚，包含智能继承配置、容量、输入类型及推理等级／JSON 参数映射。未支持的独立模型能力和输入类型置灰并说明，不保存假配置。

外观页主题选择复用通用设置语言选择的 Menu、选择器尺寸与交互，浅色／深色／跟随系统在触发器和菜单中均显示对应图标；选择状态以持久化偏好为准。

编辑模型每次打开时默认收起高级设置，移除删除模型按钮；正文和映射输入区隐藏纵向滚动条，保留滚轮／触控板滚动以访问展开后的内容，底部操作始终可见。

测试按钮的悬浮提示固定为「测试模型」，不复用上一次结果。测试反馈挂在模型设置白框内部，以详情列的底部内缩 16px 定位；样式采用状态图标、语义色、阴影与关闭按钮，反馈不占用模型行高度。

预设资产DeepSeek与自定义供应商共用标题、字段、协议选择、模型列表标题和模型摘要组件；标题统一显示图标，未知品牌使用供应商图标，DeepSeek 使用品牌图标。详情间距、只读协议框尺寸、模型行高和标签格式一致，浏览器测试逐项比较切换前后的坐标与尺寸。模型行采用 ZCode 的 14px Lucide 测试／编辑图标和 28×16 小开关，预设供应商维持只读。

模型配置的自动保存也复用白框内底部浮动反馈：保存中持续提示，成功以中性反馈短暂显示，失败显示重试按钮。原有字段下方的保存状态区域移除，不再撑动布局。

底部保存／模型测试反馈的等待、成功、失败状态统一为 48px 高度，图标和关闭／重试按钮尺寸一致。长错误保持单行省略，可悬浮查看完整原因，避免内容或操作按钮撑高反馈。

添加供应商使用与详情页相同的标题、地址、协议、密钥和模型行组件；内部 ID 自动生成 `provider-<UUID>`，用户只编辑名称。获取模型并确认所选后完成保存，密钥仍写入凭据服务。点击左侧任意供应商或标题右侧关闭按钮即可退出未完成的添加表单；未确认模型前不会写入草稿供应商。

聊天模型选择的供应商子菜单在左右展开时都保留透明鼠标通道，离开后有 250ms 缓冲，跨越菜单空隙不会立即关闭。供应商行统一图标、名称、API 标签与勾选列的对齐；浏览器回归覆盖左右方向缓慢移动和在空隙停留。

连接使用菜单参照 ZCode 增加「使用统计」，不要求账号登录；入口直接调用共享设置 shell 的 `openSection("usage")`，主页和设置页内均定位到已安装的真实用量页。入口随 usage 插件注册／卸载更新；未安装时隐藏。头像使用 32px 正圆与 Lucide User，登录／退出使用 LogIn／LogOut，统计入口使用 ChartColumn；图标路径与参考产品一致。统计数据仍由独立的 tpcowork-usage 服务记录与汇总，不显示虚构套餐额度。

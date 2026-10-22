# TP Cowork 外观插件

把本地 `tp-cowork` 的中性灰浅色/深色配色、264px 侧栏、居中工作问候、672px 首页输入区和紧凑圆角控件应用到 DSH。聊天、工作区、设置及工具执行继续使用 DSH 的现有组件与服务。助手身份和通用提示词由独立的 [tpcowork-core](../tpcowork-core/README.md) 维护。

## 维护位置

| 文件 | 用途 |
| --- | --- |
| `index.js` | 宿主启动样式注入 |
| `theme.json` | 配色和布局变量，每项同时提供浅色与深色值 |
| `styles.css` | 本插件组件样式和启动背景 |
| `src/runtime.js` | 主题覆盖、已有品牌插槽注册，以及卸载清理 |
| `src/layout-adapter.js` | 通过上游共享布局 store 的现有动作适配侧栏宽度 |
| `src/task-panel.js` | 当前会话任务投影、右上角任务卡及展开/收起交互 |
| `src/settings-launcher.js`、`src/tpcoworkhub-account.js`、`src/interface-preferences.js` | 侧栏账号、外观菜单与 TP Cowork Hub 桌面账号状态 |
| `src/upstream-css.js`、`src/upstream-styles.js` | 读取 DSH 已构建的 CSS 类名并生成原版组件的覆盖样式 |
| `locale/zh.json`、`locale/en.json` | 插件列表说明和界面文字 |
| `cordis.patch.yml` | 插件组合 |
| `client.js`、`upstream.css`、`upstream-classes.json` | `node build.mjs` 生成的浏览器模块、原组件样式和类名映射，不直接编辑 |

外观通过现有的 `ctx.theme.overrideTokens()`、品牌插槽和插件生成的 CSS 生效。构建器读取 DSH 已构建 Client 模块中的样式和类名，避免从其他目录复制的桌面产物与源码路径生成的类名不一致；规则受 `body[data-tpcowork-ui]` 限制，插件释放后恢复原组件样式，并保留用户选择的浅色/深色偏好。首页问候注册到已有的 `conversation.hero.brand.mark` 插槽，插件样式隐藏原标题与 Preview 徽标；「预览版」显示在左侧栏的 TP Cowork 名称旁，英文显示为「Preview」。禁用后恢复原版首页。

自动化页面的侧栏名称和页标题通过现有插槽覆盖为「自动化」，中文文案维护在 `locale/zh.json` 的 `ui.automation` 中；英文名称沿用上游。页面其余翻译与任务操作使用原组件，禁用插件后恢复上游名称。

通用设置通过 `settings.general.item` 插槽覆盖移除 Session Log 上传选项及说明，禁用插件后恢复原版设置项。

产品组合通过 `cordis.patch.yml` 禁用 `ui-plugin-manager` 与 `ui-settings-plugins` 两个管理界面，隐藏侧栏「插件」和设置中的「内置插件」入口。已安装插件及其 Host 服务继续加载，开发维护仍可使用 DSH 插件 CLI。

侧栏底部通过 `settings.launcher` 插槽显示圆形头像与「连接使用」，已登录时显示账号首字头像和名称，右侧保留独立设置按钮。点击账号入口显示「界面语言」「界面主题」和「连接使用／退出登录」。语言使用全局语言设置，支持系统默认及已注册语言；主题支持系统默认、深色、浅色，并与通用设置同步。菜单支持键盘操作、关闭后焦点返回、长账号名称截断和收起侧栏布局。点击菜单中的「连接使用」使用系统默认浏览器打开 TP Cowork Hub 授权页；浏览器已登录时直接确认账号，未登录时使用网站现有的用户名、密码页面。确认后侧栏显示账号名称，并与技能商店共享登录、重启恢复和退出状态。需要包含 TP Cowork Hub 桥接的桌面壳、已启用的 toolbox 插件，以及支持 `/desktop/authorize` 的网站；网站地址和等待时限由 toolbox 的 `tpcoworkhub` 配置提供，见[工具箱使用说明](../../docs/toolbox/user-guide.md)。等待认证时保留外观选项和独立设置按钮，可从账号菜单取消登录；可在桌面或网站取消，关闭浏览器标签页后可从桌面取消，未取消则等待超时。失败或超时显示重试提示，禁用外观插件会取消尚未提交的登录并恢复 DSH 原版菜单。

输入框顶部沿用 DSH 的 8px 外框留白和 4px 编辑区留白，普通首行内容起点距外框顶部 12px；技能/MCP 选择区没有提示内容时隐藏其空插槽容器，避免额外产生 8px 间距，有加载、提交或错误提示时正常显示。

会话任务区参考 Zcode 的右上角浮层，使用已有 `conversation.input.dock` 的 `todo` 注册项和当前会话的原生任务投影，通过宿主 React portal 挂到所属聊天区域。宽度达到 1280px 默认展开，否则显示当前任务和完成数摘要；支持手动展开/收起、状态图标、完成项删除线、长文字换行和内部滚动。全部完成后保留清单，没有任务时隐藏；切换会话重置展示偏好，禁用插件恢复原生输入框上方的任务面板。规则与验收见[会话任务卡](../../docs/conversation-tasks.md)。

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

身份与独立启停的回归测试位于 core 插件；在同一目录执行 `node node_modules/vitest/vitest.mjs run --config ../plugins/tpcowork-core/vitest.config.ts`。

`icon.png` 来自用户提供的 `tp-cowork/packages/ui/src/assets/tpcowork-logo.png`，侧栏展开时保留纯文字 TP Cowork，收起后的导航图标使用这张品牌图。产品构建先运行 `scripts/desktop-branding.mjs`，由同一资源生成登录欢迎页标志、浏览器图标、Windows 托盘 ICO 和 macOS ICNS，并将桌面中英文菜单、关于窗口、登录页、更新提示及开发版应用名称统一为 TP Cowork。Windows 安装包构建已自动执行此步骤；本地开发在产品目录运行 `npm run dev`，自动准备品牌、构建并启动。`npm run desktop:preview` 将现有桌面产物复制到 `.desktop-build/branded-desktop`，用于查看品牌资源，不修改底座源码。

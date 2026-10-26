# TP Cowork 工具箱

`@tpcowork/dsh-toolbox` 是一个 Host + Client 插件。Host 提供管理能力接口，Client 通过 DSH Remote、slots 和失效事件呈现专家团队、技能、MCP 与 TP Cowork Hub 四类页面。管理操作与执行分别由对应 Host 模块和 experts 持有。

首页通过原生 `conversation.input.dock` 扩展加入[“试试这些任务”](../../docs/home-suggestions.md)，在所属会话输入框下显示三条建议，支持换一批、确认关闭及通用设置重新开启。点击只替换可编辑草稿；“演示文档”绑定 `office-pptx`，沿用原生引用与工具箱能力选择，发送仍由用户确认。推荐图标及其许可随插件一起打包。

在此目录执行：

```sh
npm run typecheck
npm run build
npm test
npm run test:artifact
```

构建使用 `../../deepseek-harness` 已安装的 TypeScript、esbuild、React 和 DSH 声明，不修改该工作区或自动化插件。Host 产物为 `lib/host.js`，浏览器 ModuleLoader 入口为 `lib/client.js`，类型入口为 `lib/types/`。依赖版本与当前 DSH `0.2.1-alpha.2` 对齐。

默认资源初始化按技能隔离失败，MCP、专家团队及技能商店按各自依赖启动。`toolbox/describe` 返回 `initialization` 状态和失败资源标识、安全错误码；工具箱显示具体失败项，可通过「重试初始化」调用 `toolbox/retryInitialization`，普通刷新只重新读取状态。重试合并并发请求，停止时取消并等待初始化；只记录成功安装或明确保留的默认版本，保留用户删除、禁用及修改。安装目录访问错误保留 OS 错误码，不返回原始路径或凭据。

内置技能由 `resources/skills/` 随包交付。已移除 `office-documents`、`xlsx`、`portfolio-analysis`、`corporate-ppt`、`docx`、`pdf`、`writing-plans`、`write-article`、`weekly-report`、`long-goal`、`memory`、`my`、`weather`、`cron` 和 `create-skill`；升级只清理未经用户修改的产品副本，保留用户自建或编辑的同名技能。技能编写统一使用 `skill-creator`（技能创建与优化），不再提供重复的内置入口。

`call` 在“工具箱 → 技能 → call → 设置电话”首次配置。每个用户填写自己的四位办公分机号，软件从旧版个人技能目录下的 `call/内部分机信息表.md` 精确匹配话机 IP；重复或缺失分机不会自动选设备。可读取同目录 `config.json` 中同一主叫的 `caller`、`phone_ip`、`pbx_ip`、`scheme`、`outgoing_prefix` 和登录凭据；仅确认保存后才导入凭据。没有旧配置时，首次填写话机登录账号和密码；匹配不到 IP 时，在“话机与分机表设置”填写话机 HTTP(S) 地址。电话服务器与外线前缀沿用参考实现默认值 `12.100.10.9`、`9`，可在同一页面修改；不会预设用户分机号。安装包不携带个人分机表或密码，新电脑需导入企业提供的本机配置或手动填写。

电话配置保存在当前 DSH profile 的 `call-phone.json`，凭据使用 DSH credentials 的 `DSH_YEALINK_USERNAME`、`DSH_YEALINK_PASSWORD` 引用；前端只收到是否已配置，不回读密码。默认复用系统应用数据目录 `tpcowork/workspace/skills/call`，也可在页面指定旧版目录或通过 `TPCOWORK_CALL_DIRECTORY` 部署。原有 `DSH_YEALINK_*` 环境配置仍兼容；用户保存的本机配置优先。匹配、检查和保存不发起话机请求，配置齐全不代表通话已连通；实际拨号需要办公网络及有效的 HTTP(S)/TLS 连接。

`image-extract` 支持随应用部署图片识别配置。构建时读取本插件目录中被 Git 忽略的 `image-extract.local.json`（`apiUrl`、`model`、`apiKey`），或使用 `TPCOWORK_IMAGE_EXTRACT_API_URL`、`TPCOWORK_IMAGE_EXTRACT_MODEL`、`TPCOWORK_IMAGE_EXTRACT_API_KEY` 覆盖；默认服务为内网 `http://192.168.0.228:1025/v1/chat/completions`、模型为 `qwen-vl`。配置写入随插件打包的 `lib/image-extract.local.json`，启动时将 Key 初始化到 DSH 凭证 `DSH_IMAGE_EXTRACT_API_KEY`，已有凭证及自定义引用优先。运行时仍可通过 `DSH_IMAGE_EXTRACT_URL`、`DSH_IMAGE_EXTRACT_MODEL` 和凭证设置覆盖。Key 只在 Host 读取，不进入技能正文、前端、目录或日志。Windows CI 使用同名 Repository Secret 提供 Key，服务地址和模型使用 Repository Variables；未提供 Key 的安装包仍需配置凭证。

安装者和用户见 [使用指南](../../docs/toolbox/user-guide.md)、[功能对照](../../docs/toolbox/feature-matrix.md) 和 [集成验收](../../docs/toolbox/acceptance.md)。目录摘要与版本按会话保存；读取不同 Session 的技能不会把另一份目录误判为变化。

技能页支持全部/内置/我的技能筛选、手动创建和 AI 创建草稿。「导入技能」菜单可选择 ZIP 技能包或技能文件夹，支持直接导入 SkillHub 下载的 ZIP；本地更新选择技能文件夹。校验后复制 SKILL.md、脚本、模板和其他资源到个人技能目录；取消选择不执行导入。手动创建和 Host 的目录、ZIP、Markdown 导入接口复用同一资源校验和安装器；ZIP 支持文件位于根目录或单个顶层技能目录，校验路径、大小、资源完整性和 CRC，不执行解压后的脚本。预览有效期为 15 分钟，成功安装释放预览；最多保留最近 32 份，过期后重新检查即可。用户技能的“更新”处理同来源本地资源，商店技能在商店详情更新，内置资源按发行升级。技能移除在文件事务完成后主动使 DSH 技能目录缓存失效，后续刷新不依赖文件监听通知到达的先后顺序。

「AI 创建技能」在输入框中插入显示为「技能创建与优化」的技能引用和可编辑提示，调用标识仍为 `skill-creator`。用户确认发送后才执行。

管理功能补齐见 [2026-10-16 核验记录](../../docs/toolbox/review-2026-10-16.md)；当前原生「+」整合、回归结果与界面证据见 [输入框核验记录](../../docs/toolbox/composer-review-2026-10-16.md)。

工具箱四个页面的标题、内容宽度、标签、列表、按钮及表单与自动化页面对齐，窄窗口和深色模式证据见 [外观对齐验收](../../docs/toolbox/appearance-2026-10-16.md)。

技能商店参考 nanobot-gui 的紧凑横向卡片：展示 /技能标识、描述、标签、审核状态和个人技能安装状态，支持按标识、展示名称、描述和标签搜索，以及分页加载。点击卡片进入技能说明与资源详情，可直接下载到「我的技能」；更新已有技能前确认，仅替换同来源且未经修改的安装内容。详情中的 SKILL.md 由 Host 校验大小和摘要后预览，安装仍走统一安装器。

商店顶部不显示登录状态或上传技能入口；账号登录与退出由首页侧栏管理，业务操作失败仍保留反馈。

手动创建技能、新增／编辑 MCP 均使用独立的面包屑编辑页，返回列表时恢复原有焦点和滚动位置。MCP 的表单元素与 nanobot-gui 对齐：新增时切换远程服务、本地程序或导入配置，支持直接填写认证信息、逐项增删参数及环境变量、服务标识自动生成、超时设置、未保存配置测试，以及保存并检查连接。JSON 导入先预览，再对重名服务选择替换、改名或跳过；确认后批量保存。令牌及变量值由 Host 写入 DSH 凭证服务，编辑时只显示字段名，留空保留已保存值。当前原生运行时支持 Streamable HTTP 和 stdio，SSE 选项暂不可用。

安装集成通过现有 DSH profile/bundle 流程应用 `cordis.patch.yml`。`node scripts/desktop-plugin.mjs install toolbox` 增补工具箱，`base` 仍是 core + UI；`all` 包含工具箱。不要直接用 Node import 浏览器入口，它由 DSH ModuleLoader 加载。构建、离线归档、安装和升级步骤见 `../../docs/toolbox/packaging.md`。

Windows 产品安装包统一通过根目录 `npm run build:win` 准备工具箱：复用底座已校验的独立 Python 3.12 x64，按带 hash 的 wheel 锁补充 PyYAML，并准备 Playwright Chromium 归档。Windows 的默认解释器是随包的 `runtime/python/python.exe`；Electron 安装后使用完整解包目录中的实际路径，不要求用户安装 Python。macOS 开发环境继续使用原有 Python launcher。完整打包流程和 GitHub 操作见 [Windows 打包](../../docs/windows-github-actions.md)。

`src/composition.ts` 将技能、统一安装器和 MCP 管理接在同一 Loader entry 下。首次启动安装随包技能目录和三个默认 MCP 引用；之后只增补新默认项或更新未修改的产品资源，保留禁用、移除、同名自定义项和覆盖。配置/版本决定保存在 DSH settings；内置技能副本安装在当前 profile 的 `skills/`，个人技能直接复用旧 GUI 的系统应用数据目录，没有另建执行或安装注册表。聚源和财汇缺凭证时显示 needs_configuration；Playwright 只使用已准备的本地固定 launcher，不在启动时执行 npx 或下载浏览器，也不注册全局 MCP。

技能和专家团队的「详情」在工具箱内打开面包屑页面，与技能编辑器共用页面布局。点击面包屑或「返回列表」回到原清单，保留搜索与技能来源筛选，并恢复列表位置和入口焦点。技能展示正文、资源文件和实际路径；团队展示封面、介绍、任务示例、可展开的报告结构案例、成员职责及协作阶段。任务示例、案例及「使用团队」均只准备独立聊天草稿，保留此前的草稿，由用户确认后发送。

个人目录兼容说明见 [个人技能目录](../../docs/toolbox/personal-skills.md)。Windows 默认读取 `%APPDATA%\tpcowork\workspace\skills`，macOS 默认读取 `~/Library/Application Support/tpcowork/workspace/skills`；用户放入、导入或创建的归「我的技能」，随应用发布的运行副本仍归「内置技能」。目录变化自动刷新，实际文件路径在详情中查看；个人技能详情右侧支持「打开技能目录」。列表不显示文件路径、目录说明或重复的商店入口。

会话消息中的技能统一显示为可点击的 `/技能名`，通过“＋ → 技能”或 `/` 选择均可打开当前技能的 `SKILL.md` 预览。MCP 是工具连接，消息中仅显示连接图标和名称，不作为文件链接打开；连接配置、启停和探测仍在工具箱的“MCP”页面查看。目录加载后，同样识别历史消息中的 `$技能名` 和 MCP 名称；修改本次选择不改变历史消息的展示。

下游入口：

- `./contracts`：技能、MCP、团队、TP Cowork Hub、统一安装器、任务与工作台事件类型，以及 `pinTaskContext`、`taskStatus`。
- `./remote`：已实现的 `toolbox.describe` 与可取消的 `toolboxChanges.watch`；管理端点由各模块贡献独立 namespace。
- `./composition`：单一配置 schema、默认资源初始化及 T5/T6 可选模块挂载函数；实际产物使用共享 ESM chunk，保留统一安装器的类身份。
- `./web-search-step`：可选的 Step 搜索提供方，注册到 DSH `web`，复用原生 `web_search` 工具及引用卡片。每次请求只读取 `apiKeyRef`（默认 `STEP_API_KEY`），默认调用 `https://api.stepfun.com/v1/search`；`endpoint`、`apiKeyRef`、`defaultMaxResults` 可配置。结果只映射网址、标题、摘要，索引时间不冒充发布日期。缺凭证、HTTP 错误、无效结果或取消直接返回原生 Web 错误，不切换服务商；卸载移除注册。
- `src/examples.ts`：参与类型检查的 Host inventory、Client draft、首次提交快照样例。
- `../../docs/toolbox/contracts.md`：模块所有权、DSH 扩展缺口、端点约定与接入流程。

聊天模型与联网搜索是独立配置。DSH 默认搜索使用 DeepSeek 官方 Key，即使主任务和专家都选择 Step。需要 Step 搜索的部署显式加入以下 profile patch；仅安装工具箱不更改搜索选择。Step 搜索按阶跃搜索 API 计费，使用同一凭证不代表搜索免费或一定包含在聊天套餐内，具体以账户权益为准。

```yaml
- id: web
  config:
    searchProvider: step
- insert:
    - id: tpcowork-web-search-step
      name: '@tpcowork/dsh-toolbox/web-search-step'
      config:
        apiKeyRef: STEP_API_KEY
```

接口文档：[Step 网页搜索](https://platform.stepfun.com/docs/zh/api-reference/search/search)。
- `../../docs/toolbox/migration.md`、`migration-manifest.json`：完整迁移映射和资源清点。

`describe.modules` 说明管理服务是否挂载，其中 teams 需团队目录及任务服务同时就绪，不代表技能可用或 MCP 已连接。首次启动在任务服务就绪前保留选择草稿、不请求任务接口，模块变更通知到达后自动恢复读取。缺少模块时显示尚未接入；读取不完整、失败和断线时保留已有内容并阻止目录写操作。更新来自 `toolboxChanges.watch`，ready/reset 时重读，无固定轮询；客户端读取期间积累的跨目录通知合并为完整刷新，模块就绪通知不会被后续技能变化覆盖。技能变更只刷新技能目录及带选择的未提交草稿；启停直接采用 Host 返回的目录，不触发整页重读，目录读取不再发送变更事件。Python 模块检查按解释器及依赖集合共享结果，点击「检查可用性」重新检测；工具、凭证和资源 fingerprint 继续实时核对。

聊天能力通过 `ctx.commandUi.register()` 加入 DSH 原生“＋”菜单的“添加”分组，与文件、目标、计划等原有入口共用菜单；团队、技能和连接器选择复用 DSH 的 `popupSelect` 面板、搜索及键盘操作。从 `/` 建议选择技能后，同步到相同的能力选择与引用，重复选择不生成重复标签；引用删除、撤销和发送后的保留行为与“＋ → 技能”一致。已选能力参考 `tp-cowork`，作为原生编辑器内的轻量引用显示：技能使用紫色魔杖与名称，MCP 使用金色连接图标与名称，团队使用团队图标与名称，不带胶囊背景。点击引用或在引用后按退格即可移除；撤销恢复引用和选择，正文及其他引用保持完整。`conversation.input.selection` 仅呈现加载、提交及校验提示。未选择时不显示能力提示；历史空快照不参与能力校验，也不会拦截普通聊天。团队必需技能不可单独移除。`client-session/prompt-admission` 在原生命令仲裁和附件序列化之后，将完整 `SessionPromptRequest` 交给 `toolboxTasks.submit`；带能力选择的普通聊天按 requestId 保存不可变快照，下次发送前可继续增删技能和 MCP；删除全部标签会提交空快照，撤下此前能力。后续没有能力选择的消息沿用 DSH 原生发送流程，目录版本变化不会把历史空快照判为能力失效。团队任务受理后保留固定快照。团队按钮通过 `uiWorkspace.startSession` 的 `reuseBlank: false` 选项准备独立草稿，在 `onPrepared` 中绑定团队引用与能力：首行是可移除的团队引用，下方是可编辑提示词，个股研究和供应链研究各有对应模板。AI 创建技能也只填入提示。

能力选择目录的汇总版本跟随配置和可用性。重新打开会话、Host 重启或其他目录项变化时，若已选技能的版本与内容指纹、MCP 配置及团队版本均保持一致且可用，自动采用当前目录版本，可保留同一组能力继续发送；历史执行快照保持不变。恢复期间发送会等待能力选择读取完成，避免将已选技能的消息当作普通聊天。已选技能内容或 MCP 配置变化要求重新确认，禁用、移除、连接失败和不完整目录仍阻止提交。MCP 正常连接、释放、工具数及观测时间变化不会使选择过期；管理写操作继续使用完整目录的版本检查。

下游可以调用 Client 服务 `toolboxNavigation.open('teams' | 'skills' | 'mcp' | 'tpcoworkhub')`。T5/T6 的 UI 入口分别位于 `src/ui/tpcoworkhub/index.tsx`、`src/ui/teams/index.tsx`，接线说明见 `../../docs/toolbox/client-handoff.md`。

## Capability presentation and PDF

Built-in skills use localized names, concise descriptions, and local icons across the skill menu, Toolbox cards, and composer references. Search accepts display names, descriptions, and canonical names. Product tool icons are local SVGs; document and browser icons retain their Zcode Apache-2.0 notices. MCP connectors and expert teams use the same colored SVG tiles in cards, detail pages, selection menus, composer chips, and sent mentions. Artwork is keyed by stable catalog IDs (including distinct Juyuan, Caihui, Playwright, stock-research, and supply-chain icons); custom connectors and other teams receive category defaults. Names, selections, and invocation identities are preserved.

The skill menu, Toolbox cards, suggestions, and composer references display 电子表格 (`office-xlsx`), Word 文档 (`office-docx`), 演示文档 (`office-pptx`), and PDF (`office-pdf`) with local Zcode icons and concise localized descriptions. The four document skills appear first. Search accepts friendly names and canonical names; selection, clipboard text and invocation keep canonical skill identities. Assets retain their Apache-2.0 notices.

`office-pdf` bundles the reference project's dependency-free Chinese/English text PDF starter. It creates a new file, paginates, and includes Unicode text extraction metadata. Rich layout uses the existing Office skills and bundled LibreOffice conversion; OCR, form editing, merge and split require an available tool. The new canonical name avoids resurrecting retired `pdf` resources or replacing user-owned copies. It adds no startup downloads.

# TP Cowork 核心插件

拥有 TP Cowork 的产品身份、默认办公助手角色、自我介绍、通用交流规则和内网 DeepSeek 模型。只有 Host 入口；身份入口依赖 DSH 的 `systemPrompt` 服务，模型入口依赖 `llm` 与 `credentials`，可以在 Desktop、Web 或包含这些服务的 profile 中使用。

| 位置 | 职责 |
| --- | --- |
| `persona.md` | 产品定位、办公能力介绍、模型来源说明和通用交流方式 |
| `index.js` | 将产品身份接入 DSH 提示词组装，保留自定义角色与其他插件的贡献 |
| `cordis.patch.yml` | 注册 core 插件并关闭官方 DeepSeek API-Key 来源，不覆盖用户的 system-prompt 或 preset 配置 |
| `src/model.ts` → `model.js` | 独立注册内网模型，复用 DSH 的 pi-ai 适配器与配置解析 |
| `deployment.js`、`build.mjs` | 部署配置校验、一次性导入、构建与首次凭证初始化 |
| `model.patch.yml` | 内网模型配置与新会话的默认选择，不修改其他模型入口 |
| `deployment.local.json` | 随内网插件包分发的部署配置，忽略提交，文件权限为 `0600` |
| `locale/` | 插件管理页的中英文名称与说明 |

界面品牌、主题、布局和首页问候属于 [tpcowork-ui](../tpcowork-ui/README.md)。内置浏览器的选择和调用规则属于 [tpcowork-browser](../tpcowork-browser/README.md)，随其工具可用性生效。Office 工作流、专家角色与记忆规则由对应业务插件或 preset 拥有；core 不接管这些执行服务，也不增加第二套 Agent loop。

## 提示词规则

插件通过 `system-prompt/assemble` 在会话预设解析后移除 `harness:identity` 开场，将空白或已知的 DSH 默认角色替换为 `persona.md`。当前适配 DSH `0.2.1-alpha.2` 的全局默认角色及 Standard、Cordis、PTC 预设。`{{model}}` 由 DSH 按实际模型填入；工具、变量、运行上下文、其他指导和自定义角色的正文及后缀继续由原贡献者维护。

DSH 对声明 `complete: true` 的完整提示词拥有最终决定权，因此 Minimal 预设及用户自定义的完整提示词保持原样。自定义专家角色也保留自己的身份。需要默认 TP Cowork 办公身份时，选择 Standard、Cordis、PTC 或未指定角色的配置。

这里保留一个范围明确的组装适配：只修改原生全局 `personaPrefix` 会被会话 preset 覆盖；通过 bundle 重写现有行的 `config` 又会整体替换工具排序、运行上下文等用户配置。后续产品办公 preset 可复用 core 的角色内容，安装组合由 bundle/profile 负责。升级 DSH 时检查已知默认角色和预设行为；测试直接读取上游预设的 persona 配置。

关闭身份入口后恢复原始助手提示词，模型入口可单独启停；关闭 UI 后 core 的身份和模型保持有效。移除整个 core bundle 时同时移除身份和内网模型，并恢复上游默认配置层。用户保存的模型选择与凭证继续保留。修改 `persona.md` 或 Host 代码后重启应用，使用新会话检查自我介绍，避免旧会话回复影响判断。

## 内网 DeepSeek

默认值对齐 `tp-cowork` 的桌面发行配置：

| 项目 | 默认值 |
| --- | --- |
| 来源 ID / 名称 | `asset-deepseek` / 资产DeepSeek |
| 模型 ID | `deepseek_v4_flash` |
| API 地址 | `http://192.168.0.228:1025/v1` |
| 协议 | OpenAI Chat Completions，请求路径 `/v1/chat/completions` |
| 上下文 / 输出上限 | `128000` / `8192` |
| 推理 | 关闭；不发送 `reasoning_effort` |
| 设置区 / 凭证引用 | `tpcowork-core-model` / `TPCOWORK_DEEPSEEK_API_KEY` |

内网模型独立注册，bundle 默认关闭官方 DeepSeek API-Key 来源 `llm-deepseek`，保留 `llm-pi-ai`、账号模型和已有凭证。用户保存的默认模型与会话模型选择不被改写；原先选择官方来源的用户需切换到“资产DeepSeek”或重新启用该来源。没有保存默认选择的新安装使用内网模型。移除 core bundle 后恢复上游来源配置。

首次准备当前项目的内网发行配置，在工作区根目录执行：

```sh
node plugins/tpcowork-core/build.mjs --import-tpcowork /Users/wyx/project/nanobot-pc/tp-cowork
```

此命令一次性读取参考项目的 `config/provider/desktop-deployment.local.json`，将地址和凭证写入 core 的本地部署文件。安装后的插件只读取自己包内的文件，不访问参考项目。`model.patch.yml` 只包含非秘密模型配置；首次启动将内网凭证写入 DSH 凭证服务，已存在的同名凭证优先，不覆盖原来源的凭证。

调整 `deployment.local.json` 的 `apiBase`、`apiKey`、`providerId`、`providerName`、`modelId`、`contextWindow` 或 `maxTokens` 后，重新运行 `node plugins/tpcowork-core/build.mjs`。构建时 `TPCOWORK_DEEPSEEK_BASE_URL` 与 `TPCOWORK_DEEPSEEK_API_KEY` 环境变量优先于本地文件；地址、模型和容量也可以通过 DSH 模型设置页调整，保存后覆盖 bundle 默认值。凭证的后续更换通过 DSH 凭证设置完成。

模型构建复用当前锁定 DSH 版本的配置、认证和模型发现 helper，并将 helper 打入 `model.js`；运行时只依赖发行版已有的 DSH 与 pi-ai 包。构建需要当前工作区已安装的 DSH 开发依赖。升级 DSH 时重新构建 core 并运行插件测试。

## 安装与迁移

先准备 core 的部署配置。桌面初始化过一次后，完整退出，在工作区根目录运行 `node scripts/desktop-plugin.mjs install`，再启动桌面。默认目标 `base` 安装 core + UI；单独安装核心使用 `node scripts/desktop-plugin.mjs install core`，单独移除使用 `node scripts/desktop-plugin.mjs remove core`。脚本使用 DSH 官方插件事务。

发行时在插件目录运行 `npm pack`，生成 `tpcowork-dsh-core-0.2.0.tgz`。包包含构建后的模型入口、非秘密 bundle 配置与私有部署文件，可随内网发行包安装到 Desktop 或 Web profile；客户端使用部署凭证即可调用内网模型。打包前必须准备实际凭证，或由部署环境提供 `TPCOWORK_DEEPSEEK_API_KEY`；不包含凭证的包仍可安装，但调用模型时会报告缺少凭证。

从 UI `0.1.0` 升级到 `0.2.0` 时，需要同时安装 core 才能继续使用默认 TP Cowork 助手身份。UI 已不包含 `persona.md` 或提示词 hook；原有会话、模型和预设配置无需迁移。Web 可使用 `dsh plugin --profile web add link:/absolute/path/to/plugins/tpcowork-core`。

## 验证

在 `deepseek-harness` 目录运行 `node node_modules/vitest/vitest.mjs run --config ../tp-coworkdsh/plugins/tpcowork-core/vitest.config.ts`，类型检查使用 `node node_modules/typescript/bin/tsc -p ../tp-coworkdsh/plugins/tpcowork-core/tsconfig.json`。测试覆盖提示词快照、真实预设配置、自定义角色、完整提示词、工具排序、运行上下文、部署导入与凭证保护；验证官方 API-Key 来源默认关闭、其他来源设置保留、真实适配器的 HTTP 请求与 SSE 工具调用、连续回复、缺少凭证时不发请求和卸载恢复。测试使用模拟 HTTP 响应，不需要连接内网服务。

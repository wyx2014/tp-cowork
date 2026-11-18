# TP Cowork

基于 DeepSeek Harness 的桌面办公助手。底座由独立 fork 维护，产品能力通过外部插件扩展 DSH 原生会话、任务、权限和凭证功能。

| 插件 | 职责 |
| --- | --- |
| [core](plugins/tpcowork-core/README.md) | 产品身份、助手角色、模型配置 |
| [UI](plugins/tpcowork-ui/README.md) | 品牌、主题、布局、首页 |
| [workbench](plugins/tpcowork-workbench/README.md) | 文件交付与任务收尾 |
| [browser](plugins/tpcowork-browser/README.md) | 内置浏览器与桌面桥接 |
| [toolbox](plugins/tpcowork-toolbox/README.md) | 技能、MCP、团队管理及可选 Step 搜索 |
| [automation](plugins/tpcowork-automation/README.md) | 自动化模板、定时任务和运行记录 |
| [memory](plugins/tpcowork-memory/README.md) | 按工作区保存跨会话记忆，默认关闭 |
| [archives](plugins/tpcowork-archives/README.md) | 设置 › 归档管理：按工作区查看、取消归档和删除已归档会话 |
| [usage](plugins/tpcowork-usage/README.md) | 设置 › 使用统计：按本地会话记录统计 Token、活跃度和模型用量 |
| [computer-use](plugins/tpcowork-computer-use/README.md) | 设置 › 电脑控制：参照 ZCode，让 Agent 按应用授权查看并操作 Windows、macOS 桌面应用（Linux X11 实验） |
| [diagnostics](plugins/tpcowork-diagnostics/README.md) | 脱敏的 Host 与桌面日志文件；设置 › 通用设置 › 诊断信息导出诊断包（参照 DSH Desktop） |
| [experts](plugins/tpcowork-experts/README.md) | 专家协作，复用原生任务与子会话 |

## 本地运行

需要 Node.js 24 或更新版本，并将 `deepseek-harness` 底座仓库放在本仓库的同级目录。在 `tp-coworkdsh` 内执行一条命令即可：

```sh
npm run dev
```

`npm start` 也可启动。`npm run dev` 会根据两个仓库自上次构建以来的 git 改动自动判断：只改了插件就只重建插件，改了底座就连底座一起重建，没有改动就直接复用已有构建启动——日常不需要再区分 `dev:plugins` 和 `dev:rebuild`。首次运行或缺少产物时会自动准备，可能需要联网下载和完整构建。已有桌面程序运行时，先完整退出再启动。

`npm run dev:plugins`、`npm run dev:rebuild` 仍可手动强制重建（分别只重建插件、或完整重建底座和插件），用于绕过自动检测或排查构建问题。两者都不会重新启用已关闭的插件。

默认复用底座的 `apps/desktop/.desktop-build/development/home` 数据目录；`DSH_HOME` 可指定其他目录。初始化复用原生 Desktop 方法，保留已有会话、凭证和个人设置。`npm run dev -- --plan` 可只查看启动步骤。

## Windows 安装包

进入本仓库 **Actions → Build Windows Installer → Run workflow**，使用默认 `standalone` 模式即可构建 Windows x64 独立测试包。构建及安装验证成功后，默认同时上传 Actions Artifacts 并发布 GitHub 预发行版，可下载安装包、SHA-256 和构建记录；取消 `publish_release` 则只上传 Artifacts。

详细设置、构建模式及本地命令见 [Windows 云端打包操作](docs/windows-github-actions.md)。

## Linux 安装包

进入 **Actions → Build Linux Packages → Run workflow**，由 Ubuntu 22.04 x64 Runner 构建并校验 AppImage 和 DEB，生成 SHA-256 和构建来源记录。默认同时上传 Actions Artifacts 并发布 GitHub 预发行版；取消 `publish_release` 则只上传 Artifacts。操作、参数和麒麟实机验证范围见 [Linux 云端打包](docs/kylin-linux-github-actions.md)。

麒麟上排查启动问题时，选择 `variant=basic` 构建 **TP Cowork Basic**：排除全部 TP Cowork 产品插件，保留底座默认界面，使用独立的应用数据目录，并验证 AppImage 和 DEB 的真实图形窗口启动。基础版发布在 `linux-basic-packages-<version>`，附带启动诊断脚本。

Linux 默认选择 `variant=standard` 构建 **TP Cowork Linux**：包含浏览器在内的 11 个产品插件，仅排除 Computer Use。浏览器自动化、界面缩放与诊断导出随包交付，工具箱保留自己的 Chromium 和离线 Python 依赖。该版本使用独立数据目录，发布在 `linux-standard-packages-<version>`，并验证真实窗口、浏览器启用状态、产品界面、记忆、归档、统计和工具箱页面；`full` 仍可构建全部 12 个插件。

安装包、登录欢迎页、系统菜单、关于窗口和应用图标统一使用 TP Cowork 品牌；Windows 构建和本地启动自动准备品牌资源，品牌图片使用 `plugins/tpcowork-ui/icon.png`。

Windows 顶栏“应用”菜单不显示“检查更新”和“管理 dsh 命令”。

## 源码目录

两个仓库放在同一个父目录下：

```text
项目父目录/
  tp-cowork/          本仓库，本地目录名可以是 tp-coworkdsh
  deepseek-harness/   https://github.com/wyx2014/deepseek-harness
```

产品代码推送到本仓库 `main`；底座改动推送到 fork 的 `feat/tpcowork-workbench-ui`。Actions 同时检出两个仓库，安装包内记录各自的 commit。

`npm run dev:rebuild` 统一完成底座和插件构建。单独管理已初始化桌面的插件可使用 `node scripts/desktop-plugin.mjs install all`。检查源码和依赖链接使用 `node scripts/check-worktree.mjs`。

模型配置默认由 SkillHub 登录账号下发。登录或重启恢复账号后，Host 请求 `/tpcoworkapi/client-config`，加载该账号的 New API 网关和模型列表；模型请求直接发往 New API。退出、账号切换或配置失效后移除托管模型，不回退到共享 DeepSeek 密钥。模型密钥仅保留在 Host 内存，不写入普通设置或传给界面；登录凭证仍由 DSH 凭证服务管理。

应用启动时先验证 SkillHub 登录。未登录、登录过期或无法恢复账号时显示全屏登录入口，隐藏工作台和历史会话，并禁止背景交互；没有跳过入口。登录成功后进入工作台，退出后回到登录页。Host 同时要求有效的个人网关授权，手动添加的模型来源也不能绕过登录调用。

TP CoWork 由应用内页面统一管理登录，启动、账号退出和过期均不再打开底座的欢迎窗口，也不提供「添加 API Key」页面。用户完成账号登录后，沿用账号下发的个人网关和模型配置，无需手动填写密钥。

桌面登录只保留到登录当天结束，按本机时区计算下一个午夜；当天重启可恢复，第二天打开必须重新登录，不按登录后 24 小时计算，也不自动续期。Host 在启动、读取账号、访问内部 API 和模型调用时检查期限，跨夜运行时每分钟检查并更新登录页。没有每日到期时间的旧版登录记录升级后要求重新登录一次；网站本身的登录期限不变。

登录限制沿用上述 SkillHub 认证与授权边界，参考 [OWASP ASVS 5.0.0](https://asvs.owasp.org/) 及 [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。回归覆盖加载、退出、过期、取消、失败重试、Esc 和背景弹层；原生浏览器授权已验证 wangyb 登录恢复原有模型选择。SkillHub 原有密码存储与服务端令牌撤销仍是独立待改造项。

服务端需配置 New API 地址、受限管理 PAT 和固定用户绑定，见 SkillHub 的 `.env.production.example`。默认构建忽略旧的 DeepSeek 部署文件和构建密钥；独立静态部署可显式设置 `TPCOWORK_MODEL_SOURCE=static`。本地凭证、会话、缓存及编译产物不提交到 GitHub。

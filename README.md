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

进入本仓库 **Actions → Build Windows Installer → Run workflow**，使用默认 `standalone` 模式即可构建 Windows x64 独立测试包。构建成功后在该次运行的 **Artifacts** 下载安装包、校验文件和构建记录。

详细设置、构建模式及本地命令见 [Windows 云端打包操作](docs/windows-github-actions.md)。

麒麟 Linux x86_64 安装包使用 **Actions → Build Kylin Linux Packages**，由 Ubuntu 22.04 托管 Runner 构建 AppImage 和 DEB。操作与实机验证范围见 [麒麟 Linux 打包](docs/kylin-linux-github-actions.md)。

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

运行所需模型和 MCP 凭证由应用内的 DSH 凭证服务管理；本地凭证、会话、缓存及编译产物不提交到 GitHub。

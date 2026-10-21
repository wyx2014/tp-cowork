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

## Windows 安装包

进入本仓库 **Actions → Build Windows Installer → Run workflow**，使用默认 `standalone` 模式即可构建 Windows x64 独立测试包。构建成功后在该次运行的 **Artifacts** 下载安装包、校验文件和构建记录。

详细设置、构建模式及本地命令见 [Windows 云端打包操作](docs/windows-github-actions.md)。

安装包、登录欢迎页、系统菜单、关于窗口和应用图标统一使用 TP Cowork 品牌；Windows 构建自动准备品牌资源，品牌图片使用 `plugins/tpcowork-ui/icon.png`。

## 源码目录

两个仓库放在同一个父目录下：

```text
项目父目录/
  tp-cowork/          本仓库，本地目录名可以是 tp-coworkdsh
  deepseek-harness/   https://github.com/wyx2014/deepseek-harness
```

产品代码推送到本仓库 `main`；底座改动推送到 fork 的 `feat/tpcowork-workbench-ui`。Actions 同时检出两个仓库，安装包内记录各自的 commit。

先构建底座，再按各插件 README 构建插件。本地桌面初始化 profile 后，可运行 `node scripts/desktop-plugin.mjs install all` 安装开发插件。检查源码和依赖链接使用 `node scripts/check-worktree.mjs`。

运行所需模型和 MCP 凭证由应用内的 DSH 凭证服务管理；本地凭证、会话、缓存及编译产物不提交到 GitHub。

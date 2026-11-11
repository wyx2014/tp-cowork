# Windows GitHub Actions 打包

产品仓库：[wyx2014/tp-cowork](https://github.com/wyx2014/tp-cowork)。底座 fork：[wyx2014/deepseek-harness](https://github.com/wyx2014/deepseek-harness)。两个仓库分别提交，并放在同一个父目录下。

```text
项目父目录/
  tp-cowork/                 产品仓库，本地也可以叫 tp-coworkdsh
    plugins/
    scripts/
    desktop-product.json
    .github/workflows/
  deepseek-harness/          独立底座 fork
```

## 在 GitHub 打包

1. 将底座改动推送到 `wyx2014/deepseek-harness` 的 `feat/tpcowork-workbench-ui` 分支，将产品代码推送到 `wyx2014/tp-cowork` 的 `main` 分支。
2. 打开产品仓库的 **Actions → Build Windows Installer → Run workflow**。
3. `harness_repository` 保持 `wyx2014/deepseek-harness`；`harness_ref` 填已推送的分支、标签或完整 commit。需要复现某个版本时填写完整 commit。
4. `build_version` 保持 `auto`；`deployment` 保持 `standalone`，生成独立测试包，无需配置更新策略服务、证书或模型 API Key。
5. `publish_release` 默认勾选，构建和安装验证成功后发布 `windows-packages-<version>` 预发行版。只需要 Actions 下载时取消勾选；手动填写 `build_version` 时使用尚未发布的新版本。
6. 成功后从仓库 **Releases** 或运行页面的 **Artifacts → TPCowork-windows-x64-…** 下载 EXE、SHA-256 文件和 `build-info.json`。后者记录版本、产品和底座两个实际 commit，以及打包模式。

工作流在 Windows Server 2022 x64 上安装 Node.js 24、Python 3.13 和锁定的 pnpm，依次构建底座、`desktop-product.json` 中声明的产品插件及离线依赖，生成 NSIS 安装包。最终应用通过底座运行时检查后，完整复制到独立、带空格的临时目录，执行产品 bundle、浏览器归档和离线 Python 导入检查，全部通过才上传安装包。临时目录在验证结束后清理；这样同时验证应用可迁移，并避开深层 CI 构建目录触发的 Python 原生 DLL 路径长度限制。上传及发布前再次核验 EXE 的 SHA-256；安装、启动或校验和检查失败会阻止预发行版发布。Actions 安装包保留 30 天，失败诊断日志保留 14 天。

品牌准备阶段在本地将产品 PNG 生成包含 16–256 像素图层的 `icon-windows.ico`，Windows 应用及安装器直接使用该 ICO。PNG 仍用于应用内展示；Windows 打包无需下载 `icons-bundle.tar.gz` 做图标转换。

预发行版使用流水线自带的 `GITHUB_TOKEN` 和 `contents: write` 权限，不需要额外的个人令牌。发布说明包含版本、打包模式及两个仓库的实际 commit；预发行版不会设为 Latest。Windows 与 Linux 使用不同的标签前缀，可以分别下载各平台的安装包。

底座 fork 为公开仓库时，默认 GitHub Token 即可拉取。改为私有仓库后，在产品仓库的 **Settings → Secrets and variables → Actions** 设置 `HARNESS_READ_TOKEN`，授予底座仓库只读内容权限。

上传前实际运行 EXE，阻断验收包括首次安装、同目录覆盖升级、离线 Python 和插件完整性；每次安装后启动真实桌面程序，要求 TP Cowork 外观已激活、核心客户端插件齐全、控制台零错误。测试同时登记旧 nanobot 版安装信息，确认 DSH 版不会调用其卸载程序或覆盖其登记。测试应用在检查结束后卸载；真实安装检查仅用于一次性 GitHub Actions runner。

应用首次启动出现新手引导时，验收通过「跳过设置」及确认按钮进入工作区，再检查设置中的默认值，并通过「返回工作区」退出设置；覆盖升级复用已保存的引导状态。相同交互的中英文浏览器回归可在项目根目录运行 `node ../deepseek-harness/node_modules/vitest/vitest.mjs run --config scripts/tests/installed-ui.config.mjs --cache=false`。

打开设置前，验收等待首次 `/api/session/list` 响应完成，并让浏览器提交启动时的引导状态。已有配置会立即跳过新手引导；如果此时会话列表尚未返回，初始化引导步骤会关闭过早打开的设置窗口，导致覆盖升级验收等待「开发者模式」超时。回归测试延迟首个列表响应，确认验收等待响应后只点击一次设置，并继续检查真实控件。

设置功能是阻断验收项：要求记忆、归档、使用统计的客户端模块和设置入口齐全；实际开启记忆并读取空列表后恢复关闭，打开归档并等待列表加载，打开使用统计并等待累计摘要与当前区间数据返回。仅有模块清单、页面无报错或仍显示加载状态均不能算通过。每次安装的证据目录额外保留 `settings-general.png`、`settings-memory.png`、`settings-archives.png`、`settings-usage.png`，报告记录对应 API 的响应状态。浏览器回归使用完整的八个产品客户端插件，并保持配置热更新开启。

旧版配置升级使用单独的用户目录，预先写入没有记忆、归档、使用统计的旧插件清单，再启动实际安装的应用。验收要求自动补齐这三个功能，并保留原 profile 元数据和用户数据标记。普通的同目录覆盖升级复用已完整初始化的配置，两者分别检查。

Windows 安装包与 nanobot-gui 相同，使用 electron-builder 原生的引导式安装程序：用户可选择仅为自己或为所有用户安装，并可更改安装目录；默认目录为 `%LOCALAPPDATA%\Programs\TP Cowork`，为所有用户安装时向 Windows 申请管理员权限。流水线在这个默认目录使用 `/S /D=<目录>` 静默安装后验收，并实际执行同目录覆盖升级；配置与会话测试数据使用独立临时目录。验收拒绝覆盖预先存在的安装目录，并在结束后卸载、清理本轮安装。旧临时安装目录会让 lxml 的深层 XSLT 文件达到 265 字符，触发原生卸载器的路径长度限制；每次首次安装会记录最长文件路径，方便排查。

每次安装或卸载最多等待 5 分钟；等待期间每 30 秒记录安装器、子进程及安装目录中残留进程的 CPU 时间和读写字节数，同时记录窗口标题和弹窗文本，超时仍阻止发布。复用已有 EXE 的验证任务最多运行 20 分钟，包含首次安装、覆盖升级及旧版配置升级。

仅诊断旧版卸载失败时，可在验证任务启用 `native_upgrade_diagnostics`：首次安装和启动检查后，通过原生卸载界面捕获详细错误。这种诊断运行始终停止在验收之前，不上传已验证安装包。

浏览器桥接、专家工具箱入口及个股团队按钮放在单独的非阻断诊断步骤，使用产品 UI 的 `data-testid` 定位，不依赖语言或显示名称。诊断失败保留报告和截图，但不阻止已通过基础验收的安装包上传。两种检查的 `report.json`、截图及启动记录均保存在 `installed-ui-…` Artifact。

**UI 验证失败时先复用已有包：** 下载最后失败运行的 `installed-ui-<run_id>`，一起查看 `report.json` 的具体 URL、错误和截图后再修改。将已有构建运行 ID 和 Artifact 名称填入 **Verify Windows installer**，即可使用最新验证脚本复查原 EXE，无需重新编译；仅在诊断干净机器行为时勾选 `clean_machine`。旧包若缺少新增的测试标识，功能诊断会失败，基础验收仍独立执行。应用代码修复需要生成新包；只改验证脚本时不运行完整构建。

若 EXE 已生成但阻断验收失败，工作流保留 `unverified-installer-<run_id>` 7 天供复查。正式测试包以通过基础安装及启动验收后上传的 `TPCowork-windows-x64-…` 为准。每次推送前在本地运行 `npm run build:win -- --plan` 和 `npm run test:packaging`，Windows runner 用于真实 EXE 构建和安装行为。

产品品牌准备会修改同级 DSH 工作区。每次全新构建前先检查并备份未提交的开发改动，再在 DSH 目录执行 `git checkout -- .` 清除上次品牌输出；需要的开发改动可从备份恢复。流水线通过全新 checkout 构建。底座打包修复单独提交，仅包含打包相关文件。

DSH 版的安装标识是 `com.tparuyi.tpcowork.dsh`，与旧 nanobot 版 `com.tparuyi.app` 独立，两者可并存。安装 DSH 版时选择默认目录或其他空目录；旧版会话与配置不自动迁移。

## 打包模式

| deployment | 行为 | 必填配置 |
| --- | --- | --- |
| `standalone` | 独立未签名测试包，不接强制更新或自动更新服务 | 无 |
| `test` | 未签名包，连接测试策略服务 | `policy_origin`、`login_origins` |
| `production` | 未签名包，连接生产策略服务 | `policy_origin` |

`test` 和 `production` 保留底座原有策略校验。地址必须是 HTTPS origin，不带路径；测试登录 origin 多个时用逗号分隔，也可设为仓库 Variables `PACKAGE_POLICY_ORIGIN`、`PACKAGE_LOGIN_ORIGINS`。这三种模式均不是签名正式发布流程。

模型服务地址可用 Variable `TPCOWORK_DEEPSEEK_BASE_URL` 配置。设置仓库 Secret `TPCOWORK_DEEPSEEK_API_KEY` 后，该密钥会随安装包一起打包，应用首次启动即可直接调用默认的 DeepSeek 服务，无需用户手动添加凭证——仅建议用于密钥可随包分发的内网部署，因为任何拿到该 EXE 的人都能还原出这个密钥。不设置该 Secret 时，安装包保持不含密钥，用户需在应用内自行添加凭证。本地打包不受影响：`plugins/tpcowork-core/deployment.local.json`（已在 `.gitignore` 中）仍只用于开发机，`scripts/stage-core-bundle.mjs` 打包时永远重新生成这个文件，不会读取或泄露该本地文件的内容。

底座的编译与打包结果会按底座 commit 缓存。只改 TP Cowork 插件时，后续打包会恢复上次的底座构建（日志显示 `desktop build cache: restored`），只重新构建插件、安装包和冒烟测试。底座 commit、品牌文件（`desktop-product.json`、图标、`scripts/desktop-branding.mjs`）、Node 版本或公开构建配置任一变化，底座都会自动完整重建（日志显示 `no build for ...; building`）。本地打包设置 `DSH_DESKTOP_BUILD_CACHE_DIR` 环境变量后，也能用上同一缓存。

## 本地开发与构建

```sh
git clone https://github.com/wyx2014/deepseek-harness.git
git -C deepseek-harness switch feat/tpcowork-workbench-ui
git clone https://github.com/wyx2014/tp-cowork.git
cd tp-cowork
npm ci
node node_modules/pnpm/bin/pnpm.cjs --dir ../deepseek-harness install --frozen-lockfile
npm run test:packaging
npm run build:win
```

实际打包需要 Windows x64、Visual Studio C++ 构建工具和 Windows SDK。macOS 可以运行 `npm run build:win -- --plan` 查看装配步骤，并通过 GitHub Actions 执行 Windows 构建。默认本地模式也是 `standalone`；指定 `PACKAGE_DEPLOYMENT=test` 或 `production` 后，入口使用底座 `.env.windows`，缺少时由所提供的环境配置临时生成并在结束后清理。

产品插件由 `desktop-product.json` 声明，通过 npm tarball 安装到发行包，首次创建 profile 时启用。安装包运行不依赖源码目录或开发机的 `link:` 路径。工具箱复用底座已校验的独立 Python，并通过哈希锁定的 wheel 补齐 YAML；Playwright Chromium 随包归档。

`node scripts/check-worktree.mjs` 检查两个仓库的位置和源码/依赖链接。开发 profile 的安装仍通过 `node scripts/desktop-plugin.mjs install all`，发布装配则使用 `npm run build:win`。

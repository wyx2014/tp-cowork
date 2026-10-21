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
5. 成功后在运行页面的 **Artifacts** 下载 `TPCowork-windows-x64-…`，解压得到 EXE、SHA-256 文件和 `build-info.json`。后者记录产品、底座两个实际 commit 和打包模式。

工作流在 Windows Server 2022 x64 上安装 Node.js 24、Python 3.13 和锁定的 pnpm，依次构建底座、七个产品插件及离线依赖，生成 NSIS 安装包。最终应用通过底座运行时检查后，完整复制到独立、带空格的临时目录，执行产品 bundle、浏览器归档和离线 Python 导入检查，全部通过才上传安装包。临时目录在验证结束后清理；这样同时验证应用可迁移，并避开深层 CI 构建目录触发的 Python 原生 DLL 路径长度限制。安装包保留 30 天，失败诊断日志保留 14 天。工作流只上传 Actions Artifact，不自动创建 GitHub Release。

底座 fork 为公开仓库时，默认 GitHub Token 即可拉取。改为私有仓库后，在产品仓库的 **Settings → Secrets and variables → Actions** 设置 `HARNESS_READ_TOKEN`，授予底座仓库只读内容权限。

上传前实际运行 EXE，阻断验收包括首次安装、同目录覆盖升级、离线 Python 和插件完整性；每次安装后启动真实桌面程序，要求 TP Cowork 外观已激活、核心客户端插件齐全、控制台零错误。测试同时登记旧 nanobot 版安装信息，确认 DSH 版不会调用其卸载程序或覆盖其登记。测试应用在检查结束后卸载；真实安装检查仅用于一次性 GitHub Actions runner。

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

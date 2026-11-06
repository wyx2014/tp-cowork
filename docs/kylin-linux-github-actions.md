# Linux GitHub Actions 打包

沿用 `nanobot-gui` 的 Linux 流水线：GitHub 托管的 **Ubuntu 22.04 x64** 原生构建，校验 **AppImage 和 DEB（amd64）** 的内置运行时，上传产物及校验文件，并支持发布 GitHub 预发行版。目前仅提供 `standalone` 未签名独立测试包；麒麟桌面系统的 x86_64 安装和 UI 兼容性仍需实机验证。

## 运行流水线

1. 打开产品仓库 **Actions → Build Linux Packages → Run workflow**。工作流文件保持为 `.github/workflows/kylin-linux.yml`。
2. `harness_repository` 默认 `wyx2014/deepseek-harness`，`harness_ref` 默认 `feat/tpcowork-workbench-ui`；复现构建时填写含 Linux 支持的完整 commit。
3. `build_version` 保持 `auto`，按日期、运行编号和重试次数生成版本。
   `variant` 默认 `standard`（保留其余 10 个产品插件，排除浏览器和 Computer Use）；也可选 `full`（全部 12 个产品插件）或 `basic`（仅底座默认界面）。
4. `publish_release` 默认勾选，成功后会发布 `linux-standard-packages-<version>`（standard）、`linux-basic-packages-<version>`（basic）或 `linux-packages-<version>`（full）预发行版。只需要 Actions 下载时取消勾选。手动填写 `build_version` 时使用尚未发布的新版本。
5. 成功后从 **Artifacts → TPCowork-standard-<version>-linux-x64**（standard）或仓库 **Releases** 下载 `.AppImage`、`.deb`、各自的 `.sha256` 和 `build-info.json`。Artifacts 保留 30 天，打包日志保留 14 天；失败时另外保留未验证的安装包供排查，保留 7 天。

工作流使用 Node.js 24、锁定的 pnpm 和原生编译工具，构建底座、所选产品插件、Linux Chromium 和独立 Python 3.12；工具箱复用底座已验证的解释器，再安装经 SHA-256 锁定的 PyYAML wheel。运行环境不依赖目标机器预装 Node.js 或 Python。依赖、运行时下载及底座编译结果均有缓存；底座会核对源码、工具链、平台和公开构建参数，不匹配时重新编译。

上传前先执行底座完整运行时检查，再分别解压 AppImage 和 DEB，从各自的应用目录运行 Electron，验证产品插件可解析、浏览器归档校验和一致、离线 Python 可以导入文档处理依赖。测试临时目录带空格，并在结束后删除。只收集本次构建的两种安装包，并重新校验 SHA-256；缺失、重复或检查失败都会阻止正式产物上传及预发行版发布。

模型配置沿用 Windows 流水线的仓库 Variables 和 Secrets。不配置模型密钥也可以打包，用户安装后在应用内配置。底座仓库改为私有时，需要只读的 `HARNESS_READ_TOKEN`。预发行版使用流水线自带的 `GITHUB_TOKEN` 和 `contents: write` 权限，不需要额外的个人令牌；版本及两个仓库的精确 commit 会写入运行摘要和发布说明。

已配置 GitHub CLI 登录时，也可只构建、不发布：

```sh
gh workflow run kylin-linux.yml --ref main \
  -f harness_repository=wyx2014/deepseek-harness \
  -f harness_ref=feat/tpcowork-workbench-ui \
  -f build_version=auto -F publish_release=false
```

## 麒麟基础试用版

用户已在银河麒麟桌面 V10 SP1、x86_64、glibc 2.31 上确认基础版可以使用。这一实机结果仅对应基础版；恢复产品插件的版本仍需分别试装。

选择 `variant=basic` 后，应用名为 **TP Cowork Basic**，DEB 包名与命令为 `tpcowork-basic`，发布标签为 `linux-basic-packages-<version>`。它不打包 TP Cowork 的外观、浏览器、工具箱、自动化、记忆、归档、统计、诊断、Computer Use 或专家插件，也不构建它们的原生适配器、Chromium 和额外 Python 依赖；聊天、模型设置和桌面运行时使用底座默认实现。基础版默认将 Harness 数据放在自己的应用数据目录，首次启动需要自行配置模型；显式设置 `DSH_HOME` 时遵循该路径。

基础版继续生成 AppImage 和 DEB，并分别从解压后的应用目录启动真实图形窗口，要求加载完成、无渲染错误、无产品客户端模块且 Chromium 沙箱开启。截图和报告保存在 `linux-basic-startup-<run_id>` Artifact，`build-info.json` 记录 `variant=basic`、空产品插件列表和 GUI 检查结果。这些检查在 Ubuntu 22.04 执行，麒麟 V10 SP1 仍由目标机器试装确认。

建议先安装名称以 `tpcowork-basic-` 开头的 DEB。若点击后仍打不开，从同一 Release 下载 `diagnose-linux-basic.sh`，在图形桌面的终端运行：

```sh
bash diagnose-linux-basic.sh
```

脚本记录架构、麒麟版本、glibc、缺失的动态库、`chrome-sandbox` 权限及 Electron 启动输出，并打印日志位置。不要用 `sudo` 启动桌面应用。怀疑显卡驱动时可运行 `bash diagnose-linux-basic.sh --software-rendering`，以软件渲染和 X11 方式再试；该选项保留 Chromium 沙箱。AppImage 解压后可传入 `--executable "$PWD/squashfs-root/tpcowork-basic"`，无需 FUSE 挂载。

## 在麒麟机器验证

### 恢复插件的 Linux 标准版

选择 `variant=standard`，应用名为 **TP Cowork Linux**，DEB 包名和命令为 `tpcowork-linux`，产品配置为 `desktop-product.linux.json`。保留 core、UI、workbench、toolbox、automation、memory、archives、usage、diagnostics 和 experts 共 10 个产品插件；不构建或打包 `@tpcowork/dsh-browser`、`@tpcowork/dsh-computer-use` 或浏览器自动化原生实现。工具箱自身的 Chromium、TP Cowork Hub 适配器和离线 Python 仍随工具箱交付。

界面缩放和诊断导出此前共用浏览器的桌面通信入口；标准版在该兼容入口下只安装独立的通用工具实现，不接受浏览器或客体视图操作。`utilities.json` 记录编译输入，构建及安装包检查均禁止引入浏览器、Computer Use 源码或额外浏览器资源；真实 GUI 还验证缩放可用、浏览器关闭及诊断导出的取消流程。

标准版使用自己的应用数据目录；显式 `DSH_HOME` 仍优先。两种安装包均验证实际产品包清单和运行时解析，随后在开启 Chromium 沙箱的真实图形窗口内完成首次启动，并检查产品界面、记忆、归档、统计和工具箱页面。截图与报告位于 `linux-standard-startup-<run_id>` Artifact。发布附带 `diagnose-linux.sh`，默认启动 `/opt/TP Cowork Linux/tpcowork-linux`。

### 验证范围

当前 Runner 是 Ubuntu，新构建的标准版仍需在麒麟实机验证安装、图形界面和系统库兼容性。`build-info.json` 的 `kylinMachineVerified` 固定为 `false`，避免把构建成功当成麒麟实机验收。此流程仅构建 x86_64，ARM64、龙芯和申威等架构需要对应的运行环境和验证。

先确认机器架构及系统版本：

```sh
uname -m
cat /etc/os-release
```

在安装包所在目录校验文件，再选择一种方式安装或运行：

```sh
sha256sum -c tpcowork-实际文件名.deb.sha256
sudo apt install ./tpcowork-实际文件名.deb
```

或者：

```sh
sha256sum -c tpcowork-实际文件名.AppImage.sha256
chmod +x ./tpcowork-实际文件名.AppImage
./tpcowork-实际文件名.AppImage
```

AppImage 运行依赖系统 FUSE 支持；需要时可先用 `--appimage-extract` 解压，再运行 `squashfs-root/AppRun`。实机验收至少检查应用启动、登录、浏览器打开、工具箱文档处理和退出重启。

## 本地 Linux 构建

产品和底座应为同级独立 Git 仓库。安装工作流中列出的系统依赖后，在产品目录运行：

```sh
npm ci
npm run build:linux -- --plan
npm run test:packaging
npm run build:linux
```

完整构建会准备品牌资源并修改同级底座工作区，建议使用独立 checkout；先保存开发改动。macOS 和 Windows 可查看 `--plan`，实际构建通过 GitHub Linux Runner 执行。

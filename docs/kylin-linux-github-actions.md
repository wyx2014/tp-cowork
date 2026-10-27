# 麒麟 Linux GitHub Actions 打包

沿用 `nanobot-gui` 的 Linux 规格：GitHub 托管的 **Ubuntu 22.04 x64** 构建，输出 **AppImage 和 DEB（amd64）**，目标为麒麟桌面系统的 x86_64 机器。目前仅提供 `standalone` 未签名独立测试包。

## 运行流水线

1. 打开产品仓库 **Actions → Build Kylin Linux Packages → Run workflow**。
2. `harness_repository` 默认 `wyx2014/deepseek-harness`，`harness_ref` 默认 `feat/tpcowork-workbench-ui`；复现构建时填写含 Linux 支持的完整 commit。
3. `build_version` 保持 `auto`，按日期、运行编号和重试次数生成版本。
4. 成功后下载 **Artifacts → TPCowork-kylin-linux-x64-…**，其中包含 `.AppImage`、`.deb`、各自的 `.sha256` 和 `build-info.json`。产物保留 30 天，打包日志保留 14 天。

工作流使用 Node.js 24、锁定的 pnpm 和原生编译工具。构建底座、七个产品插件、Linux Chromium 和独立 Python 3.12；工具箱复用底座已验证的解释器，再安装经 SHA-256 锁定的 PyYAML wheel。运行环境不依赖目标机器预装 Node.js 或 Python。

上传前先执行底座完整运行时检查，再分别解压 AppImage 和 DEB，从各自的应用目录运行 Electron，验证产品插件可解析、浏览器归档校验和一致、离线 Python 可以导入文档处理依赖。测试临时目录带空格，并在结束后删除。只收集本次构建的两种安装包；缺失、重复或检查失败都会阻止上传。工作流只上传 Actions Artifact。

模型配置沿用 Windows 流水线的仓库 Variables 和 Secrets。不配置模型密钥也可以打包，用户安装后在应用内配置。底座仓库改为私有时，需要只读的 `HARNESS_READ_TOKEN`。

## 在麒麟机器验证

当前 Runner 是 Ubuntu，尚未验证特定麒麟版本的安装、图形界面和系统库兼容性。`build-info.json` 的 `kylinMachineVerified` 固定为 `false`，避免把构建成功当成麒麟实机验收。此流程仅构建 x86_64，ARM64、龙芯和申威等架构需要对应的运行环境和验证。

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

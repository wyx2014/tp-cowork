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

上传前还会在临时目录实际运行 EXE，验证首次安装、同目录覆盖升级及安装后的插件和 Python，再卸载测试应用。独立的 **Verify Windows installer** 工作流可按构建运行 ID 和 Artifact 名称检查已有安装包，无需重新编译。真实安装检查仅用于一次性 GitHub Actions runner。

## 打包模式

| deployment | 行为 | 必填配置 |
| --- | --- | --- |
| `standalone` | 独立未签名测试包，不接强制更新或自动更新服务 | 无 |
| `test` | 未签名包，连接测试策略服务 | `policy_origin`、`login_origins` |
| `production` | 未签名包，连接生产策略服务 | `policy_origin` |

`test` 和 `production` 保留底座原有策略校验。地址必须是 HTTPS origin，不带路径；测试登录 origin 多个时用逗号分隔，也可设为仓库 Variables `PACKAGE_POLICY_ORIGIN`、`PACKAGE_LOGIN_ORIGINS`。这三种模式均不是签名正式发布流程。

模型服务地址可用 Variable `TPCOWORK_DEEPSEEK_BASE_URL` 配置；用户在应用内设置自己的凭证，开发机 API Key 不进入仓库和安装包。

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

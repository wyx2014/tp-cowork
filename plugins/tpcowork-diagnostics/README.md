# DSH 诊断信息

参照 DSH Desktop 的桌面端文件日志与「导出诊断信息…」（`dsh-desktop/dsh-plugin-desktop` 的 `log-files.ts`、`file-exporter.ts`、`mask-secrets.ts`、`diagnostic-export*.ts`，设计见 `.agents/notes/implemented/architecture/2026-08-16-desktop-logging.zh.md`）。用于排查应用崩溃、卡住或无法启动；对话本身的问题仍使用会话菜单的「下载 Session 日志」（`dsh-session-log-export`），两者互不替代。

## 日志文件

| 来源 | 位置 | 内容 |
| --- | --- | --- |
| Host（本插件 Host 入口） | `$DSH_HOME/logs/host/` | 所有 `ctx.logger` 记录；Host stderr（插件 `console.error`、致命错误）按行记为 warn |
| 桌面主进程（随浏览器插件桌面载荷加载） | `app.getPath('logs')`（macOS `~/Library/Logs/<产品名>/`） | 渲染进程、子进程异常退出（含 Windows NTSTATUS 十六进制退出码）与导出记录 |

两处都按 DSH Desktop 的规则写 `dsh-YYYY-MM-DD.log`（全部级别）和 `dsh-YYYY-MM-DD.error.log`（warn 与 error）：单文件超过 10MB 滚动为 `.1`、`.2`…，目录超过 200MB 删除最旧文件，启动时删除 7 天前的文件，每次启动先写一行标识。写入前对每行脱敏：`sk-` 密钥、32 位以上的长 token、Bearer/Basic 凭据、Cookie、具名敏感字段（token、password、api_key 等，含 JSON）以及 URL 中的账号和敏感查询参数。日志目录是链接或不可用时只提示一次，不影响应用启动。

Host 插件晚于 DSH 自身启动加载，因此启动时先写入 Cordis 日志缓冲区中已有的记录（最多 1000 条），再接收实时记录。Cordis 的缓冲区只保留 error 与 info，插件加载前的 warn 无法补录；加载后的 warn 正常写入。

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `logLevel` | `info` | 写入文件的最低级别：`debug`、`info`、`warn`、`error` |
| `directory` | `$DSH_HOME/logs/host` | Host 日志目录；更改后桌面导出不会再找到它 |

## 导出

「设置 › 通用设置」最后一张卡片的「诊断信息 › 导出…」（界面插件提供，仅在桌面应用中显示）调用浏览器插件的桌面桥接 `browserAutomation.request('diagnostics', { action: 'export', locale })`。浏览器插件的桌面载荷是产品进入主进程的唯一插件入口，它打包本插件的 `src/desktop.ts` 并转发该请求，与界面缩放相同；导出不会启动浏览器本身。

主进程依次：

1. 显示原生隐私确认（文案沿用 DSH Desktop，增加「崩溃报告」），默认按钮为取消。
2. 收集证据，按以下顺序装入 50MB 上限：外壳的崩溃报告（`app.getPath('logs')/crash-*.log`）→ 本地崩溃转储（`app.getPath('crashDumps')` 下的 `.dmp`）→ 主进程与 Host 日志（最新优先）。链接形式的目录被拒绝，链接文件、消失或被锁的文件被跳过，超出上限的文件计入省略数量。
3. 写入 `system-info.txt`：产品名、版本、平台、架构、Node、Electron、Chrome 版本、各类文件的包含与省略数量和隐私提示。
4. 以临时文件写入后原子改名为 `<userData>/diagnostics/diagnostics-<时间>-<uuid>.zip`（权限 0600），只保留最新三份，然后在访达或资源管理器中显示。

ZIP 由 Node 自带的 zlib 生成（压缩在 libuv 线程池中进行，不阻塞主线程），桌面载荷因此不需要额外依赖。并发的导出请求共用同一次确认和同一个归档；失败时显示原生错误对话框。

归档结构：

```text
crash-reports/crash-…-host.log
crash-dumps/…/*.dmp
main/dsh-YYYY-MM-DD(.error).log
host/dsh-YYYY-MM-DD(.error).log
system-info.txt
```

## 与 DSH Desktop 的差异

- **入口在设置页，而不是托盘。** TP Cowork 的托盘菜单由桌面外壳固定（打开、退出），插件不能添加项目。
- **没有命令行导出。** DSH Desktop 的 `--export-diagnostics` 在不启动 Host 的情况下导出，需要修改桌面外壳的启动参数处理，插件做不到。应用无法启动时，可以直接打包上表中的两个日志目录和 `app.getPath('logs')` 下的崩溃报告。
- **主进程只记录进程异常。** 外壳自身的 `console` 输出不经过插件，未被记录；外壳的致命错误仍由其崩溃报告保存。主进程日志从桌面载荷加载时开始。
- **Host stderr 由 Host 内记录。** DSH Desktop 在主进程读取 Host 的 stderr；TP Cowork 的外壳只在内存中保留一小段，因此由 Host 插件在进程内转录。
- **没有生命周期证据、运行标记和 Crashpad 启动。** 这些由 DSH Desktop 的外壳实现；TP Cowork 外壳未启用 Crashpad 时，归档中没有 `.dmp`。

## 开发

```bash
node build.mjs --typecheck
node build.mjs                                   # Host 入口
node ../tpcowork-browser/build.mjs --install-native   # 更新桌面载荷中的导出
node ../../../deepseek-harness/node_modules/vitest/vitest.mjs run --config vitest.config.ts
```

真实 Host 与浏览器检查：在同级 `deepseek-harness` 执行 `node node_modules/vitest/vitest.mjs run --config ../tp-coworkdsh/scripts/tests/diagnostics.config.mjs --configLoader native --cache=false`，截图在 `artifacts/diagnostics/`。安装到开发 profile：先退出应用，再执行 `node scripts/desktop-plugin.mjs install diagnostics`。

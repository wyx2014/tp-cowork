# 自动化离线安装与调度移交

离线 kit 包含当前 worktree 构建的 automation Host、Client、声明及源码，DSH 运行依赖闭包、相关源码/产物、Web 静态资源、Electron 和官方 primary-runtime（Node、pnpm、Python/Office）。所有链接限定在包内，清单逐文件记录 SHA-256。kit 不包含用户任务、会话、凭证、模型选择或 nanobot-gui 数据。独立 automation 安装不安装 tpcowork-core，也不改变已有模型来源或默认选择。

## 制作

先在本任务 worktree 按 `docs/worktree-development.md` 安装并构建 DSH Host、Client、Web 和 automation，准备 Electron 及 `apps/desktop` 的 `prepare:primary-runtime`；完整 Client 聚合工程的既有 TS6307 必须另行记录，不能声称聚合检查通过。`pack-offline.mjs` 只接受此 worktree 内的输入，只写全新输出目录；不可用旧 tgz 代替。

```sh
node plugins/tpcowork-automation/build.mjs
node plugins/tpcowork-automation/pack-offline.mjs artifacts/tpco10/offline-kit
tar -czf artifacts/tpco10/automation-offline.tgz -C artifacts/tpco10 offline-kit
```

每个 OS/CPU 单独制作；本次验证范围见 `TPCO-10-delivery.md`。未签名的开发载体不等于已发布的签名桌面安装程序。接收机器需要相同 OS/CPU；解压后使用 kit 自带的 `node`（Windows 为 `node.exe`）。不需要 pnpm/npm 缓存、联网安装或 sibling 源工程。

## 首次安装与启动

明确指定 DSH_HOME；首次验证使用空目录。复用已有 home 时先退出 Desktop，再执行安装。工具会拒绝已有 Desktop 锁；不会删除锁或终止用户进程。

```sh
./node offline.mjs verify
./node offline.mjs install --home /your/isolated/dsh-home
./node offline.mjs dump-config --home /your/isolated/dsh-home
./node offline.mjs launch --home /your/isolated/dsh-home
```

`install` 通过官方 `runDesktopCli` 与 bundled pnpm 离线安装，profile 增加 automation 和 TP UI 外观依赖及 bundle。kit 的 Electron 载体使用本包内的最新 DSH runtime。保留 kit 目录，因为 profile 的 link 指向它。不要只把插件 tgz 装进缺少持久化删除、Session 引用接管或通知接口的旧 DSH；这不能满足本版本的完整运行条件。工作树开发安装也可执行 `node scripts/desktop-plugin.mjs install automation`，它要求先构建并初始化相应桌面 profile。

## 旧提醒的显式迁移

完整 patch 撤下原生 Schedule Host 和原生 UI 入口。没有旧 active 任务时直接启用 automation；有旧任务时，本插件只挂载原来的 ScheduleService，继续原生投递，新的 automation 调度器不启动。原生工具只在该 Schedule 服务存在时可用；完成移交后原生服务和工具一起撤销，仅剩同一个 automation 服务与 cron 工具。侧栏只保留一个“自动化”入口。

在自动化页面选择“迁移原生提醒”并确认：先按稳定 ID 持久化暂停副本，再保存 prepared 检查点，排空原生投递并重新核对最新定义；逐条确认副本后，将原生记录设为 inactive，最后激活新定义并启动唯一调度器。保留原 Session 关联和可识别的项目/目录；迁移后每次助手运行使用新的独立 Session。原始投递历史完整留在原生 `schedule` 域，不伪装成新的独立运行历史。

中断后保留 `tpcowork_automation_transfer` 检查点；重新加载时两个调度器均等待页面“恢复迁移”的明确确认。逐条提交可重复继续，不重复创建定义或重放原生投递。副本写入失败时不停止旧调度；移交后失败保持暂停并显示迁移未完成。过期一次提醒保留原时间并保持暂停，页面提示用户检查后选择“立即运行”。循环任务按 automation 的重启规则计算未来时间，不追补所有停机周期。原生 daily/weekly 的整秒精度保留；毫秒日历规则无法表示时明确拒绝，原任务继续调度，用户可先在原生管理调整规则。

## 更新、禁用与卸载

更新先关闭 Desktop，解压新的完整 kit 到新目录并 verify，然后对同一 home 执行 install；官方 profile 安装更新 link。旧目录保留到确认新目录可用，不运行新旧两个载体访问同一 home。更新保留定义、历史、已读状态和迁移检查点，不重写用户模型/凭证。

禁用使用桌面插件管理中 automation 的开关；卸载 automation 使用下面命令；TP UI 外观保留，可由原插件管理单独关闭或移除。两者撤销监听、通知、计时器并排空已准入工作；不会删除 storage-domain、运行历史或结果 Session。Host 退出期间没有后台执行。重装同一 home 读取原数据，按既有恢复规则确认未结算运行，不自动重放外部操作。

```sh
./node offline.mjs remove --home /your/isolated/dsh-home
```

完成移交后，卸载恢复原生入口，但原始任务仍为 inactive，不恢复其执行。迁移未确认时的任务仍归原生服务；尚在迁移检查点中的任务应先恢复迁移再卸载。保留 kit 与迁移数据，便于重新安装继续。此工具不删除任务数据，也不代替用户执行数据清理。

系统通知取决于应用已有通知权限。Toast 或调用 spy 不代表原生通知投递、系统横幅和可信点击已经通过；必须在验证记录中分别列出。离线执行外部模型/MCP 操作仍需用户原有的内网模型和连接器可达，纯提醒不调用模型。

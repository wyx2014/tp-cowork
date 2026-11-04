# DSH 电脑控制（Computer Use）

参照 ZCode 的 Computer Use：Agent 先选择应用，读取它的无障碍（辅助功能）树，按元素编号点击、填写，再重新读取确认结果；坐标只在无障碍信息看不到的内容上使用。支持 **Windows** 与 **macOS 13+**；**Linux X11** 代码相同，作为实验功能保留（Wayland 不支持）。默认关闭。

ZCode 的 Helper 未开源（`tp-cowork/packages/tpcowork-cua` 只是占位实现），因此原生部分改用 DSH 运行时已安装的 [Cua Driver](https://github.com/trycua/cua) 0.28（MIT，自带 Windows x64/arm64、macOS、Linux x64/arm64 预编译库）。模型看到的接口沿用 DSH 的 `@deepseek-ai/dsh-cua`（与 ZCode 同一形态的应用/窗口对象 API 与按应用授权），本插件提供 Windows/macOS/Linux 的原生实现。

## 组成

| 文件 | 职责 |
| --- | --- |
| `src/host.ts` | Host 插件：开关、平台判断、按 Agent 启动 Helper 进程，并把它交给 `dsh-cua` 的 `installCua`；设置页状态查询 |
| `src/helper.ts` → `lib/helper.mjs` | Helper 进程：每个 Agent 一个，在 stdio 上使用 `dsh-cua` 的 JSONL 协议（含取消），在本进程内加载 Cua Driver；原生崩溃只结束 Helper，不影响 Host |
| `src/bridge.ts` | 协议翻译：`dsh-cua` 的方法 → Cua Driver 工具 |
| `src/guidance.ts` | 模型指引：ZCode Computer Use 技能的规则（按用户原样的应用名、无障碍优先、先观察再操作再验证、拒绝后停止、仅主 Agent） |
| `src/client.tsx` | 设置 › 电脑控制：开关、当前设备状态（不支持时显示原因）、始终允许的应用 |
| `cordis.patch.yml` | 挂载 DSH 的 `computer-use` 独占注册表与本插件 |

| `dsh-cua` 方法 | Cua Driver 工具 |
| --- | --- |
| `getCapabilities` | `check_permissions` |
| `listApps` / `findApps` / `getApp` / `launchApp` | `list_apps` / `launch_app` |
| `listWindows` / `getState` / `screenshot` | `list_windows` / `get_window_state` |
| `click` / `setValue` / `performSecondaryAction` | `click`、`double_click`、`right_click` / `set_value` |
| `typeText` / `pressKey` / `paste` | `type_text` / `press_key` / `clipboard_write` + `hotkey`（macOS ⌘V，其他 Ctrl+V） |
| `scroll` / `drag` / `activate`、`show` | `scroll` / `drag` / `bring_to_front` |

- **坐标**：Host 把模型给出的截图像素换算为窗口点，Helper 再按同一窗口最近一次截图的像素/点比例换算为 Cua Driver 的截图像素，因此 Retina 和 Windows 高 DPI 下点击位置与模型所见一致。
- **元素编号**绑定观察时的 `snapshotId`；重新观察会替换旧编号，旧编号返回 `STALE_SNAPSHOT`。
- **授权**：`getApp` 会先询问用户（仅本任务 / 始终允许 / 拒绝）。授权身份是进程的真实可执行文件（Windows `Get-Process` 路径、macOS `.app` 包、Linux `/proc/<pid>/exe`）；无法解析时只提供本任务授权。始终允许的应用保存在本插件配置的 `allowedApps`，可在设置页移除，移除后正在进行的操作会被取消。
- **后台与前台**：操作默认送达后台窗口。平台只能把按键送到焦点窗口时返回 `FOREGROUND_REQUIRED`，模型按指引调用 `app.activate()` 后重试；此后该应用的键盘输入使用前台送达。
- **未提供**：`hover`、`selectText` 返回 `ACTION_UNAVAILABLE`（Cua Driver 无对应能力）；`performSecondaryAction` 只支持点击类和右键菜单类动作；粘贴 HTML 时按纯文本粘贴。

## 平台

| 平台 | 状态 | 需要 |
| --- | --- | --- |
| Windows 10/11 x64、arm64 | 支持 | 无额外权限；非打包应用启动时会获得焦点（Windows 限制） |
| macOS 13+ | 支持 | 「系统设置 › 隐私与安全性」中为 TP Cowork 打开「辅助功能」和「屏幕录制」；设置页显示两项状态 |
| macOS 12 及更早 | 不支持 | 设置页显示「需要 macOS 13 或更高版本」（Cua Driver 库最低 macOS 13） |
| Linux X11 x64、arm64（如 Kylin V10） | 实验 | X11 会话、AT-SPI 无障碍服务；glibc ≥ 2.30，以及 libX11、libXi、libxkbcommon |
| Linux Wayland | 不支持 | 设置页提示改用 X11（Xorg）会话 |

不支持的环境与 ZCode 一样显示说明，不提供开关。

## 配置

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 设置页开关；更改后插件重新加载，挂载或移除 `cua` 工具 |
| `allowedApps` | `[]` | 始终允许的应用（由授权对话写入，设置页可移除） |
| `driverPath` | — | 指定 Cua Driver 入口（绝对路径或 file URL），用于诊断和测试 |
| 其余 | 同 `dsh-cua` | `timeoutMs`、`maxElements`、`maxDepth`、`dragDurationMs` 等，见 `@deepseek-ai/dsh-cua` |

## 打包

`@trycua/cua-driver` 及其平台库随 DSH 运行时安装（`dsh-experimental-computer-use-cua-driver-native` 的依赖），在哪个系统上构建就带哪个系统的库，因此 Windows 安装包须在 Windows 上构建（现有 `windows-installer.yml` 即如此），macOS 包在 macOS 上构建。Helper 由 Host 的运行时（Electron，`ELECTRON_RUN_AS_NODE=1`）启动，用户无需安装 Node。

## 验证

```bash
node build.mjs --typecheck
node build.mjs
node ../../../deepseek-harness/node_modules/vitest/vitest.mjs run --config vitest.config.ts
```

- `tests/bridge.spec.ts`：协议翻译（应用选择与授权身份、元素操作、过期编号、Retina 坐标换算、组合键、滚动方向、粘贴、前台要求）与平台判断。
- `tests/channel.spec.ts`：用 `dsh-cua` 自己的 `NativeClient` 经本插件的进程通道驱动构建后的 Helper（替身驱动），覆盖拒绝与取消后连接仍可用。
- `tests/host.spec.ts`：在真实的 DSH 工具、Agent、用户提问和 computer-use 注册表中挂载本插件，以 Agent 身份调用 `cua`：授权询问 → getApp → getState → setValue；拒绝后停止；开关关闭时不提供工具。
- `tests/settings.spec.tsx`：设置页（开关、macOS 权限、移除始终允许的应用、不支持提示、Windows 就绪）。
- **真实驱动**：在 Linux X11 容器（Xvfb + xfwm4 + AT-SPI + Mousepad）中用真实 Cua Driver 0.28 运行构建后的 Helper：启动应用、读取 254 个元素、`setValue` 中文、`typeText`、截图、坐标点击、过期编号、后台按键返回 `FOREGROUND_REQUIRED` 且激活后成功，最终文本为「第一行 hello world」。

**尚未验证**：Windows 与 macOS 13+ 上的真实运行（开发机为 macOS 12，Cua Driver 无法加载），以及完整桌面应用中的端到端流程。请按下列清单在真机检查：

1. 退出应用，`node scripts/desktop-plugin.mjs install computer-use`，再 `npm run dev`。
2. 设置 › 电脑控制：Windows 显示「可以使用」；macOS 显示「辅助功能」「屏幕录制」两项，未授权时按提示授权后点「重新检查」。
3. 打开开关，新建会话：「用记事本（macOS：备忘录）新建一个文档，写入『你好，TP Cowork』」。应出现授权询问；选择「仅本任务」后应用中出现文字。
4. 再让它「点击保存按钮」，确认按元素点击生效；在高分屏上让它点击截图中的某个位置，确认位置准确。
5. 选择「始终允许」后，设置页「始终允许的应用」中出现该应用；移除后再次使用会重新询问。
6. 关闭开关后新会话中不再有 `cua` 工具。

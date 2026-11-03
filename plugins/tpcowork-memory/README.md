# DSH 工作区记忆

按工作区保存跨会话事实的 Host 插件，行为参照 ZCode 的 Project Memory（`ZCode.app/Contents/Resources/glm/zcode.cjs`，设计见 `tp-cowork/apps/tpcowork-cli/docs/design/v2/memory/README.md`）。默认关闭：与 ZCode 一样，自动提取会在每轮对话后多发一次模型请求。

## 启用

在「设置 → 记忆」中打开「工作区记忆」。开关写入本插件配置的 `enabled`（`.volatile()` 字段，保存在用户配置层），插件不重启：打开后注册提示段和工具，所有会话从下一条消息起生效；关闭后撤下提示段和工具，并中止进行中的提取。设置页只在 Host 提供本插件的配置时出现。开关说明沿用 ZCode 的文案：「在工作区中保存并复用长期上下文，新会话生效。开启后可能增加模型调用和 Token 成本。」

开启后，开关下方出现 ZCode 的记忆查看器（`MemorySettingsSection` / `MemorySettingsViewer` 的布局与文案）：没有记忆时显示虚线框「暂无已保存的工作区记忆」；有记忆时显示工作区选择器、记忆条数、文件搜索、「文件」标题和刷新按钮，以及 `MEMORY.md` 在前、其余按名称排序的文件列表，每行带更新时间（30 分钟内相对时间，之后为今天/昨天/星期/日期）。列表来自 Host 的只读 Remote `memoryCatalog.list`，扫描 `$DSH_HOME/memories/projects/*/memory/*.md`；已注册工作区使用其标题并按侧栏顺序排在前面，其余按最近更新排序并显示目录名。Host 有桌面时，每行右侧是打开按钮：主按钮用默认应用打开，下拉列出其他可用应用和「在文件夹中显示」（经 Session Remote 的 `openWorkspacePath`）。

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 设置页开关，实时生效；关闭时不注入提示、不提供工具、不提取 |
| `extraction` | `true` | 每个成功完成的轮次后，后台调用模型提取值得保存的事实 |
| `extractionMaxTokens` | `2048` | 单次提取的输出上限 |
| `extractionTimeoutMs` | `120000` | 单次提取的截止时间 |

## 存储

```text
$DSH_HOME/memories/projects/<目录名-路径哈希16位>/memory/
  MEMORY.md        每条记忆一行：- [name](name.md) — description
  <name>.md        一条事实，带 frontmatter（name、description、metadata.type、metadata.originSessionId）
```

隔离键与 ZCode 相同：工作区绝对路径（Windows 转小写）的 SHA-256 前 16 位，加目录名 slug。`DSH_HOME` 未设置时使用 `~/.dsh`。类型只有 `user`、`feedback`、`project`、`reference`。

## 模型看到什么

- 系统提示中的 `# Memory` 段：何时保存、如何去重、不保存什么。文案改编自 ZCode。
- 每个会话第一次请求时，`MEMORY.md` 作为一条 `tpcowork-memory` 用户上下文注入（最多 200 行或 25,000 字符）。恢复的会话已含这条消息，不再重复注入。同一会话内不重新加载。
- 工具 `memory_save`、`memory_delete`、`memory_read`。

## 与 ZCode 的差异

- **由工具写文件，而非 Write + 权限豁免。** DSH 沙箱只允许写会话工作区，不支持额外可写目录，所以记忆目录由插件工具写入，索引也由插件同步，模型不需要手动维护 `MEMORY.md`。
- **提取是一次模型调用。** ZCode 用最多 5 轮的受限子代理；这里让模型直接返回 `{"save":[...],"delete":[...]}`，每次最多 5 条保存和 5 条删除。
- **沿用的规则：** 只在成功完成的轮次后提取；本轮已直接写过记忆、或没有至少三个词（中日韩文本为三个字）的用户消息时跳过；每个会话同时只有一个提取在运行、一个最新的在等待；会话关闭或插件卸载时中止。
- **开关即时生效：** ZCode 在会话创建时冻结开关；这里切换后所有会话从下一条消息起生效。
- **查看器的打开按钮：** ZCode 列出固定的编辑器；这里列出 Host 系统为 `.md` 注册的应用。
- **未实现：** 语义召回（ZCode 也未启用）、Dream 整理、子代理记忆。

## 已知限制

- 系统提示段和工具对所有代理可见；子代理调用工具会被拒绝，提取也只对主会话运行。
- 提取使用会话当前的模型与服务商，失败不重试；中止或出错的轮次保留到下一个成功轮次再提取。

## 开发

```bash
node build.mjs --typecheck
node build.mjs
node ../../../deepseek-harness/node_modules/vitest/vitest.mjs run --config vitest.config.ts
```

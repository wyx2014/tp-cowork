---
name: tpcowork-api-auth
description: 演示技能如何安全复用当前 TP Cowork 登录用户的身份（Bearer token）调用内部接口：可即时查询“我是谁”，并提供 Python/curl/Node 调用范例与服务端校验指南，教技能开发者编写需要用户登录态的技能。
---

你现在执行**接口登录示例**。本技能演示：用户已在 TP Cowork 左下角「连接使用」登录后，技能脚本如何在**不接触明文登录令牌（token）**的前提下，以当前登录用户的身份调用内部接口。

## 核心原理（为什么不能直接获取明文 token）

出于凭证隔离安全设计，用户的 TP Cowork 登录 token 仅保存在 Host 后台进程私有凭证库中，**不会暴露**给技能脚本、环境变量、模型上下文或日志（包括「办公电话」Cisco 也是在 Host 原生工具内使用 token，从未下发给脚本）。

普通技能复用登录态的标准方式是走 **TP Cowork 本机转发代理**：

1. Host 为技能执行的命令自动注入三个环境变量：
   - `DSH_TPCOWORK_API_URL`：本机环回转发地址（如 `http://127.0.0.1:53817`）
   - `DSH_TPCOWORK_API_KEY`：每次启动随机生成的**本机转发口令**（仅用于证明请求来自当前应用，**不是**用户登录 token）
   - `DSH_TPCOWORK_PYTHON`：TP Cowork 自带的 Python 可执行文件路径
2. 技能脚本只需带请求头 `X-TPCowork-Key: $DSH_TPCOWORK_API_KEY` 请求 `$DSH_TPCOWORK_API_URL/<接口名>/<路径>`。
3. Host 校验口令并在白名单（`tpcoworkhub.apis`，其中 `hub` 始终指向 TP Cowork Hub）中匹配目标地址后，去掉 `X-TPCowork-Key`，**自动附加 `Authorization: Bearer <当前用户登录 token>`** 转发给目标内部接口，并原样返回响应。

## 何时使用

- 用户问「我现在以谁的身份登录」「技能能不能用我的账号访问接口」。
- 用户问「怎么获取用户登录后的 token」「怎么开发需要用户登录态的技能」「参考办公电话怎么做鉴权」。

## 执行步骤

### 场景 A：检查当前登录身份（运行演示）

1. 运行本技能目录下的演示脚本（`<skill-directory>` 换成本技能目录的绝对路径）：
   - bash：`"$DSH_TPCOWORK_PYTHON" "<skill-directory>/scripts/whoami.py"`
   - PowerShell：`& $env:DSH_TPCOWORK_PYTHON "<skill-directory>/scripts/whoami.py"`
2. 根据输出回答：
   - `"signedIn": true`：告诉用户当前以哪个账号（`name` / `username` / `id`）访问内部接口。
   - `"signedIn": false`：请用户点击左下角「连接使用」登录后再试。
   - 其他 `error`：说明接口暂不可用，如实转述 `message`，不要猜测原因。

### 场景 B：教用户编写带登录态的技能

1. 读取 `<skill-directory>/references/auth-guide.md`，按用户的开发语言（Python / curl / Node.js）和角色（技能作者 / 后端接口开发者 / 管理员）给出对应示例。
2. 核心三步概括给用户：
   - **管理员登记接口**：在 `cordis.patch.yml` 的 `tpcowork-toolbox.config.tpcoworkhub.apis` 中配置 `<接口名>: <基础地址>`（`hub` 始终可用，无需登记）。
   - **技能脚本发请求**：复制本技能的 `scripts/tpcowork_api.py` 到目标技能的 `scripts/`，调用 `call("<接口名>", "/路径")`（或用其他语言带 `X-TPCowork-Key` 请求 `$DSH_TPCOWORK_API_URL/<接口名>/<路径>`）。
   - **内部接口验身份**：从请求头读取 `Authorization: Bearer <token>`，向 Hub `/tpcoworkapi/convex/query`（`{"path": "users:me", "args": {}}`）核验身份并做权限控制与缓存。
3. 如用户询问为什么不能像某些脚本那样直接拿到明文 token 或把 token 写进 JSON Body，请转述 `references/auth-guide.md` 中关于安全隔离及与「办公电话（Cisco）」原生工具差异的说明。

## 注意

- **严禁**打印、回显或要求用户提供 `DSH_TPCOWORK_API_KEY`、登录 token 或任何 `Authorization` 请求头内容。
- **严禁**尝试读取 TP Cowork 本机凭据文件或绕过本地转发代理直连上游接口。
- 只报告脚本输出中的账号字段，不编造用户信息。

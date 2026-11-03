---
name: tpcowork-api-auth
description: 演示技能如何以当前登录 TP Cowork 的用户身份调用内部接口：查询“我是谁”，并作为编写此类技能的范例。
---

你现在执行**接口登录示例**。本技能演示：用户已在 TP Cowork 中“连接使用”登录后，技能脚本调用内部接口时会自动带上该用户的登录，接口据此知道是谁在请求、并按其权限返回数据。脚本本身拿不到登录令牌。

## 何时使用

- 用户问“我现在以谁的身份登录”“技能能不能用我的账号访问接口”。
- 用户想学习或检查如何编写需要登录的技能。

## 执行步骤

1. 运行本技能目录下的演示脚本（`<skill-directory>` 换成本技能目录的绝对路径）：
   - bash：`"$DSH_TPCOWORK_PYTHON" "<skill-directory>/scripts/whoami.py"`
   - PowerShell：`& $env:DSH_TPCOWORK_PYTHON "<skill-directory>/scripts/whoami.py"`
2. 根据输出回答：
   - `"signedIn": true`：告诉用户当前以哪个账号（name / username）访问内部接口。
   - `"signedIn": false`：请用户点击左下角“连接使用”登录后再试。
   - 其他 `error`：说明接口暂不可用，转述 message，不要猜测原因。
3. 如果用户想写自己的技能，说明做法：把 `scripts/tpcowork_api.py` 复制到自己技能的 `scripts/`，用 `call("<接口名>", "/路径")` 调用；接口名由管理员在 TP Cowork 配置中登记（`tpcoworkhub.apis`），`hub` 始终指向 TP Cowork Hub。详见《技能调用内部接口指南》（`docs/toolbox/skill-api-auth.md`）。

## 注意

- 不要打印或回显 `DSH_TPCOWORK_API_KEY` 或任何 Authorization 内容；它们不是给用户看的信息。
- 不要尝试读取 TP Cowork 的凭据文件或绕过本地转发直接调用接口。
- 只报告脚本输出中的账号字段，不编造用户信息。

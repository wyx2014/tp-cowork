# 技能调用内部接口指南：以当前登录用户的身份

用户在 TP Cowork 左下角点击「连接使用」登录后，技能脚本调用内部接口时会**自动带上该用户的登录**。接口因此知道是谁在请求，并按此人的权限返回数据、记录操作。技能脚本**拿不到登录令牌**，也不需要处理账号密码。

内置技能「接口登录示例」（`tpcowork-api-auth`）就是按本指南编写的完整范例，可以直接复制。

## 一、它是怎么工作的

```
技能脚本                        TP Cowork（用户电脑上）                     内部接口
────────                        ──────────────────────                     ────────
GET $DSH_TPCOWORK_API_URL/crm/customers?mine=1
    X-TPCowork-Key: …      ──▶  1. 核对 Key（确认请求来自本应用的技能命令）
                                2. 在白名单中查 crm → https://crm.intra/api
                                3. 去掉 Key，加上
                                   Authorization: Bearer <用户的登录令牌>
                                4. GET https://crm.intra/api/customers?mine=1 ──▶ 验证令牌 → 用户 zhangsan
                                                                                  按其权限查询、记录日志
                                                                             ◀── 200 [zhangsan 的客户…]
    ◀────────────────────────── 5. 原样返回接口的响应
```

- 脚本只需要发**一次**请求，拿到的就是接口返回的数据，不存在“先换令牌再调用”的步骤。
- `DSH_TPCOWORK_API_KEY` 不是登录令牌，只是本机转发服务的口令（每次启动 TP Cowork 随机生成，只在本机 `127.0.0.1` 有效）。内部接口看不到它。
- 登录令牌只保存在 TP Cowork 的后台进程中，不会出现在脚本环境、模型对话或日志里。

TP Cowork 为技能执行的每条命令提供三个环境变量：

| 变量 | 含义 |
|---|---|
| `DSH_TPCOWORK_API_URL` | 本机转发地址，例如 `http://127.0.0.1:53817`。路径第一段是接口名：`/crm/...` 表示登记为 `crm` 的接口 |
| `DSH_TPCOWORK_API_KEY` | 转发口令，放在请求头 `X-TPCowork-Key` 中 |
| `DSH_TPCOWORK_PYTHON` | TP Cowork 自带的 Python，运行脚本用 `"$DSH_TPCOWORK_PYTHON" script.py`，用户电脑无需安装 Python |

## 二、三方各自要做什么

### 1. 管理员：登记接口

只有登记过的接口才会收到用户登录，其他地址一律拒绝。在发行配置（`cordis.patch.yml`）中给 `tpcowork-toolbox` 增加 `tpcoworkhub.apis`，键是技能中使用的接口名，值是接口的基础地址：

```yaml
- id: tpcowork-toolbox
  config:
    tpcoworkhub:
      apis:
        crm: https://crm.intra.example.com/api
        report: http://10.1.2.3:8000/report     # 内网开发可用 http
```

- `hub` 始终指向 TP Cowork Hub 本身，无需登记。
- 地址不能包含账号、`?` 查询参数或 `#`。
- 脚本访问的路径只能在该地址之下，例如 `crm` 只能访问 `https://crm.intra.example.com/api/...`。

### 2. 接口开发者：识别用户

接口会收到标准的 `Authorization: Bearer <令牌>` 请求头。用这个令牌向 TP Cowork Hub 询问用户身份，得到用户 id、用户名和姓名，再据此做权限判断和审计：

```python
# 示例：FastAPI 依赖，校验每个请求的用户
import httpx
from fastapi import Header, HTTPException

HUB = "https://hub.intra.example.com"

async def current_user(authorization: str = Header(...)):
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{HUB}/tpcoworkapi/convex/query",
                              json={"path": "users:me", "args": {}},
                              headers={"Authorization": authorization})
    if r.status_code != 200:
        raise HTTPException(401, "TP Cowork 登录无效或已过期")
    user = r.json()          # {"_id": "...", "username": "zhangsan", "name": "张三"}
    return user
```

- 请把验证结果缓存几分钟，避免每个请求都询问 Hub。
- 令牌无效时返回 401；有身份但无权限时返回 403。TP Cowork 会把这些状态原样交给脚本。
- 如果 Hub 的令牌是签名的 JWT，也可以直接验证签名，不必回调 Hub（需向 Hub 团队确认签名方式）。

### 3. 技能作者：编写技能

目录结构（以 `customer-report` 为例）：

```
customer-report/
├── SKILL.md
└── scripts/
    ├── tpcowork_api.py     ← 从「接口登录示例」技能复制，不要修改
    └── report.py
```

`scripts/report.py`：

```python
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tpcowork_api import call, LoginRequired, RelayError

try:
    status, data = call("crm", "/customers", params={"mine": 1})
except LoginRequired as error:
    print(json.dumps({"signedIn": False, "message": str(error)}, ensure_ascii=False)); sys.exit(2)
except RelayError as error:
    print(json.dumps({"error": error.code, "message": str(error)}, ensure_ascii=False)); sys.exit(1)

if status == 403:
    print(json.dumps({"error": "forbidden", "message": "当前账号无权查看客户数据"}, ensure_ascii=False)); sys.exit(1)
print(json.dumps(data, ensure_ascii=False))
```

`call(接口名, 路径, method="GET", params=None, json=None, headers=None)` 返回 `(状态码, 数据)`：
- 数据是 JSON 时自动解析，否则返回文本。
- 接口自己的错误状态（403、404、500 等）照常返回。
- 用户未登录或登录过期时抛出 `LoginRequired`；转发服务拒绝时抛出 `RelayError`。

`SKILL.md` 里告诉模型如何运行脚本、如何处理结果：

```markdown
---
name: customer-report
description: 以当前登录用户的身份查询其客户并生成报告。
---

1. 运行 `"$DSH_TPCOWORK_PYTHON" "<skill-directory>/scripts/report.py"`（PowerShell：`& $env:DSH_TPCOWORK_PYTHON ...`）。
2. 输出 `"signedIn": false` 时，请用户点击左下角「连接使用」登录后重试。
3. 输出 `error` 时如实转述 message，不要猜测或编造数据。
4. 不要打印 `DSH_TPCOWORK_API_KEY` 或任何 Authorization 内容。
```

其他语言也可以直接发 HTTP 请求，只要满足两点：地址为 `$DSH_TPCOWORK_API_URL/<接口名>/<路径>`，请求头带 `X-TPCowork-Key: $DSH_TPCOWORK_API_KEY`。

## 三、错误与排查

转发服务自己拒绝的请求，响应头会带 `X-TPCowork-Relay-Error`，以区别于接口本身的错误：

| 代码 | 状态 | 原因与处理 |
|---|---|---|
| `login-required` | 401 | 用户未登录。请用户点击「连接使用」 |
| `login-expired` | 401 | 登录已过期。请用户重新「连接使用」 |
| `unknown-api` | 404 | 接口名未登记，或路径写成了 `/../` 之类越界路径。检查 `tpcoworkhub.apis` |
| `bad-key` | 403 | 没带或带错 `X-TPCowork-Key`；只能在 TP Cowork 执行的命令中使用 |
| `upstream-unreachable` | 502 | 接口连不上或超时（默认 30 秒，`tpcoworkhub.requestTimeoutMs`） |
| `too-large` | 413 | 请求或响应超过 `tpcoworkhub.maxResponseBytes`（默认 96 MB） |
| `not-configured` | 503 | 未配置 TP Cowork Hub 地址 |

没有 `X-TPCowork-Relay-Error` 的 401/403 来自接口本身：Hub 返回 401 时 TP Cowork 会把该登录标记为过期；其他接口的 401/403 直接交给脚本处理。

调试建议：
- 先运行内置「接口登录示例」技能（对话中输入“我现在以谁的身份登录？”），确认登录与转发正常。
- 脚本必须在 TP Cowork 中由模型执行（三个环境变量只存在于这些命令中）。在终端单独运行会得到 `no-relay` 错误。

## 四、安全须知

- 接口地址重定向（3xx）会原样交给脚本，TP Cowork 不会带着用户登录跟随跳转到其他地址。
- 脚本的 Cookie 和 `X-TPCowork-Key` 不会转发给接口；接口返回的 `Set-Cookie` 也不会交给脚本。
- 用户退出登录后，转发立即停止；下次启动 TP Cowork 会生成新的转发口令。
- 已知局限：模型执行的命令与 TP Cowork 以同一系统用户运行。转发机制可以防止令牌被意外打印到对话或日志中，但不能阻止刻意读取本机凭据文件的程序。请只安装可信来源的技能。
- 实现位于 `plugins/tpcowork-toolbox/src/host/tpcoworkhub/relay.ts`；端到端测试见 `scripts/tests/skill-api-auth.spec.mjs`。

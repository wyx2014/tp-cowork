# 技能复用用户登录态（Bearer Token）开发范例

本文档供技能开发者、内部接口开发者与管理员参考，说明如何在 TP Cowork 中安全使用当前登录用户的身份访问内部接口。

---

## 1. 工作原理与内置环境变量

用户在 TP Cowork 左下角点击「连接使用」登录后，登录令牌（token）仅保存在 Host 后台进程私有凭证库中，**不会下发到脚本环境、模型上下文或日志**。

技能脚本发起内部接口请求时，统一经过 Host 启动的本机环回转发代理（`127.0.0.1`）：

```text
技能脚本                          TP Cowork Host（本机 127.0.0.1）               内部接口
────────                          ──────────────────────────────               ────────
GET $DSH_TPCOWORK_API_URL/crm/customers?mine=1
  X-TPCowork-Key: $DSH_TPCOWORK_API_KEY
                             ──▶  1. 校验 X-TPCowork-Key（本机一次性口令）
                                  2. 在白名单 tpcoworkhub.apis 查找 crm 基础地址
                                  3. 移除 X-TPCowork-Key 与 Cookie
                                  4. 注入 Authorization: Bearer <用户登录 token>
                                  5. 转发到目标接口 ──────────────────────────▶  读取 Authorization Header
                                                                                 向 Hub 核验用户身份与权限
                                                                            ◀──  200 JSON 业务数据
                             ◀──  6. 移除 Set-Cookie，原样返回状态码与响应体
```

TP Cowork 为技能执行的每条命令自动注入三个环境变量：

| 变量名 | 说明 |
| --- | --- |
| `DSH_TPCOWORK_API_URL` | 本机转发服务基地址，如 `http://127.0.0.1:53817`。路径首段为接口名（如 `/hub/...`、`/crm/...`）。 |
| `DSH_TPCOWORK_API_KEY` | 本次启动随机生成的本机转发口令，放在请求头 `X-TPCowork-Key` 中；**它不是用户登录 token**，也不会发给目标接口。 |
| `DSH_TPCOWORK_PYTHON` | TP Cowork 自带 Python 路径，推荐用 `"$DSH_TPCOWORK_PYTHON" script.py` 执行脚本，用户电脑无需另装 Python。 |

---

## 2. 技能脚本调用示例（三种语言）

### 方式一：Python（推荐，零第三方依赖）

将本技能目录下的 `scripts/tpcowork_api.py` 复制到自己技能的 `scripts/` 目录，然后编写业务脚本：

```python
# scripts/my_action.py
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tpcowork_api import LoginRequired, RelayError, call  # noqa: E402


def main():
    try:
        # 1) GET 示例：调用管理员登记为 "crm" 的内部接口
        status, data = call("crm", "/customers", params={"mine": 1})
        # 2) POST 示例：
        # status, data = call("crm", "/orders", method="POST", json={"sku": "A1"})
    except LoginRequired as error:
        print(json.dumps({"signedIn": False, "message": str(error)}, ensure_ascii=False))
        return 2
    except RelayError as error:
        print(json.dumps({"error": error.code, "message": str(error)}, ensure_ascii=False))
        return 1

    if status == 403:
        print(json.dumps({"error": "forbidden", "message": "当前账号无权访问该资源"}, ensure_ascii=False))
        return 1
    if status >= 400:
        print(json.dumps({"error": f"api-{status}", "detail": data}, ensure_ascii=False))
        return 1

    print(json.dumps(data, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 方式二：curl（bash / PowerShell）

适合快速调试或极简脚本（`hub` 接口名默认可用，无需登记）：

**bash / macOS / Linux：**
```bash
# 查询当前登录用户（Hub 内置接口）
curl -sS -X POST "$DSH_TPCOWORK_API_URL/hub/tpcoworkapi/convex/query" \
  -H "X-TPCowork-Key: $DSH_TPCOWORK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"path":"users:me","args":{}}'

# 调用已登记的内部业务接口（示例：crm）
curl -sS "$DSH_TPCOWORK_API_URL/crm/customers?mine=1" \
  -H "X-TPCowork-Key: $DSH_TPCOWORK_API_KEY"
```

**PowerShell（Windows）：**
```powershell
Invoke-RestMethod -Method Post `
  -Uri "$env:DSH_TPCOWORK_API_URL/hub/tpcoworkapi/convex/query" `
  -Headers @{ "X-TPCowork-Key" = $env:DSH_TPCOWORK_API_KEY } `
  -ContentType "application/json" `
  -Body '{"path":"users:me","args":{}}'
```

### 方式三：Node.js（Node 22+ 原生 `fetch`，零依赖）

```javascript
const base = process.env.DSH_TPCOWORK_API_URL;
const key = process.env.DSH_TPCOWORK_API_KEY;
if (!base || !key) {
  console.error(JSON.stringify({ error: "no-relay", message: "请在 TP Cowork 内执行此脚本" }));
  process.exit(1);
}

const res = await fetch(`${base}/hub/tpcoworkapi/convex/query`, {
  method: "POST",
  headers: {
    "X-TPCowork-Key": key,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({ path: "users:me", args: {} }),
});

const relayError = res.headers.get("x-tpcowork-relay-error");
const body = await res.json().catch(() => null);
if (relayError === "login-required" || relayError === "login-expired") {
  console.log(JSON.stringify({ signedIn: false, message: body?.message ?? "请先登录 TP Cowork" }));
  process.exit(2);
}
if (relayError) {
  console.log(JSON.stringify({ error: relayError, message: body?.message ?? "转发服务拒绝请求" }));
  process.exit(1);
}
console.log(JSON.stringify({ status: res.status, data: body }));
```

---

## 3. 后端接口如何校验用户 Bearer Token

目标内部接口会收到标准请求头 `Authorization: Bearer <用户登录 token>`。接口拿到该请求头后，向 TP Cowork Hub 核验当前用户身份（建议按 token 哈希缓存结果 3–5 分钟，避免每次请求回源）：

### Python（FastAPI）示例

```python
import httpx
from fastapi import Header, HTTPException

HUB = "https://hub.intra.example.com"  # 替换为实际 TP Cowork Hub 地址


async def current_user(authorization: str = Header(...)):
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{HUB}/tpcoworkapi/convex/query",
            json={"path": "users:me", "args": {}},
            headers={"Authorization": authorization},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="TP Cowork 登录无效或已过期")
    data = r.json()
    user = data.get("value") or data.get("data") or data if isinstance(data, dict) else None
    if not isinstance(user, dict) or not (user.get("_id") or user.get("id")):
        raise HTTPException(status_code=401, detail="TP Cowork 登录无效或已过期")
    return user  # {"_id": "...", "username": "zhangsan", "name": "张三"}
```

### Node.js 示例

```javascript
export async function verifyTpcoworkUser(hubBaseUrl, authorizationHeader) {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const res = await fetch(`${hubBaseUrl.replace(/\/+$/, "")}/tpcoworkapi/convex/query`, {
    method: "POST",
    headers: {
      Authorization: authorizationHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: "users:me", args: {} }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const raw = await res.json();
  const user = raw?.value ?? raw?.data ?? raw;
  return user && (user._id || user.id) ? user : null;
}
```

- 令牌无效或过期时请返回 `401`；身份有效但无业务权限时请返回 `403`。
- 若 Hub 颁发的是带签名的 JWT，也可在确认公钥/验签方式后本地离线验签。

---

## 4. 管理员如何登记内部接口白名单

出于安全限制，只有白名单中的接口才会收到用户登录态。管理员需在发行配置 `cordis.patch.yml` 的 `tpcowork-toolbox` 下配置 `tpcoworkhub.apis`：

```yaml
- id: tpcowork-toolbox
  config:
    tpcoworkhub:
      apis:
        crm: https://crm.intra.example.com/api
        report: http://10.1.2.3:8000/report
```

- `hub` 始终指向当前连接的 TP Cowork Hub，无需手动登记。
- 基础地址仅允许 `http://` 或 `https://`，不能包含账号密码、`?` 查询串或 `#`。
- 路径穿越（如 `/crm/../other`）会被转发服务直接拦截。

---

## 5. 与「办公电话（Cisco）」机制的区别

「办公电话」是 TP Cowork 内置的 **Host 原生工具**（`call`），它在 Host 进程内通过私有服务 `toolboxTpcoworkHub.dialCisco()` 直接读取凭证库中的 token，发往 Cisco MCP 代理的 `Authorization: Bearer <token>` 请求头和下游工具参数，同样**不会向模型或脚本暴露明文 token**。

普通技能没有 Host 内部代码权限，因此统一通过本指南的**本机转发代理**复用登录态：
- 代理自动在请求头注入 `Authorization: Bearer <token>`；
- 代理不会修改 JSON 请求体，因此新建内部接口请直接从 `Authorization` 请求头获取令牌，不要要求调用方把明文 token 放进请求体参数中。

---

## 6. 常见错误码（`X-TPCowork-Relay-Error`）

当响应头包含 `X-TPCowork-Relay-Error` 时，表示请求被本机转发服务拒绝（而非上游业务接口报错）：

| 错误码 | HTTP 状态 | 原因与处理 |
| --- | --- | --- |
| `login-required` | 401 | 用户未登录，请引导用户点击左下角「连接使用」。 |
| `login-expired` | 401 | 登录态已过期，请引导用户重新「连接使用」。 |
| `unknown-api` | 404 | 接口名未在 `tpcoworkhub.apis` 中登记。 |
| `bad-path` | 400 | 请求路径包含越界片段（如 `/../`），超出目标接口基础路径。 |
| `bad-key` | 403 | 缺失或写错 `X-TPCowork-Key` 请求头。 |
| `upstream-unreachable` | 502 | 目标接口无法连接或请求超时（默认 30 秒）。 |
| `too-large` | 413 | 请求体或响应体超过单次转发上限（默认 96 MB）。 |
| `not-configured` | 503 | 当前环境未配置 TP Cowork Hub 地址。 |
| `no-relay`（脚本抛出） | — | 脚本在 TP Cowork 外部终端直接运行，缺少 `DSH_TPCOWORK_API_URL` 环境变量。 |

> 安全约束：转发服务绝不会带着用户登录态跟随 3xx 重定向，也会剥离脚本发送的 Cookie/Key 和上游返回的 `Set-Cookie`。用户退出登录后，转发立即失效。

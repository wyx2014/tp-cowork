"""Call internal APIs as the user who is signed in to TP Cowork.

Copy this file into your own skill's scripts/ folder and use it like this:

    from tpcowork_api import call, LoginRequired

    status, data = call("crm", "/customers", params={"mine": 1})
    status, data = call("crm", "/orders", method="POST", json={"sku": "A1"})

`call` sends the request to TP Cowork's local relay ($DSH_TPCOWORK_API_URL). The relay adds the user's login
(`Authorization: Bearer <token>`) and forwards it to the API registered under that name, so the API knows who is
asking and what they may do. Your script never sees the token. Only the Python standard library is used.
"""
import json as _json
import os
import urllib.error
import urllib.parse
import urllib.request


class LoginRequired(Exception):
    """The user is not signed in to TP Cowork, or their login expired. Ask them to click 连接使用."""


class RelayError(Exception):
    """The relay refused the request: unknown API, wrong key, unreachable API, or too large."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def call(api, path, method="GET", params=None, json=None, headers=None, timeout=60):
    """Call `path` on the API registered as `api` (for example "crm"), as the signed-in user.

    Returns (status, data): data is parsed JSON when the API answers with JSON, otherwise text.
    The API's own error statuses (403, 404, 500...) are returned, not raised.
    Raises LoginRequired when the user must sign in, RelayError when the relay itself refused.
    """
    base = os.environ.get("DSH_TPCOWORK_API_URL")
    key = os.environ.get("DSH_TPCOWORK_API_KEY")
    if not base or not key:
        raise RelayError("no-relay", "Run this inside TP Cowork: $DSH_TPCOWORK_API_URL is not set.")
    url = f"{base}/{urllib.parse.quote(api)}/{path.lstrip('/')}"
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    body = None
    request_headers = {"X-TPCowork-Key": key, "Accept": "application/json", **(headers or {})}
    if json is not None:
        body = _json.dumps(json).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, _decode(response)
    except urllib.error.HTTPError as response:
        relay_error = response.headers.get("X-TPCowork-Relay-Error")
        data = _decode(response)
        if relay_error in ("login-required", "login-expired"):
            raise LoginRequired(data.get("message") if isinstance(data, dict) else str(data)) from None
        if relay_error:
            raise RelayError(relay_error, data.get("message") if isinstance(data, dict) else str(data)) from None
        return response.status, data


def _decode(response):
    raw = response.read().decode("utf-8", errors="replace")
    if "json" in (response.headers.get("Content-Type") or ""):
        try:
            return _json.loads(raw)
        except ValueError:
            pass
    return raw

"""Demo: ask the TP Cowork Hub who the signed-in user is, through the relay.

The Hub is always registered under the name "hub". Its `users:me` query answers with the user that the request's
login belongs to, which is exactly what any internal API does to find out who is calling.
Run: "$DSH_TPCOWORK_PYTHON" scripts/whoami.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tpcowork_api import LoginRequired, RelayError, call  # noqa: E402


def main():
    try:
        status, data = call("hub", "/tpcoworkapi/convex/query", method="POST", json={"path": "users:me", "args": {}})
    except LoginRequired as error:
        print(json.dumps({"signedIn": False, "message": str(error)}, ensure_ascii=False))
        return 2
    except RelayError as error:
        print(json.dumps({"error": error.code, "message": str(error)}, ensure_ascii=False))
        return 1
    if status != 200:
        print(json.dumps({"error": f"hub-{status}", "detail": data}, ensure_ascii=False))
        return 1
    # Deployments answer with the user itself, or wrap it in "value" / "data".
    user = data.get("value") or data.get("data") or data if isinstance(data, dict) else {}
    print(json.dumps({
        "signedIn": True,
        "id": user.get("_id") or user.get("id"),
        "username": user.get("username"),
        "name": user.get("name"),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
